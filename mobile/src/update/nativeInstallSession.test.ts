import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_LOCALE } from '../localization';

/**
 * The native updater has no JVM test harness, so the session hand-over that
 * the JS store relies on is pinned on the Kotlin sources: their order is the
 * contract the README describes.
 */
const NATIVE_DIR = '../../modules/loggerythm-updater/android/src/main/java/top/logge/loggerythm/updater/';

function nativeSource(file: string): string {
  return readFileSync(fileURLToPath(new URL(`${NATIVE_DIR}${file}`, import.meta.url)), 'utf8');
}

/** The body of `private fun <name>(` up to the next member declaration. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`private fun ${name}(`);
  if (start < 0) throw new Error(`Kotlin function ${name} not found`);
  const next = source.slice(start + 1).search(/\n {2}(private |internal |override |@ReactMethod|companion object)/);
  if (next < 0) throw new Error(`End of Kotlin function ${name} not found`);
  return source.slice(start, start + 1 + next);
}

/** Asserts that every marker occurs in `body`, in this order. */
function expectInOrder(body: string, markers: string[]): void {
  let from = 0;
  for (const marker of markers) {
    const at = body.indexOf(marker, from);
    expect(at, `"${marker}" after position ${from}`).toBeGreaterThanOrEqual(0);
    from = at + marker.length;
  }
}

describe('native install session hand-over', () => {
  const requestInstall = functionBody(nativeSource('LoggeRythmUpdaterModule.kt'), 'requestInstall');

  it('ends earlier sessions only once the new session holds the verified APK', () => {
    // A failure to create, open or write the new session leaves the earlier
    // session (and its pending-install marker in JS) intact.
    expectInOrder(requestInstall, [
      'installer.createSession(',
      'installer.openSession(sessionId)',
      'session.openWrite(',
      'session.fsync(',
      'InstallSessionStore.clear(',
      'LoggeRythmUpdateInstallReceiver.cancelUpdateNotification(',
      'abandonEarlierSession(installer, earlier.sessionId)',
      'InstallOutcomeStore.clear(',
      'InstallSessionStore.setCurrent(reactContext, sessionId)',
      'session.commit(',
    ]);
  });

  it('never abandons the session it just created', () => {
    expect(requestInstall).toMatch(/earlier\.sessionId != sessionId/);
  });

  it('gives a still-open earlier session its current-session role back when the attempt fails', () => {
    expect(requestInstall).toMatch(/restoreCurrentSession\(installer, previousSession/);
  });

  it('cancels a stale "update ready" notification when the current session ends without success', () => {
    const receiver = nativeSource('LoggeRythmUpdateInstallReceiver.kt');
    expectInOrder(functionBody(receiver, 'reportOutcome'), [
      'InstallOutcomeStore.save(',
      'cancelUpdateNotification(context)',
    ]);
  });
});

describe('native install receiver toasts', () => {
  const RES_DIR = '../../modules/loggerythm-updater/android/src/main/res/';

  function stringResource(values: string, name: string): string {
    const xml = readFileSync(fileURLToPath(new URL(`${RES_DIR}${values}/strings.xml`, import.meta.url)), 'utf8');
    const match = new RegExp(`<string name="${name}">([^<]*)</string>`).exec(xml);
    if (match === null) throw new Error(`String resource ${name} missing in ${values}/strings.xml`);
    return match[1];
  }

  /** onReceive's branch for every installer end that is neither success nor pending. */
  function failureBranch(): string {
    const receiver = nativeSource('LoggeRythmUpdateInstallReceiver.kt');
    const start = receiver.indexOf('override fun onReceive(');
    const branch = receiver.indexOf('      else -> {', start);
    const end = receiver.indexOf('  /**', branch);
    if (start < 0 || branch < 0 || end < 0) throw new Error('Failure branch of onReceive not found');
    return receiver.slice(branch, end);
  }

  it('says a cancelled install was cancelled, short and localized, instead of "failed" with raw detail', () => {
    expectInOrder(failureBranch(), [
      'if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {',
      'texts.getString(R.string.loggerythm_updater_cancelled_toast)',
      '} else {',
      'texts.getString(R.string.loggerythm_updater_failed_toast, message)',
      'showFailure(context, message, toastText)',
      // The stored outcome still carries the code and Android's message.
      'PackageInstaller.STATUS_FAILURE_ABORTED -> INSTALL_ABORTED_CODE',
      'reportOutcome(',
    ]);
    expect(stringResource('values', 'loggerythm_updater_cancelled_toast')).toBe('LoggeRythm update cancelled.');
    expect(stringResource('values-de', 'loggerythm_updater_cancelled_toast')).toBe('LoggeRythm-Update abgebrochen.');
  });

  it('still logs every non-success end with Android\'s message and toasts only the given text', () => {
    const body = functionBody(nativeSource('LoggeRythmUpdateInstallReceiver.kt'), 'showFailure');
    expectInOrder(body, [
      'Log.e(TAG, "Update installation failed: $message")',
      'Toast.makeText(context, toastText, Toast.LENGTH_LONG).show()',
    ]);
    expect(body).not.toContain('loggerythm_updater_failed_toast');
  });

  /** onReceive's branch for STATUS_PENDING_USER_ACTION. */
  function pendingBranch(): string {
    const receiver = nativeSource('LoggeRythmUpdateInstallReceiver.kt');
    const start = receiver.indexOf('PackageInstaller.STATUS_PENDING_USER_ACTION -> {');
    const end = receiver.indexOf('      else -> {', start);
    if (start < 0 || end < 0) throw new Error('Pending branch of onReceive not found');
    return receiver.slice(start, end);
  }

  it('says an abandoned, unconfirmed update was not confirmed instead of "ready" when notifications are blocked', () => {
    expectInOrder(pendingBranch(), [
      'notifyOrToast(',
      'texts.getString(R.string.loggerythm_updater_ready_title)',
      'texts.getString(R.string.loggerythm_updater_ready_text)',
      'texts.getString(R.string.loggerythm_updater_not_confirmed_toast)',
      'if (blockedReason != null) {',
      'abandonSession(',
    ]);
    expect(nativeSource('LoggeRythmUpdateInstallReceiver.kt')).not.toContain('loggerythm_updater_ready_toast');
    expect(stringResource('values', 'loggerythm_updater_not_confirmed_toast'))
      .toBe('LoggeRythm update not confirmed. Start it again in the app.');
    expect(stringResource('values-de', 'loggerythm_updater_not_confirmed_toast'))
      .toBe('LoggeRythm-Update nicht bestätigt. Starte es in der App neu.');
    // "ready" stays for the notification, which can still open the confirmation.
    expect(() => stringResource('values', 'loggerythm_updater_ready_toast')).toThrow('missing');
    expect(() => stringResource('values-de', 'loggerythm_updater_ready_toast')).toThrow('missing');
  });
});

describe('native updater texts follow the app language', () => {
  const receiver = nativeSource('LoggeRythmUpdateInstallReceiver.kt');

  function appLocaleStore(): string {
    const start = receiver.indexOf('internal object AppLocaleStore {');
    const end = receiver.indexOf('\n}\n', start);
    if (start < 0 || end < 0) throw new Error('AppLocaleStore not found');
    return receiver.slice(start, end);
  }

  it('reads every receiver text through the app-language context, never the system-language one', () => {
    expect(receiver).not.toContain('context.getString(');
    expect(receiver.match(/texts\.getString\(R\.string\./g)?.length).toBeGreaterThanOrEqual(10);
    const onReceive = receiver.slice(receiver.indexOf('override fun onReceive('), receiver.indexOf('  /**\n   * Abandons'));
    expectInOrder(onReceive, [
      'relaunchApp(context, AppLocaleStore.localizedContext(context))',
      'val texts = AppLocaleStore.localizedContext(context)',
      'when (status) {',
    ]);
  });

  it('builds the localized context from the stored app language', () => {
    expectInOrder(appLocaleStore(), [
      'fun localizedContext(context: Context): Context {',
      'Configuration(context.resources.configuration)',
      'configuration.setLocale(Locale.forLanguageTag(current(context)))',
      'context.createConfigurationContext(configuration)',
    ]);
  });

  it('stores the app language with commit() and fails loudly otherwise', () => {
    expectInOrder(appLocaleStore(), [
      'fun set(context: Context, locale: String) {',
      'if (locale !in SUPPORTED_LOCALES) {',
      '"updater-locale-invalid"',
      '.putString(KEY_LOCALE, locale).commit()',
      '"updater-locale-unsaved"',
    ]);
  });

  it('uses the app\'s own default language, logged, only before JS stored one', () => {
    expect(appLocaleStore()).toContain(`const val APP_DEFAULT_LOCALE = "${DEFAULT_APP_LOCALE}"`);
    expectInOrder(appLocaleStore(), [
      'fun current(context: Context): String {',
      'if (stored == null) {',
      'Log.i(',
      'return APP_DEFAULT_LOCALE',
      'if (stored !in SUPPORTED_LOCALES) {',
      'throw IllegalStateException(',
    ]);
  });

  it('lets JS store the language without waiting behind a running download', () => {
    const module = nativeSource('LoggeRythmUpdaterModule.kt');
    const start = module.indexOf('fun setAppLocale(locale: String, promise: Promise) {');
    const end = module.indexOf('  @ReactMethod', start);
    if (start < 0 || end < 0) throw new Error('setAppLocale not found');
    const body = module.slice(start, end);
    expectInOrder(body, ['AppLocaleStore.set(reactContext, locale)', 'promise.resolve(null)', 'reject(promise, error)']);
    expect(body).not.toContain('execute(');
  });
});
