import type { Track } from '../api/types';

export interface ReleaseRadarStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const RELEASE_RADAR_SEEN_PREFIX = 'lr.release-radar.seen.v1:';
const pendingSeenWrites = new Map<string, Promise<void>>();

function normalizedAccountScope(accountScope: string): string {
  const normalized = accountScope.trim();
  if (normalized.length === 0) {
    throw new Error('Release Radar storage scope must not be empty');
  }
  return normalized;
}

export function releaseRadarSeenStorageKey(accountScope: string): string {
  return `${RELEASE_RADAR_SEEN_PREFIX}${encodeURIComponent(normalizedAccountScope(accountScope))}`;
}

/** Match the web contract: identity and unseen state are based on unique track IDs. */
export function releaseRadarTrackIds(
  tracks: readonly Pick<Track, 'id'>[],
): string[] {
  const ids = new Set<string>();
  for (const track of tracks) {
    const id = String(track.id).trim();
    if (id.length === 0) throw new Error('Release Radar contained a track without an ID');
    ids.add(id);
  }
  return [...ids];
}

export function decodeReleaseRadarSeenTrackIds(raw: string | null): string[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error('Saved Release Radar state is not valid JSON', { cause });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((id) => typeof id !== 'string' || id.trim().length === 0)
  ) {
    throw new Error('Saved Release Radar state must be a list of non-empty track IDs');
  }
  return [...new Set(parsed.map((id) => id.trim()))];
}

export function countUnseenReleaseRadarTracks(
  currentTrackIds: readonly string[],
  seenTrackIds: readonly string[],
): number {
  const seen = new Set(seenTrackIds);
  return new Set(currentTrackIds.filter((id) => !seen.has(id))).size;
}

/** Keep a cumulative set so temporary removals or reorderings never become "new" again. */
export function mergeReleaseRadarSeenTrackIds(
  seenTrackIds: readonly string[],
  visibleTrackIds: readonly string[],
): string[] {
  return [...new Set([...seenTrackIds, ...visibleTrackIds])];
}

export async function readReleaseRadarSeenTrackIds(
  storage: ReleaseRadarStorage,
  accountScope: string,
): Promise<string[]> {
  const key = releaseRadarSeenStorageKey(accountScope);
  await pendingSeenWrites.get(key);
  const raw = await storage.getItem(key);
  return decodeReleaseRadarSeenTrackIds(raw);
}

function enqueueSeenWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingSeenWrites.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  pendingSeenWrites.set(key, tail);
  void tail.then(() => {
    if (pendingSeenWrites.get(key) === tail) pendingSeenWrites.delete(key);
  });
  return result;
}

/** Let logout/account deletion finish in-flight acknowledgements before removing the key. */
export async function waitForReleaseRadarSeenWrites(
  accountScope: string | null,
): Promise<void> {
  if (accountScope === null) {
    await Promise.all([...pendingSeenWrites.values()]);
    return;
  }
  await pendingSeenWrites.get(releaseRadarSeenStorageKey(accountScope));
}

/**
 * Acknowledge only tracks rendered by the dedicated Radar screen. The Home card
 * deliberately never calls this function, matching the production web rule.
 */
export async function markReleaseRadarTracksSeen(
  storage: ReleaseRadarStorage,
  accountScope: string,
  visibleTrackIds: readonly string[],
): Promise<string[]> {
  if (visibleTrackIds.length === 0) return readReleaseRadarSeenTrackIds(storage, accountScope);
  const key = releaseRadarSeenStorageKey(accountScope);
  return enqueueSeenWrite(key, async () => {
    const current = decodeReleaseRadarSeenTrackIds(await storage.getItem(key));
    const next = mergeReleaseRadarSeenTrackIds(current, visibleTrackIds);
    if (next.length !== current.length) await storage.setItem(key, JSON.stringify(next));
    return next;
  });
}
