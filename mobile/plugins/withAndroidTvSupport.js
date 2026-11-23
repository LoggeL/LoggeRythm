const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const LEANBACK_FEATURE = 'android.software.leanback';
const TOUCHSCREEN_FEATURE = 'android.hardware.touchscreen';
const MAIN_ACTION = 'android.intent.action.MAIN';
const LEANBACK_LAUNCHER_CATEGORY = 'android.intent.category.LEANBACK_LAUNCHER';
const TV_BANNER_RESOURCE = '@drawable/tv_banner';
const TV_BANNER_SOURCE = ['assets', 'android-tv-banner.png'];
const TV_BANNER_DENSITY_DIR = 'drawable-xhdpi';
const TV_BANNER_FILENAME = 'tv_banner.png';
const TV_BANNER_WIDTH = 320;
const TV_BANNER_HEIGHT = 180;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PORTRAIT_LOCKED_ORIENTATIONS = new Set([
  'portrait',
  'reversePortrait',
  'sensorPortrait',
  'userPortrait',
  'locked',
]);

/**
 * Validate a PNG buffer and extract its width/height from the IHDR chunk.
 * Fails loudly on corrupt, non-PNG, or mis-sized TV banners.
 */
function readPngDimensions(bytes, sourcePath) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`withAndroidTvSupport: TV banner is not a valid PNG: ${sourcePath}`);
  }
  const chunkType = bytes.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new Error(
      `withAndroidTvSupport: TV banner PNG is missing IHDR header (${chunkType}): ${sourcePath}`,
    );
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function readValidatedTvBanner(projectRoot) {
  const source = path.join(projectRoot, ...TV_BANNER_SOURCE);
  if (!fs.existsSync(source)) {
    throw new Error(`withAndroidTvSupport: TV banner asset is missing: ${source}`);
  }
  const bytes = fs.readFileSync(source);
  const { width, height } = readPngDimensions(bytes, source);
  if (width !== TV_BANNER_WIDTH || height !== TV_BANNER_HEIGHT) {
    throw new Error(
      `withAndroidTvSupport: TV banner must be ${TV_BANNER_WIDTH}x${TV_BANNER_HEIGHT}px, got ${width}x${height}px: ${source}`,
    );
  }
  return bytes;
}

/** Copy the validated 320x180 TV banner into res/drawable-xhdpi/tv_banner.png. */
function writeTvBannerAsset(projectRoot, resourceRoot) {
  const bytes = readValidatedTvBanner(projectRoot);
  const targetDir = path.join(resourceRoot, TV_BANNER_DENSITY_DIR);
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, TV_BANNER_FILENAME);
  fs.writeFileSync(targetPath, bytes);
  return targetPath;
}

function upsertOptionalFeature(manifest, featureName) {
  manifest['uses-feature'] = manifest['uses-feature'] || [];
  let entry = manifest['uses-feature'].find(
    (candidate) => candidate.$?.['android:name'] === featureName,
  );
  if (!entry) {
    entry = { $: { 'android:name': featureName } };
    manifest['uses-feature'].push(entry);
  }
  entry.$ = {
    ...(entry.$ || {}),
    'android:name': featureName,
    'android:required': 'false',
  };
}

function ensureLeanbackLauncherFilter(activity) {
  activity['intent-filter'] = activity['intent-filter'] || [];
  const hasLeanbackFilter = activity['intent-filter'].some(
    (filter) =>
      filter.action?.some((action) => action.$?.['android:name'] === MAIN_ACTION) &&
      filter.category?.some(
        (category) => category.$?.['android:name'] === LEANBACK_LAUNCHER_CATEGORY,
      ),
  );
  if (!hasLeanbackFilter) {
    activity['intent-filter'].push({
      action: [{ $: { 'android:name': MAIN_ACTION } }],
      category: [{ $: { 'android:name': LEANBACK_LAUNCHER_CATEGORY } }],
    });
  }
}

function ensureNavigationConfigChange(activity) {
  const raw = activity.$?.['android:configChanges'];
  if (!raw) return;
  const tokens = raw
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.includes('navigation')) {
    tokens.push('navigation');
    activity.$['android:configChanges'] = tokens.join('|');
  }
}

function assertTvCompatibleOrientation(activity) {
  const orientation = activity.$?.['android:screenOrientation'];
  if (orientation && PORTRAIT_LOCKED_ORIENTATIONS.has(orientation)) {
    throw new Error(
      `withAndroidTvSupport: .MainActivity cannot lock android:screenOrientation="${orientation}" ` +
        'because Android TV requires landscape support; use "unspecified" or omit orientation lock.',
    );
  }
}

/**
 * Configure AndroidManifest.xml so the same APK launches on Android TV
 * (Leanback launcher, 320x180 TV banner, non-required leanback & touchscreen
 * features) without breaking phone or Android Auto install/orientation behavior.
 */
function configureManifestObject(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('withAndroidTvSupport: AndroidManifest root object is missing');
  }
  const application = manifest.application?.[0];
  if (!application) {
    throw new Error('withAndroidTvSupport: <application> element not found');
  }
  const activity = application.activity?.find(
    (candidate) => candidate.$?.['android:name'] === '.MainActivity',
  );
  if (!activity) {
    throw new Error('withAndroidTvSupport: .MainActivity not found');
  }

  assertTvCompatibleOrientation(activity);
  upsertOptionalFeature(manifest, LEANBACK_FEATURE);
  upsertOptionalFeature(manifest, TOUCHSCREEN_FEATURE);

  application.$ = {
    ...(application.$ || {}),
    'android:banner': TV_BANNER_RESOURCE,
  };

  ensureLeanbackLauncherFilter(activity);
  ensureNavigationConfigChange(activity);
  return manifest;
}

function withAndroidTvSupport(config) {
  config = withAndroidManifest(config, (cfg) => {
    configureManifestObject(cfg.modResults.manifest);
    return cfg;
  });
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const resourceRoot = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
      );
      writeTvBannerAsset(cfg.modRequest.projectRoot, resourceRoot);
      return cfg;
    },
  ]);
  return config;
}

module.exports = withAndroidTvSupport;
module.exports.LEANBACK_FEATURE = LEANBACK_FEATURE;
module.exports.TOUCHSCREEN_FEATURE = TOUCHSCREEN_FEATURE;
module.exports.LEANBACK_LAUNCHER_CATEGORY = LEANBACK_LAUNCHER_CATEGORY;
module.exports.TV_BANNER_RESOURCE = TV_BANNER_RESOURCE;
module.exports.TV_BANNER_WIDTH = TV_BANNER_WIDTH;
module.exports.TV_BANNER_HEIGHT = TV_BANNER_HEIGHT;
module.exports.configureManifestObject = configureManifestObject;
module.exports.readPngDimensions = readPngDimensions;
module.exports.writeTvBannerAsset = writeTvBannerAsset;
