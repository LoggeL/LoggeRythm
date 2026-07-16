import TrackPlayer, {
  Event,
  RepeatMode,
  type BackgroundEvent,
  type MediaItem,
  type MediaItemTransitionEvent,
  type PlaybackErrorEvent,
  type PlaybackProgressUpdatedEvent,
} from '@rntp/player';
import type { Track } from '../api/types';
import { authenticatedHeadersFor } from '../api/client';
import { getApiBase } from '../config';
import { invalidateListeningStats } from '../data/queryClient';
import { musicRepository } from '../data/repositories';
import { strings } from '../localization';
import { offlineUriForTrack } from '../offline/registry';
import { clearPlayerError, reportPlayerError, UserFacingPlayerError } from './errors';
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
let extending = false;
let queueGeneration = 0;
let itemSequence = 0;
let contextShuffleEnabled = false;
let contextShuffleRestoreOrder: string[] = [];
const BACKGROUND_REQUEST_TIMEOUT_MS = 4_000;
const BACKGROUND_RECOVERY_REQUEST_TIMEOUT_MS = 2_500;
const BACKGROUND_RECOVERY_BUDGET_MS = 4_500;
const FOREGROUND_RECOVERY_REQUEST_TIMEOUT_MS = 5_000;
const FOREGROUND_RECOVERY_BUDGET_MS = 20_000;
const QUEUE_MUTATION_TIMEOUT_MS = 1_500;
const QUEUE_MUTATION_POLL_MS = 25;

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
  return withQueueProductMetadata(
    trackToMediaItem(
      track,
      source.kind === 'remote' ? source.context.base : '',
      source.kind === 'remote' ? source.context.headers : {},
      {
        mediaId: options.mediaId,
        radio: options.radio,
        explicitDownloadUri: source.kind === 'explicit-download' ? source.uri : undefined,
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

function disableNativeShuffleForQueueContract(): void {
  // Media3 exposes only a global shuffle order through RNTP. It cannot keep a
  // primary manual section ahead of context. Product shuffle therefore uses
  // explicit RNTP queue moves while native global shuffle stays disabled.
  if (TrackPlayer.isShuffleEnabled()) TrackPlayer.setShuffleEnabled(false);
}

function resetContextShuffleState(): void {
  contextShuffleEnabled = false;
  contextShuffleRestoreOrder = [];
}

function persistContextShuffleState(): void {
  TrackPlayer.setQueuePersistenceState({
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
  queueGeneration += 1;
  restoreItemSequence(items);
  disableNativeShuffleForQueueContract();

  if (items.length === 0) {
    resetContextShuffleState();
    return;
  }
  if (activeIndex === null) {
    throw new Error('A restored non-empty queue must have an active item');
  }
  uniqueQueueStableIds(items, 'Queue restoration');
  assertManualQueuePriority(items, activeIndex);

  const state = TrackPlayer.getQueuePersistenceState();
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
  queueGeneration += 1;
  resetContextShuffleState();
  disableNativeShuffleForQueueContract();
  clearPlayerError();
  TrackPlayer.setMediaItem(item);
  TrackPlayer.play();
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
    const matches = TrackPlayer.getQueue().filter((item) => item.mediaId === mediaId);
    return matches.length === 1;
  });
}

async function mediaContext(): Promise<{ base: string; headers: Record<string, string> }> {
  const base = await getApiBase();
  const headers = await authenticatedHeadersFor(base);
  return { base, headers };
}

/**
 * Resolve explicit files before touching auth or compatibility checks. A mixed
 * queue shares one authenticated remote context, while a wholly local queue
 * stays synchronous with respect to the network boundary.
 */
async function mediaSources(tracks: readonly Track[]): Promise<MediaSource[]> {
  const explicitUris = tracks.map((track) => offlineUriForTrack(track.id));
  if (explicitUris.every((uri): uri is string => uri !== null)) {
    return explicitUris.map((uri) => ({ kind: 'explicit-download', uri }));
  }

  const context = await mediaContext();
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
  const generation = ++queueGeneration;
  const context = opts.context;
  resetContextShuffleState();
  persistContextShuffleState();
  disableNativeShuffleForQueueContract();
  clearPlayerError();
  TrackPlayer.setMediaItems(
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
  TrackPlayer.play();
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

  const activeItem = TrackPlayer.getActiveMediaItem();
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
  await playTracks(queue, 0, {
    radio: true,
    context: {
      type: 'radio',
      id: seed.id,
      label: strings.queue.trackRadioContext(seed.title),
    },
  });
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
  disableNativeShuffleForQueueContract();
  TrackPlayer.insertMediaItem(activeIndex + 1, item);
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
  disableNativeShuffleForQueueContract();
  if (at === items.length) TrackPlayer.addMediaItem(item);
  else TrackPlayer.insertMediaItem(at, item);
  await verifyManualInsertion(mediaId);
}

export function togglePlay(): void {
  clearPlayerError();
  if (TrackPlayer.isPlaying()) TrackPlayer.pause();
  else TrackPlayer.play();
}

export const next = (): void => TrackPlayer.skipToNext();
export function prev(): void {
  const { activeIndex } = getQueueSnapshot();
  if (activeIndex === null) return;
  const { position } = TrackPlayer.getProgress();
  if (!Number.isFinite(position) || position < 0) {
    throw new Error(`Native player reported invalid playback position ${String(position)}`);
  }
  if (position > 3 || activeIndex === 0) TrackPlayer.seekTo(0);
  else TrackPlayer.skipToPrevious();
}
export const seekTo = (seconds: number): void => TrackPlayer.seekTo(seconds);

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
  const items = TrackPlayer.getQueue();
  const activeIndex = TrackPlayer.getActiveMediaItemIndex();
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

/** Apply a full target order through RNTP, verifying every native move. */
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

    TrackPlayer.moveMediaItem(fromIndex, targetIndex);
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

  TrackPlayer.skipToIndex(index);
  await waitForNativeQueueMutation('Queue skip', () => {
    const snapshot = getQueueSnapshot();
    return (
      snapshot.activeIndex === index &&
      snapshot.items[index] !== undefined &&
      queueStableIdOf(snapshot.items[index]) === stableId
    );
  });
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
  TrackPlayer.removeMediaItem(index);
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

  queueGeneration += 1;
  disableNativeShuffleForQueueContract();
  TrackPlayer.removeMediaItems(firstUpcomingIndex, items.length);
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
  TrackPlayer.moveMediaItem(fromIndex, toIndex);
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
}

/** Cycle Off → All → One → Off, returning the new mode. */
export function cycleRepeat(): RepeatMode {
  const current = TrackPlayer.getRepeatMode();
  const nextMode =
    current === RepeatMode.Off
      ? RepeatMode.All
      : current === RepeatMode.All
        ? RepeatMode.One
        : RepeatMode.Off;
  TrackPlayer.setRepeatMode(nextMode);
  return nextMode;
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
  disableNativeShuffleForQueueContract();

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
  requestTimeoutMs?: number,
): Promise<void> {
  noteMediaItemTransition(event);
  let bookkeepingFailed = false;
  try {
    const operations: Promise<void>[] = [];
    const track = mediaItemToTrack(event.item);
    const recordResultIndex = track === null ? null : operations.length;
    if (track !== null) operations.push(musicRepository.recordPlay(track, requestTimeoutMs));
    operations.push(maybeExtendRadio(event.index, requestTimeoutMs));
    const results = await Promise.allSettled(operations);
    if (
      recordResultIndex !== null &&
      results[recordResultIndex]?.status === 'fulfilled'
    ) {
      void invalidateListeningStats().catch(() => undefined);
    }
    bookkeepingFailed = results.some((result) => result.status === 'rejected');
  } catch {
    // Transition side effects are not audio control. Even malformed bookkeeping
    // metadata must not become an unhandled listener rejection or stop playback.
    bookkeepingFailed = true;
  }
  if (bookkeepingFailed) {
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
    const position = TrackPlayer.getProgress().position;
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
    TrackPlayer.pause();
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
      TrackPlayer.skipToNext();
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
      const currentItem = TrackPlayer.getQueue()[currentIndex];
      if (currentItem?.mediaId !== target.mediaId) return;

      TrackPlayer.replaceMediaItem(
        currentIndex,
        refreshedRecoveryItem(currentItem, target, base, headers),
      );
      TrackPlayer.seekTo(target.position);
      TrackPlayer.play();
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
    await handleMediaItemTransition(event, BACKGROUND_REQUEST_TIMEOUT_MS);
  } else if (event.type === Event.PlaybackProgressUpdated) {
    notePlaybackProgress(event);
  } else if (event.type === Event.PlaybackError) {
    await requestPlaybackRecovery(
      event,
      BACKGROUND_RECOVERY_REQUEST_TIMEOUT_MS,
      BACKGROUND_RECOVERY_BUDGET_MS,
    );
  }
}

/** Install one-time foreground listeners for play recording, radio, and resilient recovery. */
export function installPlaybackListeners(): void {
  if (listenersInstalled) return;
  TrackPlayer.addEventListener(Event.MediaItemTransition, (event) => {
    void handleMediaItemTransition(event);
  });
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, notePlaybackProgress);
  TrackPlayer.addEventListener(Event.PlaybackError, (error) => {
    void requestPlaybackRecovery(
      error,
      FOREGROUND_RECOVERY_REQUEST_TIMEOUT_MS,
      FOREGROUND_RECOVERY_BUDGET_MS,
    );
  });
  listenersInstalled = true;
}

async function maybeExtendRadio(activeIndex: number, requestTimeoutMs?: number): Promise<void> {
  if (extending) return;
  const generation = queueGeneration;
  const queue = TrackPlayer.getQueue();
  const active = queue[activeIndex];
  if (!mediaItemIsRadio(active) || queue.length - activeIndex > 2) return;
  const seed = mediaItemToTrack(active);
  if (seed === null) throw new Error(`Radio queue item ${activeIndex} has no Track metadata`);

  extending = true;
  try {
    const similar = await musicRepository.getRadio(seed.id, undefined, requestTimeoutMs);
    if (generation !== queueGeneration) return;

    // The active item or queue can change natively while the HTTP request is in
    // flight (including from Android Auto). Re-read the canonical queue before
    // deciding whether and what to append.
    const current = getQueueSnapshot();
    if (current.activeIndex === null) return;
    const currentActive = current.items[current.activeIndex];
    if (!mediaItemIsRadio(currentActive) || current.items.length - current.activeIndex > 2) return;
    const existing = new Set(
      current.items
        .map((item) => mediaItemToTrack(item)?.id)
        .filter((id): id is string => id !== undefined),
    );
    const fresh = uniqueTracksNotInQueue(similar, existing, 5);
    if (fresh.length > 0) {
      const sources = await mediaSources(fresh);
      if (generation !== queueGeneration) return;
      const context = queueContextOf(currentActive) ?? {
        type: 'radio' as const,
        id: seed.id,
        label: strings.queue.trackRadioContext(seed.title),
      };
      const firstOrder = nextOriginalContextOrder(current.items);
      TrackPlayer.addMediaItems(
        fresh.map((track, index) =>
          queueMediaItem(track, sources[index], {
            mediaId: nextMediaId('radio', track),
            origin: 'context',
            radio: true,
            context,
            originalContextOrder: firstOrder + index,
            stableId: contextStableId(context, firstOrder + index, track),
          }),
        ),
      );
    }
  } finally {
    extending = false;
  }
}

export function resetControllerState(): void {
  extending = false;
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
  return TrackPlayer.getQueue();
}
