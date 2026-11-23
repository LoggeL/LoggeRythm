import { NativeModules } from 'react-native';

const DEEZER_ID = /^[0-9]{1,32}$/;
const MAX_LIKED_TRACK_IDS = 50_000;
const LIKED_TRACK_IDS_SCHEMA_VERSION = 1;

export interface FavoriteNativePort {
  setLikedTrackIds(trackIdsJson: string | null): Promise<unknown>;
  completeFavoritePlaybackEvent(leaseId: string, eventId: string): Promise<unknown>;
  failFavoritePlaybackEvent(leaseId: string, eventId: string): Promise<unknown>;
}

let injectedPort: FavoriteNativePort | null = null;

/** Runtime-checked native bridge for durable Android Auto / notification favorites. */
export function getFavoriteNativePort(): FavoriteNativePort {
  if (injectedPort !== null) return injectedPort;
  const candidate = NativeModules.LoggeRythmPlayer as
    | Partial<FavoriteNativePort>
    | undefined;
  if (
    candidate === undefined
    || typeof candidate.setLikedTrackIds !== 'function'
    || typeof candidate.completeFavoritePlaybackEvent !== 'function'
    || typeof candidate.failFavoritePlaybackEvent !== 'function'
  ) {
    throw new Error('LoggeRythmPlayer native favorite bridge is unavailable');
  }
  return {
    setLikedTrackIds: (trackIdsJson) => candidate.setLikedTrackIds!(trackIdsJson),
    completeFavoritePlaybackEvent: (leaseId, eventId) =>
      candidate.completeFavoritePlaybackEvent!(leaseId, eventId),
    failFavoritePlaybackEvent: (leaseId, eventId) =>
      candidate.failFavoritePlaybackEvent!(leaseId, eventId),
  };
}

export function encodeLikedTrackIdsPayload(
  trackIds: readonly string[] | null,
): string | null {
  if (trackIds === null) return null;
  if (!Array.isArray(trackIds)) {
    throw new TypeError('Liked track IDs must be an array or null');
  }
  const unique = new Set<string>();
  for (let index = 0; index < trackIds.length; index += 1) {
    const id = trackIds[index];
    if (typeof id !== 'string' || !DEEZER_ID.test(id)) {
      throw new TypeError(`Liked track ID at index ${index} is invalid`);
    }
    unique.add(id);
    if (unique.size > MAX_LIKED_TRACK_IDS) {
      throw new RangeError('Liked track IDs exceed native limit');
    }
  }
  return JSON.stringify({
    schemaVersion: LIKED_TRACK_IDS_SCHEMA_VERSION,
    trackIds: [...unique].sort(),
  });
}

/** Persist the account's authoritative liked track IDs to the native Media3 service. */
export async function syncNativeLikedTrackIds(
  trackIds: readonly string[] | null,
): Promise<void> {
  const payload = encodeLikedTrackIdsPayload(trackIds);
  await getFavoriteNativePort().setLikedTrackIds(payload);
}

/** Narrow test seam for deterministic unit testing without mocking NativeModules globally. */
export function setFavoriteNativePortForTests(port: FavoriteNativePort | null): () => void {
  const previous = injectedPort;
  injectedPort = port;
  return () => {
    injectedPort = previous;
  };
}
