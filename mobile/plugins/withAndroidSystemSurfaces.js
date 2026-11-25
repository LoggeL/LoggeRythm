const { withAndroidManifest, withDangerousMod, withStringsXml } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const WIDGET_PROVIDER_NAME = 'top.logge.loggerythm.player.LoggeRythmNowPlayingWidgetProvider';
const WIDGET_ACTION_RECEIVER_NAME = 'top.logge.loggerythm.player.LoggeRythmWidgetActionReceiver';
const QUICK_TILE_SERVICE_NAME = 'top.logge.loggerythm.player.LoggeRythmQuickTileService';
const SHORTCUTS_META_NAME = 'android.app.shortcuts';
const APPWIDGET_UPDATE_ACTION = 'android.appwidget.action.APPWIDGET_UPDATE';
const QS_TILE_ACTION = 'android.service.quicksettings.action.QS_TILE';
const QS_TILE_PERMISSION = 'android.permission.BIND_QUICK_SETTINGS_TILE';

const LAUNCHER_SHORTCUTS = Object.freeze([
  {
    id: 'shortcut_search',
    icon: '@drawable/ic_shortcut_search',
    shortLabelRes: 'shortcut_search_short',
    longLabelRes: 'shortcut_search_long',
    shortEn: 'Search',
    longEn: 'Search LoggeRythm',
    shortDe: 'Suche',
    longDe: 'LoggeRythm durchsuchen',
    data: 'loggerythm://search',
  },
  {
    id: 'shortcut_liked',
    icon: '@drawable/ic_shortcut_liked',
    shortLabelRes: 'shortcut_liked_short',
    longLabelRes: 'shortcut_liked_long',
    shortEn: 'Liked Songs',
    longEn: 'Open Liked Songs',
    shortDe: 'Lieblingssongs',
    longDe: 'Lieblingssongs öffnen',
    data: 'loggerythm://library',
  },
  {
    id: 'shortcut_radar',
    icon: '@drawable/ic_shortcut_radar',
    shortLabelRes: 'shortcut_radar_short',
    longLabelRes: 'shortcut_radar_long',
    shortEn: 'Release Radar',
    longEn: 'Open Release Radar',
    shortDe: 'Release Radar',
    longDe: 'Release Radar öffnen',
    data: 'loggerythm://radar',
  },
  {
    id: 'shortcut_radio',
    icon: '@drawable/ic_shortcut_radio',
    shortLabelRes: 'shortcut_radio_short',
    longLabelRes: 'shortcut_radio_long',
    shortEn: 'Personal Radio',
    longEn: 'Start Personal Radio',
    shortDe: 'Persönliches Radio',
    longDe: 'Persönliches Radio starten',
    data: 'loggerythm://radio',
  },
  {
    id: 'shortcut_jam',
    icon: '@drawable/ic_shortcut_jam',
    shortLabelRes: 'shortcut_jam_short',
    longLabelRes: 'shortcut_jam_long',
    shortEn: 'Start Jam',
    longEn: 'Start a Jam Session',
    shortDe: 'Jam starten',
    longDe: 'Jam-Session starten',
    data: 'loggerythm://party/start',
  },
]);

const SHORTCUT_GLYPH_PATHS = Object.freeze({
  ic_shortcut_search:
    'M15.5,14h-0.79l-0.28,-0.27A6.471,6.471 0,0 0,16 9.5,6.5 6.5,0 1,0 9.5,16c1.61,0 3.09,-0.59 4.23,-1.57l0.27,0.28v0.79l5,4.99L20.49,19l-4.99,-5zM9.5,14C7.01,14 5,11.99 5,9.5S7.01,5 9.5,5 14,7.01 14,9.5 11.99,14 9.5,14z',
  ic_shortcut_liked:
    'M12,21.35l-1.45,-1.32C5.4,15.36 2,12.28 2,8.5 2,5.42 4.42,3 7.5,3c1.74,0 3.41,0.81 4.5,2.09C13.09,3.81 14.76,3 16.5,3 19.58,3 22,5.42 22,8.5c0,3.78 -3.4,6.86 -8.55,11.54L12,21.35z',
  ic_shortcut_radar:
    'M12,2a10,10 0,1 0,10 10A10,10 0,0 0,12 2zm0,18a8,8 0,1 1,8 -8 8,8 0,0 1,-8 8zm0,-13a5,5 0,1 0,5 5 5,5 0,0 0,-5 -5zm0,7a2,2 0,1 1,2 -2 2,2 0,0 1,-2 2z',
  ic_shortcut_radio:
    'M3.24,6.15C2.51,6.43 2,7.17 2,8v12c0,1.1 0.89,2 2,2h16c1.11,0 2,-0.9 2,-2V8c0,-1.11 -0.89,-2 -2,-2H8.3l8.26,-3.34L15.88,1 3.24,6.15zM7,20c-1.66,0 -3,-1.34 -3,-3s1.34,-3 3,-3 3,1.34 3,3 -1.34,3 -3,3zM20,12h-2v-2h-2v2H4V8h16v4z',
  ic_shortcut_jam:
    'M16,11c1.66,0 2.99,-1.34 2.99,-3S17.66,5 16,5s-3,1.34 -3,3 1.34,3 3,3zm-8,0c1.66,0 2.99,-1.34 2.99,-3S9.66,5 8,5 5,6.34 5,8s1.34,3 3,3zm0,2c-2.33,0 -7,1.17 -7,3.5V19h14v-2.5c0,-2.33 -4.67,-3.5 -7,-3.5zm8,0c-0.29,0 -0.62,0.02 -0.97,0.05 1.16,0.84 1.97,1.97 1.97,3.45V19h6v-2.5c0,-2.33 -4.67,-3.5 -7,-3.5z',
});

/** Circular dark badge + centered 24dp glyph for Android 7 (API 24-25) shortcut menus. */
function buildLegacyShortcutVectorXml(pathData) {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp"
    android:height="48dp"
    android:viewportWidth="48"
    android:viewportHeight="48">
    <path
        android:fillColor="#0f0e11"
        android:pathData="M24,0A24,24 0,1 0,24 48A24,24 0,1 0,24 0Z" />
    <group
        android:translateX="12"
        android:translateY="12">
        <path
            android:fillColor="#d6ff4b"
            android:pathData="${pathData}" />
    </group>
</vector>
`;
}

/** 108dp adaptive shortcut layer with the 24dp glyph scaled to 42dp inside the 66dp safe circle. */
function buildAdaptiveShortcutLayerXml(pathData, fillColor) {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:translateX="33"
        android:translateY="33"
        android:scaleX="1.75"
        android:scaleY="1.75">
        <path
            android:fillColor="${fillColor}"
            android:pathData="${pathData}" />
    </group>
</vector>
`;
}

/** API 26+ adaptive-icon wrapper so long-press & pinned shortcuts follow round masks and icon packs. */
function buildAdaptiveShortcutXml(baseName) {
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground" />
    <foreground android:drawable="@drawable/${baseName}_foreground" />
    <monochrome android:drawable="@drawable/${baseName}_monochrome" />
</adaptive-icon>
`;
}

const SHORTCUT_VECTOR_DRAWABLES = Object.freeze(
  Object.fromEntries(
    Object.entries(SHORTCUT_GLYPH_PATHS).flatMap(([baseName, pathData]) => [
      [`${baseName}.xml`, buildLegacyShortcutVectorXml(pathData)],
      [`${baseName}_foreground.xml`, buildAdaptiveShortcutLayerXml(pathData, '#d6ff4b')],
      [`${baseName}_monochrome.xml`, buildAdaptiveShortcutLayerXml(pathData, '#FFFFFF')],
    ]),
  ),
);

const SHORTCUT_ADAPTIVE_DRAWABLES = Object.freeze(
  Object.fromEntries(
    Object.keys(SHORTCUT_GLYPH_PATHS).map((baseName) => [
      `${baseName}.xml`,
      buildAdaptiveShortcutXml(baseName),
    ]),
  ),
);

function validatePackageName(packageName) {
  if (typeof packageName !== 'string' || !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(packageName)) {
    throw new Error('withAndroidSystemSurfaces: android.package is invalid');
  }
  return packageName;
}

function buildShortcutsXml(packageName) {
  const pkg = validatePackageName(packageName);
  const items = LAUNCHER_SHORTCUTS.map((entry) => `    <shortcut
        android:shortcutId="${entry.id}"
        android:enabled="true"
        android:icon="${entry.icon}"
        android:shortcutShortLabel="@string/${entry.shortLabelRes}"
        android:shortcutLongLabel="@string/${entry.longLabelRes}">
        <intent
            android:action="android.intent.action.VIEW"
            android:targetPackage="${pkg}"
            android:targetClass="${pkg}.MainActivity"
            android:data="${entry.data}" />
    </shortcut>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${items}
</shortcuts>
`;
}

function buildShortcutStringsXml(locale) {
  const lines = LAUNCHER_SHORTCUTS.flatMap((entry) => {
    const shortVal = locale === 'de' ? entry.shortDe : entry.shortEn;
    const longVal = locale === 'de' ? entry.longDe : entry.longEn;
    return [
      `    <string name="${entry.shortLabelRes}">${shortVal}</string>`,
      `    <string name="${entry.longLabelRes}">${longVal}</string>`,
    ];
  }).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
${lines}
</resources>
`;
}

function upsertWidgetReceiver(application) {
  application.receiver = application.receiver || [];
  let receiver = application.receiver.find(
    (entry) => entry.$?.['android:name'] === WIDGET_PROVIDER_NAME,
  );
  if (!receiver) {
    receiver = { $: {} };
    application.receiver.push(receiver);
  }
  receiver.$ = {
    'android:name': WIDGET_PROVIDER_NAME,
    'android:exported': 'true',
    'android:label': '@string/loggerythm_widget_name',
  };
  receiver['intent-filter'] = [
    {
      action: [
        { $: { 'android:name': APPWIDGET_UPDATE_ACTION } },
      ],
    },
  ];
  receiver['meta-data'] = [
    {
      $: {
        'android:name': 'android.appwidget.provider',
        'android:resource': '@xml/loggerythm_now_playing_widget_info',
      },
    },
  ];

  // Non-exported action receiver for widget button PendingIntents so external apps cannot spoof actions.
  let actionReceiver = application.receiver.find(
    (entry) => entry.$?.['android:name'] === WIDGET_ACTION_RECEIVER_NAME,
  );
  if (!actionReceiver) {
    actionReceiver = { $: {} };
    application.receiver.push(actionReceiver);
  }
  actionReceiver.$ = {
    'android:name': WIDGET_ACTION_RECEIVER_NAME,
    'android:exported': 'false',
  };
  for (const key of Object.keys(actionReceiver)) {
    if (key !== '$') delete actionReceiver[key];
  }
}

function upsertQuickTileService(application) {
  application.service = application.service || [];
  let service = application.service.find(
    (entry) => entry.$?.['android:name'] === QUICK_TILE_SERVICE_NAME,
  );
  if (!service) {
    service = { $: {} };
    application.service.push(service);
  }
  service.$ = {
    'android:name': QUICK_TILE_SERVICE_NAME,
    'android:exported': 'true',
    'android:icon': '@drawable/ic_loggerythm_qs_radio',
    'android:label': '@string/loggerythm_qs_tile_label',
    'android:permission': QS_TILE_PERMISSION,
  };
  service['intent-filter'] = [
    {
      action: [
        { $: { 'android:name': QS_TILE_ACTION } },
      ],
    },
  ];
  service['meta-data'] = [
    {
      $: {
        'android:name': 'android.service.quicksettings.ACTIVE_TILE',
        'android:value': 'false',
      },
    },
  ];
}

function upsertMainActivityShortcutsMeta(application) {
  const activity = application.activity?.find(
    (candidate) => candidate.$?.['android:name'] === '.MainActivity',
  );
  if (!activity) throw new Error('withAndroidSystemSurfaces: .MainActivity not found');
  activity['meta-data'] = activity['meta-data'] || [];
  let entry = activity['meta-data'].find(
    (item) => item.$?.['android:name'] === SHORTCUTS_META_NAME,
  );
  if (!entry) {
    entry = { $: { 'android:name': SHORTCUTS_META_NAME } };
    activity['meta-data'].push(entry);
  }
  entry.$['android:resource'] = '@xml/shortcuts';
}

function configureManifestObject(manifest) {
  const application = manifest.application?.[0];
  if (!application) throw new Error('withAndroidSystemSurfaces: <application> not found');
  upsertWidgetReceiver(application);
  upsertQuickTileService(application);
  upsertMainActivityShortcutsMeta(application);
  return manifest;
}

function writeShortcutResourcesToDisk(packageName, resRoot) {
  const xmlDir = path.join(resRoot, 'xml');
  const drawableDir = path.join(resRoot, 'drawable');
  const drawableAnyDpiV26Dir = path.join(resRoot, 'drawable-anydpi-v26');
  const valuesDir = path.join(resRoot, 'values');
  const valuesDeDir = path.join(resRoot, 'values-de');
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.mkdirSync(drawableDir, { recursive: true });
  fs.mkdirSync(drawableAnyDpiV26Dir, { recursive: true });
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.mkdirSync(valuesDeDir, { recursive: true });

  fs.writeFileSync(path.join(xmlDir, 'shortcuts.xml'), buildShortcutsXml(packageName));
  fs.writeFileSync(
    path.join(valuesDir, 'loggerythm_shortcuts.xml'),
    buildShortcutStringsXml('en'),
  );
  fs.writeFileSync(
    path.join(valuesDeDir, 'loggerythm_shortcuts.xml'),
    buildShortcutStringsXml('de'),
  );
  for (const [fileName, contents] of Object.entries(SHORTCUT_VECTOR_DRAWABLES)) {
    fs.writeFileSync(path.join(drawableDir, fileName), contents);
  }
  for (const [fileName, contents] of Object.entries(SHORTCUT_ADAPTIVE_DRAWABLES)) {
    fs.writeFileSync(path.join(drawableAnyDpiV26Dir, fileName), contents);
  }
}

function writeShortcutResources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const packageName = validatePackageName(cfg.android?.package);
      const resRoot = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      writeShortcutResourcesToDisk(packageName, resRoot);
      return cfg;
    },
  ]);
}

function markAppNameUntranslatable(stringsResource) {
  const entries = stringsResource?.resources?.string;
  if (!Array.isArray(entries)) return stringsResource;
  for (const entry of entries) {
    if (entry.$?.name === 'app_name') {
      entry.$.translatable = 'false';
    }
  }
  return stringsResource;
}

function withAndroidSystemSurfaces(config) {
  let next = withAndroidManifest(config, (cfg) => {
    configureManifestObject(cfg.modResults.manifest);
    return cfg;
  });
  // Because we ship localized values-de/ shortcut strings, mark the brand name
  // app_name untranslatable so Android Lint's MissingTranslation stays green.
  next = withStringsXml(next, (cfg) => {
    cfg.modResults = markAppNameUntranslatable(cfg.modResults);
    return cfg;
  });
  return writeShortcutResources(next);
}

module.exports = withAndroidSystemSurfaces;
module.exports.WIDGET_PROVIDER_NAME = WIDGET_PROVIDER_NAME;
module.exports.WIDGET_ACTION_RECEIVER_NAME = WIDGET_ACTION_RECEIVER_NAME;
module.exports.QUICK_TILE_SERVICE_NAME = QUICK_TILE_SERVICE_NAME;
module.exports.LAUNCHER_SHORTCUTS = LAUNCHER_SHORTCUTS;
module.exports.SHORTCUT_VECTOR_DRAWABLES = SHORTCUT_VECTOR_DRAWABLES;
module.exports.SHORTCUT_ADAPTIVE_DRAWABLES = SHORTCUT_ADAPTIVE_DRAWABLES;
module.exports.buildShortcutsXml = buildShortcutsXml;
module.exports.buildShortcutStringsXml = buildShortcutStringsXml;
module.exports.configureManifestObject = configureManifestObject;
module.exports.writeShortcutResourcesToDisk = writeShortcutResourcesToDisk;
