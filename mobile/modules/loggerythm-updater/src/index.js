const { NativeEventEmitter, NativeModules, Platform } = require('react-native');

const DOWNLOAD_PROGRESS_EVENT = 'LoggeRythmUpdaterDownloadProgress';

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
  downloadAndInstall: (url, digest, versionName) =>
    requireAndroidModule().downloadAndInstall(url, digest, versionName),
  subscribeDownloadProgress: (listener) => {
    const module = requireAndroidModule();
    const subscription = new NativeEventEmitter(module).addListener(
      DOWNLOAD_PROGRESS_EVENT,
      listener,
    );
    return () => subscription.remove();
  },
};
