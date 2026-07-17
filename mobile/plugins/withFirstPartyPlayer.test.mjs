import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withFirstPartyPlayer');
const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.join(here, '..', 'modules', 'loggerythm-player');
const readModuleFile = (...parts) => fs.readFileSync(path.join(moduleRoot, ...parts), 'utf8');

function createManifest() {
  return {
    $: {},
    application: [{
      $: {},
      activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [] }],
      service: [],
    }],
  };
}

describe('withFirstPartyPlayer app integration', () => {
  it('adds automotive metadata, production App Links, and attribution idempotently', () => {
    const manifest = createManifest();
    manifest.application[0].activity[0]['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.media.action.MEDIA_PLAY_FROM_SEARCH' } }],
    });
    plugin.configureManifestObject(manifest);
    plugin.configureManifestObject(manifest);
    const application = manifest.application[0];
    expect(application['meta-data']).toContainEqual({
      $: {
        'android:name': 'com.google.android.gms.car.application',
        'android:resource': '@xml/automotive_app_desc',
      },
    });
    expect(application['meta-data']).toContainEqual({
      $: {
        'android:name': 'androidx.car.app.TintableAttributionIcon',
        'android:resource': '@drawable/ic_stat_music',
      },
    });
    expect(application['meta-data']).toHaveLength(2);
    const webLinks = application.activity[0]['intent-filter'].find((filter) =>
      filter.data?.some((data) => data.$['android:host'] === plugin.WEB_LINK_HOST));
    expect(webLinks.$['android:autoVerify']).toBeUndefined();
    expect(webLinks.action).toEqual([
      { $: { 'android:name': 'android.intent.action.VIEW' } },
    ]);
    expect(webLinks.category).toEqual(expect.arrayContaining([
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
    ]));
    expect(webLinks.data.every((entry) =>
      entry.$['android:scheme'] === 'https' &&
      entry.$['android:host'] === plugin.WEB_LINK_HOST)).toBe(true);
    expect(application.activity[0]['intent-filter'].some((filter) =>
      filter.action?.some((action) =>
        action.$['android:name'] === 'android.media.action.MEDIA_PLAY_FROM_SEARCH'))).toBe(false);
  });

  it('enables verified App Links only after an explicit deployment opt-in', () => {
    const manifest = createManifest();
    plugin.configureManifestObject(manifest, { enableVerifiedAppLinks: true });
    const webLinks = manifest.application[0].activity[0]['intent-filter'].find((filter) =>
      filter.data?.some((data) => data.$['android:host'] === plugin.WEB_LINK_HOST));
    expect(webLinks.$['android:autoVerify']).toBe('true');
  });

  it('declares the owned browser service in the app manifest for Android Auto lint', () => {
    const manifest = createManifest();
    plugin.configureManifestObject(manifest);
    plugin.configureManifestObject(manifest);
    const services = manifest.application[0].service;
    const playerServices = services.filter((service) =>
      service.$['android:name'] ===
        'top.logge.loggerythm.player.LoggeRythmMediaLibraryService');
    expect(playerServices).toHaveLength(1);
    expect(playerServices[0].$).toMatchObject({
      'android:exported': 'true',
      'android:foregroundServiceType': 'mediaPlayback',
      'android:stopWithTask': 'false',
      'tools:ignore': 'ExportedService',
    });
    const actions = playerServices[0]['intent-filter']
      .flatMap((filter) => filter.action || [])
      .map((action) => action.$['android:name']);
    expect(actions).toEqual(expect.arrayContaining([
      'androidx.media3.session.MediaLibraryService',
      'android.media.browse.MediaBrowserService',
    ]));
  });

  it('declares the playback-event Headless JS service nonexported and idempotently', () => {
    const manifest = createManifest();
    manifest.application[0].service.push({
      $: {
        'android:name': plugin.PLAYBACK_EVENT_HEADLESS_SERVICE_NAME,
        'android:exported': 'true',
        'android:permission': 'example.stale.PERMISSION',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'example.stale.ACTION' } }] }],
    });
    plugin.configureManifestObject(manifest);
    const once = JSON.stringify(manifest);
    plugin.configureManifestObject(manifest);
    expect(JSON.stringify(manifest)).toBe(once);

    const services = manifest.application[0].service.filter((service) =>
      service.$['android:name'] === plugin.PLAYBACK_EVENT_HEADLESS_SERVICE_NAME);
    expect(services).toEqual([{
      $: {
        'android:name':
          'top.logge.loggerythm.player.LoggeRythmPlaybackEventHeadlessService',
        'android:exported': 'false',
      },
    }]);
  });

  it('keeps the deliberate Android Auto voice-search lint policy idempotent', () => {
    const once = plugin.transformAutoLint('android { }\n');
    expect(plugin.transformAutoLint(once)).toBe(once);
    expect(once).toContain("disable 'MissingIntentFilterForMediaSearch'");
    expect(once).not.toContain('androidx.media3:');
  });

  it('wires the separate-package hostile-controller helper idempotently', () => {
    const once = plugin.transformTestControllerSettings("include ':app'\n");
    expect(plugin.transformTestControllerSettings(once)).toBe(once);
    expect(once.match(/include ':loggerythm_player-hostile-controller'/g)).toHaveLength(1);
    expect(once).toContain("new File(rootDir, '../modules/loggerythm-player/android-test-controller')");
  });

  it('keeps the hostile-controller helper a separate unprivileged test APK', () => {
    const helperBuild = readModuleFile('android-test-controller', 'build.gradle');
    const helperManifest = readModuleFile(
      'android-test-controller',
      'src',
      'main',
      'AndroidManifest.xml',
    );
    const instrumentationManifest = readModuleFile(
      'android',
      'src',
      'androidTest',
      'AndroidManifest.xml',
    );

    expect(helperBuild).toContain('apply plugin: "com.android.application"');
    expect(helperBuild).toContain(
      'applicationId "top.logge.loggerythm.player.hostilecontroller"',
    );
    expect(helperManifest).not.toContain('android:sharedUserId');
    expect(helperManifest).not.toContain('android.permission.MEDIA_CONTENT_CONTROL');
    expect(helperManifest).toContain('android:protectionLevel="signature"');
    expect(helperManifest).toContain(
      'android:permission="top.logge.loggerythm.player.hostilecontroller.permission.BIND_PROBE"',
    );
    expect(instrumentationManifest).toContain(
      'android:name="top.logge.loggerythm.player.hostilecontroller.permission.BIND_PROBE"',
    );
  });
});

describe('loggerythm-player Android library contract', () => {
  const buildGradle = readModuleFile('android', 'build.gradle');
  const consumerRules = readModuleFile('android', 'consumer-rules.pro');
  const manifest = readModuleFile('android', 'src', 'main', 'AndroidManifest.xml');
  const javaRoot = path.join(
    moduleRoot,
    'android',
    'src',
    'main',
    'java',
    'top',
    'logge',
    'loggerythm',
    'player',
  );
  const kotlin = () => fs.readdirSync(javaRoot)
    .filter((file) => file.endsWith('.kt'))
    .map((file) => fs.readFileSync(path.join(javaRoot, file), 'utf8'))
    .join('\n');
  const playerModule = () => fs.readFileSync(
    path.join(javaRoot, 'LoggeRythmPlayerModule.kt'),
    'utf8',
  );

  it('pins explicit Media3 dependencies in the library, not the Expo plugin', () => {
    expect(buildGradle).toContain('def media3Version = "1.10.1"');
    for (const artifact of ['exoplayer', 'session', 'datasource', 'database']) {
      expect(buildGradle).toContain(`androidx.media3:media3-${artifact}:$media3Version`);
    }
    expect(plugin.transformAutoLint('android { }')).not.toContain('androidx.media3:');
  });

  it('uses one opaque reboot-persistent WorkManager signal for the native journal', () => {
    const scheduler = fs.readFileSync(
      path.join(javaRoot, 'LoggeRythmPlaybackJournalWork.kt'),
      'utf8',
    );
    const coordinator = fs.readFileSync(
      path.join(javaRoot, 'LoggeRythmPersistedPlayerCoordinator.kt'),
      'utf8',
    );
    expect(buildGradle).toContain('def workManagerVersion = "2.11.2"');
    expect(buildGradle).toContain(
      'androidx.work:work-runtime:$workManagerVersion',
    );
    expect(manifest).toContain(
      'android.permission.RECEIVE_BOOT_COMPLETED',
    );
    expect(manifest).toMatch(
      /android:name="androidx\.work\.impl\.diagnostics\.DiagnosticsReceiver"\s+tools:node="remove"/,
    );
    expect(scheduler).toContain('enqueueUniqueWork(');
    expect(scheduler).toContain('ExistingWorkPolicy.REPLACE');
    expect(scheduler).toContain('PLAYBACK_JOURNAL_MAY_BE_NONEMPTY_A');
    expect(scheduler).toContain('PLAYBACK_JOURNAL_MAY_BE_NONEMPTY_B');
    expect(scheduler).toContain('val result = operation.result');
    expect(scheduler).toContain('LoggeRythmPlaybackJournalDurableAdmission');
    expect(scheduler).toContain('private const val TASK_RUNNER_TIMEOUT_MS = 55_000L');
    expect(scheduler).toContain('Context.BIND_AUTO_CREATE');
    expect(scheduler).toContain('preparePlaybackJournalWake');
    expect(scheduler).not.toContain('setInputData(');
    expect(scheduler).not.toContain('Data.Builder');
    expect(scheduler).not.toContain('startService(');
    expect(scheduler).not.toContain('startForegroundService(');
    expect(scheduler).toMatch(
      /LoggeRythmPlaybackJournalWakeDecision\.EMPTY\s*->\s*Result\.success\(\)/,
    );
    expect(scheduler).not.toMatch(
      /LoggeRythmPlaybackJournalWakeDecision\.EMPTY[\s\S]{0,160}scheduler\.cancel\(\)/,
    );
    expect(coordinator).toMatch(
      /workerRunning && localDelay == 0L[\s\S]{0,120}PLAYBACK_EVENT_DISPATCH_RETRY_MS/,
    );
    expect(coordinator).toMatch(
      /LoggeRythmPlaybackJournalDurableAdmission\.admit\([\s\S]{0,240}playbackJournalScheduler::prearm/,
    );
    expect(manifest).not.toContain('LoggeRythmPlaybackJournalWorker');
    expect(consumerRules).toMatch(
      /-keep class top\.logge\.loggerythm\.player\.LoggeRythmPlaybackJournalWorker \{\s*public <init>\(android\.content\.Context, androidx\.work\.WorkerParameters\);\s*\}/,
    );
  });

  it('owns the exported service declaration and both browser actions', () => {
    expect(manifest).toContain('android:name=".LoggeRythmMediaLibraryService"');
    expect(manifest).toContain('android:exported="true"');
    expect(manifest).toContain('android:foregroundServiceType="mediaPlayback"');
    expect(manifest).toContain('androidx.media3.session.MediaLibraryService');
    expect(manifest).toContain('android.media.browse.MediaBrowserService');
  });

  it('publishes an immutable explicit app activity for notification and system-player taps', () => {
    const service = fs.readFileSync(
      path.join(javaRoot, 'LoggeRythmMediaLibraryService.kt'),
      'utf8',
    );
    const sessionActivity = fs.readFileSync(
      path.join(javaRoot, 'LoggeRythmSessionActivity.kt'),
      'utf8',
    );
    expect(service).toContain(
      '.setSessionActivity(LoggeRythmSessionActivity.pendingIntent(this))',
    );
    expect(sessionActivity).toContain(
      'context.packageManager.getLaunchIntentForPackage(context.packageName)',
    );
    expect(sessionActivity).toContain('.setComponent(component)');
    expect(sessionActivity).toContain('.setPackage(context.packageName)');
    expect(sessionActivity).toContain('Intent.FLAG_ACTIVITY_NEW_TASK');
    expect(sessionActivity).toContain('Intent.FLAG_ACTIVITY_CLEAR_TOP');
    expect(sessionActivity).toContain('Intent.FLAG_ACTIVITY_SINGLE_TOP');
    expect(sessionActivity).toContain(
      'PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE',
    );
  });

  it('keeps the Headless JS drain shell private, data-free, and task-key aligned', () => {
    const service = fs.readFileSync(
      path.join(javaRoot, 'LoggeRythmPlaybackEventHeadlessService.kt'),
      'utf8',
    );
    const journal = fs.readFileSync(
      path.join(here, '..', 'src', 'player', 'playbackEventJournal.ts'),
      'utf8',
    );
    expect(manifest).toContain(
      'android:name=".LoggeRythmPlaybackEventHeadlessService"',
    );
    expect(manifest).toMatch(
      /android:name="\.LoggeRythmPlaybackEventHeadlessService"\s+android:exported="false"/,
    );
    expect(service).toContain('internal const val TASK_KEY = "LoggeRythmPlaybackEventDrain"');
    expect(journal).toContain(
      "PLAYBACK_EVENT_HEADLESS_TASK = 'LoggeRythmPlaybackEventDrain'",
    );
    expect(service).toContain('Arguments.createMap()');
    expect(service).toMatch(/TASK_TIMEOUT_MS,\s+true,/);
    expect(service).not.toContain('Arguments.fromBundle');
    expect(service).not.toContain('intent?.extras');
    expect(service).not.toContain('putString(');
  });

  it('exposes an async JSON bridge with no synchronous React methods or header events', () => {
    const source = kotlin();
    expect(source).toContain('const val NAME = "LoggeRythmPlayer"');
    expect(source).toContain('"snapshotEvent" to SNAPSHOT_EVENT');
    expect(source).toContain('"playerEvent" to PLAYER_EVENT');
    expect(source).toContain('"progressEvent" to PROGRESS_EVENT');
    expect(source).toContain('fun setup(optionsJson: String, promise: Promise)');
    expect(source).toContain('fun command(name: String, payloadJson: String, promise: Promise)');
    expect(source).toContain('fun setBrowseTree(treeJson: String, promise: Promise)');
    expect(source).toContain('fun clearPersistedState(promise: Promise)');
    expect(source).toContain('fun clearCache(promise: Promise)');
    expect(source).not.toMatch(/isBlockingSynchronousMethod\s*=\s*true/);
    expect(source).not.toContain('putMap("headers"');
    expect(source).not.toContain('putString("Cookie"');
    expect(source).not.toContain('Log.');
  });

  it('rejects a destructive cache clear while a durable radio queue commit is active', () => {
    const source = playerModule();
    expect(source).toMatch(
      /fun clearCache\(promise: Promise\)[\s\S]*?isQueueMutationBlocked\(\)[\s\S]*?playback-event-queue-commit-active[\s\S]*?cleanupInProgress\.compareAndSet/,
    );
  });

  it('freezes the v1 authoritative snapshot field names', () => {
    const source = playerModule();
    for (const field of [
      'schemaVersion',
      'playbackState',
      'playWhenReady',
      'isPlaying',
      'positionMs',
      'durationMs',
      'bufferedPositionMs',
      'currentIndex',
      'currentItemId',
      'repeatMode',
      'queue',
      'errorCode',
      'extras',
    ]) {
      expect(source).toContain(`put("${field}"`);
    }
    expect(source).not.toContain('put("activeIndex"');
    expect(source).not.toContain('put("progress"');
    expect(source).not.toContain('put("mediaId"');
  });

  it('contains strict protocol and controller trust boundaries', () => {
    const source = kotlin();
    expect(source).toContain('requireExactKeys');
    expect(source).toContain('unexpected-key');
    expect(source).toContain('scheme == "https"');
    expect(source).toContain('scheme == "file"');
    expect(source).toContain('setOf("Cookie")');
    expect(source).toContain('MAX_BROWSE_DEPTH');
    expect(source).toContain('MAX_BROWSE_NODES');
    expect(source).toContain('session.isMediaNotificationController(controller)');
    expect(source).toContain('session.isAutomotiveController(controller)');
    expect(source).toContain('session.isAutoCompanionController(controller)');
    expect(source).toContain('controller.isTrusted');
    expect(source).toContain('ConnectionResult.reject()');
    expect(source).toContain('dataSpec.uri.toString()');
    expect(source).not.toContain('setCustomCacheKey');
  });

  it.todo('adds Android Auto sibling-queue resolution and browse-tree change notifications in phase 2');
});
