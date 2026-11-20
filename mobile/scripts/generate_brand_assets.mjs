import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MOBILE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPOSITORY_ROOT = path.resolve(MOBILE_ROOT, '..');
const WEB_ROOT = path.join(REPOSITORY_ROOT, 'web');
export const PRODUCTION_LOGO_PATH = path.join(WEB_ROOT, 'public', 'Logo.svg');
const MOBILE_ASSETS = path.join(MOBILE_ROOT, 'assets');

/** Brand fill declared once in Logo.svg (the web --accent). */
export const BRAND_FILL = '#d6ff4b';
/** Tile/launcher background (the web --background, warm near-black). */
export const BRAND_BACKGROUND = '#0f0e11';

/** Logo.svg draws in a 256-unit box; the 4x4 step grid spans units 38..218. */
const LOGO_BOX = 256;
const GRID_MIN = 38;
const GRID_SIZE = 180;
const GRID_CENTER = GRID_MIN + GRID_SIZE / 2;
const SVG_DENSITY = 384;

/**
 * Every derived raster: where it lives, its pixel size, how large the step
 * grid is relative to the canvas, and what sits behind it.
 *  - transparent: just the mark
 *  - square:      full-bleed brand background (maskable / store icons)
 *  - tile:        rounded brand tile (browser tabs, home-screen "any" icons)
 *  - circle:      round brand background (Android 7 legacy launcher)
 */
export const BRAND_ASSETS = Object.freeze({
  androidForeground: {
    file: path.join(MOBILE_ASSETS, 'android-icon-foreground.png'),
    size: 1024, grid: 560 / 1024, backdrop: 'transparent',
  },
  androidMonochrome: {
    file: path.join(MOBILE_ASSETS, 'android-icon-monochrome.png'),
    size: 1024, grid: 560 / 1024, backdrop: 'transparent', monochrome: true,
  },
  androidLegacy: {
    file: path.join(MOBILE_ASSETS, 'android-icon-legacy.png'),
    size: 1024, grid: 600 / 1024, backdrop: 'circle',
  },
  expoIcon: {
    file: path.join(MOBILE_ASSETS, 'icon.png'),
    size: 1024, grid: 600 / 1024, backdrop: 'square',
  },
  expoWebFavicon: {
    file: path.join(MOBILE_ASSETS, 'favicon.png'),
    size: 48, grid: 0.72, backdrop: 'tile',
  },
  webIcon192: {
    file: path.join(WEB_ROOT, 'public', 'icon-192.png'),
    size: 192, grid: 0.6, backdrop: 'tile',
  },
  webIcon512: {
    file: path.join(WEB_ROOT, 'public', 'icon-512.png'),
    size: 512, grid: 0.6, backdrop: 'tile',
  },
  webIconMaskable: {
    file: path.join(WEB_ROOT, 'public', 'icon-maskable-512.png'),
    size: 512, grid: 0.5, backdrop: 'square',
  },
  webAppIcon: {
    file: path.join(WEB_ROOT, 'src', 'app', 'icon.png'),
    size: 512, grid: 0.6, backdrop: 'tile',
  },
  webLogoPreview: {
    file: path.join(WEB_ROOT, 'public', 'Logo.png'),
    size: 1254, grid: 0.5, backdrop: 'square',
  },
  /** expo-splash-screen centres this at SPLASH_IMAGE_WIDTH_DP on BRAND_BACKGROUND. */
  androidSplash: {
    file: path.join(MOBILE_ASSETS, 'splash-logo.png'),
    size: 1024, grid: 0.9, backdrop: 'transparent',
  },
});

/**
 * Width (dp) app.json gives expo-splash-screen for splash-logo.png. Android 12+
 * shows the splash icon inside a 192 dp circle, so the step grid's diagonal
 * (SPLASH_IMAGE_WIDTH_DP * grid * sqrt 2) must stay below 192 dp.
 */
export const SPLASH_IMAGE_WIDTH_DP = 132;

/**
 * Status-bar/media-notification icon (Android tints it). Only the eight set
 * steps of the mark: at 24 dp the empty-step dots would shrink to sub-pixel
 * specks. The 180-unit grid gets 18 units of padding on each side, the
 * 2-of-24 dp margin Android's system-icon grid asks for.
 */
export const NOTIFICATION_ICON = Object.freeze({
  file: path.join(MOBILE_ROOT, 'plugins', 'brand', 'ic_stat_music.xml'),
  sizeDp: 24,
  padding: 18,
});

/** Multi-size favicon.ico; each entry is a PNG-compressed tile. */
export const FAVICON_ICO = Object.freeze({
  file: path.join(WEB_ROOT, 'src', 'app', 'favicon.ico'),
  sizes: Object.freeze([16, 32, 48, 256]),
});

function assertSingleOccurrence(source, value, description) {
  const occurrences = source.split(value).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Cannot derive brand assets from Logo.svg: expected exactly one ${description}, found ${occurrences}`,
    );
  }
}

/** The inner drawing of Logo.svg, validated against what the derivations rely on. */
export function logoBody(productionLogo) {
  assertSingleOccurrence(productionLogo, `viewBox="0 0 ${LOGO_BOX} ${LOGO_BOX}"`, 'production viewBox');
  assertSingleOccurrence(productionLogo, `fill="${BRAND_FILL}"`, 'brand fill declaration');
  if (/<(filter|linearGradient|radialGradient|image)\b/.test(productionLogo)) {
    throw new Error('Cannot derive brand assets: Logo.svg must stay a flat single-colour mark');
  }
  const match = productionLogo.match(/^<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/);
  if (!match) throw new Error('Cannot derive brand assets: Logo.svg is not a single <svg> element');
  return match[1];
}

function backdropShape(kind, size) {
  switch (kind) {
    case 'transparent':
      return '';
    case 'square':
      return `<rect width="${size}" height="${size}" fill="${BRAND_BACKGROUND}"/>`;
    case 'tile': {
      const radius = size * 0.225;
      return `<rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND_BACKGROUND}"/>`;
    }
    case 'circle':
      return `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${BRAND_BACKGROUND}"/>`;
    default:
      throw new Error(`Unknown brand asset backdrop: ${kind}`);
  }
}

/** Compose one asset: the backdrop, then Logo.svg scaled so its grid fills `grid` of the canvas. */
export function composeAssetSvg(productionLogo, { size, grid, backdrop, monochrome = false }) {
  let body = logoBody(productionLogo);
  if (monochrome) body = body.replace(`fill="${BRAND_FILL}"`, 'fill="#ffffff"');
  const scale = (size * grid) / GRID_SIZE;
  const offset = size / 2 - GRID_CENTER * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    backdropShape(backdrop, size) +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g>` +
    '</svg>'
  );
}

const RECT_PATTERN = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="(\d+)"\/>/g;

/** The filled steps of Logo.svg as {x, y, width, height, radius}, in logo units. */
export function logoSteps(productionLogo) {
  const body = logoBody(productionLogo);
  const steps = [...body.matchAll(RECT_PATTERN)].map((match) => {
    const [x, y, width, height, radius] = match.slice(1).map(Number);
    return { x, y, width, height, radius };
  });
  const rectCount = (body.match(/<rect\b/g) ?? []).length;
  if (steps.length === 0 || steps.length !== rectCount) {
    throw new Error(
      `Cannot derive the notification icon: expected every <rect> in Logo.svg as ` +
        `x/y/width/height/rx integers, matched ${steps.length} of ${rectCount}`,
    );
  }
  for (const step of steps) {
    if (step.x < GRID_MIN || step.y < GRID_MIN ||
        step.x + step.width > GRID_MIN + GRID_SIZE || step.y + step.height > GRID_MIN + GRID_SIZE) {
      throw new Error(`Logo.svg step at ${step.x},${step.y} lies outside the ${GRID_SIZE}-unit grid`);
    }
  }
  return steps;
}

function roundedRectPath({ x, y, width, height, radius }) {
  const right = x + width;
  const bottom = y + height;
  return (
    `M${x + radius},${y}H${right - radius}A${radius},${radius} 0,0 1,${right},${y + radius}` +
    `V${bottom - radius}A${radius},${radius} 0,0 1,${right - radius},${bottom}` +
    `H${x + radius}A${radius},${radius} 0,0 1,${x},${bottom - radius}` +
    `V${y + radius}A${radius},${radius} 0,0 1,${x + radius},${y}Z`
  );
}

/** White VectorDrawable of the set steps, cropped to the grid plus padding. */
export function notificationIconXml(productionLogo) {
  const { sizeDp, padding } = NOTIFICATION_ICON;
  const viewport = GRID_SIZE + 2 * padding;
  const shift = GRID_MIN - padding;
  const pathData = logoSteps(productionLogo)
    .map((step) => roundedRectPath({ ...step, x: step.x - shift, y: step.y - shift }))
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<!-- Generated from web/public/Logo.svg by mobile/scripts/generate_brand_assets.mjs. Do not edit. -->\n' +
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n' +
    `    android:width="${sizeDp}dp"\n` +
    `    android:height="${sizeDp}dp"\n` +
    `    android:viewportWidth="${viewport}"\n` +
    `    android:viewportHeight="${viewport}"\n` +
    '    android:tint="#FFFFFF">\n' +
    '  <path\n' +
    '      android:fillColor="#FFFFFF"\n' +
    `      android:pathData="${pathData}" />\n` +
    '</vector>\n'
  );
}

async function rasterize(svg, size) {
  return sharp(Buffer.from(svg), { density: SVG_DENSITY })
    .resize(size, size, { fit: 'fill' })
    .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
    .toBuffer();
}

/** ICO container holding PNG images (supported by every current browser). */
export function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    if (size > 256) throw new Error(`ICO entries cannot exceed 256px, got ${size}`);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

async function renderFavicon(productionLogo) {
  const images = [];
  for (const size of FAVICON_ICO.sizes) {
    const svg = composeAssetSvg(productionLogo, {
      size, grid: size <= 32 ? 0.74 : 0.62, backdrop: 'tile',
    });
    images.push({ size, png: await rasterize(svg, size) });
  }
  return encodeIco(images);
}

export async function renderBrandAssets() {
  const productionLogo = await readFile(PRODUCTION_LOGO_PATH, 'utf8');
  const rendered = {};
  for (const [name, spec] of Object.entries(BRAND_ASSETS)) {
    rendered[name] = await rasterize(composeAssetSvg(productionLogo, spec), spec.size);
  }
  return {
    rasters: rendered,
    favicon: await renderFavicon(productionLogo),
    notificationIcon: notificationIconXml(productionLogo),
  };
}

async function rawRgba(buffer, size, description) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== size || info.height !== size || info.channels !== 4) {
    throw new Error(
      `${description} must decode to ${size}x${size} RGBA; got ` +
        `${info.width}x${info.height} with ${info.channels} channels`,
    );
  }
  return data;
}

async function readCommitted(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    throw new Error(
      `Brand asset is missing: ${path.relative(REPOSITORY_ROOT, filePath)}. ` +
        'Run npm run generate:brand-assets in mobile/.',
      { cause: error },
    );
  }
}

export async function checkBrandAssets() {
  const { rasters, favicon, notificationIcon } = await renderBrandAssets();
  const stale = [];
  for (const [name, spec] of Object.entries(BRAND_ASSETS)) {
    const actual = await readCommitted(spec.file);
    const relative = path.relative(REPOSITORY_ROOT, spec.file);
    const [expectedPixels, actualPixels] = await Promise.all([
      rawRgba(rasters[name], spec.size, `Generated ${name} asset`),
      rawRgba(actual, spec.size, relative),
    ]);
    if (!expectedPixels.equals(actualPixels)) stale.push(relative);
  }
  const committedFavicon = await readCommitted(FAVICON_ICO.file);
  if (!committedFavicon.equals(favicon)) stale.push(path.relative(REPOSITORY_ROOT, FAVICON_ICO.file));
  const committedIcon = (await readCommitted(NOTIFICATION_ICON.file)).toString('utf8');
  if (committedIcon !== notificationIcon) stale.push(path.relative(REPOSITORY_ROOT, NOTIFICATION_ICON.file));
  if (stale.length > 0) {
    throw new Error(
      `Brand assets are stale (${stale.join(', ')}). Run npm run generate:brand-assets in mobile/.`,
    );
  }
}

export async function writeBrandAssets() {
  const { rasters, favicon, notificationIcon } = await renderBrandAssets();
  await mkdir(path.dirname(NOTIFICATION_ICON.file), { recursive: true });
  await Promise.all([
    ...Object.entries(BRAND_ASSETS).map(([name, spec]) => writeFile(spec.file, rasters[name])),
    writeFile(FAVICON_ICO.file, favicon),
    writeFile(NOTIFICATION_ICON.file, notificationIcon),
  ]);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/generate_brand_assets.mjs [--check]');
  }
  if (args[0] === '--check') {
    await checkBrandAssets();
    return;
  }
  await writeBrandAssets();
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
