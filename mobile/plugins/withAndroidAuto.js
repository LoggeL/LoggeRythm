const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin: wire up Android Auto for @rntp/player.
 *
 * @rntp/player ships no Expo config plugin, so we inject the two Android Auto
 * requirements ourselves at prebuild time:
 *   1. res/xml/automotive_app_desc.xml declaring a media app.
 *   2. The <meta-data> in AndroidManifest pointing at it.
 * RNTP's library manifest declares the playback service; this plugin augments
 * that declaration with the two library-browser actions required by car hosts.
 */

const AUTOMOTIVE_DESC = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
    <uses name="media" />
</automotiveApp>
`;

const META_NAME = 'com.google.android.gms.car.application';
const ATTRIBUTION_ICON_META_NAME = 'androidx.car.app.TintableAttributionIcon';
const PLAYBACK_SERVICE = 'com.doublesymmetry.trackplayer.TrackPlayerPlaybackService';
const UNSUPPORTED_SEARCH_ACTION = 'android.media.action.MEDIA_PLAY_FROM_SEARCH';
const SERVICE_ACTIONS = [
  'androidx.media3.session.MediaLibraryService',
  'android.media.browse.MediaBrowserService',
];
const WEB_LINK_PATHS = [
  { 'android:path': '/' },
  ...['register', 'album', 'artist', 'playlist', 'genre', 'account', 'search', 'radio', 'library'].map(
    (value) => ({ 'android:pathPrefix': `/${value}` }),
  ),
];

function configureAutoManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('withAndroidAuto: <application> not found in AndroidManifest.xml');
    app['meta-data'] = app['meta-data'] || [];
    const already = app['meta-data'].some((m) => m.$?.['android:name'] === META_NAME);
    if (!already) {
      app['meta-data'].push({
        $: { 'android:name': META_NAME, 'android:resource': '@xml/automotive_app_desc' },
      });
    }
    const attributionIcon = app['meta-data'].find(
      (item) => item.$?.['android:name'] === ATTRIBUTION_ICON_META_NAME,
    );
    if (attributionIcon) {
      attributionIcon.$['android:resource'] = '@drawable/ic_stat_music';
    } else {
      app['meta-data'].push({
        $: {
          'android:name': ATTRIBUTION_ICON_META_NAME,
          'android:resource': '@drawable/ic_stat_music',
        },
      });
    }

    app.service = app.service || [];
    let service = app.service.find((item) => item.$?.['android:name'] === PLAYBACK_SERVICE);
    if (!service) {
      service = { $: { 'android:name': PLAYBACK_SERVICE } };
      app.service.push(service);
    }
    service.$ = {
      ...service.$,
      'android:name': PLAYBACK_SERVICE,
      'android:exported': 'true',
      'android:foregroundServiceType': 'mediaPlayback',
    };
    service['intent-filter'] = service['intent-filter'] || [];
    let filter = service['intent-filter'].find((item) =>
      item.action?.some((action) =>
        ['androidx.media3.session.MediaLibraryService', 'android.media.browse.MediaBrowserService'].includes(
          action.$?.['android:name'],
        ),
      ),
    );
    if (!filter) {
      filter = { action: [] };
      service['intent-filter'].push(filter);
    }
    filter.action = filter.action || [];
    for (const name of SERVICE_ACTIONS) {
      if (!filter.action.some((action) => action.$?.['android:name'] === name)) {
        filter.action.push({ $: { 'android:name': name } });
      }
    }

    // Do not advertise voice search until the playback service implements it.
    // A manifest action alone makes car hosts route an unsupported command into
    // MainActivity and is materially worse than an honest capability gap.
    const mainActivity = app.activity?.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (!mainActivity)
      throw new Error('withAndroidAuto: .MainActivity not found in AndroidManifest.xml');
    mainActivity['intent-filter'] = mainActivity['intent-filter'] || [];
    mainActivity['intent-filter'] = mainActivity['intent-filter'].filter(
      (item) => !item.action?.some((action) => action.$?.['android:name'] === UNSUPPORTED_SEARCH_ACTION),
    );
    let webLinks = mainActivity['intent-filter'].find((item) =>
      item.data?.some((data) => data.$?.['android:host'] === 'loggerythm.logge.top'),
    );
    if (!webLinks) {
      webLinks = {};
      mainActivity['intent-filter'].push(webLinks);
    }
    webLinks.action = [{ $: { 'android:name': 'android.intent.action.VIEW' } }];
    webLinks.category = [
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
    ];
    webLinks.data = WEB_LINK_PATHS.map((pathRule) => ({
      $: {
        'android:scheme': 'https',
        'android:host': 'loggerythm.logge.top',
        ...pathRule,
      },
    }));
    cfg.modResults.manifest.$ = cfg.modResults.manifest.$ || {};
    cfg.modResults.manifest.$['xmlns:tools'] =
      cfg.modResults.manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const ignored = new Set((app.$['tools:ignore'] || '').split(',').filter(Boolean));
    ignored.add('MissingIntentFilterForMediaSearch');
    app.$['tools:ignore'] = [...ignored].join(',');
    return cfg;
  });
}

function writeAutomotiveDesc(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'automotive_app_desc.xml'), AUTOMOTIVE_DESC);
      return cfg;
    },
  ]);
}

function configureAutoLint(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidAuto: only Groovy app build.gradle files are supported');
    }
    const start = '// @generated begin withAndroidAutoLint';
    const end = '// @generated end withAndroidAutoLint';
    const previous = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g');
    const block = `${start}
// Voice search remains disabled until the MediaLibraryService implements it.
android {
    lint {
        disable 'MissingIntentFilterForMediaSearch'
    }
}
${end}
`;
    cfg.modResults.contents = `${cfg.modResults.contents.replace(previous, '').trimEnd()}\n\n${block}`;
    return cfg;
  });
}

module.exports = function withAndroidAuto(config) {
  config = configureAutoManifest(config);
  config = configureAutoLint(config);
  config = writeAutomotiveDesc(config);
  return config;
};
