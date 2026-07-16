const { withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const GENERATED_APPLICATION_MARKER = '// @generated withOfflineDownloads package';
const NATIVE_SOURCE_FILES = [
  'OfflineDownloadStorage.kt',
  'OfflineDownloadCoordinator.kt',
  'OfflineDownloadsModule.kt',
  'OfflineDownloadsPackage.kt',
];

function transformMainApplication(source) {
  if (source.includes(GENERATED_APPLICATION_MARKER)) return source;
  const anchor = 'PackageList(this).packages.apply {';
  if (!source.includes(anchor)) {
    throw new Error('withOfflineDownloads: unsupported MainApplication package list');
  }
  return source.replace(
    anchor,
    `${anchor}\n          ${GENERATED_APPLICATION_MARKER}\n          add(OfflineDownloadsPackage())`,
  );
}

function kotlinSources(packageName) {
  if (typeof packageName !== 'string' || !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(packageName)) {
    throw new Error('withOfflineDownloads: android.package is invalid');
  }
  return Object.fromEntries(NATIVE_SOURCE_FILES.map((fileName) => [
    fileName,
    fs.readFileSync(require.resolve(`./offline-downloads-native/${fileName}`), 'utf8')
      .replaceAll('__PACKAGE__', packageName),
  ]));
}

function writeNativeSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const packageName = cfg.android?.package;
      if (!packageName) throw new Error('withOfflineDownloads: android.package is required');
      const directory = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
      );
      fs.mkdirSync(directory, { recursive: true });
      for (const [fileName, source] of Object.entries(kotlinSources(packageName))) {
        fs.writeFileSync(path.join(directory, fileName), source);
      }
      return cfg;
    },
  ]);
}

function withOfflineDownloads(config) {
  config = withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withOfflineDownloads: only Kotlin MainApplication is supported');
    }
    cfg.modResults.contents = transformMainApplication(cfg.modResults.contents);
    return cfg;
  });
  return writeNativeSources(config);
}

module.exports = withOfflineDownloads;
module.exports.kotlinSources = kotlinSources;
module.exports.transformMainApplication = transformMainApplication;
