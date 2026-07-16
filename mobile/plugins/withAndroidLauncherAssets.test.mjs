import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withAndroidLauncherAssets');

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fixture'),
]);
const WEBP_BYTES = Buffer.from('RIFF\x04\x00\x00\x00WEBPfixture', 'binary');
const temporaryRoots = [];

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loggerythm-launcher-assets-'));
  temporaryRoots.push(root);
  for (const density of plugin.DENSITY_DIRECTORIES) {
    const directory = path.join(root, density);
    fs.mkdirSync(directory, { recursive: true });
    for (const resourceName of plugin.REQUIRED_LAUNCHER_RESOURCES) {
      fs.writeFileSync(path.join(directory, `${resourceName}.webp`), PNG_BYTES);
    }
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('withAndroidLauncherAssets generated-resource contract', () => {
  it('renames PNG-encoded WebP paths without changing bytes or resource names', () => {
    const root = fixtureRoot();
    const optional = path.join(root, 'mipmap-mdpi', 'ic_launcher_background.webp');
    fs.writeFileSync(optional, PNG_BYTES);

    plugin.normalizeAndroidLauncherAssets(root);

    for (const density of plugin.DENSITY_DIRECTORIES) {
      for (const resourceName of plugin.REQUIRED_LAUNCHER_RESOURCES) {
        const png = path.join(root, density, `${resourceName}.png`);
        expect(fs.readFileSync(png)).toEqual(PNG_BYTES);
        expect(fs.existsSync(path.join(root, density, `${resourceName}.webp`))).toBe(false);
      }
    }
    expect(fs.readFileSync(optional.replace(/\.webp$/, '.png'))).toEqual(PNG_BYTES);
    plugin.verifyAndroidLauncherAssets(root);
  });

  it('preserves genuinely encoded WebP resources', () => {
    const root = fixtureRoot();
    for (const density of plugin.DENSITY_DIRECTORIES) {
      for (const resourceName of plugin.REQUIRED_LAUNCHER_RESOURCES) {
        fs.writeFileSync(path.join(root, density, `${resourceName}.webp`), WEBP_BYTES);
      }
    }

    plugin.normalizeAndroidLauncherAssets(root);

    expect(fs.existsSync(path.join(root, 'mipmap-mdpi', 'ic_launcher.webp'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'mipmap-mdpi', 'ic_launcher.png'))).toBe(false);
    plugin.verifyAndroidLauncherAssets(root);
  });

  it('fails loudly on missing, conflicting, and unknown launcher resources', () => {
    const missingRoot = fixtureRoot();
    fs.unlinkSync(path.join(missingRoot, 'mipmap-mdpi', 'ic_launcher.webp'));
    expect(() => plugin.normalizeAndroidLauncherAssets(missingRoot)).toThrow(
      'Required Android launcher resource is missing: mipmap-mdpi/ic_launcher',
    );

    const conflictingRoot = fixtureRoot();
    fs.writeFileSync(path.join(conflictingRoot, 'mipmap-mdpi', 'ic_launcher.png'), PNG_BYTES);
    expect(() => plugin.normalizeAndroidLauncherAssets(conflictingRoot)).toThrow(
      'conflicting PNG/WebP files: mipmap-mdpi/ic_launcher',
    );

    const unknownRoot = fixtureRoot();
    fs.writeFileSync(path.join(unknownRoot, 'mipmap-mdpi', 'ic_launcher.webp'), 'not-an-image');
    expect(() => plugin.normalizeAndroidLauncherAssets(unknownRoot)).toThrow('unknown encoding');
  });
});
