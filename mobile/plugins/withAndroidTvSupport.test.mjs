import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withAndroidTvSupport');

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loggerythm-android-tv-'));
  temporaryRoots.push(root);
  return root;
}

function createManifest(activityAttrs = {}) {
  return {
    $: {},
    application: [
      {
        $: { 'android:name': '.MainApplication' },
        activity: [
          {
            $: {
              'android:name': '.MainActivity',
              'android:screenOrientation': 'unspecified',
              'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|uiMode',
              ...activityAttrs,
            },
            'intent-filter': [
              {
                action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
                category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function createSyntheticPng(width, height) {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('withAndroidTvSupport', () => {
  it('adds Leanback launcher, optional TV/touchscreen features, banner, and navigation config idempotently', () => {
    const manifest = createManifest();
    plugin.configureManifestObject(manifest);
    plugin.configureManifestObject(manifest);

    expect(manifest['uses-feature']).toEqual([
      {
        $: {
          'android:name': 'android.software.leanback',
          'android:required': 'false',
        },
      },
      {
        $: {
          'android:name': 'android.hardware.touchscreen',
          'android:required': 'false',
        },
      },
    ]);

    const app = manifest.application[0];
    expect(app.$['android:banner']).toBe('@drawable/tv_banner');

    const activity = app.activity[0];
    // Phone launcher intent filter remains untouched.
    expect(activity['intent-filter']).toHaveLength(2);
    expect(activity['intent-filter'][0]).toEqual({
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
    });
    expect(activity['intent-filter'][1]).toEqual({
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } }],
    });

    expect(activity.$['android:screenOrientation']).toBe('unspecified');
    expect(activity.$['android:configChanges'].split('|')).toContain('navigation');
    expect(
      activity.$['android:configChanges'].split('|').filter((item) => item === 'navigation'),
    ).toHaveLength(1);
  });

  it('normalizes existing required=true leanback/touchscreen declarations to required=false', () => {
    const manifest = createManifest();
    manifest['uses-feature'] = [
      { $: { 'android:name': 'android.software.leanback', 'android:required': 'true' } },
      { $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'true' } },
    ];

    plugin.configureManifestObject(manifest);

    expect(manifest['uses-feature']).toEqual([
      { $: { 'android:name': 'android.software.leanback', 'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'false' } },
    ]);
  });

  it('fails loudly when .MainActivity locks portrait orientation or manifest elements are missing', () => {
    expect(() =>
      plugin.configureManifestObject(createManifest({ 'android:screenOrientation': 'portrait' })),
    ).toThrow(/cannot lock android:screenOrientation="portrait"/);
    expect(() =>
      plugin.configureManifestObject(
        createManifest({ 'android:screenOrientation': 'sensorPortrait' }),
      ),
    ).toThrow(/cannot lock android:screenOrientation="sensorPortrait"/);
    expect(() => plugin.configureManifestObject({})).toThrow('<application> element not found');
    expect(() => plugin.configureManifestObject({ application: [{ $: {}, activity: [] }] })).toThrow(
      '.MainActivity not found',
    );
  });

  it('writes the committed 320x180 PNG TV banner into res/drawable-xhdpi/tv_banner.png', () => {
    const resRoot = temporaryRoot();
    const writtenPath = plugin.writeTvBannerAsset(MOBILE_ROOT, resRoot);

    expect(writtenPath).toBe(path.join(resRoot, 'drawable-xhdpi', 'tv_banner.png'));
    const writtenBytes = fs.readFileSync(writtenPath);
    const sourceBytes = fs.readFileSync(path.join(MOBILE_ROOT, 'assets', 'android-tv-banner.png'));
    expect(writtenBytes).toEqual(sourceBytes);
    expect(plugin.readPngDimensions(writtenBytes, writtenPath)).toEqual({
      width: 320,
      height: 180,
    });
  });

  it('fails loudly on missing, non-PNG, or mis-sized TV banner assets', () => {
    expect(() => plugin.writeTvBannerAsset(temporaryRoot(), temporaryRoot())).toThrow(
      /TV banner asset is missing/,
    );

    const invalidRoot = temporaryRoot();
    fs.mkdirSync(path.join(invalidRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(invalidRoot, 'assets', 'android-tv-banner.png'), 'not-a-png');
    expect(() => plugin.writeTvBannerAsset(invalidRoot, temporaryRoot())).toThrow(
      /not a valid PNG/,
    );

    const wrongSizeRoot = temporaryRoot();
    fs.mkdirSync(path.join(wrongSizeRoot, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(wrongSizeRoot, 'assets', 'android-tv-banner.png'),
      createSyntheticPng(160, 90),
    );
    expect(() => plugin.writeTvBannerAsset(wrongSizeRoot, temporaryRoot())).toThrow(
      /must be 320x180px, got 160x90px/,
    );
  });
});
