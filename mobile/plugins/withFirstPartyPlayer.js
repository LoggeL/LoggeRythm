const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withSettingsGradle,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const AUTOMOTIVE_META_NAME = 'com.google.android.gms.car.application';
const ATTRIBUTION_ICON_META_NAME = 'androidx.car.app.TintableAttributionIcon';
const WEB_LINK_HOST = 'loggerythm.logge.top';
const UNSUPPORTED_SEARCH_ACTION = 'android.media.action.MEDIA_PLAY_FROM_SEARCH';
const PLAYER_SERVICE_NAME = 'top.logge.loggerythm.player.LoggeRythmMediaLibraryService';
const MEDIA3_LIBRARY_SERVICE_ACTION = 'androidx.media3.session.MediaLibraryService';
const MEDIA_BROWSER_SERVICE_ACTION = 'android.media.browse.MediaBrowserService';
const HOSTILE_CONTROLLER_TEST_PROJECT = ':loggerythm_player-hostile-controller';
const HOSTILE_CONTROLLER_TEST_DIRECTORY =
  '../modules/loggerythm-player/android-test-controller';
const WEB_LINK_PATHS = [
  { 'android:path': '/' },
  ...['register', 'album', 'artist', 'playlist', 'genre', 'account', 'search', 'radio', 'library']
    .map((value) => ({ 'android:pathPrefix': `/${value}` })),
];

const AUTOMOTIVE_DESC = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
    <uses name="media" />
</automotiveApp>
`;

function upsertMetadata(application, name, resource) {
  application['meta-data'] = application['meta-data'] || [];
  let entry = application['meta-data'].find((item) => item.$?.['android:name'] === name);
  if (!entry) {
    entry = { $: { 'android:name': name } };
    application['meta-data'].push(entry);
  }
  entry.$['android:resource'] = resource;
}

function upsertPlayerService(application) {
  application.service = application.service || [];
  let service = application.service.find(
    (candidate) => candidate.$?.['android:name'] === PLAYER_SERVICE_NAME,
  );
  if (!service) {
    service = { $: { 'android:name': PLAYER_SERVICE_NAME } };
    application.service.push(service);
  }
  service.$ = {
    ...(service.$ || {}),
    'android:name': PLAYER_SERVICE_NAME,
    'android:exported': 'true',
    'android:foregroundServiceType': 'mediaPlayback',
    'android:stopWithTask': 'false',
    'tools:ignore': 'ExportedService',
  };
  service['intent-filter'] = service['intent-filter'] || [];
  let browserFilter = service['intent-filter'].find((filter) =>
    filter.action?.some((action) => [
      MEDIA3_LIBRARY_SERVICE_ACTION,
      MEDIA_BROWSER_SERVICE_ACTION,
    ].includes(action.$?.['android:name'])));
  if (!browserFilter) {
    browserFilter = { action: [] };
    service['intent-filter'].push(browserFilter);
  }
  browserFilter.action = browserFilter.action || [];
  for (const actionName of [MEDIA3_LIBRARY_SERVICE_ACTION, MEDIA_BROWSER_SERVICE_ACTION]) {
    if (!browserFilter.action.some((action) => action.$?.['android:name'] === actionName)) {
      browserFilter.action.push({ $: { 'android:name': actionName } });
    }
  }
}

function configureWebLinks(application, enableVerifiedAppLinks) {
  const activity = application.activity?.find(
    (candidate) => candidate.$?.['android:name'] === '.MainActivity',
  );
  if (!activity) throw new Error('withFirstPartyPlayer: .MainActivity not found');
  activity['intent-filter'] = activity['intent-filter'] || [];
  activity['intent-filter'] = activity['intent-filter'].filter((filter) =>
    !filter.action?.some((action) => action.$?.['android:name'] === UNSUPPORTED_SEARCH_ACTION));
  let webLinks = activity['intent-filter'].find((filter) =>
    filter.data?.some((data) => data.$?.['android:host'] === WEB_LINK_HOST),
  );
  if (!webLinks) {
    webLinks = {};
    activity['intent-filter'].push(webLinks);
  }
  webLinks.$ = { ...(webLinks.$ || {}) };
  if (enableVerifiedAppLinks) webLinks.$['android:autoVerify'] = 'true';
  else delete webLinks.$['android:autoVerify'];
  webLinks.action = [{ $: { 'android:name': 'android.intent.action.VIEW' } }];
  webLinks.category = [
    { $: { 'android:name': 'android.intent.category.DEFAULT' } },
    { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
  ];
  webLinks.data = WEB_LINK_PATHS.map((pathRule) => ({
    $: {
      'android:scheme': 'https',
      'android:host': WEB_LINK_HOST,
      ...pathRule,
    },
  }));
}

function configureManifestObject(
  manifest,
  { enableVerifiedAppLinks = false } = {},
) {
  const application = manifest.application?.[0];
  if (!application) throw new Error('withFirstPartyPlayer: <application> not found');
  upsertMetadata(application, AUTOMOTIVE_META_NAME, '@xml/automotive_app_desc');
  upsertMetadata(application, ATTRIBUTION_ICON_META_NAME, '@drawable/ic_stat_music');
  upsertPlayerService(application);
  configureWebLinks(application, enableVerifiedAppLinks);
  return manifest;
}

function transformAutoLint(source) {
  const start = '// @generated begin withFirstPartyPlayer Auto lint';
  const end = '// @generated end withFirstPartyPlayer Auto lint';
  const previous = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g');
  const block = `${start}
// Voice search is intentionally not advertised until the library implements it.
android {
    lint {
        disable 'MissingIntentFilterForMediaSearch'
    }
}
${end}`;
  return `${source.replace(previous, '').trimEnd()}\n\n${block}\n`;
}

function configureAutoLint(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withFirstPartyPlayer: only Groovy app build.gradle files are supported');
    }
    cfg.modResults.contents = transformAutoLint(cfg.modResults.contents);
    return cfg;
  });
}

function transformTestControllerSettings(source) {
  const start = '// @generated begin withFirstPartyPlayer hostile-controller test app';
  const end = '// @generated end withFirstPartyPlayer hostile-controller test app';
  const previous = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g');
  const block = `${start}
include '${HOSTILE_CONTROLLER_TEST_PROJECT}'
project('${HOSTILE_CONTROLLER_TEST_PROJECT}').projectDir =
    new File(rootDir, '${HOSTILE_CONTROLLER_TEST_DIRECTORY}')
${end}`;
  return `${source.replace(previous, '').trimEnd()}\n\n${block}\n`;
}

function configureTestControllerProject(config) {
  return withSettingsGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withFirstPartyPlayer: only Groovy settings.gradle files are supported');
    }
    cfg.modResults.contents = transformTestControllerSettings(cfg.modResults.contents);
    return cfg;
  });
}

function writeAutomotiveDescriptor(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const directory = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'automotive_app_desc.xml'), AUTOMOTIVE_DESC);
      return cfg;
    },
  ]);
}

module.exports = function withFirstPartyPlayer(config, options = {}) {
  let next = withAndroidManifest(config, (cfg) => {
    configureManifestObject(cfg.modResults.manifest, options);
    return cfg;
  });
  next = configureAutoLint(next);
  next = configureTestControllerProject(next);
  return writeAutomotiveDescriptor(next);
};

module.exports.AUTOMOTIVE_DESC = AUTOMOTIVE_DESC;
module.exports.WEB_LINK_HOST = WEB_LINK_HOST;
module.exports.configureManifestObject = configureManifestObject;
module.exports.configureAutoLint = configureAutoLint;
module.exports.transformAutoLint = transformAutoLint;
module.exports.configureTestControllerProject = configureTestControllerProject;
module.exports.transformTestControllerSettings = transformTestControllerSettings;
