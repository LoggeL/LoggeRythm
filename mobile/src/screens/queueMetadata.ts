import {
  resolveRemoteVisualState,
  type RemoteVisualState,
  type RemoteVisualStateInput,
} from '../data/remoteState';
import type { TrackPresentationState } from '../player/trackPresentation';

export interface QueueRowMetadataInput {
  durationSeconds: unknown;
  serverCached: boolean;
  active: boolean;
  activeCachedSeconds?: unknown;
}

export interface QueueRowMetadata {
  duration: string | null;
  deviceCache: string | null;
  serverCached: boolean;
}

export interface QueueMetadataCopy {
  duration: (value: string) => string;
  deviceCache: (value: string) => string;
  serverCached: string;
}

/**
 * RNTP uses zero when its rolling on-device cache position is unavailable or
 * disabled. Treat every non-positive or corrupt value as unknown so the queue
 * only presents metadata backed by positive evidence.
 */
export function formatQueueSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Build display metadata without changing native queue order or identity. */
export function queueRowMetadata(input: QueueRowMetadataInput): QueueRowMetadata {
  return {
    duration: formatQueueSeconds(input.durationSeconds),
    deviceCache: input.active ? formatQueueSeconds(input.activeCachedSeconds) : null,
    serverCached: input.serverCached,
  };
}

export function queueMetadataFacts(
  metadata: QueueRowMetadata,
  copy: QueueMetadataCopy,
): string[] {
  const facts: string[] = [];
  if (metadata.duration !== null) facts.push(copy.duration(metadata.duration));
  if (metadata.deviceCache !== null) facts.push(copy.deviceCache(metadata.deviceCache));
  if (metadata.serverCached) facts.push(copy.serverCached);
  return facts;
}

/** Server-cache metadata never blocks the native queue body. */
export function resolveQueueMetadataVisualState(
  input: RemoteVisualStateInput,
): RemoteVisualState {
  return resolveRemoteVisualState(input);
}

/**
 * Native queue index is stronger evidence than catalog id for manual/legacy
 * duplicate occurrences. Preserve cache knowledge, but never let an id-only
 * fallback mark a different native row as active.
 */
export function authoritativeQueueTrackPresentation(
  presentation: TrackPresentationState,
  activeNativeIndex: boolean,
): TrackPresentationState {
  return activeNativeIndex
    ? presentation
    : {
        ...presentation,
        active: false,
        playback: 'inactive',
        rollingDeviceCache: null,
      };
}
