const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

const DENSITY_DIRECTORIES = Object.freeze([
  'mipmap-mdpi',
  'mipmap-hdpi',
  'mipmap-xhdpi',
  'mipmap-xxhdpi',
  'mipmap-xxxhdpi',
]);
const REQUIRED_LAUNCHER_RESOURCES = Object.freeze([
  'ic_launcher',
  'ic_launcher_round',
  'ic_launcher_foreground',
  'ic_launcher_monochrome',
]);
const OPTIONAL_LAUNCHER_RESOURCES = Object.freeze(['ic_launcher_background']);
const ADAPTIVE_ANYDPI_DIR = 'mipmap-anydpi-v26';
const ADAPTIVE_XML_FILES = Object.freeze(['ic_launcher.xml', 'ic_launcher_round.xml']);
const ADAPTIVE_VECTOR_FILES = Object.freeze([
  'ic_launcher_foreground.xml',
  'ic_launcher_monochrome.xml',
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodedFormat(bytes) {
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return 'unknown';
}

function resourceCandidates(resourceRoot, density, resourceName) {
  const directory = path.join(resourceRoot, density);
  return {
    png: path.join(directory, `${resourceName}.png`),
    webp: path.join(directory, `${resourceName}.webp`),
  };
}

function existingCandidates(candidates) {
  return Object.entries(candidates).filter(([, filePath]) => fs.existsSync(filePath));
}

function assertKnownEncoding(filePath, extension) {
  const format = encodedFormat(fs.readFileSync(filePath));
  if (format === 'unknown') {
    throw new Error(`Android launcher resource has an unknown encoding: ${filePath}`);
  }
  if (format !== extension) {
    throw new Error(
      `Android launcher resource extension mismatch: ${filePath} is encoded as ${format}`,
    );
  }
}

function verifyResource(resourceRoot, density, resourceName, required) {
  const candidates = resourceCandidates(resourceRoot, density, resourceName);
  const existing = existingCandidates(candidates);
  if (existing.length === 0) {
    if (required) {
      throw new Error(`Required Android launcher resource is missing: ${density}/${resourceName}`);
    }
    return;
  }
  if (existing.length !== 1) {
    throw new Error(
      `Android launcher resource has conflicting PNG/WebP files: ${density}/${resourceName}`,
    );
  }
  const [extension, filePath] = existing[0];
  assertKnownEncoding(filePath, extension);
}

function verifyAndroidLauncherAssets(resourceRoot) {
  for (const density of DENSITY_DIRECTORIES) {
    for (const resourceName of REQUIRED_LAUNCHER_RESOURCES) {
      verifyResource(resourceRoot, density, resourceName, true);
    }
    for (const resourceName of OPTIONAL_LAUNCHER_RESOURCES) {
      verifyResource(resourceRoot, density, resourceName, false);
    }
  }
}

/**
 * Expo 57 names launcher outputs *.webp, but @expo/image-utils 0.11.3 emits
 * PNG buffers. Rename only files whose signatures prove they are PNG. The
 * Android resource identifier excludes the extension, so adaptive-icon XML
 * and AndroidManifest references remain unchanged.
 */
function normalizeAndroidLauncherAssets(resourceRoot) {
  for (const density of DENSITY_DIRECTORIES) {
    for (const resourceName of [
      ...REQUIRED_LAUNCHER_RESOURCES,
      ...OPTIONAL_LAUNCHER_RESOURCES,
    ]) {
      const candidates = resourceCandidates(resourceRoot, density, resourceName);
      const existing = existingCandidates(candidates);
      const required = REQUIRED_LAUNCHER_RESOURCES.includes(resourceName);
      if (existing.length === 0) {
        if (required) {
          throw new Error(`Required Android launcher resource is missing: ${density}/${resourceName}`);
        }
        continue;
      }
      if (existing.length !== 1) {
        throw new Error(
          `Android launcher resource has conflicting PNG/WebP files: ${density}/${resourceName}`,
        );
      }

      const [extension, filePath] = existing[0];
      const format = encodedFormat(fs.readFileSync(filePath));
      if (format === 'unknown') {
        throw new Error(`Android launcher resource has an unknown encoding: ${filePath}`);
      }
      if (extension === 'webp' && format === 'png') {
        fs.renameSync(filePath, candidates.png);
      } else if (extension !== format) {
        throw new Error(
          `Android launcher resource extension mismatch: ${filePath} is encoded as ${format}`,
        );
      }
    }
  }
  verifyAndroidLauncherAssets(resourceRoot);
}

function readAdaptiveVector(projectRoot, fileName) {
  const source = path.join(projectRoot, 'plugins', 'brand', fileName);
  if (!fs.existsSync(source)) {
    throw new Error(
      `Adaptive launcher vector is missing: ${source}. Run npm run generate:brand-assets in mobile/.`,
    );
  }
  const xml = fs.readFileSync(source, 'utf8');
  if (
    !xml.includes('<vector ') ||
    !xml.includes('android:width="108dp"') ||
    !xml.includes('android:height="108dp"') ||
    !xml.includes('android:pathData="M')
  ) {
    throw new Error(`Adaptive launcher vector ${source} is not a valid 108dp VectorDrawable`);
  }
  return xml;
}

/**
 * Install the generated 108dp VectorDrawable layers into mipmap-anydpi-v26 so
 * API 26+ launchers, Material You themed icons, and adaptive icon packs render
 * crisp vector geometry at every scale and mask shape while density PNGs stay
 * normalized for compatibility.
 */
function writeAdaptiveLauncherVectors(projectRoot, resourceRoot) {
  const anyDpiDir = path.join(resourceRoot, ADAPTIVE_ANYDPI_DIR);
  fs.mkdirSync(anyDpiDir, { recursive: true });
  for (const fileName of ADAPTIVE_VECTOR_FILES) {
    const xml = readAdaptiveVector(projectRoot, fileName);
    fs.writeFileSync(path.join(anyDpiDir, fileName), xml);
  }
}

function verifyAdaptiveLauncherVectors(projectRoot, resourceRoot) {
  const anyDpiDir = path.join(resourceRoot, ADAPTIVE_ANYDPI_DIR);
  for (const xmlFile of ADAPTIVE_XML_FILES) {
    const fullPath = path.join(anyDpiDir, xmlFile);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Required adaptive launcher XML is missing: ${ADAPTIVE_ANYDPI_DIR}/${xmlFile}`);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    if (
      !content.includes('<adaptive-icon') ||
      !content.includes('<background ') ||
      !content.includes('<foreground android:drawable="@mipmap/ic_launcher_foreground"') ||
      !content.includes('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"')
    ) {
      throw new Error(
        `Adaptive launcher XML ${ADAPTIVE_ANYDPI_DIR}/${xmlFile} must declare background, foreground, and monochrome layers`,
      );
    }
  }
  for (const fileName of ADAPTIVE_VECTOR_FILES) {
    const expected = readAdaptiveVector(projectRoot, fileName);
    const targetPath = path.join(anyDpiDir, fileName);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Adaptive launcher vector was not installed: ${ADAPTIVE_ANYDPI_DIR}/${fileName}`);
    }
    const actual = fs.readFileSync(targetPath, 'utf8');
    if (actual !== expected) {
      throw new Error(
        `Adaptive launcher vector ${ADAPTIVE_ANYDPI_DIR}/${fileName} is out of sync with plugins/brand/${fileName}`,
      );
    }
  }
}

function withAndroidLauncherAssets(config) {
  return withFinalizedMod(config, [
    'android',
    async (cfg) => {
      const resourceRoot = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
      );
      normalizeAndroidLauncherAssets(resourceRoot);
      writeAdaptiveLauncherVectors(cfg.modRequest.projectRoot, resourceRoot);
      verifyAdaptiveLauncherVectors(cfg.modRequest.projectRoot, resourceRoot);
      return cfg;
    },
  ]);
}

module.exports = withAndroidLauncherAssets;
module.exports.DENSITY_DIRECTORIES = DENSITY_DIRECTORIES;
module.exports.REQUIRED_LAUNCHER_RESOURCES = REQUIRED_LAUNCHER_RESOURCES;
module.exports.ADAPTIVE_ANYDPI_DIR = ADAPTIVE_ANYDPI_DIR;
module.exports.ADAPTIVE_XML_FILES = ADAPTIVE_XML_FILES;
module.exports.ADAPTIVE_VECTOR_FILES = ADAPTIVE_VECTOR_FILES;
module.exports.encodedFormat = encodedFormat;
module.exports.normalizeAndroidLauncherAssets = normalizeAndroidLauncherAssets;
module.exports.verifyAndroidLauncherAssets = verifyAndroidLauncherAssets;
module.exports.writeAdaptiveLauncherVectors = writeAdaptiveLauncherVectors;
module.exports.verifyAdaptiveLauncherVectors = verifyAdaptiveLauncherVectors;
