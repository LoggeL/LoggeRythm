import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  encodeLikedTrackIdsPayload,
  getFavoriteNativePort,
  setFavoriteNativePortForTests,
  syncNativeLikedTrackIds,
} from './favoriteNativePort';

vi.mock('react-native', () => ({ NativeModules: {} }));

describe('favorite native port', () => {
  afterEach(() => {
    setFavoriteNativePortForTests(null);
  });

  it('encodes deduplicated, sorted Deezer IDs and rejects invalid values loudly', () => {
    expect(encodeLikedTrackIdsPayload(null)).toBeNull();
    expect(encodeLikedTrackIdsPayload([])).toBe(
      JSON.stringify({ schemaVersion: 1, trackIds: [] }),
    );
    expect(encodeLikedTrackIdsPayload(['900', '42', '900'])).toBe(
      JSON.stringify({ schemaVersion: 1, trackIds: ['42', '900'] }),
    );
    expect(() => encodeLikedTrackIdsPayload(['not-numeric'])).toThrow(/invalid/i);
  });

  it('fails loudly when the native favorite bridge is absent', () => {
    expect(() => getFavoriteNativePort()).toThrow(/native favorite bridge is unavailable/i);
  });

  it('forwards sync, complete, and fail calls to the native port', async () => {
    const port = {
      setLikedTrackIds: vi.fn(async () => undefined),
      completeFavoritePlaybackEvent: vi.fn(async () => undefined),
      failFavoritePlaybackEvent: vi.fn(async () => undefined),
    };
    const restore = setFavoriteNativePortForTests(port);
    try {
      await syncNativeLikedTrackIds(['77', '12']);
      expect(port.setLikedTrackIds).toHaveBeenCalledWith(
        JSON.stringify({ schemaVersion: 1, trackIds: ['12', '77'] }),
      );
      await getFavoriteNativePort().completeFavoritePlaybackEvent('lease-1', 'event-1');
      expect(port.completeFavoritePlaybackEvent).toHaveBeenCalledWith('lease-1', 'event-1');
      await getFavoriteNativePort().failFavoritePlaybackEvent('lease-1', 'event-2');
      expect(port.failFavoritePlaybackEvent).toHaveBeenCalledWith('lease-1', 'event-2');
    } finally {
      restore();
    }
  });
});
