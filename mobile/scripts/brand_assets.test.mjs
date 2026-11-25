import { Buffer } from 'node:buffer';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  ADAPTIVE_CANVAS_DP,
  ADAPTIVE_GRID_DP,
  ADAPTIVE_LAUNCHER_VECTORS,
  ADAPTIVE_SAFE_DIAMETER_DP,
  BRAND_ASSETS,
  BRAND_BACKGROUND,
  BRAND_FILL,
  FAVICON_ICO,
  NOTIFICATION_ICON,
  PRODUCTION_LOGO_PATH,
  SPLASH_IMAGE_WIDTH_DP,
  adaptiveLauncherVectorXml,
  checkBrandAssets,
  logoDots,
  logoSteps,
  notificationIconXml,
} from './generate_brand_assets.mjs';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_CONFIG = JSON.parse(readFileSync(path.join(MOBILE_ROOT, 'app.json'), 'utf8'));

const ANDROID_BRAND_ASSETS = {
  foreground: BRAND_ASSETS.androidForeground.file,
  monochrome: BRAND_ASSETS.androidMonochrome.file,
  legacy: BRAND_ASSETS.androidLegacy.file,
};

const SIZE = 1024;
const ADAPTIVE_SAFE_RADIUS = ((ADAPTIVE_SAFE_DIAMETER_DP / 2) / ADAPTIVE_CANVAS_DP) * SIZE;
// Leave extra radial margin inside the 66dp safe circle for bordered/ringed icon packs.
const ADAPTIVE_ICON_PACK_RADIUS = (30 / ADAPTIVE_CANVAS_DP) * SIZE;
const ADAPTIVE_MIN_MARK = Math.floor((SIZE * 38) / ADAPTIVE_CANVAS_DP);
const ADAPTIVE_MAX_MARK = Math.ceil((SIZE * 46) / ADAPTIVE_CANVAS_DP);

function logoCoordToPixel(coord, size, grid) {
  const scale = (size * grid) / 180;
  const offset = size / 2 - 128 * scale;
  return Math.round(offset + coord * scale);
}

async function pixels(filePath, expectedSize = SIZE) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: expectedSize, height: expectedSize, channels: 4 });
  return data;
}

function alphaAt(data, x, y, size = SIZE) {
  return data[(y * size + x) * 4 + 3];
}

function maxRadius(data, size, predicate) {
  let maxDist = 0;
  let found = 0;
  const center = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!predicate(data, x, y, size)) continue;
      found += 1;
      const dist = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      if (dist > maxDist) maxDist = dist;
    }
  }
  if (found === 0) throw new Error('Expected at least one matching pixel');
  return maxDist;
}

function isBrandMarkPixel(data, x, y, size) {
  const offset = (y * size + x) * 4;
  // Distinguishes lime mark pixels (including AA edges) from the #0f0e11 backdrop & its rim.
  return data[offset + 3] > 0 && data[offset + 1] > 30;
}

function alphaBounds(data) {
  let minX = SIZE;
  let minY = SIZE;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  let translucent = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const alpha = alphaAt(data, x, y);
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (alpha === 255) opaque += 1;
      else translucent += 1;
    }
  }
  if (maxX < 0) throw new Error('Android launcher mark has no visible pixels');
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    opaque,
    translucent,
  };
}

function expectTransparentBorder(data) {
  for (let coordinate = 0; coordinate < SIZE; coordinate += 1) {
    expect(alphaAt(data, coordinate, 0)).toBe(0);
    expect(alphaAt(data, coordinate, SIZE - 1)).toBe(0);
    expect(alphaAt(data, 0, coordinate)).toBe(0);
    expect(alphaAt(data, SIZE - 1, coordinate)).toBe(0);
  }
}

function expectTransparentCorners(data) {
  expect(alphaAt(data, 0, 0)).toBe(0);
  expect(alphaAt(data, SIZE - 1, 0)).toBe(0);
  expect(alphaAt(data, 0, SIZE - 1)).toBe(0);
  expect(alphaAt(data, SIZE - 1, SIZE - 1)).toBe(0);
}

function alphaChannel(data) {
  const alpha = Buffer.alloc(SIZE * SIZE);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
    alpha[pixel] = data[pixel * 4 + 3];
  }
  return alpha;
}

describe('Brand assets derived from the production Logo.svg', () => {
  it('matches deterministic rasters and favicon.ico derived from Logo.svg', async () => {
    await expect(checkBrandAssets()).resolves.toBeUndefined();
  }, 30_000);

  it('ships a favicon.ico with every tab and taskbar size', async () => {
    const ico = await import('node:fs/promises').then(({ readFile }) => readFile(FAVICON_ICO.file));
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = [];
    for (let entry = 0; entry < count; entry += 1) {
      const width = ico.readUInt8(6 + entry * 16);
      sizes.push(width === 0 ? 256 : width);
    }
    expect(sizes).toEqual([16, 32, 48, 256]);
  });

  it('paints the colour launcher mark in the web accent', async () => {
    const foreground = await pixels(ANDROID_BRAND_ASSETS.foreground);
    const stepX = logoCoordToPixel(56, SIZE, BRAND_ASSETS.androidForeground.grid);
    const stepY = logoCoordToPixel(56, SIZE, BRAND_ASSETS.androidForeground.grid);
    const offset = (stepY * SIZE + stepX) * 4;
    const hex = `#${[...foreground.subarray(offset, offset + 3)]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`;
    expect(hex).toBe(BRAND_FILL);
    expect(foreground[offset + 3]).toBe(255);
  });

  it('keeps adaptive color and monochrome marks inside the 66dp circular safe zone for round icons and icon packs', async () => {
    const foreground = await pixels(ANDROID_BRAND_ASSETS.foreground);
    const monochrome = await pixels(ANDROID_BRAND_ASSETS.monochrome);
    const foregroundBounds = alphaBounds(foreground);
    const monochromeBounds = alphaBounds(monochrome);

    for (const [data, bounds] of [
      [foreground, foregroundBounds],
      [monochrome, monochromeBounds],
    ]) {
      // Every visible pixel (including the three corner tiles) must fit inside
      // Android's 66dp circular safe zone with extra margin for ringed/custom icon packs.
      const furthest = maxRadius(data, SIZE, (buf, x, y, s) => alphaAt(buf, x, y, s) > 0);
      expect(furthest).toBeLessThanOrEqual(ADAPTIVE_SAFE_RADIUS);
      expect(furthest).toBeLessThanOrEqual(ADAPTIVE_ICON_PACK_RADIUS);
      expect(bounds.width).toBeGreaterThanOrEqual(ADAPTIVE_MIN_MARK);
      expect(bounds.height).toBeGreaterThanOrEqual(ADAPTIVE_MIN_MARK);
      expect(bounds.width).toBeLessThanOrEqual(ADAPTIVE_MAX_MARK);
      expect(bounds.height).toBeLessThanOrEqual(ADAPTIVE_MAX_MARK);
      // Only the 1px antialiased rim of the 16 step shapes may be translucent
      // (~4-5%); a glow or soft shadow layer would push this past 20%.
      expect(bounds.translucent / (bounds.opaque + bounds.translucent)).toBeLessThan(0.08);
    }
    expectTransparentBorder(foreground);
    expectTransparentBorder(monochrome);
    expect(alphaChannel(monochrome)).toEqual(alphaChannel(foreground));
  }, 15_000);

  it('uses a crisp tintable monochrome silhouette with set steps and empty-step dots', async () => {
    const monochrome = await pixels(ANDROID_BRAND_ASSETS.monochrome);
    const grid = BRAND_ASSETS.androidMonochrome.grid;
    for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
      const offset = pixel * 4;
      if (monochrome[offset + 3] === 0) continue;
      expect(monochrome[offset]).toBe(255);
      expect(monochrome[offset + 1]).toBe(255);
      expect(monochrome[offset + 2]).toBe(255);
    }
    // Top-left set step, the off-beat step, and an empty-step dot are solid…
    expect(alphaAt(monochrome, logoCoordToPixel(56, SIZE, grid), logoCoordToPixel(56, SIZE, grid))).toBeGreaterThan(250);
    expect(alphaAt(monochrome, logoCoordToPixel(152, SIZE, grid), logoCoordToPixel(104, SIZE, grid))).toBeGreaterThan(250);
    expect(alphaAt(monochrome, logoCoordToPixel(104, SIZE, grid), logoCoordToPixel(56, SIZE, grid))).toBeGreaterThan(250);
    // …while the gutters between steps stay open.
    expect(alphaAt(monochrome, logoCoordToPixel(80, SIZE, grid), logoCoordToPixel(56, SIZE, grid))).toBe(0);
    expect(alphaAt(monochrome, 512, 512)).toBe(0);
  }, 15_000);

  it('gives Android 7 a circular brand-background legacy silhouette with round-edge margin', async () => {
    const foreground = await pixels(ANDROID_BRAND_ASSETS.foreground);
    const legacy = await pixels(ANDROID_BRAND_ASSETS.legacy);
    const foregroundBounds = alphaBounds(foreground);
    const legacyBounds = alphaBounds(legacy);

    expectTransparentCorners(legacy);
    expect(legacyBounds.width).toBeGreaterThan(foregroundBounds.width);
    expect(legacyBounds.height).toBeGreaterThan(foregroundBounds.height);
    expect(legacyBounds.width).toBe(SIZE);
    expect(legacyBounds.height).toBe(SIZE);
    expect(Math.abs(legacyBounds.width - legacyBounds.height)).toBeLessThanOrEqual(1);
    expect(alphaAt(legacy, Math.floor(SIZE / 2), 0)).toBeGreaterThan(250);
    expect(alphaAt(legacy, 0, Math.floor(SIZE / 2))).toBeGreaterThan(250);
    expect(alphaAt(legacy, SIZE - 1, Math.floor(SIZE / 2))).toBeGreaterThan(250);
    expect(alphaAt(legacy, Math.floor(SIZE / 2), SIZE - 1)).toBeGreaterThan(250);
    const brandBackground = (80 * SIZE + 512) * 4;
    expect([...legacy.subarray(brandBackground, brandBackground + 4)]).toEqual([15, 14, 17, 255]);
    // Mark corners keep >= 9% radial clearance from the circular edge.
    expect(maxRadius(legacy, SIZE, isBrandMarkPixel)).toBeLessThanOrEqual(SIZE * 0.41);
    expect(path.basename(ANDROID_BRAND_ASSETS.legacy)).toBe('android-icon-legacy.png');
  });

  it('keeps PWA maskable and monochrome icons strictly inside the 80% circular safe zone', async () => {
    for (const [name, spec] of [
      ['webIconMaskable192', BRAND_ASSETS.webIconMaskable192],
      ['webIconMaskable', BRAND_ASSETS.webIconMaskable],
      ['webIconMonochrome', BRAND_ASSETS.webIconMonochrome],
    ]) {
      const data = await pixels(spec.file, spec.size);
      const predicate = spec.monochrome
        ? (buf, x, y, s) => alphaAt(buf, x, y, s) > 0
        : isBrandMarkPixel;
      const furthest = maxRadius(data, spec.size, predicate);
      // W3C maskable safe zone is an 80% diameter circle (radius 0.40 * size);
      // keeping the mark within 0.34 * size preserves clean breathing room under circular masks.
      expect(furthest, `${name} exceeds 80% maskable safe circle`).toBeLessThanOrEqual(spec.size * 0.34);
    }
  });

  it('derives crisp 108dp adaptive foreground and monochrome VectorDrawables inside the 66dp safe circle', async () => {
    const logo = await readFile(PRODUCTION_LOGO_PATH, 'utf8');
    expect(logoSteps(logo)).toHaveLength(8);
    expect(logoDots(logo)).toHaveLength(8);

    const safeRadiusVp = ((ADAPTIVE_SAFE_DIAMETER_DP / 2) / ADAPTIVE_CANVAS_DP) * ADAPTIVE_LAUNCHER_VECTORS.viewport;
    const centerVp = ADAPTIVE_LAUNCHER_VECTORS.viewport / 2;
    const expectedGridVp = (ADAPTIVE_LAUNCHER_VECTORS.viewport * ADAPTIVE_GRID_DP) / ADAPTIVE_CANVAS_DP;
    const expectedOrigin = (ADAPTIVE_LAUNCHER_VECTORS.viewport - expectedGridVp) / 2;

    for (const layer of ['foreground', 'monochrome']) {
      const spec = ADAPTIVE_LAUNCHER_VECTORS[layer];
      const xml = adaptiveLauncherVectorXml(logo, spec);
      expect(await readFile(spec.file, 'utf8')).toBe(xml);
      expect(xml).toContain('android:width="108dp"');
      expect(xml).toContain('android:height="108dp"');
      expect(xml).toContain(`android:viewportWidth="${ADAPTIVE_LAUNCHER_VECTORS.viewport}"`);
      expect(xml).toContain(`android:fillColor="${spec.fillColor}"`);

      const paths = [...xml.matchAll(/android:pathData="([^"]+)"/g)].map((match) => match[1]);
      expect(paths.length).toBeGreaterThanOrEqual(2);
      let shapeCount = 0;
      for (const pathData of paths) {
        // Keep every single path below Android Lint's 800-character VectorPath threshold.
        expect(pathData.length).toBeLessThan(800);
        shapeCount += (pathData.match(/M/g) ?? []).length;
      }
      expect(shapeCount).toBe(16);
      // Corner of the rounded outer tile sits well inside the 66dp safe-zone circle.
      const cornerRadius = (10 / 180) * expectedGridVp;
      const cornerCenterOffset = expectedGridVp / 2 - cornerRadius;
      const outerCornerDist = Math.hypot(cornerCenterOffset, cornerCenterOffset) + cornerRadius;
      expect(outerCornerDist).toBeLessThan(safeRadiusVp);
      expect(expectedOrigin).toBeGreaterThan(centerVp - safeRadiusVp);
    }
  });

  it('configures the native splash with the transparent mark on the brand background', async () => {
    const splashPlugins = APP_CONFIG.expo.plugins.filter(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );
    expect(splashPlugins).toHaveLength(1);
    const options = splashPlugins[0][1];
    expect(path.resolve(MOBILE_ROOT, options.image)).toBe(BRAND_ASSETS.androidSplash.file);
    expect(options.backgroundColor).toBe(BRAND_BACKGROUND);
    expect(options.imageWidth).toBe(SPLASH_IMAGE_WIDTH_DP);
    expect(Object.keys(options).sort()).toEqual(['backgroundColor', 'image', 'imageWidth']);

    // Android 12+ crops the splash icon to a 192 dp circle: the grid's corners must fit.
    const gridDp = SPLASH_IMAGE_WIDTH_DP * BRAND_ASSETS.androidSplash.grid;
    expect(gridDp * Math.SQRT2).toBeLessThan(192);
    expect(gridDp).toBeGreaterThan(100);

    const splash = await pixels(BRAND_ASSETS.androidSplash.file);
    expectTransparentBorder(splash);
    const offset = (Math.round(SIZE * 0.1) * SIZE + Math.round(SIZE * 0.1)) * 4;
    expect(`#${[...splash.subarray(offset, offset + 3)]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`).toBe(BRAND_FILL);
  });

  it('derives the notification icon from the eight set steps only', async () => {
    const logo = await readFile(PRODUCTION_LOGO_PATH, 'utf8');
    const steps = logoSteps(logo);
    expect(steps).toHaveLength(8);
    const xml = notificationIconXml(logo);
    expect(await readFile(NOTIFICATION_ICON.file, 'utf8')).toBe(xml);
    expect(xml).toContain('android:width="24dp"');
    expect(xml).toContain('android:viewportWidth="216"');
    const pathData = xml.match(/android:pathData="([^"]+)"/)[1];
    expect(pathData.match(/M/g)).toHaveLength(8);
    const coordinates = pathData.match(/-?\d+(\.\d+)?/g).map(Number);
    expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...coordinates)).toBeLessThanOrEqual(216 - NOTIFICATION_ICON.padding);
  });

  it('rejects a logo whose steps or dots the vector icons cannot read', () => {
    const badSteps = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">' +
      `<g fill="${BRAND_FILL}"><rect x="38" y="38" width="36" height="36"/></g></svg>`;
    expect(() => logoSteps(badSteps)).toThrow('matched 0 of 1');

    const badDots = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">' +
      `<g fill="${BRAND_FILL}"><circle cx="104" cy="56"/></g></svg>`;
    expect(() => logoDots(badDots)).toThrow('matched 0 of 1');
  });
});
