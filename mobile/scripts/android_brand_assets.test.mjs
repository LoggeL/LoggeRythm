import { Buffer } from 'node:buffer';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  ANDROID_BRAND_ASSETS,
  checkAndroidBrandAssets,
} from './generate_android_brand_assets.mjs';

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

describe('Android production-brand launcher assets', () => {
  it('matches deterministic rasters derived from the production Logo.svg', async () => {
    await expect(checkAndroidBrandAssets()).resolves.toBeUndefined();
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
      expect(bounds.translucent / (bounds.opaque + bounds.translucent)).toBeLessThan(0.03);
    }
    expectTransparentBorder(foreground);
    expectTransparentBorder(monochrome);
    expect(alphaChannel(monochrome)).toEqual(alphaChannel(foreground));
  });

  it('uses a crisp tintable monochrome silhouette with the production wave cut-out', async () => {
    const monochrome = await pixels(ANDROID_BRAND_ASSETS.monochrome);
    for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
      const offset = pixel * 4;
      if (monochrome[offset + 3] === 0) continue;
      expect(monochrome[offset]).toBe(255);
      expect(monochrome[offset + 1]).toBe(255);
      expect(monochrome[offset + 2]).toBe(255);
    }
    expect(alphaAt(monochrome, 512, 540)).toBe(0);
    expect(alphaAt(monochrome, 512, 480)).toBeGreaterThan(250);
    expect(alphaAt(monochrome, 512, 620)).toBeGreaterThan(250);
  });

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
    expect([...legacy.subarray(brandBackground, brandBackground + 4)]).toEqual([10, 10, 20, 255]);
    expect(path.basename(ANDROID_BRAND_ASSETS.legacy)).toBe('android-icon-legacy.png');
  });
});
