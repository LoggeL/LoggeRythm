import type { MediaItem, PlaybackState } from '@rntp/player';
import {
  queueContextOf,
  queueOriginalContextOrderOf,
  type QueueContextMetadata,
} from './queueContract';

export type TrackPlaybackPhase =
  | 'inactive'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'active';

export type ServerCacheKnowledge = 'cached' | 'not-cached' | 'unknown';
export type ExplicitDownloadKnowledge = 'downloaded' | 'not-downloaded' | 'unknown';

export interface TrackOccurrenceIdentity {
  trackId: string;
  queueContext?: Pick<QueueContextMetadata, 'type' | 'id'> | null;
  originalContextOrder?: number | null;
}

export interface ActiveTrackOccurrence {
  trackId: string;
  queueContext: Pick<QueueContextMetadata, 'type' | 'id'> | null;
  originalContextOrder: number | null;
}

export type TrackOccurrenceMatch = 'occurrence' | 'legacy-track-id' | 'none';

export interface TrackPresentationState {
  active: boolean;
  playback: TrackPlaybackPhase;
  serverCache: ServerCacheKnowledge;
  /**
   * Automatic Media3/RNTP LRU evidence for the active item only. This is not
   * pinned, durable, or a user-managed offline download.
   */
  rollingDeviceCache: { kind: 'rolling-lru'; seconds: number } | null;
  /** Account-bound, verified user-managed download evidence. */
  explicitDownload: { kind: ExplicitDownloadKnowledge };
}

export interface ResolveTrackPresentationInput {
  target: TrackOccurrenceIdentity;
  activeOccurrence: ActiveTrackOccurrence | null;
  playbackState: PlaybackState;
  isPlaying: boolean;
  /** Null means the authenticated server-cache response is not known. */
  serverCachedTrackIds: ReadonlySet<string> | null;
  /** Null means the account-bound native download manifest is not hydrated. */
  explicitDownloadedTrackIds: ReadonlySet<string> | null;
  /** Caller-owned active-item evidence; the shared provider never polls progress. */
  rollingDeviceCacheSeconds?: unknown;
}

function nonEmptyScalar(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Last-resort recovery for native/legacy playable items without extras.track.
 * Parent browse ids such as `playlist:7` are deliberately not accepted.
 */
function legacyTrackIdFromMediaId(mediaId: unknown): string | null {
  if (typeof mediaId !== 'string') return null;
  const parts = mediaId.split(':');
  const supported =
    (parts[0] === 'track' && parts.length === 2)
    || (parts[0] === 'queue' && parts.length >= 4)
    || (parts[0] === 'radio' && parts.length >= 3)
    || (parts[0] === 'liked' && parts.length >= 3)
    || (parts[0] === 'playlist' && parts.length >= 4);
  if (!supported) return null;
  return nonEmptyScalar(safeDecode(parts[parts.length - 1] ?? ''));
}

function mediaItemTrackId(item: MediaItem): string | null {
  const track = item.extras?.track;
  if (typeof track === 'object' && track !== null) {
    const id = nonEmptyScalar((track as Record<string, unknown>).id);
    if (id !== null) return id;
  }
  return legacyTrackIdFromMediaId(item.mediaId);
}

function defensiveQueueOccurrence(item: MediaItem): {
  queueContext: Pick<QueueContextMetadata, 'type' | 'id'> | null;
  originalContextOrder: number | null;
} {
  let queueContext: QueueContextMetadata | null = null;
  let originalContextOrder: number | null = null;
  try {
    queueContext = queueContextOf(item);
  } catch {
    // Corrupt or half-present metadata must not crash every track surface.
  }
  try {
    originalContextOrder = queueOriginalContextOrderOf(item);
  } catch {
    // Treat corrupt order as legacy identity and fall back to track id below.
  }
  return {
    queueContext:
      queueContext === null
        ? null
        : { type: queueContext.type, id: queueContext.id },
    originalContextOrder,
  };
}

/** Parse active identity without trusting restored/native extras. */
export function activeTrackOccurrenceFromMediaItem(
  item: MediaItem | null | undefined,
): ActiveTrackOccurrence | null {
  if (item == null) return null;
  const trackId = mediaItemTrackId(item);
  if (trackId === null) return null;
  return { trackId, ...defensiveQueueOccurrence(item) };
}

function normalizedTarget(target: TrackOccurrenceIdentity): ActiveTrackOccurrence | null {
  const trackId = nonEmptyScalar(target.trackId);
  if (trackId === null) return null;
  const context = target.queueContext;
  const type = nonEmptyScalar(context?.type);
  const id = nonEmptyScalar(context?.id);
  const order = target.originalContextOrder;
  const originalContextOrder =
    typeof order === 'number' && Number.isInteger(order) && order >= 0
      ? order
      : null;
  return {
    trackId,
    queueContext:
      type === null || id === null
        ? null
        : { type: type as QueueContextMetadata['type'], id },
    originalContextOrder,
  };
}

function hasCompleteOccurrence(
  value: ActiveTrackOccurrence,
): value is ActiveTrackOccurrence & {
  queueContext: Pick<QueueContextMetadata, 'type' | 'id'>;
  originalContextOrder: number;
} {
  return value.queueContext !== null && value.originalContextOrder !== null;
}

/**
 * Product queues identify duplicate occurrences by semantic context plus their
 * original context position. Old/native queues lack one or both fields, so the
 * only compatible fallback is track id. That legacy fallback can highlight
 * multiple duplicate rows; new callers should always pass complete occurrence
 * metadata when their collection can contain duplicates.
 */
export function matchTrackOccurrence(
  target: TrackOccurrenceIdentity,
  active: ActiveTrackOccurrence | null,
): TrackOccurrenceMatch {
  const candidate = normalizedTarget(target);
  if (candidate === null || active === null || candidate.trackId !== active.trackId) {
    return 'none';
  }
  if (!hasCompleteOccurrence(candidate) || !hasCompleteOccurrence(active)) {
    return 'legacy-track-id';
  }
  return candidate.queueContext.type === active.queueContext.type
    && candidate.queueContext.id === active.queueContext.id
    && candidate.originalContextOrder === active.originalContextOrder
    ? 'occurrence'
    : 'none';
}

function playbackPhase(
  active: boolean,
  state: PlaybackState,
  isPlaying: boolean,
): TrackPlaybackPhase {
  if (!active) return 'inactive';
  if (state === 'buffering') return 'buffering';
  if (isPlaying) return 'playing';
  if (state === 'ready') return 'paused';
  return 'active';
}

function positiveSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function resolveTrackPresentation(
  input: ResolveTrackPresentationInput,
): TrackPresentationState {
  const targetId = nonEmptyScalar(input.target.trackId);
  const active = matchTrackOccurrence(input.target, input.activeOccurrence) !== 'none';
  const rollingSeconds = active
    ? positiveSeconds(input.rollingDeviceCacheSeconds)
    : null;
  const serverCache: ServerCacheKnowledge =
    targetId === null || input.serverCachedTrackIds === null
      ? 'unknown'
      : input.serverCachedTrackIds.has(targetId)
        ? 'cached'
        : 'not-cached';
  const explicitDownload: ExplicitDownloadKnowledge =
    targetId === null || input.explicitDownloadedTrackIds === null
      ? 'unknown'
      : input.explicitDownloadedTrackIds.has(targetId)
        ? 'downloaded'
        : 'not-downloaded';

  return {
    active,
    playback: playbackPhase(active, input.playbackState, input.isPlaying),
    serverCache,
    rollingDeviceCache:
      rollingSeconds === null
        ? null
        : { kind: 'rolling-lru', seconds: rollingSeconds },
    explicitDownload: { kind: explicitDownload },
  };
}
