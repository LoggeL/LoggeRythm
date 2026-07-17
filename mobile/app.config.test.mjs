import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const configure = require('./app.config');
const appConfig = require('./app.json').expo;

const originalNodeEnv = process.env.NODE_ENV;
const originalApiBase = process.env.EXPO_PUBLIC_API_BASE;

function resolvedConfig(nodeEnv, apiBase) {
  process.env.NODE_ENV = nodeEnv;
  if (apiBase === undefined) delete process.env.EXPO_PUBLIC_API_BASE;
  else process.env.EXPO_PUBLIC_API_BASE = apiBase;
  return configure({ config: structuredClone(appConfig) });
}

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalApiBase === undefined) delete process.env.EXPO_PUBLIC_API_BASE;
  else process.env.EXPO_PUBLIC_API_BASE = originalApiBase;
});

describe('Expo API-origin policy', () => {
  it('keeps production HTTPS-only at the canonical origin', () => {
    const config = resolvedConfig('production', undefined);
    expect(config.android.predictiveBackGestureEnabled).toBe(true);
    expect(config.android.icon).toBe('./assets/android-icon-legacy.png');
    expect(config.plugins).toContain('./plugins/withMusicVolumeControl');
    expect(config.plugins).toContain('./plugins/withAndroidLauncherAssets');
    expect(config.plugins).toContain('./plugins/withNoHttpRedirects');
    expect(config.plugins).toContain('./plugins/withFirstPartyPlayer');
    expect(config.plugins).not.toContain('./plugins/withAndroidAuto');
    expect(config.plugins).toContain('@react-native-vector-icons/material-design-icons');
    const buildProperties = config.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
    );
    expect(buildProperties[1].android.usesCleartextTraffic).toBe(false);
    expect(() => resolvedConfig('production', 'https://staging.example.test')).toThrow(
      'production builds must use the canonical LoggeRythm API origin',
    );
  });

  it('allows explicit cleartext only for local debug builds', () => {
    const config = resolvedConfig('development', 'http://10.0.2.2:8000');
    const buildProperties = config.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
    );
    expect(buildProperties[1].android.usesCleartextTraffic).toBe(true);
  });

  it('never echoes a rejected configured value', () => {
    const configured = 'https://user:fake-secret@example.test';
    let message = '';
    try {
      resolvedConfig('production', configured);
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('embedded credentials are not allowed');
    expect(message).not.toContain(configured);
    expect(message).not.toContain('fake-secret');
  });
});
