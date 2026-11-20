import { Buffer } from 'node:buffer';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  BRAND_ASSETS,
  BRAND_BACKGROUND,
  BRAND_FILL,
  FAVICON_ICO,
  NOTIFICATION_ICON,
  PRODUCTION_LOGO_PATH,
  SPLASH_IMAGE_WIDTH_DP,
  checkBrandAssets,
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
const ADAPTIVE_SAFE_MIN = Math.floor((SIZE * 18) / 108);
const ADAPTIVE_SAFE_MAX = Math.ceil((SIZE * 90) / 108) - 1;
const ADAPTIVE_MIN_MARK = Math.floor((SIZE * 48) / 108);
const ADAPTIVE_MAX_MARK = Math.ceil((SIZE * 66) / 108);

async function pixels(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: SIZE, height: SIZE, channels: 4 });
  return data;
}

function alphaAt(data, x, y) {
  return data[(y * SIZE + x) * 4 + 3];
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
    const offset = (288 * SIZE + 288) * 4;
    const hex = `#${[...foreground.subarray(offset, offset + 3)]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`;
    expect(hex).toBe(BRAND_FILL);
    expect(foreground[offset + 3]).toBe(255);
  });

  it('keeps adaptive color and monochrome marks inside the 66/108 safe zone', async () => {
    const foreground = await pixels(ANDROID_BRAND_ASSETS.foreground);
    const monochrome = await pixels(ANDROID_BRAND_ASSETS.monochrome);
    const foregroundBounds = alphaBounds(foreground);
    const monochromeBounds = alphaBounds(monochrome);

    for (const bounds of [foregroundBounds, monochromeBounds]) {
      expect(bounds.minX).toBeGreaterThanOrEqual(ADAPTIVE_SAFE_MIN);
      expect(bounds.minY).toBeGreaterThanOrEqual(ADAPTIVE_SAFE_MIN);
      expect(bounds.maxX).toBeLessThanOrEqual(ADAPTIVE_SAFE_MAX);
      expect(bounds.maxY).toBeLessThanOrEqual(ADAPTIVE_SAFE_MAX);
      expect(bounds.width).toBeGreaterThanOrEqual(ADAPTIVE_MIN_MARK);
      expect(bounds.height).toBeGreaterThanOrEqual(ADAPTIVE_MIN_MARK);
      expect(bounds.width).toBeLessThanOrEqual(ADAPTIVE_MAX_MARK);
      expect(bounds.height).toBeLessThanOrEqual(ADAPTIVE_MAX_MARK);
      // Only the 1px antialiased rim of the 16 step shapes may be translucent
      // (~3.5%); a glow or soft shadow layer would push this past 20%.
      expect(bounds.translucent / (bounds.opaque + bounds.translucent)).toBeLessThan(0.05);
    }
    expectTransparentBorder(foreground);
    expectTransparentBorder(monochrome);
    expect(alphaChannel(monochrome)).toEqual(alphaChannel(foreground));
  }, 15_000);

  it('uses a crisp tintable monochrome silhouette with set steps and empty-step dots', async () => {
    const monochrome = await pixels(ANDROID_BRAND_ASSETS.monochrome);
    for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
      const offset = pixel * 4;
      if (monochrome[offset + 3] === 0) continue;
      expect(monochrome[offset]).toBe(255);
      expect(monochrome[offset + 1]).toBe(255);
      expect(monochrome[offset + 2]).toBe(255);
    }
    // Top-left set step, the off-beat step, and an empty-step dot are solid…
    expect(alphaAt(monochrome, 288, 288)).toBeGreaterThan(250);
    expect(alphaAt(monochrome, 587, 437)).toBeGreaterThan(250);
    expect(alphaAt(monochrome, 437, 288)).toBeGreaterThan(250);
    // …while the gutters between steps stay open.
    expect(alphaAt(monochrome, 363, 288)).toBe(0);
    expect(alphaAt(monochrome, 512, 512)).toBe(0);
  }, 15_000);

  it('gives Android 7 a circular brand-background legacy silhouette', async () => {
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
    expect(path.basename(ANDROID_BRAND_ASSETS.legacy)).toBe('android-icon-legacy.png');
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

  it('rejects a logo whose steps the notification icon cannot read', () => {
    const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">' +
      `<g fill="${BRAND_FILL}"><rect x="38" y="38" width="36" height="36"/></g></svg>`;
    expect(() => logoSteps(logo)).toThrow('matched 0 of 1');
  });
});
