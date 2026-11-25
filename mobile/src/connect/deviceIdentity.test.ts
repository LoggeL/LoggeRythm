import { describe, expect, it, vi } from 'vitest';
import {
  CONNECT_DEVICE_ID_STORAGE_KEY,
  CONNECT_DEVICE_NAME_STORAGE_KEY,
  CONNECT_ENABLED_STORAGE_KEY,
  defaultMobileDeviceName,
  detectMobileDeviceType,
  loadConnectDeviceIdentity,
  MOBILE_CONNECT_CAPABILITIES,
  saveConnectDeviceName,
  saveConnectEnabled,
  validateConnectDeviceName,
} from './deviceIdentity';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() },
}));
vi.mock('react-native', () => ({
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  Platform: { OS: 'android', constants: { Brand: 'google', Model: 'Pixel 9' } },
}));
vi.mock('../tv/tvEnvironment', () => ({ isTvMode: () => false }));

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: vi.fn(async (key: string) => map.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
  };
}

describe('Connect mobile device identity', () => {
  it('declares mobile audio playback and hardware volume capabilities', () => {
    expect(MOBILE_CONNECT_CAPABILITIES).toEqual({
      can_play_audio: true,
      can_control_volume: true,
    });
  });

  it('classifies TV, tablet, and phone form factors deterministically', () => {
    expect(detectMobileDeviceType({ isTv: true, os: 'android', dimensions: { width: 960, height: 540 } })).toBe('tv');
    expect(detectMobileDeviceType({ isTv: false, os: 'ios', isPad: true, dimensions: { width: 820, height: 1180 } })).toBe('tablet');
    expect(detectMobileDeviceType({ isTv: false, os: 'android', dimensions: { width: 800, height: 1280 } })).toBe('tablet');
    expect(detectMobileDeviceType({ isTv: false, os: 'android', dimensions: { width: 390, height: 844 } })).toBe('mobile');
  });

  it('derives readable default device names from platform metadata', () => {
    expect(defaultMobileDeviceName('mobile', { os: 'android', constants: { Brand: 'google', Model: 'Pixel 9' } }))
      .toBe('Google Pixel 9');
    expect(defaultMobileDeviceName('tv', { os: 'android', constants: {} })).toBe('Android TV');
    expect(defaultMobileDeviceName('tablet', { os: 'ios', constants: {} })).toBe('iPad');
    expect(defaultMobileDeviceName('mobile', { os: 'ios', constants: {} })).toBe('iPhone');
  });

  it('generates and persists a stable device_id, respects stored settings, and rejects corrupt flags', async () => {
    const store = memoryStorage();
    const first = await loadConnectDeviceIdentity(store);
    expect(first.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.name).toBe('Google Pixel 9');
    expect(first.enabled).toBe(true);
    expect(store.map.get(CONNECT_DEVICE_ID_STORAGE_KEY)).toBe(first.deviceId);

    const second = await loadConnectDeviceIdentity(store);
    expect(second.deviceId).toBe(first.deviceId);

    await saveConnectDeviceName('Living Room Phone', store);
    await saveConnectEnabled(false, store);
    expect(store.map.get(CONNECT_DEVICE_NAME_STORAGE_KEY)).toBe('Living Room Phone');
    expect(store.map.get(CONNECT_ENABLED_STORAGE_KEY)).toBe('false');

    const reloaded = await loadConnectDeviceIdentity(store);
    expect(reloaded.name).toBe('Living Room Phone');
    expect(reloaded.enabled).toBe(false);

    const corrupt = memoryStorage({ [CONNECT_ENABLED_STORAGE_KEY]: 'maybe' });
    await expect(loadConnectDeviceIdentity(corrupt)).rejects.toThrow(/invalid/i);
  });

  it('validates device names strictly', () => {
    expect(validateConnectDeviceName('  My Phone  ')).toBe('My Phone');
    expect(() => validateConnectDeviceName('   ')).toThrow(/empty/i);
    expect(() => validateConnectDeviceName('x'.repeat(61))).toThrow(/60/);
  });
});
