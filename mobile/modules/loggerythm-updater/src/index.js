const { NativeModules, Platform } = require('react-native');

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
};
