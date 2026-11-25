import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSettings } from '../api/types';
import {
  hydrateAccountPlaybackSettings,
  resetNativePlaybackSettings,
  syncNativePlaybackSettings,
} from './playbackSettingsSync';
import {
  getAudioQualityPreference,
  resetAudioQualityPreference,
} from './qualityPreference';

const mocks = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
  isNativeMethodAvailable: vi.fn(),
  setCrossfadeConfig: vi.fn(),
}));

vi.mock('../data', () => ({
  musicQueryClient: { fetchQuery: mocks.fetchQuery },
  musicQueries: {
    playbackSettings: (scope: string) => ({ queryKey: ['profile', 'settings', scope] }),
  },
}));
vi.mock('./nativeAudioCraft', () => ({
  isNativeMethodAvailable: mocks.isNativeMethodAvailable,
  setCrossfadeConfig: mocks.setCrossfadeConfig,
}));

const sampleSettings: PlaybackSettings = {
  crossfade_enabled: true,
  crossfade_duration_sec: 6,
  preferred_quality: 'lossless',
  share_listening_activity: true,
};

describe('playbackSettingsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAudioQualityPreference();
    mocks.isNativeMethodAvailable.mockReturnValue(true);
    mocks.setCrossfadeConfig.mockResolvedValue({ enabled: true, durationSec: 6 });
  });

  it('hydrates preferred_quality and native crossfade once per approved session', async () => {
    mocks.fetchQuery.mockResolvedValueOnce(sampleSettings);

    await hydrateAccountPlaybackSettings('https://music.test::user:7');

    expect(mocks.fetchQuery).toHaveBeenCalledWith({
      queryKey: ['profile', 'settings', 'https://music.test::user:7'],
    });
    expect(getAudioQualityPreference()).toBe('lossless');
    expect(mocks.setCrossfadeConfig).toHaveBeenCalledExactlyOnceWith(true, 6);
  });

  it('skips applying hydrated settings if the session is no longer current', async () => {
    mocks.fetchQuery.mockResolvedValueOnce(sampleSettings);

    await hydrateAccountPlaybackSettings('https://music.test::user:7', () => false);

    expect(getAudioQualityPreference()).toBe('high');
    expect(mocks.setCrossfadeConfig).not.toHaveBeenCalled();
  });

  it('resets both quality preference and native crossfade config on sign-out', async () => {
    await syncNativePlaybackSettings(sampleSettings);
    expect(getAudioQualityPreference()).toBe('lossless');
    mocks.setCrossfadeConfig.mockClear();

    resetNativePlaybackSettings();
    await vi.waitFor(() => {
      expect(mocks.setCrossfadeConfig).toHaveBeenCalledExactlyOnceWith(false, 0);
    });
    expect(getAudioQualityPreference()).toBe('high');
  });
});
