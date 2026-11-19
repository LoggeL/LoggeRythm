const { NativeEventEmitter, NativeModules, Platform } = require('react-native');

const DOWNLOAD_PROGRESS_EVENT = 'LoggeRythmUpdaterDownloadProgress';
const INSTALL_OUTCOME_EVENT = 'LoggeRythmUpdaterInstallOutcome';

function requireAndroidModule() {
  if (Platform.OS !== 'android') {
    throw new Error('LoggeRythm updater is available on Android only');
  }
  const module = NativeModules.LoggeRythmUpdater;
  if (!module) {
    throw new Error('LoggeRythm updater native module is not linked');
  }
  return module;
}

module.exports = {
  getInstallationInfo: () => requireAndroidModule().getInstallationInfo(),
  openInstallPermissionSettings: () =>
    requireAndroidModule().openInstallPermissionSettings(),
  // versionCode is the release's declared "Android-Versioncode"; the native
  // side rejects an APK whose versionCode differs from it. Resolves
  // { status: 'awaiting-user-confirmation', versionName, versionCode, sessionId }.
  downloadAndInstall: (url, digest, versionName, versionCode) =>
    requireAndroidModule().downloadAndInstall(url, digest, versionName, versionCode),
  subscribeDownloadProgress: (listener) => {
    const module = requireAndroidModule();
    const subscription = new NativeEventEmitter(module).addListener(
      DOWNLOAD_PROGRESS_EVENT,
      listener,
    );
    return () => subscription.remove();
  },
  // Reads and clears the last non-success installation outcome
  // ({ code, message, sessionId, versionName, versionCode }) or resolves null.
  // Only outcomes of the session committed last are stored.
  consumeInstallOutcome: () => requireAndroidModule().consumeInstallOutcome(),
  // Stores the language chosen in the app ('de' | 'en') for the install
  // receiver's toasts and notifications, which otherwise could only follow
  // the system language. Rejects updater-locale-invalid / -unsaved.
  setAppLocale: (locale) => requireAndroidModule().setAppLocale(locale),
  // Fires when Android's installer ended a session without success while the
  // app runs; the outcome is also stored until consumeInstallOutcome reads it.
  subscribeInstallOutcome: (listener) => {
    const module = requireAndroidModule();
    const subscription = new NativeEventEmitter(module).addListener(
      INSTALL_OUTCOME_EVENT,
      listener,
    );
    return () => subscription.remove();
  },
};
