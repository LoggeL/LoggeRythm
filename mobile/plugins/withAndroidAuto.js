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
 * RNTP's library manifest already declares the playback service, so we don't.
 */

const AUTOMOTIVE_DESC = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
    <uses name="media" />
</automotiveApp>
`;

const META_NAME = 'com.google.android.gms.car.application';

function addAutoMetaData(config) {
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
  config = addAutoMetaData(config);
  config = writeAutomotiveDesc(config);
  return config;
};
