const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
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
const PLAYBACK_SERVICE = 'com.doublesymmetry.trackplayer.TrackPlayerPlaybackService';
const SERVICE_ACTIONS = [
  'androidx.media3.session.MediaLibraryService',
  'android.media.browse.MediaBrowserService',
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

module.exports = function withAndroidAuto(config) {
  config = configureAutoManifest(config);
  config = writeAutomotiveDesc(config);
  return config;
};
