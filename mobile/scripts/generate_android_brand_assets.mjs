import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MOBILE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPOSITORY_ROOT = path.resolve(MOBILE_ROOT, '..');
const PRODUCTION_LOGO_PATH = path.join(REPOSITORY_ROOT, 'web', 'public', 'Logo.svg');
const ASSETS_ROOT = path.join(MOBILE_ROOT, 'assets');

export const ANDROID_BRAND_ASSETS = Object.freeze({
  foreground: path.join(ASSETS_ROOT, 'android-icon-foreground.png'),
  monochrome: path.join(ASSETS_ROOT, 'android-icon-monochrome.png'),
  legacy: path.join(ASSETS_ROOT, 'android-icon-legacy.png'),
});

const OUTPUT_SIZE = 1024;
const SVG_DENSITY = 384;

function replaceExactly(source, pattern, replacement, description) {
  const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const matches = [...source.matchAll(matcher)];
  if (matches.length !== 1) {
    throw new Error(
      `Cannot derive Android brand assets: expected exactly one ${description}, found ${matches.length}`,
    );
  }
  return source.replace(matcher, replacement);
}

function assertSingleOccurrence(source, value, description) {
  const occurrences = source.split(value).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Cannot derive Android brand assets: expected exactly one ${description}, found ${occurrences}`,
    );
  }
}

/**
 * Keep the production equalizer geometry, wave cut-out, and gradient while
 * removing the two glow layers. Android requires clean adaptive-icon edges;
 * shadows/glow belong in the in-app logo, not in launcher foreground layers.
 */
export function cleanProductionLogoSvg(productionLogo) {
  assertSingleOccurrence(productionLogo, 'viewBox="0 0 256 256"', 'production viewBox');
  assertSingleOccurrence(productionLogo, '<use href="#sfMarks"/>', 'unfiltered brand mark');

  let clean = replaceExactly(
    productionLogo,
    /\n    <filter id="sfSoftGlow"[\s\S]*?<\/filter>/,
    '',
    'sfSoftGlow filter definition',
  );
  clean = replaceExactly(
    clean,
    /\n    <filter id="sfTightGlow"[\s\S]*?<\/filter>/,
    '',
    'sfTightGlow filter definition',
  );
  clean = replaceExactly(
    clean,
    /\n    <use href="#sfMarks" filter="url\(#sfSoftGlow\)" opacity="0\.55"\/>/,
    '',
    'sfSoftGlow paint layer',
  );
  clean = replaceExactly(
    clean,
    /\n    <use href="#sfMarks" filter="url\(#sfTightGlow\)" opacity="0\.9"\/>/,
    '',
    'sfTightGlow paint layer',
  );

  if (clean.includes('<filter') || clean.includes('filter=')) {
    throw new Error('Cannot derive Android brand assets: an unsupported SVG filter remains');
  }
  return clean;
}

export function monochromeLogoSvg(cleanLogo) {
  return replaceExactly(
    cleanLogo,
    /fill="url\(#sfGrad\)" stroke="url\(#sfGrad\)"/,
    'fill="#ffffff" stroke="#ffffff"',
    'gradient paint declaration',
  );
}

export function legacyLogoSvg(cleanLogo) {
  const zoomed = replaceExactly(
    cleanLogo,
    /viewBox="0 0 256 256"/,
    'viewBox="21 21 214 214"',
    'production viewBox',
  );
  return replaceExactly(
    zoomed,
    /  <\/defs>\n\n  <g mask="url\(#sfWave\)">/,
    `  </defs>

  <circle cx="128" cy="128" r="107" fill="#0a0a14"/>

  <g mask="url(#sfWave)">`,
    'brand mark render boundary',
  );
}

async function rasterize(svg) {
  return sharp(Buffer.from(svg), { density: SVG_DENSITY })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'fill' })
    .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
    .toBuffer();
}

export async function renderAndroidBrandAssets() {
  const productionLogo = await readFile(PRODUCTION_LOGO_PATH, 'utf8');
  const cleanLogo = cleanProductionLogoSvg(productionLogo);
  return {
    foreground: await rasterize(cleanLogo),
    monochrome: await rasterize(monochromeLogoSvg(cleanLogo)),
    legacy: await rasterize(legacyLogoSvg(cleanLogo)),
  };
}

async function rawRgba(buffer, description) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== OUTPUT_SIZE || info.height !== OUTPUT_SIZE || info.channels !== 4) {
    throw new Error(
      `${description} must decode to ${OUTPUT_SIZE}x${OUTPUT_SIZE} RGBA; got ` +
        `${info.width}x${info.height} with ${info.channels} channels`,
    );
  }
  return data;
}

export async function checkAndroidBrandAssets() {
  const expected = await renderAndroidBrandAssets();
  for (const [name, filePath] of Object.entries(ANDROID_BRAND_ASSETS)) {
    let actual;
    try {
      actual = await readFile(filePath);
    } catch (error) {
      throw new Error(
        `Android brand asset is missing: ${path.relative(MOBILE_ROOT, filePath)}. ` +
          'Run npm run generate:android-icons.',
        { cause: error },
      );
    }
    const [expectedPixels, actualPixels] = await Promise.all([
      rawRgba(expected[name], `Generated ${name} asset`),
      rawRgba(actual, path.relative(MOBILE_ROOT, filePath)),
    ]);
    if (!expectedPixels.equals(actualPixels)) {
      throw new Error(
        `Android brand asset is stale: ${path.relative(MOBILE_ROOT, filePath)}. ` +
          'Run npm run generate:android-icons.',
      );
    }
  }
}

export async function writeAndroidBrandAssets() {
  const rendered = await renderAndroidBrandAssets();
  await Promise.all(
    Object.entries(ANDROID_BRAND_ASSETS).map(([name, filePath]) => writeFile(filePath, rendered[name])),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/generate_android_brand_assets.mjs [--check]');
  }
  if (args[0] === '--check') {
    await checkAndroidBrandAssets();
    return;
  }
  await writeAndroidBrandAssets();
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
