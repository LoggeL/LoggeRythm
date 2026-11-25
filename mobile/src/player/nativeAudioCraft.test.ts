import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNativeModule = {
  getEqualizerState: vi.fn(),
  setEqualizerEnabled: vi.fn(),
  setEqualizerBandLevel: vi.fn(),
  setEqualizerPreset: vi.fn(),
  getBassBoostState: vi.fn(),
  setBassBoost: vi.fn(),
  getLoudnessConfig: vi.fn(),
  setLoudnessConfig: vi.fn(),
  getPlaybackSpeed: vi.fn(),
  setPlaybackSpeed: vi.fn(),
  getCrossfadeConfig: vi.fn(),
  setCrossfadeConfig: vi.fn(),
  openAudioOutputSwitcher: vi.fn(),
  getAudioOutputDevices: vi.fn(),
  getDeviceVolume: vi.fn(),
  setDeviceVolume: vi.fn(),
  setRemoteVolumeControl: vi.fn(),
  extractArtworkPalette: vi.fn(),
  setVisualizerEnabled: vi.fn(),
  getVisualizerState: vi.fn(),
  addListener: vi.fn(),
  removeListeners: vi.fn(),
};

const addListenerSpy = vi.fn(() => ({ remove: vi.fn() }));

vi.mock('react-native', () => ({
  NativeModules: {
    get LoggeRythmPlayer() {
      return mockNativeModule;
    },
  },
  NativeEventEmitter: class {
    addListener = addListenerSpy;
  },
}));

describe('nativeAudioCraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards EQ, Bass Boost, Loudness, Speed, Crossfade, Output Switcher, and Volume to native module', async () => {
    const craft = await import('./nativeAudioCraft');
    mockNativeModule.setEqualizerPreset.mockResolvedValue({ enabled: true, preset: 'rock', bands: [] });
    mockNativeModule.setBassBoost.mockResolvedValue({ enabled: true, strength: 600 });
    mockNativeModule.setLoudnessConfig.mockResolvedValue({ enabled: true, preset: 'loud' });
    mockNativeModule.setPlaybackSpeed.mockResolvedValue({ speed: 1.25, pitch: 1.0 });
    mockNativeModule.setCrossfadeConfig.mockResolvedValue({ enabled: true, durationSec: 6 });
    mockNativeModule.openAudioOutputSwitcher.mockResolvedValue({ opened: true, method: 'system_ui' });
    mockNativeModule.setDeviceVolume.mockResolvedValue({ volume: 0.5, step: 7, maxStep: 15, muted: false });
    mockNativeModule.setRemoteVolumeControl.mockResolvedValue({
      active: true,
      currentVolume: 50,
      maxVolume: 100,
      muted: false,
      normalizedVolume: 0.5,
    });

    expect(craft.isNativeAudioCraftAvailable()).toBe(true);
    await expect(craft.setEqualizerPreset('rock')).resolves.toMatchObject({ preset: 'rock' });
    await expect(craft.setBassBoost(true, 600)).resolves.toMatchObject({ strength: 600 });
    await expect(craft.setLoudnessConfig(true, 'loud')).resolves.toMatchObject({ preset: 'loud' });
    await expect(craft.setPlaybackSpeed(1.25, 1.0)).resolves.toMatchObject({ speed: 1.25 });
    await expect(craft.setCrossfadeConfig(true, 6)).resolves.toMatchObject({ durationSec: 6 });
    await expect(craft.openAudioOutputSwitcher()).resolves.toMatchObject({ opened: true });
    await expect(craft.setDeviceVolume(0.5, false)).resolves.toMatchObject({ volume: 0.5 });
    await expect(craft.setRemoteVolumeControl(true, 50, 100, false)).resolves.toMatchObject({ active: true });
  });

  it('validates speed, pitch, device volume, and artwork URI strictly', async () => {
    const craft = await import('./nativeAudioCraft');
    expect(() => craft.setPlaybackSpeed(5, 1)).toThrow(/speed/i);
    expect(() => craft.setPlaybackSpeed(1, 0.1)).toThrow(/pitch/i);
    expect(() => craft.setDeviceVolume(1.5)).toThrow(/volume/i);
    await expect(craft.extractArtworkPalette('   ')).rejects.toThrow(/empty/i);
  });

  it('subscribes cleanly to native visualizer and volume events', async () => {
    const craft = await import('./nativeAudioCraft');
    const unsubVis = craft.subscribeVisualizerFrames(vi.fn());
    const unsubRem = craft.subscribeRemoteVolumeEvents(vi.fn());
    const unsubDev = craft.subscribeDeviceVolumeEvents(vi.fn());

    expect(addListenerSpy).toHaveBeenCalledWith('LoggeRythmVisualizerFrame', expect.any(Function));
    expect(addListenerSpy).toHaveBeenCalledWith('LoggeRythmRemoteVolume', expect.any(Function));
    expect(addListenerSpy).toHaveBeenCalledWith('LoggeRythmDeviceVolume', expect.any(Function));

    unsubVis();
    unsubRem();
    unsubDev();
  });
});
