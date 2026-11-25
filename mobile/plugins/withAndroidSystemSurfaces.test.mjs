import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withAndroidSystemSurfaces');

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createManifest() {
  return {
    $: {},
    application: [{
      $: {},
      activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [] }],
      service: [],
      receiver: [],
    }],
  };
}

describe('withAndroidSystemSurfaces', () => {
  it('registers the Now Playing widget, Quick Settings Tile, and launcher shortcuts metadata idempotently', () => {
    const manifest = createManifest();
    plugin.configureManifestObject(manifest);
    const once = JSON.stringify(manifest);
    plugin.configureManifestObject(manifest);
    expect(JSON.stringify(manifest)).toBe(once);

    const app = manifest.application[0];
    const receivers = app.receiver.filter(
      (entry) => entry.$['android:name'] === plugin.WIDGET_PROVIDER_NAME,
    );
    expect(receivers).toHaveLength(1);
    expect(receivers[0].$).toMatchObject({
      'android:exported': 'true',
      'android:label': '@string/loggerythm_widget_name',
    });
    expect(receivers[0]['meta-data']).toContainEqual({
      $: {
        'android:name': 'android.appwidget.provider',
        'android:resource': '@xml/loggerythm_now_playing_widget_info',
      },
    });

    const actionReceivers = app.receiver.filter(
      (entry) => entry.$['android:name'] === plugin.WIDGET_ACTION_RECEIVER_NAME,
    );
    expect(actionReceivers).toEqual([{
      $: {
        'android:name': plugin.WIDGET_ACTION_RECEIVER_NAME,
        'android:exported': 'false',
      },
    }]);

    const tiles = app.service.filter(
      (entry) => entry.$['android:name'] === plugin.QUICK_TILE_SERVICE_NAME,
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0].$).toMatchObject({
      'android:exported': 'true',
      'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE',
      'android:icon': '@drawable/ic_loggerythm_qs_radio',
      'android:label': '@string/loggerythm_qs_tile_label',
    });

    expect(app.activity[0]['meta-data']).toContainEqual({
      $: {
        'android:name': 'android.app.shortcuts',
        'android:resource': '@xml/shortcuts',
      },
    });
  });

  it('generates all five deep-linked static launcher shortcuts with strict package scoping', () => {
    const xml = plugin.buildShortcutsXml('top.logge.loggerythm');
    expect(xml).toContain('android:shortcutId="shortcut_search"');
    expect(xml).toContain('android:data="loggerythm://search"');
    expect(xml).toContain('android:shortcutId="shortcut_liked"');
    expect(xml).toContain('android:data="loggerythm://library"');
    expect(xml).toContain('android:shortcutId="shortcut_radar"');
    expect(xml).toContain('android:data="loggerythm://radar"');
    expect(xml).toContain('android:shortcutId="shortcut_radio"');
    expect(xml).toContain('android:data="loggerythm://radio"');
    expect(xml).toContain('android:shortcutId="shortcut_jam"');
    expect(xml).toContain('android:data="loggerythm://party/start"');
    expect(xml).toContain('android:targetPackage="top.logge.loggerythm"');
    expect(xml).toContain('android:targetClass="top.logge.loggerythm.MainActivity"');

    const enStrings = plugin.buildShortcutStringsXml('en');
    const deStrings = plugin.buildShortcutStringsXml('de');
    expect(enStrings).toContain('Release Radar');
    expect(enStrings).toContain('Start Jam');
    expect(deStrings).toContain('Lieblingssongs');
    expect(deStrings).toContain('Jam starten');
  });

  it('writes adaptive and monochrome shortcut icons for round masks and icon packs alongside legacy fallbacks', () => {
    const resRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loggerythm-shortcuts-'));
    temporaryRoots.push(resRoot);
    plugin.writeShortcutResourcesToDisk('top.logge.loggerythm', resRoot);

    for (const shortcut of plugin.LAUNCHER_SHORTCUTS) {
      const baseName = shortcut.icon.replace('@drawable/', '');
      const legacyXml = fs.readFileSync(path.join(resRoot, 'drawable', `${baseName}.xml`), 'utf8');
      const fgXml = fs.readFileSync(path.join(resRoot, 'drawable', `${baseName}_foreground.xml`), 'utf8');
      const monoXml = fs.readFileSync(path.join(resRoot, 'drawable', `${baseName}_monochrome.xml`), 'utf8');
      const adaptiveXml = fs.readFileSync(path.join(resRoot, 'drawable-anydpi-v26', `${baseName}.xml`), 'utf8');

      expect(legacyXml).toContain('android:fillColor="#0f0e11"');
      expect(legacyXml).toContain('android:fillColor="#d6ff4b"');
      expect(fgXml).toContain('android:width="108dp"');
      expect(fgXml).toContain('android:fillColor="#d6ff4b"');
      expect(monoXml).toContain('android:width="108dp"');
      expect(monoXml).toContain('android:fillColor="#FFFFFF"');
      expect(adaptiveXml).toContain('<adaptive-icon');
      expect(adaptiveXml).toContain('<background android:drawable="@color/iconBackground" />');
      expect(adaptiveXml).toContain(`<foreground android:drawable="@drawable/${baseName}_foreground" />`);
      expect(adaptiveXml).toContain(`<monochrome android:drawable="@drawable/${baseName}_monochrome" />`);
    }
  });

  it('fails loudly when android.package or .MainActivity is missing', () => {
    expect(() => plugin.buildShortcutsXml('not valid')).toThrow('android.package is invalid');
    expect(() => plugin.configureManifestObject({ application: [{ activity: [] }] })).toThrow(
      '.MainActivity not found',
    );
  });
});
