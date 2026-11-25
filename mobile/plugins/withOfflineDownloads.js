const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const GENERATED_APPLICATION_MARKER = '// @generated withOfflineDownloads package';
const WORKMANAGER_DEPENDENCY = 'androidx.work:work-runtime-ktx:2.11.2';
const GUAVA_DEPENDENCY = 'com.google.guava:guava:33.3.1-android';
const WORKMANAGER_FOREGROUND_SERVICE = 'androidx.work.impl.foreground.SystemForegroundService';
const REQUIRED_PERMISSIONS = [
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
];
const NATIVE_SOURCE_FILES = [
  'OfflineDownloadStorage.kt',
  'OfflineDownloadNotification.kt',
  'OfflineDownloadWorker.kt',
  'OfflineDownloadCoordinator.kt',
  'OfflineDownloadsModule.kt',
  'OfflineDownloadsPackage.kt',
];

function configureManifestObject(manifest) {
  manifest.$ = {
    ...(manifest.$ || {}),
    'xmlns:tools': manifest.$?.['xmlns:tools'] || 'http://schemas.android.com/tools',
  };
  manifest['uses-permission'] = manifest['uses-permission'] || [];
  for (const permission of REQUIRED_PERMISSIONS) {
    if (!manifest['uses-permission'].some((entry) => entry.$?.['android:name'] === permission)) {
      manifest['uses-permission'].push({ $: { 'android:name': permission } });
    }
  }
  const application = manifest.application?.[0];
  if (!application) throw new Error('withOfflineDownloads: <application> not found');
  application.service = application.service || [];
  let fgService = application.service.find(
    (entry) => entry.$?.['android:name'] === WORKMANAGER_FOREGROUND_SERVICE,
  );
  if (!fgService) {
    fgService = { $: {} };
    application.service.push(fgService);
  }
  fgService.$ = {
    ...(fgService.$ || {}),
    'android:name': WORKMANAGER_FOREGROUND_SERVICE,
    'android:foregroundServiceType': 'dataSync',
    'tools:node': 'merge',
  };
  return manifest;
}

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

function transformAppBuildGradle(source) {
  const start = '// @generated begin withOfflineDownloads dependency';
  const end = '// @generated end withOfflineDownloads dependency';
  const previous = new RegExp(
    `[ \\t]*${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
    'g',
  );
  const cleaned = source.replace(previous, '');
  const anchor = /(dependencies\s*\{\s*\n)/;
  if (!anchor.test(cleaned)) {
    throw new Error(
      'withOfflineDownloads: could not find dependencies block in android/app/build.gradle',
    );
  }
  const block =
    `    ${start}\n` +
    `    implementation("${WORKMANAGER_DEPENDENCY}")\n` +
    `    implementation("${GUAVA_DEPENDENCY}")\n` +
    `    ${end}\n`;
  return cleaned.replace(anchor, `$1${block}`);
}

function withOfflineDownloads(config) {
  config = withAndroidManifest(config, (cfg) => {
    configureManifestObject(cfg.modResults.manifest);
    return cfg;
  });
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withOfflineDownloads: only Groovy app build.gradle files are supported');
    }
    cfg.modResults.contents = transformAppBuildGradle(cfg.modResults.contents);
    return cfg;
  });
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
module.exports.WORKMANAGER_DEPENDENCY = WORKMANAGER_DEPENDENCY;
module.exports.GUAVA_DEPENDENCY = GUAVA_DEPENDENCY;
module.exports.configureManifestObject = configureManifestObject;
module.exports.kotlinSources = kotlinSources;
module.exports.transformAppBuildGradle = transformAppBuildGradle;
module.exports.transformMainApplication = transformMainApplication;
