import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withFirstPartyPlayer');
const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.join(here, '..', 'modules', 'loggerythm-player');
const readModuleFile = (...parts) => fs.readFileSync(path.join(moduleRoot, ...parts), 'utf8');

function createManifest() {
  return {
    $: {},
    application: [{
      $: {},
      activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [] }],
      service: [],
    }],
  };
}

describe('withFirstPartyPlayer app integration', () => {
  it('adds automotive metadata, production App Links, and attribution idempotently', () => {
    const manifest = createManifest();
    manifest.application[0].activity[0]['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.media.action.MEDIA_PLAY_FROM_SEARCH' } }],
    });
    plugin.configureManifestObject(manifest);
    plugin.configureManifestObject(manifest);
    const application = manifest.application[0];
    expect(application['meta-data']).toContainEqual({
      $: {
        'android:name': 'com.google.android.gms.car.application',
        'android:resource': '@xml/automotive_app_desc',
      },
    });
    expect(application['meta-data']).toContainEqual({
      $: {
        'android:name': 'androidx.car.app.TintableAttributionIcon',
        'android:resource': '@drawable/ic_stat_music',
      },
    });
    expect(application['meta-data']).toHaveLength(2);
    const webLinks = application.activity[0]['intent-filter'].find((filter) =>
      filter.data?.some((data) => data.$['android:host'] === plugin.WEB_LINK_HOST));
    expect(webLinks.$['android:autoVerify']).toBeUndefined();
    expect(webLinks.action).toEqual([
      { $: { 'android:name': 'android.intent.action.VIEW' } },
    ]);
    expect(webLinks.category).toEqual(expect.arrayContaining([
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
    ]));
    expect(webLinks.data.every((entry) =>
      entry.$['android:scheme'] === 'https' &&
      entry.$['android:host'] === plugin.WEB_LINK_HOST)).toBe(true);
    expect(application.activity[0]['intent-filter'].some((filter) =>
      filter.action?.some((action) =>
        action.$['android:name'] === 'android.media.action.MEDIA_PLAY_FROM_SEARCH'))).toBe(false);
  });

  it('enables verified App Links only after an explicit deployment opt-in', () => {
    const manifest = createManifest();
    plugin.configureManifestObject(manifest, { enableVerifiedAppLinks: true });
    const webLinks = manifest.application[0].activity[0]['intent-filter'].find((filter) =>
      filter.data?.some((data) => data.$['android:host'] === plugin.WEB_LINK_HOST));
    expect(webLinks.$['android:autoVerify']).toBe('true');
  });

  it('declares the owned browser service in the app manifest for Android Auto lint', () => {
    const manifest = createManifest();
    plugin.configureManifestObject(manifest);
    plugin.configureManifestObject(manifest);
    const services = manifest.application[0].service;
    const playerServices = services.filter((service) =>
      service.$['android:name'] ===
        'top.logge.loggerythm.player.LoggeRythmMediaLibraryService');
    expect(playerServices).toHaveLength(1);
    expect(playerServices[0].$).toMatchObject({
      'android:exported': 'true',
      'android:foregroundServiceType': 'mediaPlayback',
      'android:stopWithTask': 'false',
      'tools:ignore': 'ExportedService',
    });
    const actions = playerServices[0]['intent-filter']
      .flatMap((filter) => filter.action || [])
      .map((action) => action.$['android:name']);
    expect(actions).toEqual(expect.arrayContaining([
      'androidx.media3.session.MediaLibraryService',
      'android.media.browse.MediaBrowserService',
    ]));
  });

  it('keeps the deliberate Android Auto voice-search lint policy idempotent', () => {
    const once = plugin.transformAutoLint('android { }\n');
    expect(plugin.transformAutoLint(once)).toBe(once);
    expect(once).toContain("disable 'MissingIntentFilterForMediaSearch'");
    expect(once).not.toContain('androidx.media3:');
  });
});

describe('loggerythm-player Android library contract', () => {
  const buildGradle = readModuleFile('android', 'build.gradle');
  const manifest = readModuleFile('android', 'src', 'main', 'AndroidManifest.xml');
  const javaRoot = path.join(
    moduleRoot,
    'android',
    'src',
    'main',
    'java',
    'top',
    'logge',
    'loggerythm',
    'player',
  );
  const kotlin = () => fs.readdirSync(javaRoot)
    .filter((file) => file.endsWith('.kt'))
    .map((file) => fs.readFileSync(path.join(javaRoot, file), 'utf8'))
    .join('\n');
  const playerModule = () => fs.readFileSync(
    path.join(javaRoot, 'LoggeRythmPlayerModule.kt'),
    'utf8',
  );

  it('pins explicit Media3 dependencies in the library, not the Expo plugin', () => {
    expect(buildGradle).toContain('def media3Version = "1.10.1"');
    for (const artifact of ['exoplayer', 'session', 'datasource', 'database']) {
      expect(buildGradle).toContain(`androidx.media3:media3-${artifact}:$media3Version`);
    }
    expect(plugin.transformAutoLint('android { }')).not.toContain('androidx.media3:');
  });

  it('owns the exported service declaration and both browser actions', () => {
    expect(manifest).toContain('android:name=".LoggeRythmMediaLibraryService"');
    expect(manifest).toContain('android:exported="true"');
    expect(manifest).toContain('android:foregroundServiceType="mediaPlayback"');
    expect(manifest).toContain('androidx.media3.session.MediaLibraryService');
    expect(manifest).toContain('android.media.browse.MediaBrowserService');
  });

  it('exposes an async JSON bridge with no synchronous React methods or header events', () => {
    const source = kotlin();
    expect(source).toContain('const val NAME = "LoggeRythmPlayer"');
    expect(source).toContain('"snapshotEvent" to SNAPSHOT_EVENT');
    expect(source).toContain('"playerEvent" to PLAYER_EVENT');
    expect(source).toContain('"progressEvent" to PROGRESS_EVENT');
    expect(source).toContain('fun setup(optionsJson: String, promise: Promise)');
    expect(source).toContain('fun command(name: String, payloadJson: String, promise: Promise)');
    expect(source).toContain('fun setBrowseTree(treeJson: String, promise: Promise)');
    expect(source).toContain('fun clearPersistedState(promise: Promise)');
    expect(source).toContain('fun clearCache(promise: Promise)');
    expect(source).not.toMatch(/isBlockingSynchronousMethod\s*=\s*true/);
    expect(source).not.toContain('putMap("headers"');
    expect(source).not.toContain('putString("Cookie"');
    expect(source).not.toContain('Log.');
  });

  it('freezes the v1 authoritative snapshot field names', () => {
    const source = playerModule();
    for (const field of [
      'schemaVersion',
      'playbackState',
      'playWhenReady',
      'isPlaying',
      'positionMs',
      'durationMs',
      'bufferedPositionMs',
      'currentIndex',
      'currentItemId',
      'repeatMode',
      'queue',
      'errorCode',
      'extras',
    ]) {
      expect(source).toContain(`put("${field}"`);
    }
    expect(source).not.toContain('put("activeIndex"');
    expect(source).not.toContain('put("progress"');
    expect(source).not.toContain('put("mediaId"');
  });

  it('contains strict protocol and controller trust boundaries', () => {
    const source = kotlin();
    expect(source).toContain('requireExactKeys');
    expect(source).toContain('unexpected-key');
    expect(source).toContain('scheme == "https"');
    expect(source).toContain('scheme == "file"');
    expect(source).toContain('setOf("Cookie")');
    expect(source).toContain('MAX_BROWSE_DEPTH');
    expect(source).toContain('MAX_BROWSE_NODES');
    expect(source).toContain('session.isMediaNotificationController(controller)');
    expect(source).toContain('session.isAutomotiveController(controller)');
    expect(source).toContain('session.isAutoCompanionController(controller)');
    expect(source).toContain('controller.isTrusted');
    expect(source).toContain('ConnectionResult.reject()');
    expect(source).toContain('dataSpec.uri.toString()');
    expect(source).not.toContain('setCustomCacheKey');
  });

  it.todo('adds Android Auto sibling-queue resolution and browse-tree change notifications in phase 2');
});
