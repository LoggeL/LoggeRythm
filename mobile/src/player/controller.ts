import Player, {
  Event,
  RepeatMode,
  mapMediaItemToNativeQueueItem,
  type BackgroundEvent,
  type MediaItem,
  type MediaItemTransitionEvent,
  type NativeQueueWireItem,
  type PlaybackErrorEvent,
  type PlaybackProgressUpdatedEvent,
} from './player';
import type { ConnectPlaybackState, Track, TrackAudioMeta } from '../api/types';
import { activeConnectRouter } from '../connect/activeConnect';
import { activeRemoteTrack, connectRepeatToPlayer } from '../connect/connectModel';
import {
  authenticatedHeadersFor,
  authoritativeSessionInvalidationFor,
  captureAuthenticatedRequestAuthority,
  isAuthenticatedRequestAuthorityError,
  type AuthenticatedRequestAuthority,
} from '../api/client';
import { getApiBase } from '../config';
import { refreshLibraryAutoBrowse } from '../data/autoBrowseRefresh';
import {
  invalidateListeningStats,
  musicCacheScope,
  musicQueryClient,
} from '../data/queryClient';
import { queryKeys } from '../data/queryKeys';
import { musicRepository } from '../data/repositories';
import { withTrackLiked } from '../data/trackLikes';
import { strings } from '../localization';
import { offlineUriForTrack } from '../offline/registry';
import { clearPlayerError, reportPlayerError, UserFacingPlayerError } from './errors';
import {
  PlaybackEventDrainer,
  trackFromPlaybackEventMetadata,
  type PlaybackEventDrainResult,
  type RadioPlaybackEvent,
} from './playbackEventJournal';
import { clearPlayerNotice, reportPlayerNotice } from './notices';
import {
  mediaItemIsRadio,
  mediaItemToTrack,
  mediaItemUsesExplicitDownload,
  trackToMediaItem,
} from './mediaItem';
import {
  MAX_TOTAL_RECOVERY_ATTEMPTS,
  classifyPlaybackFailure,
  createRecoveryBudget,
  nextRecoveryAttempt,
  observeRecoveryProgress,
  reclassifyRecoveryAttempt,
  recoveryPolicy,
  transitionRecoveryBudget,
  type PlaybackFailureCategory,
  type RecoveryBudgetState,
} from './recoveryPolicy';
import {
  assertManualQueuePriority,
  assertMovePreservesManualPriority,
  captureUpcomingContextOrder,
  manualQueueTailIndex,
  nextOriginalContextOrder,
  queueContextOf,
  queueOriginOf,
  queueStableIdOf,
  restoreUpcomingContext,
  shuffleUpcomingContext,
  uniqueTracksNotInQueue,
  withQueueProductMetadata,
  type QueueContext,
  type QueueContextMetadata,
  type QueueOrigin,
} from './queueContract';

let listenersInstalled = false;
let queueGeneration = 0;
let itemSequence = 0;
let contextShuffleEnabled = false;
let contextShuffleRestoreOrder: string[] = [];
const BACKGROUND_RECOVERY_REQUEST_TIMEOUT_MS = 2_500;
const BACKGROUND_RECOVERY_BUDGET_MS = 4_500;
const FOREGROUND_RECOVERY_REQUEST_TIMEOUT_MS = 5_000;
const FOREGROUND_RECOVERY_BUDGET_MS = 20_000;
const QUEUE_MUTATION_TIMEOUT_MS = 1_500;
const QUEUE_MUTATION_POLL_MS = 25;

interface PlaybackEventDrainPort {
  drain(): Promise<Readonly<PlaybackEventDrainResult>>;
}

let defaultPlaybackEventDrainer: PlaybackEventDrainPort | null = null;
let injectedPlaybackEventDrainer: PlaybackEventDrainPort | null = null;

async function authorizePlaybackEventBinding() {
  const origin = await getApiBase();
  const [{ readOfflineIdentity }, playerSetup] = await Promise.all([
    import('../auth/offlineIdentity'),
    import('./setup'),
  ]);
  const identity = await readOfflineIdentity(origin);
  if (identity === null || !identity.is_approved) {
    throw new Error('Approved offline playback identity is unavailable');
  }
  const queryScope = musicCacheScope(origin, identity.id);
  const binding = playerSetup.playerSessionBindingFromQueryScope(queryScope);
  await playerSetup.ensurePlayer(queryScope);
  return binding;
}

function playbackEventDrainer(): PlaybackEventDrainPort {
  if (injectedPlaybackEventDrainer !== null) return injectedPlaybackEventDrainer;
  defaultPlaybackEventDrainer ??= new PlaybackEventDrainer({
    native: {
      claimPlaybackEvents: async (maxEvents, leaseMs) =>
        (await import('./nativePlayerPort'))
          .getPlaybackEventJournalNativePort()
          .claimPlaybackEvents(maxEvents, leaseMs),
      ackPlaybackEvent: async (leaseId, eventId) =>
        (await import('./nativePlayerPort'))
          .getPlaybackEventJournalNativePort()
          .ackPlaybackEvent(leaseId, eventId),
      retryPlaybackEvent: async (leaseId, eventId, notBeforeEpochMs) =>
        (await import('./nativePlayerPort'))
          .getPlaybackEventJournalNativePort()
          .retryPlaybackEvent(leaseId, eventId, notBeforeEpochMs),
      completeRadioPlaybackEvent: async (leaseId, eventId, payloadJson) =>
        (await import('./nativePlayerPort'))
          .getPlaybackEventJournalNativePort()
          .completeRadioPlaybackEvent(leaseId, eventId, payloadJson),
    },
    captureAuthenticatedRequestAuthority,
    authorizeBinding: authorizePlaybackEventBinding,
    authoritativeSessionInvalidation: authoritativeSessionInvalidationFor,
    isAuthenticatedRequestAuthorityError,
    clearAuthoritativeSessionAuthority: async (authority) =>
      (await import('../auth/authoritativeSessionCleanup'))
        .clearAuthoritativeSessionAuthority(authority),
    recordPlay: (track, timeoutMs, eventId, authority) =>
      musicRepository.recordPlay(track, timeoutMs, eventId, authority),
    prepareRadioItems: prepareRadioPlaybackCompletionItems,
    likeTrack: (track, timeoutMs, authority) =>
      musicRepository.likeTrack(track, timeoutMs, authority),
    unlikeTrack: (trackId, timeoutMs, authority) =>
      musicRepository.unlikeTrack(trackId, timeoutMs, authority),
    completeFavoritePlaybackEvent: async (leaseId, eventId) => {
      await (await import('./favoriteNativePort'))
        .getFavoriteNativePort()
        .completeFavoritePlaybackEvent(leaseId, eventId);
    },
    failFavoritePlaybackEvent: async (leaseId, eventId) => {
      await (await import('./favoriteNativePort'))
        .getFavoriteNativePort()
        .failFavoritePlaybackEvent(leaseId, eventId);
    },
    onFavoriteUpdated: async (binding, track, requestedLiked) => {
      const [{ musicQueryClient }, { refreshBrowseTree }] = await Promise.all([
        import('../data/queryClient'),
        import('./browseTree'),
      ]);
      const scope = `${binding.origin}::${binding.accountScope}`;
      const likesKey = queryKeys.library.likes(scope);
      musicQueryClient.setQueryData<Track[]>(likesKey, (current) =>
        current === undefined ? undefined : withTrackLiked(current, track, requestedLiked),
      );
      await Promise.all([
        musicQueryClient.invalidateQueries({ queryKey: likesKey, exact: true }),
        refreshLibraryAutoBrowse(refreshBrowseTree, () =>
          reportPlayerNotice(
            'bookkeeping',
            'auto-library-refresh',
            strings.player.autoLibraryFailed,
            strings.player.autoLibraryRefreshFailedMessage,
          ),
        ),
      ]);
    },
    onFavoriteFailed: (_track, _requestedLiked, error) => {
      reportPlayerError(strings.player.likeFailed, error);
    },
    onPlayRecorded: () => invalidateListeningStats(),
  });
  return defaultPlaybackEventDrainer;
}

/** One shared entry point for foreground listeners and Android Headless JS. */
export function drainDurablePlaybackEvents(): Promise<Readonly<PlaybackEventDrainResult>> {
  try {
    return playbackEventDrainer().drain();
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Narrow deterministic injection seam; production always uses the strict native journal. */
export function setPlaybackEventDrainerForTests(
  drainer: PlaybackEventDrainPort,
): () => void {
  const previous = injectedPlaybackEventDrainer;
  injectedPlaybackEventDrainer = drainer;
  return () => {
    injectedPlaybackEventDrainer = previous;
  };
}

let recoveryBudget: RecoveryBudgetState = createRecoveryBudget();
let recoveryEpoch = 0;
let recoveryBudgetEpoch = 0;
let recoveryReloadSequence = 0;
let recoveryInFlight: Promise<void> | null = null;

export interface QueueSnapshot {
  items: MediaItem[];
  activeIndex: number | null;
}

export interface PlayTracksOptions {
  /** Stable semantic source used for queue grouping, restoration, and analytics. */
  context: QueueContext;
  radio?: boolean;
  /** Fail closed unless every queue occurrence is a currently verified explicit download. */
  requireExplicitDownloads?: boolean;
  /** Execute directly on this device's native player (used by Connect command execution). */
  localOnly?: boolean;
}

function nextMediaId(prefix: string, track: Track): string {
  itemSequence += 1;
  return `${prefix}:${itemSequence}:${track.id}`;
}

function stableIdPart(value: string): string {
  return encodeURIComponent(value);
}

function contextStableId(
  context: Pick<QueueContextMetadata, 'type' | 'id'>,
  order: number,
  track: Track,
): string {
  return `context:${context.type}:${stableIdPart(context.id)}:${order}:${stableIdPart(track.id)}`;
}

interface RemoteMediaContext {
  base: string;
  headers: Record<string, string>;
}

type MediaSource =
  | { kind: 'explicit-download'; uri: string }
  | { kind: 'remote'; context: RemoteMediaContext };

function queueMediaItem(
  track: Track,
  source: MediaSource,
  options: {
    mediaId: string;
    origin: QueueOrigin;
    radio: boolean;
    context?: QueueContextMetadata | null;
    originalContextOrder?: number | null;
    stableId: string;
  },
): MediaItem {
  const cachedAudioMeta = musicQueryClient.getQueryData<TrackAudioMeta>(
    queryKeys.catalog.audioMeta(track.id),
  );
  const crossfade =
    cachedAudioMeta !== undefined
    && (cachedAudioMeta.intro_end_sec !== null || cachedAudioMeta.outro_start_sec !== null)
      ? {
          introEndSec: cachedAudioMeta.intro_end_sec,
          outroStartSec: cachedAudioMeta.outro_start_sec,
        }
      : undefined;
  return withQueueProductMetadata(
    trackToMediaItem(
      track,
      source.kind === 'remote' ? source.context.base : '',
      source.kind === 'remote' ? source.context.headers : {},
      {
        mediaId: options.mediaId,
        radio: options.radio,
        explicitDownloadUri: source.kind === 'explicit-download' ? source.uri : undefined,
        ...(crossfade === undefined ? {} : { crossfade }),
      },
    ),
    {
      origin: options.origin,
      context: options.context,
      originalContextOrder: options.originalContextOrder,
      stableId: options.stableId,
    },
  );
}

function assertNativeShuffleDisabledForQueueContract(): void {
  // Media3 exposes only a global shuffle order. It cannot keep a
  // primary manual section ahead of context. Product shuffle therefore uses
  // explicit queue moves. A true native snapshot is an invariant breach, not
  // state this controller is authorized to repair through MediaController.
  if (Player.isShuffleEnabled()) {
    throw new Error('Native global shuffle must remain disabled');
  }
}

function resetContextShuffleState(): void {
  contextShuffleEnabled = false;
  contextShuffleRestoreOrder = [];
}

function persistContextShuffleState(): void {
  Player.setQueuePersistenceState({
    contextShuffleEnabled,
    contextShuffleRestoreOrder: [...contextShuffleRestoreOrder],
  });
}

function restoreItemSequence(items: readonly MediaItem[]): void {
  let restoredSequence = 0;
  for (const item of items) {
    if (typeof item.mediaId !== 'string') continue;
    const match = /^(?:added|next|radio):(\d+):/.exec(item.mediaId);
    if (match !== null) restoredSequence = Math.max(restoredSequence, Number(match[1]));
  }
  itemSequence = Math.max(itemSequence, restoredSequence);
}

/** Rehydrate JavaScript-only queue semantics after Media3 restores the encrypted timeline. */
export function restoreControllerStateFromNativeQueue(): void {
  const { items, activeIndex } = getQueueSnapshot();
  assertNativeShuffleDisabledForQueueContract();
  queueGeneration += 1;
  restoreItemSequence(items);

  if (items.length === 0) {
    resetContextShuffleState();
    return;
  }
  if (activeIndex === null) {
    throw new Error('A restored non-empty queue must have an active item');
  }
  uniqueQueueStableIds(items, 'Queue restoration');
  assertManualQueuePriority(items, activeIndex);

  const state = Player.getQueuePersistenceState();
  if (
    typeof state.contextShuffleEnabled !== 'boolean' ||
    !Array.isArray(state.contextShuffleRestoreOrder)
  ) {
    throw new Error('Native queue persistence returned an invalid context-shuffle state');
  }
  const seen = new Set<string>();
  const restoreOrder = state.contextShuffleRestoreOrder.map((stableId, index) => {
    if (typeof stableId !== 'string' || stableId.trim().length === 0) {
      throw new Error(`Native queue persistence returned invalid restore ID at index ${index}`);
    }
    if (seen.has(stableId)) {
      throw new Error(`Native queue persistence returned duplicate restore ID ${stableId}`);
    }
    seen.add(stableId);
    return stableId;
  });
  if (!state.contextShuffleEnabled && restoreOrder.length > 0) {
    throw new Error('Native queue persistence retained a restore order while shuffle is disabled');
  }
  contextShuffleEnabled = state.contextShuffleEnabled;
  contextShuffleRestoreOrder = restoreOrder;
}

async function startIdleManualTrack(item: MediaItem): Promise<void> {
  const mediaId = item.mediaId;
  if (typeof mediaId !== 'string' || mediaId.length === 0) {
    throw new Error('Cannot start an idle manual queue item without a mediaId');
  }
  assertNativeShuffleDisabledForQueueContract();
  queueGeneration += 1;
  resetContextShuffleState();
  clearPlayerError();
  Player.setMediaItem(item);
  Player.play();
  await waitForNativeQueueMutation('Idle manual queue start', () => {
    const snapshot = getQueueSnapshot();
    return (
      snapshot.items.length === 1 &&
      snapshot.activeIndex === 0 &&
      snapshot.items[0]?.mediaId === mediaId
    );
  });
  persistContextShuffleState();
}

async function verifyManualInsertion(mediaId: string): Promise<void> {
  await waitForNativeQueueMutation('Manual queue insertion', () => {
    const matches = Player.getQueue().filter((item) => item.mediaId === mediaId);
    return matches.length === 1;
  });
  // Every insertion reaches native as a SetQueue, which resets the persisted
  // context-shuffle sidecar — re-persist so a relaunch restores shuffle.
  persistContextShuffleState();
}

async function mediaContext(
  authority?: AuthenticatedRequestAuthority,
): Promise<{ base: string; headers: Record<string, string> }> {
  const base = await getApiBase();
  const headers = authority === undefined
    ? await authenticatedHeadersFor(base)
    : await authenticatedHeadersFor(base, authority);
  return { base, headers };
}

/**
 * Resolve explicit files before touching auth or compatibility checks. A mixed
 * queue shares one authenticated remote context, while a wholly local queue
 * stays synchronous with respect to the network boundary.
 */
async function mediaSources(
  tracks: readonly Track[],
  authority?: AuthenticatedRequestAuthority,
): Promise<MediaSource[]> {
  const explicitUris = tracks.map((track) => offlineUriForTrack(track.id));
  if (explicitUris.every((uri): uri is string => uri !== null)) {
    return explicitUris.map((uri) => ({ kind: 'explicit-download', uri }));
  }

  const context = await mediaContext(authority);
  return tracks.map((track) => {
    // Re-read after the async auth boundary so a concurrent remove never leaves
    // a newly assembled queue pointing at a registry entry that is no longer verified.
    const explicitUri = offlineUriForTrack(track.id);
    return explicitUri === null
      ? { kind: 'remote', context }
      : { kind: 'explicit-download', uri: explicitUri };
  });
}

function requireExplicitDownloadSources(tracks: readonly Track[]): MediaSource[] {
  const explicitUris = tracks.map((track) => offlineUriForTrack(track.id));
  if (!explicitUris.every((uri): uri is string => uri !== null)) {
    throw new Error(
      'Offline-only playback requires a verified explicit download for every selected track',
    );
  }
  return explicitUris.map((uri) => ({ kind: 'explicit-download', uri }));
}

/** Replace the queue with `tracks`, start at `startIndex`, and play. */
export async function playTracks(
  tracks: Track[],
  startIndex = 0,
  opts: PlayTracksOptions,
): Promise<void> {
  if (!opts.localOnly && !opts.requireExplicitDownloads) {
    const connect = activeConnectRouter();
    if (connect?.isControllingRemote() === true) {
      if (tracks.length === 0) throw new Error('playTracks called with an empty track list');
      if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= tracks.length) {
        throw new Error(`playTracks startIndex ${startIndex} is outside a ${tracks.length}-track queue`);
      }
      await connect.sendCommand('play_tracks', {
        tracks,
        start_index: startIndex,
        queue_context: opts.context.label,
      });
      return;
    }
  }
  await replaceQueueAndPlay(tracks, startIndex, opts);
}

/** Shared queue replacement; resolves with the controller generation it started. */
async function replaceQueueAndPlay(
  tracks: Track[],
  startIndex: number,
  opts: PlayTracksOptions,
): Promise<number> {
  if (tracks.length === 0) throw new Error('playTracks called with an empty track list');
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= tracks.length) {
    throw new Error(`playTracks startIndex ${startIndex} is outside a ${tracks.length}-track queue`);
  }
  // The strict branch deliberately contains no await: registry validation and
  // native queue assembly happen in one JavaScript turn, so a stale UI snapshot
  // cannot silently degrade an offline-only request into remote playback.
  const sources = opts.requireExplicitDownloads
    ? requireExplicitDownloadSources(tracks)
    : await mediaSources(tracks);
  assertNativeShuffleDisabledForQueueContract();
  const generation = ++queueGeneration;
  const context = opts.context;
  resetContextShuffleState();
  persistContextShuffleState();
  clearPlayerError();
  Player.setMediaItems(
    tracks.map((track, index) =>
      queueMediaItem(track, sources[index], {
        mediaId: `queue:${generation}:${index}:${track.id}`,
        origin: 'context',
        radio: opts.radio === true,
        context,
        originalContextOrder: index,
        stableId: contextStableId(context, index, track),
      }),
    ),
    startIndex,
  );
  Player.play();
  return generation;
}

/**
 * Handle a direct track-row activation without destroying the current queue
 * when the row already represents the active catalog track.
 *
 * Play-all and explicit context-start actions should continue to call
 * `playTracks`; this helper is intentionally for row taps only.
 */
export async function playTrackRow(
  tracks: Track[],
  startIndex: number,
  opts: PlayTracksOptions,
): Promise<'toggled-current' | 'started-context'> {
  if (tracks.length === 0) throw new Error('playTrackRow called with an empty track list');
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= tracks.length) {
    throw new Error(
      `playTrackRow startIndex ${startIndex} is outside a ${tracks.length}-track queue`,
    );
  }

  if (!opts.localOnly && !opts.requireExplicitDownloads) {
    const connect = activeConnectRouter();
    if (connect?.isControllingRemote() === true) {
      const remoteTrack = activeRemoteTrack(connect.remotePlayback());
      if (remoteTrack?.id === tracks[startIndex].id) {
        await connect.sendCommand('toggle', {});
        return 'toggled-current';
      }
      await connect.sendCommand('play_tracks', {
        tracks,
        start_index: startIndex,
        queue_context: opts.context.label,
      });
      return 'started-context';
    }
  }

  const activeItem = Player.getActiveMediaItem();
  const activeTrack = activeItem === null ? null : mediaItemToTrack(activeItem);
  if (activeTrack?.id === tracks[startIndex].id) {
    togglePlay();
    return 'toggled-current';
  }

  await playTracks(tracks, startIndex, opts);
  return 'started-context';
}

/** Start endless radio seeded from a track. */
export async function startRadio(seed: Track): Promise<void> {
  const similar = await musicRepository.getRadio(seed.id);
  const queue = [
    seed,
    ...uniqueTracksNotInQueue(similar, new Set([seed.id]), similar.length),
  ];
  await playTracks(queue, 0, { radio: true, context: trackRadioContext(seed) });
}

/**
 * The seed is already playing, but its track radio could not be attached.
 * Callers surface this separately from a playback failure: the song keeps
 * playing while the user learns that no radio follows it.
 */
export class TrackRadioError extends Error {
  constructor(message: string, readonly reason?: unknown) {
    super(message);
    this.name = 'TrackRadioError';
  }
}

function trackRadioContext(seed: Track): QueueContext {
  return {
    type: 'radio',
    id: seed.id,
    label: strings.queue.trackRadioContext(seed.title),
  };
}

/**
 * Handle a track-row tap that should play exactly this track followed by its
 * track radio (search results). The seed starts before the radio request so
 * playback never waits on the radio API; similar tracks are appended once
 * they arrive. Tapping the active track keeps the play/pause toggle.
 *
 * Resolves `'started-radio'` once the radio is attached, or once a newer
 * queue (or the native near-tail radio extension) superseded the append.
 * Rejects with `TrackRadioError` when the radio could not be attached while
 * the seed keeps playing; any other rejection means the seed did not start.
 */
export async function playTrackWithRadio(
  seed: Track,
): Promise<'toggled-current' | 'started-radio'> {
  const connect = activeConnectRouter();
  if (connect?.isControllingRemote() === true) {
    const remoteTrack = activeRemoteTrack(connect.remotePlayback());
    if (remoteTrack?.id === seed.id) {
      await connect.sendCommand('toggle', {});
      return 'toggled-current';
    }
    const context = trackRadioContext(seed);
    let queue: Track[] = [seed];
    let radioError: TrackRadioError | null = null;
    try {
      const similar = await musicRepository.getRadio(seed.id);
      queue = [
        seed,
        ...uniqueTracksNotInQueue(similar, new Set([seed.id]), similar.length),
      ];
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      radioError = new TrackRadioError(
        `Track radio for ${seed.id} could not be loaded: ${detail}`,
        cause,
      );
    }
    await connect.sendCommand('play_tracks', {
      tracks: queue,
      start_index: 0,
      queue_context: context.label,
    });
    if (radioError !== null) throw radioError;
    return 'started-radio';
  }

  const activeItem = Player.getActiveMediaItem();
  const activeTrack = activeItem === null ? null : mediaItemToTrack(activeItem);
  if (activeTrack?.id === seed.id) {
    togglePlay();
    return 'toggled-current';
  }

  const context = trackRadioContext(seed);
  const generation = await replaceQueueAndPlay([seed], 0, { radio: true, context });
  const seedMediaId = `queue:${generation}:0:${seed.id}`;

  let similar: Track[];
  try {
    similar = await musicRepository.getRadio(seed.id);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new TrackRadioError(`Track radio for ${seed.id} could not be loaded: ${detail}`, cause);
  }

  const { items } = getQueueSnapshot();
  if (
    generation !== queueGeneration
    || !items.some((item) => item.mediaId === seedMediaId)
  ) {
    // A newer queue replaced this one while the radio loaded; the user moved on.
    return 'started-radio';
  }
  if (items.some((item) => item.mediaId !== seedMediaId && queueOriginOf(item) === 'context')) {
    // The native near-tail radio extension already appended similar tracks.
    return 'started-radio';
  }

  const existing = new Set(
    items
      .map((item) => mediaItemToTrack(item)?.id)
      .filter((id): id is string => id !== undefined),
  );
  const fresh = uniqueTracksNotInQueue(similar, existing, similar.length);
  if (fresh.length === 0) {
    throw new TrackRadioError(`Track radio for ${seed.id} returned no new tracks`);
  }
  let sources: MediaSource[];
  try {
    sources = await mediaSources(fresh);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new TrackRadioError(`Track radio sources for ${seed.id} are unavailable: ${detail}`, cause);
  }
  // mediaSources awaits; re-check that the queue still belongs to this tap.
  const current = getQueueSnapshot().items;
  if (
    generation !== queueGeneration
    || !current.some((item) => item.mediaId === seedMediaId)
    || current.some((item) => item.mediaId !== seedMediaId && queueOriginOf(item) === 'context')
  ) {
    return 'started-radio';
  }
  const firstOrder = nextOriginalContextOrder(current);
  const radioItems = fresh.map((track, index) =>
    queueMediaItem(track, sources[index], {
      mediaId: nextMediaId('radio', track),
      origin: 'context',
      radio: mediaItemIsRadio(currentActive),
      context,
      originalContextOrder: firstOrder + index,
      stableId: contextStableId(context, firstOrder + index, track),
    }),
  );
  assertNativeShuffleDisabledForQueueContract();
  Player.addMediaItems(radioItems);
  const appendedIds = new Set(radioItems.map((item) => item.mediaId));
  try {
    await waitForNativeQueueMutation('Track radio append', () =>
      Player.getQueue().filter((item) => item.mediaId !== undefined && appendedIds.has(item.mediaId))
        .length === appendedIds.size,
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new TrackRadioError(`Track radio for ${seed.id} was not appended: ${detail}`, cause);
  }
  persistContextShuffleState();
  return 'started-radio';
}

/** Insert a track immediately after the current one. */
export async function playNext(track: Track): Promise<void> {
  const [source] = await mediaSources([track]);
  const { items, activeIndex } = getQueueSnapshot();
  const mediaId = nextMediaId('next', track);
  if (activeIndex === null) {
    await startIdleManualTrack(
      queueMediaItem(track, source, {
        mediaId,
        origin: 'manual',
        radio: false,
        stableId: `manual:${stableIdPart(mediaId)}`,
      }),
    );
    return;
  }

  assertManualQueuePriority(items, activeIndex);
  const radio = mediaItemIsRadio(items[activeIndex]);
  const item = queueMediaItem(track, source, {
    mediaId,
    origin: 'manual',
    radio,
    context: queueContextOf(items[activeIndex]),
    stableId: `manual:${stableIdPart(mediaId)}`,
  });
  assertNativeShuffleDisabledForQueueContract();
  Player.insertMediaItem(activeIndex + 1, item);
  await verifyManualInsertion(mediaId);
}

/** Add behind existing manual items and before remaining context. */
export async function addToQueue(track: Track): Promise<void> {
  const [source] = await mediaSources([track]);
  const { items, activeIndex } = getQueueSnapshot();
  const mediaId = nextMediaId('added', track);
  if (activeIndex === null) {
    await startIdleManualTrack(
      queueMediaItem(track, source, {
        mediaId,
        origin: 'manual',
        radio: false,
        stableId: `manual:${stableIdPart(mediaId)}`,
      }),
    );
    return;
  }

  const at = manualQueueTailIndex(items, activeIndex);
  const radio = mediaItemIsRadio(items[activeIndex]);
  const item = queueMediaItem(track, source, {
    mediaId,
    origin: 'manual',
    radio,
    context: queueContextOf(items[activeIndex]),
    stableId: `manual:${stableIdPart(mediaId)}`,
  });
  assertNativeShuffleDisabledForQueueContract();
  if (at === items.length) Player.addMediaItem(item);
  else Player.insertMediaItem(at, item);
  await verifyManualInsertion(mediaId);
}

export function togglePlay(): void {
  clearPlayerError();
  if (Player.isPlaying()) Player.pause();
  else Player.play();
}

export const next = (): void => Player.skipToNext();
/** Past this many seconds into a song, "previous" restarts it instead of stepping back. */
export const PREVIOUS_RESTARTS_AFTER_SEC = 3;

/** Whether `prev()` would restart the current song (true) or step back (false); null without a song. */
export function prevRestartsTrack(): boolean | null {
  const { activeIndex } = getQueueSnapshot();
  if (activeIndex === null) return null;
  const { position } = Player.getProgress();
  if (!Number.isFinite(position) || position < 0) {
    throw new Error(`Native player reported invalid playback position ${String(position)}`);
  }
  return position > PREVIOUS_RESTARTS_AFTER_SEC || activeIndex === 0;
}

export function prev(): void {
  const restarts = prevRestartsTrack();
  if (restarts === null) return;
  if (restarts) Player.seekTo(0);
  else Player.skipToPrevious();
}
export const seekTo = (seconds: number): void => Player.seekTo(seconds);

function requireQueueIndex(queue: MediaItem[], index: number, operation: string): MediaItem {
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
    throw new Error(`${operation} index ${index} is outside a ${queue.length}-item queue`);
  }
  return queue[index];
}

function requireUniqueStableId(queue: MediaItem[], index: number, operation: string): string {
  const item = requireQueueIndex(queue, index, operation);
  const stableId = queueStableIdOf(item);
  const matches = queue.filter((candidate) => queueStableIdOf(candidate) === stableId).length;
  if (matches !== 1) {
    throw new Error(`${operation} cannot safely target duplicate stable queue id ${stableId}`);
  }
  return stableId;
}

function assertExpectedQueue(
  queue: MediaItem[],
  expectedStableIds: readonly string[],
  operation: string,
): void {
  if (queue.length !== expectedStableIds.length) {
    throw new Error(`${operation} was cancelled because the native queue changed`);
  }
  const seen = new Set<string>();
  queue.forEach((item, index) => {
    const stableId = queueStableIdOf(item);
    if (seen.has(stableId)) {
      throw new Error(
        `${operation} cannot safely target duplicate stable queue id ${stableId}`,
      );
    }
    seen.add(stableId);
    if (stableId !== expectedStableIds[index]) {
      throw new Error(`${operation} was cancelled because the native queue changed`);
    }
  });
}

function waitForNativeQueueMutation(
  operation: string,
  predicate: () => boolean,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      try {
        if (predicate()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() - startedAt >= QUEUE_MUTATION_TIMEOUT_MS) {
        reject(new Error(`${operation} was not applied by the native player`));
        return;
      }
      setTimeout(inspect, QUEUE_MUTATION_POLL_MS);
    };
    setTimeout(inspect, 0);
  });
}

/** Read the canonical native queue together with its active canonical index. */
export function getQueueSnapshot(): QueueSnapshot {
  const items = Player.getQueue();
  const activeIndex = Player.getActiveMediaItemIndex();
  if (
    activeIndex !== null &&
    (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= items.length)
  ) {
    throw new Error(
      `Native player reported active index ${activeIndex} for a ${items.length}-item queue`,
    );
  }
  return { items, activeIndex };
}

function uniqueQueueStableIds(queue: MediaItem[], operation: string): string[] {
  return queue.map((_item, index) => requireUniqueStableId(queue, index, operation));
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertSameQueueMembership(
  currentIds: readonly string[],
  targetIds: readonly string[],
  operation: string,
): void {
  if (
    currentIds.length !== targetIds.length ||
    currentIds.some((mediaId) => !targetIds.includes(mediaId))
  ) {
    throw new Error(`${operation} was cancelled because the native queue changed`);
  }
}

/** Apply a full target order through the player boundary, verifying every native move. */
async function applyUpcomingQueueOrder(
  target: MediaItem[],
  operation: string,
): Promise<void> {
  const initial = getQueueSnapshot();
  if (initial.activeIndex === null) {
    throw new Error(`${operation} requires a currently playing queue item`);
  }
  const activeIndex = initial.activeIndex;
  const activeStableId = requireUniqueStableId(initial.items, activeIndex, operation);
  const targetIds = uniqueQueueStableIds(target, operation);
  if (targetIds[activeIndex] !== activeStableId) {
    throw new Error(`${operation} cannot move the currently playing queue item`);
  }

  for (let targetIndex = activeIndex + 1; targetIndex < targetIds.length; targetIndex += 1) {
    const desiredStableId = targetIds[targetIndex];
    const current = getQueueSnapshot();
    const currentIds = uniqueQueueStableIds(current.items, operation);
    assertSameQueueMembership(currentIds, targetIds, operation);
    const currentActiveItem =
      current.activeIndex === null ? null : current.items[current.activeIndex];
    if (
      current.activeIndex !== activeIndex ||
      currentActiveItem === null ||
      queueStableIdOf(currentActiveItem) !== activeStableId
    ) {
      throw new Error(`${operation} was cancelled because the active queue item changed`);
    }
    if (currentIds[targetIndex] === desiredStableId) continue;
    const fromIndex = currentIds.indexOf(desiredStableId);
    if (fromIndex <= activeIndex) {
      throw new Error(`${operation} cannot move an item across the currently playing track`);
    }

    Player.moveMediaItem(fromIndex, targetIndex);
    await waitForNativeQueueMutation(operation, () => {
      const snapshot = getQueueSnapshot();
      const activeItem =
        snapshot.activeIndex === null ? null : snapshot.items[snapshot.activeIndex];
      return (
        snapshot.items.length === targetIds.length &&
        snapshot.items[targetIndex] !== undefined &&
        queueStableIdOf(snapshot.items[targetIndex]) === desiredStableId &&
        snapshot.activeIndex === activeIndex &&
        activeItem !== null &&
        queueStableIdOf(activeItem) === activeStableId
      );
    });
  }

  await waitForNativeQueueMutation(operation, () => {
    const snapshot = getQueueSnapshot();
    const currentIds = snapshot.items.map(queueStableIdOf);
    const activeItem =
      snapshot.activeIndex === null ? null : snapshot.items[snapshot.activeIndex];
    return (
      sameIds(currentIds, targetIds) &&
      snapshot.activeIndex === activeIndex &&
      activeItem !== null &&
      queueStableIdOf(activeItem) === activeStableId
    );
  });
}

/** Jump to an item in the native queue and verify that the transition happened. */
export async function skipToQueueItem(
  index: number,
  expectedStableIds: readonly string[],
): Promise<void> {
  const { items, activeIndex } = getQueueSnapshot();
  assertExpectedQueue(items, expectedStableIds, 'Skip');
  const stableId = requireUniqueStableId(items, index, 'Skip');
  if (activeIndex === index) return;

  Player.skipToIndex(index);
  await waitForNativeQueueMutation('Queue skip', () => {
    const snapshot = getQueueSnapshot();
    return (
      snapshot.activeIndex === index &&
      snapshot.items[index] !== undefined &&
      queueStableIdOf(snapshot.items[index]) === stableId
    );
  });
  persistContextShuffleState();
}

/** Remove a non-active item from the native queue and verify that it disappeared. */
export async function removeQueueItem(
  index: number,
  expectedStableIds: readonly string[],
): Promise<void> {
  const { items, activeIndex } = getQueueSnapshot();
  assertExpectedQueue(items, expectedStableIds, 'Remove');
  if (activeIndex === index) throw new Error('The currently playing queue item cannot be removed');
  const activeStableId =
    activeIndex === null ? null : requireUniqueStableId(items, activeIndex, 'Remove');
  const stableId = requireUniqueStableId(items, index, 'Remove');
  const originalLength = items.length;

  queueGeneration += 1;
  Player.removeMediaItem(index);
  await waitForNativeQueueMutation('Queue removal', () => {
    const snapshot = getQueueSnapshot();
    const activeItem =
      snapshot.activeIndex === null ? null : snapshot.items[snapshot.activeIndex];
    return (
      snapshot.items.length === originalLength - 1 &&
      !snapshot.items.some((item) => queueStableIdOf(item) === stableId) &&
      (activeStableId === null ||
        (activeItem !== null && queueStableIdOf(activeItem) === activeStableId))
    );
  });
  // Prune any removed stableId from the restore order before re-persisting so
  // removing a track while shuffled keeps context-shuffle persistence valid.
  if (contextShuffleRestoreOrder.length > 0) {
    contextShuffleRestoreOrder = contextShuffleRestoreOrder.filter((id) => id !== stableId);
  }
  persistContextShuffleState();
}

/** Remove every future item while preserving history and the active item. */
export async function clearUpcomingQueue(
  expectedStableIds: readonly string[],
): Promise<void> {
  const { items, activeIndex } = getQueueSnapshot();
  assertExpectedQueue(items, expectedStableIds, 'Clear upcoming');
  const firstUpcomingIndex = activeIndex === null ? 0 : activeIndex + 1;
  if (firstUpcomingIndex >= items.length) return;
  const retainedStableIds = expectedStableIds.slice(0, firstUpcomingIndex);
  const activeStableId =
    activeIndex === null ? null : requireUniqueStableId(items, activeIndex, 'Clear upcoming');

  assertNativeShuffleDisabledForQueueContract();
  queueGeneration += 1;
  Player.removeMediaItems(firstUpcomingIndex, items.length);
  await waitForNativeQueueMutation('Clear upcoming', () => {
    const snapshot = getQueueSnapshot();
    const currentIds = snapshot.items.map(queueStableIdOf);
    const activeItem =
      snapshot.activeIndex === null ? null : snapshot.items[snapshot.activeIndex];
    return (
      sameIds(currentIds, retainedStableIds) &&
      (activeStableId === null
        ? snapshot.activeIndex === null
        : activeItem !== null && queueStableIdOf(activeItem) === activeStableId)
    );
  });
  resetContextShuffleState();
  persistContextShuffleState();
}

/** Move an item within the canonical native queue and verify its destination. */
export async function moveQueueItem(
  fromIndex: number,
  toIndex: number,
  expectedStableIds: readonly string[],
): Promise<void> {
  const { items, activeIndex } = getQueueSnapshot();
  assertExpectedQueue(items, expectedStableIds, 'Move');
  const stableId = requireUniqueStableId(items, fromIndex, 'Move');
  requireQueueIndex(items, toIndex, 'Move destination');
  if (fromIndex === toIndex) return;
  const activeStableId =
    activeIndex === null ? null : requireUniqueStableId(items, activeIndex, 'Move');
  if (
    activeIndex !== null &&
    (fromIndex === activeIndex ||
      toIndex === activeIndex ||
      (fromIndex < activeIndex) !== (toIndex < activeIndex))
  ) {
    throw new Error('Queue items cannot be moved across the currently playing track');
  }
  assertMovePreservesManualPriority(items, activeIndex, fromIndex, toIndex);

  queueGeneration += 1;
  Player.moveMediaItem(fromIndex, toIndex);
  await waitForNativeQueueMutation('Queue move', () => {
    const snapshot = getQueueSnapshot();
    const activeItem =
      snapshot.activeIndex === null ? null : snapshot.items[snapshot.activeIndex];
    return (
      snapshot.items.length === items.length &&
      snapshot.items[toIndex] !== undefined &&
      queueStableIdOf(snapshot.items[toIndex]) === stableId &&
      (activeStableId === null ||
        (activeItem !== null && queueStableIdOf(activeItem) === activeStableId))
    );
  });
  persistContextShuffleState();
}

/** One entry of a party queue: the server's entry ID plus the song it plays. */
export interface PartyQueueEntry {
  itemId: number;
  track: Track;
}

export interface PartyQueueTarget {
  code: string;
  /** Queue source label shown in the player ("Party" or the party's name). */
  label: string;
  entries: readonly PartyQueueEntry[];
  /** The party's current entry, or -1 when nothing is selected. */
  currentIndex: number;
  /** Where the current entry starts when it is not already playing here. */
  startPosition: number;
  playing: boolean;
  /** Keep this device's play/pause when the running entry continues (the host). */
  keepLocalPlayState: boolean;
}

export type PartyQueueSyncResult = 'unchanged' | 'replaced' | 'cleared';

/** Stable queue identity of one party entry; duplicate songs stay distinct. */
export function partyQueueStableId(code: string, itemId: number): string {
  return `party:${stableIdPart(code)}:${itemId}`;
}

/** The party entry the native player is on, or null when it plays something else. */
export function activePartyItemId(code: string): number | null {
  const { items, activeIndex } = getQueueSnapshot();
  if (activeIndex === null) return null;
  const prefix = `party:${stableIdPart(code)}:`;
  const stableId = queueStableIdOf(items[activeIndex]);
  if (!stableId.startsWith(prefix)) return null;
  const itemId = Number(stableId.slice(prefix.length));
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new Error(`Party queue item has a malformed stable id ${stableId}`);
  }
  return itemId;
}

/** Remove this Jam's entries without interrupting any active personal track. */
export async function releasePartyQueue(code: string): Promise<void> {
  const prefix = `party:${stableIdPart(code)}:`;
  const { items } = getQueueSnapshot();
  const ids = items.map(queueStableIdOf);
  const keep = ids.filter((id) => !id.startsWith(prefix));
  if (keep.length === ids.length) return;
  if (keep.length === 0) {
    await clearLocalQueue();
    return;
  }
  queueGeneration += 1;
  for (let index = ids.length - 1; index >= 0; index--) {
    if (ids[index].startsWith(prefix)) Player.removeMediaItem(index);
  }
  await waitForNativeQueueMutation('Party queue release', () =>
    sameIds(getQueueSnapshot().items.map(queueStableIdOf), keep));
  persistContextShuffleState();
}

/**
 * Make the native queue mirror a party. The whole queue is replaced in one
 * native step, so removals, additions and reorders never restart the running
 * entry: when the party's current entry is already playing here (or, right
 * after starting a party, the same song from the host's own queue) it keeps
 * its playhead. Play/pause and drift are the caller's job.
 */
export async function syncPartyQueue(target: PartyQueueTarget): Promise<PartyQueueSyncResult> {
  const { code, entries, currentIndex } = target;
  if (
    !Number.isInteger(currentIndex) ||
    currentIndex < -1 ||
    currentIndex >= entries.length
  ) {
    throw new Error(
      `Party current index ${currentIndex} is outside a ${entries.length}-entry party queue`,
    );
  }
  if (!Number.isFinite(target.startPosition) || target.startPosition < 0) {
    throw new Error(`Party start position must be finite and non-negative, got ${target.startPosition}`);
  }
  const before = getQueueSnapshot();
  if (currentIndex === -1) {
    if (before.items.length === 0) return 'unchanged';
    queueGeneration += 1;
    resetContextShuffleState();
    Player.clear();
    await waitForNativeQueueMutation('Party queue clear', () => getQueueSnapshot().items.length === 0);
    persistContextShuffleState();
    return 'cleared';
  }

  const targetIds = entries.map((entry) => partyQueueStableId(code, entry.itemId));
  if (new Set(targetIds).size !== targetIds.length) {
    throw new Error(`Party ${code} has duplicate queue entry IDs`);
  }
  const localIds = before.items.map(queueStableIdOf);
  if (sameIds(localIds, targetIds) && before.activeIndex === currentIndex) return 'unchanged';

  const prefix = `party:${stableIdPart(code)}:`;
  const activeItem = before.activeIndex === null ? null : before.items[before.activeIndex];
  const activeStableId = activeItem === null ? null : queueStableIdOf(activeItem);
  const currentEntry = entries[currentIndex];
  const keepsPlayhead =
    activeItem !== null &&
    (activeStableId === targetIds[currentIndex] ||
      (!localIds.some((id) => id.startsWith(prefix)) &&
        mediaItemToTrack(activeItem)?.id === currentEntry.track.id));
  let position = target.startPosition;
  if (keepsPlayhead) {
    position = Player.getProgress().position;
    if (!Number.isFinite(position) || position < 0) {
      throw new Error(`Native player reported invalid playback position ${String(position)}`);
    }
  }

  const tracks = entries.map((entry) => entry.track);
  const sources = await mediaSources(tracks);
  const context: QueueContext = { type: 'party', id: code, label: target.label };
  const items = entries.map((entry, index) =>
    queueMediaItem(entry.track, sources[index], {
      mediaId: `party:${stableIdPart(code)}:${entry.itemId}:${entry.track.id}`,
      origin: 'context',
      radio: false,
      context,
      originalContextOrder: index,
      stableId: targetIds[index],
    }),
  );
  assertNativeShuffleDisabledForQueueContract();
  queueGeneration += 1;
  resetContextShuffleState();
  clearPlayerError();
  if (keepsPlayhead && target.keepLocalPlayState) {
    // Resume=false leaves the native play-when-ready flag exactly as it is.
    Player.replaceQueue(items, currentIndex, position, false);
  } else {
    Player.replaceQueue(items, currentIndex, position, target.playing);
    if (!target.playing) Player.pause();
  }
  await waitForNativeQueueMutation('Party queue sync', () => {
    const snapshot = getQueueSnapshot();
    return (
      snapshot.activeIndex === currentIndex &&
      sameIds(snapshot.items.map(queueStableIdOf), targetIds)
    );
  });
  persistContextShuffleState();
  return 'replaced';
}

/**
 * Hydrate this device's native player from a Connect `activate` transfer frame.
 * Replaces the full queue in one native step, preserves manual/context origins,
 * restores repeat mode, and starts at the server-interpolated position.
 */
export async function syncConnectQueue(playback: ConnectPlaybackState): Promise<void> {
  const { queue, origins, current_index: currentIndex, position_sec: positionSec } = playback;
  if (!Number.isInteger(currentIndex) || currentIndex < -1 || currentIndex >= queue.length) {
    throw new Error(
      `Connect playback current_index ${currentIndex} is outside a ${queue.length}-track queue`,
    );
  }
  if (!Number.isFinite(positionSec) || positionSec < 0) {
    throw new Error(`Connect playback position_sec must be finite and non-negative, got ${positionSec}`);
  }
  Player.setRepeatMode(connectRepeatToPlayer(playback.repeat));

  if (queue.length === 0 || currentIndex === -1) {
    queueGeneration += 1;
    resetContextShuffleState();
    Player.clear();
    await waitForNativeQueueMutation('Connect queue clear', () => getQueueSnapshot().items.length === 0);
    persistContextShuffleState();
    return;
  }

  const sources = await mediaSources(queue);
  assertNativeShuffleDisabledForQueueContract();
  const generation = ++queueGeneration;
  const contextLabel = playback.queue_context?.trim() || strings.connect.title;
  const context: QueueContext = {
    type: 'collection',
    id: `connect:${generation}`,
    label: contextLabel,
  };
  let contextOrder = 0;
  const items = queue.map((track, index) => {
    const isManual = origins[index] === 'manual';
    if (isManual) {
      const mediaId = nextMediaId('added', track);
      return queueMediaItem(track, sources[index], {
        mediaId,
        origin: 'manual',
        radio: false,
        context,
        stableId: `manual:${stableIdPart(mediaId)}`,
      });
    }
    const order = contextOrder++;
    return queueMediaItem(track, sources[index], {
      mediaId: `queue:${generation}:${index}:${track.id}`,
      origin: 'context',
      radio: false,
      context,
      originalContextOrder: order,
      stableId: contextStableId(context, order, track),
    });
  });
  const targetStableIds = items.map(queueStableIdOf);
  resetContextShuffleState();
  clearPlayerError();
  Player.replaceQueue(items, currentIndex, positionSec, playback.is_playing);
  if (!playback.is_playing) Player.pause();
  await waitForNativeQueueMutation('Connect playback transfer', () => {
    const snapshot = getQueueSnapshot();
    return (
      snapshot.activeIndex === currentIndex
      && sameIds(snapshot.items.map(queueStableIdOf), targetStableIds)
    );
  });
  persistContextShuffleState();
}

export function setRepeatMode(mode: RepeatMode): void {
  Player.setRepeatMode(mode);
}

export async function clearLocalQueue(): Promise<void> {
  queueGeneration += 1;
  resetContextShuffleState();
  Player.clear();
  await waitForNativeQueueMutation('Clear queue', () => getQueueSnapshot().items.length === 0);
  persistContextShuffleState();
}

/** Cycle Off → All → One → Off, returning the new mode. */
export function cycleRepeat(): RepeatMode {
  const current = Player.getRepeatMode();
  const nextMode =
    current === RepeatMode.Off
      ? RepeatMode.All
      : current === RepeatMode.All
        ? RepeatMode.One
        : RepeatMode.Off;
  Player.setRepeatMode(nextMode);
  return nextMode;
}

/**
 * Autoplay: once a queue runs out, native keeps playing the song radio of the
 * track near its tail. The value is a device preference owned by the native
 * player service, so it also applies without the UI (Android Auto, notification).
 */
export function isAutoRadioEnabled(): boolean {
  return Player.isAutoRadioEnabled();
}

export function setAutoRadioEnabled(enabled: boolean): void {
  Player.setAutoRadioEnabled(enabled);
}

/**
 * Mirrors the native near-tail rule: an explicit song radio always extends
 * itself; any other queue only with Autoplay on, repeat off and outside a party.
 */
export function radioExtensionEligible(item: MediaItem): boolean {
  if (mediaItemIsRadio(item)) return true;
  return Player.isAutoRadioEnabled()
    && Player.getRepeatMode() === RepeatMode.Off
    && queueContextOf(item)?.type !== 'party';
}

export function isContextShuffleEnabled(): boolean {
  return contextShuffleEnabled;
}

/**
 * Toggle product shuffle by physically reordering only future context items.
 * Manual priority, history, and the active item never move.
 */
export async function toggleShuffle(
  expectedStableIds?: readonly string[],
  random: () => number = Math.random,
): Promise<boolean> {
  const { items, activeIndex } = getQueueSnapshot();
  if (expectedStableIds !== undefined) {
    assertExpectedQueue(items, expectedStableIds, 'Shuffle');
  }
  if (activeIndex === null) {
    throw new Error('Shuffle requires a currently playing queue item');
  }
  assertManualQueuePriority(items, activeIndex);
  assertNativeShuffleDisabledForQueueContract();

  const enabling = !contextShuffleEnabled;
  const restoreOrder = enabling
    ? captureUpcomingContextOrder(items, activeIndex)
    : contextShuffleRestoreOrder;
  const target = enabling
    ? shuffleUpcomingContext(items, activeIndex, random)
    : restoreUpcomingContext(items, activeIndex, restoreOrder);
  const currentIds = uniqueQueueStableIds(items, 'Shuffle');
  const targetIds = uniqueQueueStableIds(target, 'Shuffle');

  if (!sameIds(currentIds, targetIds)) {
    queueGeneration += 1;
    try {
      await applyUpcomingQueueOrder(target, enabling ? 'Queue shuffle' : 'Queue restore');
    } catch (cause) {
      try {
        await applyUpcomingQueueOrder(items, 'Queue shuffle rollback');
      } catch (rollbackCause) {
        const failure = cause instanceof Error ? cause.message : String(cause);
        const rollbackFailure =
          rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause);
        throw new Error(`${failure}; rollback failed: ${rollbackFailure}`);
      }
      throw cause;
    }
  }

  contextShuffleEnabled = enabling;
  contextShuffleRestoreOrder = enabling ? restoreOrder : [];
  persistContextShuffleState();
  return contextShuffleEnabled;
}

async function handleMediaItemTransition(
  event: MediaItemTransitionEvent,
): Promise<void> {
  noteMediaItemTransition(event);
  try {
    await drainDurablePlaybackEvents();
  } catch {
    // Durable bookkeeping is isolated from transport. Native keeps an unacked
    // or explicitly retried event; JavaScript never needs diagnostic payloads.
    const mediaId = event.item?.mediaId;
    reportPlayerNotice(
      'bookkeeping',
      `transition:${typeof mediaId === 'string' ? mediaId : event.index}`,
      strings.player.bookkeepingFailedTitle,
      strings.player.bookkeepingFailedMessage,
    );
  }
}

function waitForRecoveryDelay(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function recoveryPosition(): number {
  try {
    const position = Player.getProgress().position;
    return Number.isFinite(position) && position >= 0 ? position : 0;
  } catch {
    return 0;
  }
}

function noteMediaItemTransition(event: MediaItemTransitionEvent): void {
  const mediaId = event.item?.mediaId;
  if (typeof mediaId !== 'string' || mediaId.trim().length === 0) return;
  const transitioned = transitionRecoveryBudget(
    recoveryBudget,
    mediaId,
    recoveryPosition(),
    Date.now(),
  );
  if (transitioned !== recoveryBudget) recoveryBudgetEpoch += 1;
  recoveryBudget = transitioned;
}

function notePlaybackProgress(event: PlaybackProgressUpdatedEvent): void {
  if (typeof event.mediaId !== 'string' || event.mediaId.trim().length === 0) return;
  const observed = observeRecoveryProgress(
    recoveryBudget,
    event.mediaId,
    event.position,
    event.timestamp,
  );
  if (observed.reset) recoveryBudgetEpoch += 1;
  recoveryBudget = observed.state;
}

interface RecoveryTarget {
  mediaId: string;
  track: Track;
  position: number;
  generation: number;
  epoch: number;
  budgetEpoch: number;
  explicitDownload: boolean;
}

function captureRecoveryTarget(): RecoveryTarget | null {
  const snapshot = getQueueSnapshot();
  if (snapshot.activeIndex === null) return null;
  const item = snapshot.items[snapshot.activeIndex];
  const mediaId = item.mediaId;
  if (typeof mediaId !== 'string' || mediaId.trim().length === 0) {
    throw new Error('The active queue item has no stable mediaId');
  }
  const track = mediaItemToTrack(item);
  if (track === null) throw new Error(`The active queue item ${mediaId} has no Track metadata`);
  const position = recoveryPosition();
  const observed = observeRecoveryProgress(
    recoveryBudget,
    mediaId,
    position,
    Date.now(),
  );
  if (observed.reset) recoveryBudgetEpoch += 1;
  recoveryBudget = observed.state;
  return {
    mediaId,
    track,
    position,
    generation: queueGeneration,
    epoch: recoveryEpoch,
    budgetEpoch: recoveryBudgetEpoch,
    explicitDownload: mediaItemUsesExplicitDownload(item),
  };
}

function activeTargetIndex(target: RecoveryTarget): number | null {
  if (
    target.epoch !== recoveryEpoch ||
    target.generation !== queueGeneration ||
    target.budgetEpoch !== recoveryBudgetEpoch
  ) {
    return null;
  }
  const snapshot = getQueueSnapshot();
  if (snapshot.activeIndex === null) return null;
  return snapshot.items[snapshot.activeIndex]?.mediaId === target.mediaId
    ? snapshot.activeIndex
    : null;
}

function refreshedRecoveryItem(
  item: MediaItem,
  target: RecoveryTarget,
  base: string,
  headers: Record<string, string>,
): MediaItem {
  const refreshed = trackToMediaItem(target.track, base, headers, {
    mediaId: target.mediaId,
    radio: mediaItemIsRadio(item),
  });
  if (
    typeof refreshed.url !== 'object' ||
    refreshed.url === null ||
    typeof refreshed.url.uri !== 'string'
  ) {
    throw new Error(`Recovery stream for ${target.mediaId} did not produce an HTTP URL`);
  }
  recoveryReloadSequence += 1;
  const recoveryKey = encodeURIComponent(
    `${target.mediaId}:${recoveryEpoch}:${recoveryReloadSequence}`,
  );
  return {
    ...item,
    ...refreshed,
    // Bypass a partial native cache entry while retaining the authenticated backend route.
    url: { ...refreshed.url, uri: `${refreshed.url.uri}?lr_recovery=${recoveryKey}` },
    extras: { ...item.extras, ...refreshed.extras },
  };
}

function pauseAfterRecoveryFailure(): string {
  try {
    Player.pause();
    return '';
  } catch {
    return ` ${strings.player.recovery.pauseFailed}`;
  }
}

function finishExhaustedRecovery(
  target: RecoveryTarget,
  category: PlaybackFailureCategory,
): void {
  const activeIndex = activeTargetIndex(target);
  if (activeIndex === null) return;
  const snapshot = getQueueSnapshot();
  const policy = recoveryPolicy(category);
  const attempts = recoveryBudget.totalAttempts;
  const attemptLabel = strings.player.recovery.attempts(attempts);
  const reason = strings.player.recovery.explanations[category];

  if (category === 'session') {
    const pauseFailure = pauseAfterRecoveryFailure();
    reportPlayerError(
      strings.player.recovery.stoppedTitle,
      new UserFacingPlayerError(`${strings.player.recovery.sessionExpired(target.track.title)}${pauseFailure}`),
    );
    return;
  }

  if (policy.exhaustionAction === 'skip' && activeIndex + 1 < snapshot.items.length) {
    try {
      Player.skipToNext();
      reportPlayerError(
        strings.player.recovery.skippedTitle,
        new UserFacingPlayerError(strings.player.recovery.skipped(target.track.title, attemptLabel, reason)),
      );
      return;
    } catch {
      const pauseFailure = pauseAfterRecoveryFailure();
      reportPlayerError(
        strings.player.recovery.stoppedTitle,
        new UserFacingPlayerError(`${strings.player.recovery.skipFailed(target.track.title, attemptLabel)}${pauseFailure}`),
      );
      return;
    }
  }

  const pauseFailure = pauseAfterRecoveryFailure();
  reportPlayerError(
    strings.player.recovery.stoppedTitle,
    new UserFacingPlayerError(
      `${strings.player.recovery.stopped(
        target.track.title,
        attemptLabel,
        reason,
        policy.exhaustionAction === 'skip',
      )}${pauseFailure}`,
    ),
  );
}

async function performPlaybackRecovery(
  event: PlaybackErrorEvent,
  requestTimeoutMs: number,
  totalBudgetMs: number,
): Promise<void> {
  const target = captureRecoveryTarget();
  if (target === null) {
    const pauseFailure = pauseAfterRecoveryFailure();
    reportPlayerError(
      strings.player.recovery.stoppedTitle,
      new UserFacingPlayerError(`${strings.player.recovery.noActiveTrack}${pauseFailure}`),
    );
    return;
  }

  let category = classifyPlaybackFailure(event);
  const startedAt = Date.now();

  if (target.explicitDownload) {
    // An explicit download is authoritative for offline playback. Never turn a
    // missing/corrupt local file into a silent backend probe or remote fallback.
    // Count the failed local source once so the existing accessible exhaustion
    // message and skip/stop policy remain deterministic.
    const decision = nextRecoveryAttempt(recoveryBudget, 'source');
    recoveryBudget = decision.state;
    finishExhaustedRecovery(target, 'source');
    return;
  }

  for (;;) {
    if (Date.now() - startedAt >= totalBudgetMs) {
      finishExhaustedRecovery(target, category);
      return;
    }
    const decision = nextRecoveryAttempt(recoveryBudget, category);
    recoveryBudget = decision.state;
    if (!decision.allowed) {
      finishExhaustedRecovery(target, category);
      return;
    }

    await waitForRecoveryDelay(decision.delayMs);
    if (activeTargetIndex(target) === null) return;
    const remainingMs = totalBudgetMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      finishExhaustedRecovery(target, category);
      return;
    }

    try {
      await musicRepository.preloadTrack(target.track.id, {
        timeoutMs: Math.max(1, Math.min(requestTimeoutMs, remainingMs)),
      });
      if (activeTargetIndex(target) === null) return;
      if (Date.now() - startedAt >= totalBudgetMs) {
        finishExhaustedRecovery(target, category);
        return;
      }

      const { base, headers } = await mediaContext();
      const currentIndex = activeTargetIndex(target);
      if (currentIndex === null) return;
      const currentItem = Player.getQueue()[currentIndex];
      if (currentItem?.mediaId !== target.mediaId) return;

      Player.replaceMediaItem(
        currentIndex,
        refreshedRecoveryItem(currentItem, target, base, headers),
      );
      // Native SetQueue resets the persisted context-shuffle sidecar.
      persistContextShuffleState();
      Player.seekTo(target.position);
      Player.play();
      return;
    } catch (error) {
      if (activeTargetIndex(target) === null) return;
      const preciseCategory = classifyPlaybackFailure(event, error);
      recoveryBudget = reclassifyRecoveryAttempt(recoveryBudget, category, preciseCategory);
      category = preciseCategory;

      const policy = recoveryPolicy(category);
      if (
        category === 'session' ||
        recoveryBudget.attemptsByCategory[category] >= policy.maxAttempts ||
        recoveryBudget.totalAttempts >= MAX_TOTAL_RECOVERY_ATTEMPTS
      ) {
        finishExhaustedRecovery(target, category);
        return;
      }
    }
  }
}

/** Coalesce foreground and Android headless delivery into one native recovery mutation. */
function requestPlaybackRecovery(
  event: PlaybackErrorEvent,
  requestTimeoutMs: number,
  totalBudgetMs: number,
): Promise<void> {
  if (recoveryInFlight !== null) return recoveryInFlight;

  const attempt = performPlaybackRecovery(event, requestTimeoutMs, totalBudgetMs).catch(() => {
    const pauseFailure = pauseAfterRecoveryFailure();
    reportPlayerError(
      strings.player.recovery.failedTitle,
      new UserFacingPlayerError(`${strings.player.recovery.unexpected}${pauseFailure}`),
    );
  });
  recoveryInFlight = attempt;
  void attempt.finally(() => {
    if (recoveryInFlight === attempt) recoveryInFlight = null;
  });
  return attempt;
}

/** Called by Android's headless playback task while the UI is backgrounded. */
export async function handleBackgroundPlaybackEvent(event: BackgroundEvent): Promise<void> {
  if (event.type === Event.MediaItemTransition) {
    await handleMediaItemTransition(event);
  } else if (event.type === Event.PlaybackProgressUpdated) {
    notePlaybackProgress(event);
  } else if (event.type === Event.PlaybackError) {
    await requestPlaybackRecovery(
      event,
      BACKGROUND_RECOVERY_REQUEST_TIMEOUT_MS,
      BACKGROUND_RECOVERY_BUDGET_MS,
    );
  } else if (event.type === Event.RemoteToggleFavorite) {
    await drainDurablePlaybackEvents();
  }
}

/** Install one-time foreground listeners for play recording, radio, and resilient recovery. */
export function installPlaybackListeners(): void {
  if (listenersInstalled) return;
  Player.addEventListener(Event.MediaItemTransition, (event) => {
    void handleMediaItemTransition(event);
  });
  Player.addEventListener(Event.RemoteToggleFavorite, () => {
    void drainDurablePlaybackEvents().catch((cause) => {
      reportPlayerError(strings.player.likeFailed, cause);
    });
  });
  Player.addEventListener(Event.PlaybackProgressUpdated, notePlaybackProgress);
  Player.addEventListener(Event.PlaybackError, (error) => {
    void requestPlaybackRecovery(
      error,
      FOREGROUND_RECOVERY_REQUEST_TIMEOUT_MS,
      FOREGROUND_RECOVERY_BUDGET_MS,
    );
  });
  // A natively rejected command reverts the optimistic queue state; without
  // this listener that revert is silent and the UI claims the edit succeeded.
  Player.addEventListener(Event.CommandRejected, (event) => {
    reportPlayerError(
      strings.player.commandRejectedTitle,
      new UserFacingPlayerError(`${event.command}: ${event.code}`),
    );
  });
  listenersInstalled = true;
}

/**
 * Prepare, but never append, one radio extension. Native validates the leased
 * event's generation/active item and atomically appends these items with event
 * completion, closing the previous append-then-ack crash window.
 */
export async function prepareRadioPlaybackCompletionItems(
  event: Readonly<RadioPlaybackEvent>,
  requestTimeoutMs: number,
  requestAuthority?: AuthenticatedRequestAuthority,
): Promise<readonly NativeQueueWireItem[]> {
  const initial = getQueueSnapshot();
  if (initial.activeIndex === null) return [];
  const initialActive = initial.items[initial.activeIndex];
  const initialTrack = mediaItemToTrack(initialActive);
  if (
    initialActive.mediaId !== event.activeMediaId
    || !radioExtensionEligible(initialActive)
    || initial.items.length - initial.activeIndex > 2
    || initialTrack?.id !== event.track.id
  ) {
    return [];
  }

  const seed = trackFromPlaybackEventMetadata(event.track);
  const similar = requestAuthority === undefined
    ? await musicRepository.getRadio(seed.id, undefined, requestTimeoutMs)
    : await musicRepository.getRadio(
        seed.id,
        undefined,
        requestTimeoutMs,
        requestAuthority,
      );

  // Re-read after HTTP so Android Auto replacement and foreground queue changes
  // become an empty stale completion. Native repeats this check transactionally.
  const current = getQueueSnapshot();
  if (current.activeIndex === null) return [];
  const currentActive = current.items[current.activeIndex];
  const currentTrack = mediaItemToTrack(currentActive);
  if (
    currentActive.mediaId !== event.activeMediaId
    || !radioExtensionEligible(currentActive)
    || current.items.length - current.activeIndex > 2
    || currentTrack?.id !== seed.id
  ) {
    return [];
  }
  const existing = new Set(
    current.items
      .map((item) => mediaItemToTrack(item)?.id)
      .filter((id): id is string => id !== undefined),
  );
  const fresh = uniqueTracksNotInQueue(similar, existing, 5);
  if (fresh.length === 0) return [];
  const sources = await mediaSources(fresh, requestAuthority);
  // Autoplay turns the end of an album/playlist into a song radio of its own, so
  // the appended tracks never pose as more of the album they follow.
  const seedContext = queueContextOf(currentActive);
  const context = seedContext?.type === 'radio' ? seedContext : trackRadioContext(seed);
  const firstOrder = nextOriginalContextOrder(current.items);
  return fresh.map((track, index) => mapMediaItemToNativeQueueItem(
    queueMediaItem(track, sources[index], {
      mediaId: nextMediaId('radio', track),
      origin: 'context',
      radio: true,
      context,
      originalContextOrder: firstOrder + index,
      stableId: contextStableId(context, firstOrder + index, track),
    }),
  ));
}

export function resetControllerState(): void {
  queueGeneration += 1;
  resetContextShuffleState();
  recoveryEpoch += 1;
  recoveryBudgetEpoch += 1;
  recoveryBudget = createRecoveryBudget();
  recoveryInFlight = null;
  clearPlayerError();
  clearPlayerNotice();
}

export function currentQueue(): MediaItem[] {
  return Player.getQueue();
}
