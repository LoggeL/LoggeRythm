import { NativeEventEmitter, NativeModules } from 'react-native';
import {
  Event,
  PlayerCommand,
  PlaybackState,
  RepeatMode,
  requirePlayerSessionBinding,
  type BackgroundEvent,
  type BackgroundEventHandler,
  type BrowseCategory,
  type BrowseItem,
  type CommandRejectedEvent,
  type EventPayloadByEvent,
  type MediaItem,
  type MediaItemTransitionEvent,
  type PlayerConfig,
  type PlayerOperationName,
  type PlayerPort,
  type PlayerPortCommandName,
  type PlayerSessionBinding,
  type PlayerSnapshot,
  type PlayerSubscription,
  type Progress,
  type QueueMediaItem,
  type QueuePersistenceState,
  type RemoteControlConfig,
  type SleepTimerState,
} from './playerPort';
import {
  createInitialPlayerSnapshot,
  deepFreeze,
  nextSnapshot,
  parseJson,
  requireFinitePosition,
  requireMediaId,
  requireQueueIndex,
  sanitizeMediaItemForPublic,
  sanitizeMediaItemsForPublic,
  validateBrowseTree,
  validateMediaItem,
  validateMediaItems,
  validateQueuePersistenceState,
} from './playerState';

export const NATIVE_SNAPSHOT_EVENT = 'LoggeRythmPlayerSnapshot';
export const NATIVE_PLAYER_EVENT = 'LoggeRythmPlayerEvent';

export type NativePlayerCommandName =
  | 'setQueue'
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'skipToNext'
  | 'skipToPrevious'
  | 'setRepeatMode'
  | 'stop'
  | 'clearQueue'
  | 'refreshSnapshot'
  | 'setQueuePersistenceState'
  | 'setCommands'
  | 'setShuffleEnabled'
  | 'sleepAfterTime'
  | 'sleepAfterMediaItemAtIndex'
  | 'cancelSleepTimer';

export interface NativeCommandTranslation {
  nativeName: NativePlayerCommandName;
  support: 'vertical-slice';
}

/** One reviewable map keeps native growth independent from consumer imports. */
export const NATIVE_COMMAND_TRANSLATION = deepFreeze({
  play: { nativeName: 'play', support: 'vertical-slice' },
  pause: { nativeName: 'pause', support: 'vertical-slice' },
  stop: { nativeName: 'stop', support: 'vertical-slice' },
  seekTo: { nativeName: 'seekTo', support: 'vertical-slice' },
  skipToNext: { nativeName: 'skipToNext', support: 'vertical-slice' },
  skipToPrevious: { nativeName: 'skipToPrevious', support: 'vertical-slice' },
  skipToIndex: { nativeName: 'setQueue', support: 'vertical-slice' },
  setMediaItem: { nativeName: 'setQueue', support: 'vertical-slice' },
  setMediaItems: { nativeName: 'setQueue', support: 'vertical-slice' },
  addMediaItem: { nativeName: 'setQueue', support: 'vertical-slice' },
  addMediaItems: { nativeName: 'setQueue', support: 'vertical-slice' },
  insertMediaItem: { nativeName: 'setQueue', support: 'vertical-slice' },
  removeMediaItem: { nativeName: 'setQueue', support: 'vertical-slice' },
  removeMediaItems: { nativeName: 'setQueue', support: 'vertical-slice' },
  replaceMediaItem: { nativeName: 'setQueue', support: 'vertical-slice' },
  moveMediaItem: { nativeName: 'setQueue', support: 'vertical-slice' },
  clear: { nativeName: 'clearQueue', support: 'vertical-slice' },
  setRepeatMode: { nativeName: 'setRepeatMode', support: 'vertical-slice' },
  setQueuePersistenceState: {
    nativeName: 'setQueuePersistenceState',
    support: 'vertical-slice',
  },
  setCommands: { nativeName: 'setCommands', support: 'vertical-slice' },
  setShuffleEnabled: { nativeName: 'setShuffleEnabled', support: 'vertical-slice' },
  sleepAfterTime: { nativeName: 'sleepAfterTime', support: 'vertical-slice' },
  sleepAfterMediaItemAtIndex: {
    nativeName: 'sleepAfterMediaItemAtIndex',
    support: 'vertical-slice',
  },
  cancelSleepTimer: { nativeName: 'cancelSleepTimer', support: 'vertical-slice' },
} satisfies Record<PlayerPortCommandName, NativeCommandTranslation>);

export interface LoggeRythmPlayerNativeModule {
  readonly LoggeRythmPlayerSnapshot?: unknown;
  getConstants?(): Readonly<Record<string, unknown>>;
  setup(optionsJson: string): Promise<unknown>;
  command(name: string, payloadJson: string): Promise<unknown>;
  setBrowseTree(treeJson: string): Promise<unknown>;
  clearPersistedState(): Promise<unknown>;
  clearCache(): Promise<unknown>;
  claimPlaybackEvents(maxEvents: number, leaseMs: number): Promise<string>;
  ackPlaybackEvent(leaseId: string, eventId: string): Promise<unknown>;
  retryPlaybackEvent(
    leaseId: string,
    eventId: string,
    notBeforeEpochMs: number,
  ): Promise<unknown>;
  completeRadioPlaybackEvent(
    leaseId: string,
    eventId: string,
    payloadJson: string,
  ): Promise<unknown>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export type PlaybackEventJournalNativePort = Pick<
  LoggeRythmPlayerNativeModule,
  | 'claimPlaybackEvents'
  | 'ackPlaybackEvent'
  | 'retryPlaybackEvent'
  | 'completeRadioPlaybackEvent'
>;

export interface NativeEventSubscription {
  remove(): void;
}

export interface NativePlayerEventEmitter {
  addListener(eventName: string, listener: (payload: unknown) => void): NativeEventSubscription;
}

export interface NativePlayerPortDependencies {
  nativeModule: LoggeRythmPlayerNativeModule;
  emitter: NativePlayerEventEmitter;
  now?: () => number;
}

interface PendingCommand {
  sequence: number;
  logicalName: PlayerPortCommandName;
  reducer: (snapshot: Readonly<PlayerSnapshot>) => Readonly<PlayerSnapshot>;
  expectedQueueIds?: readonly string[];
  payload: Readonly<Record<string, unknown>>;
  resumeAfterQueueSet: boolean;
  conflicted: boolean;
  sourceUpdates: ReadonlyMap<string, QueueMediaItem>;
}

interface NativeQueueItemV1 {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  extras: Record<string, unknown>;
}

export interface NativeSnapshotV1 {
  schemaVersion: 1;
  playbackState: 'idle' | 'buffering' | 'ready' | 'ended';
  playWhenReady: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number | null;
  bufferedPositionMs: number;
  currentIndex: number | null;
  currentItemId: string | null;
  repeatMode: 'off' | 'one' | 'all';
  queuePersistence: {
    contextShuffleEnabled: boolean;
    contextShuffleRestoreOrder: string[];
  };
  shuffleEnabled: boolean;
  sleepTimer:
    | null
    | { type: 'time'; remainingMs: number; fadeOutMs: number }
    | { type: 'mediaItem'; index: number };
  queue: NativeQueueItemV1[];
  errorCode: string | null;
}

export interface NativeQueueWireItem {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationMs?: number;
  headers?: { Cookie: string };
  extras?: Readonly<Record<string, unknown>>;
}

export interface NativeBrowseNodeV1 {
  id: string;
  title: string;
  subtitle?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationMs?: number;
  playable: boolean;
  url?: string;
  headers?: { Cookie: string };
  children?: readonly NativeBrowseNodeV1[];
}

export interface NativeBrowseTreeV1 {
  root: NativeBrowseNodeV1;
}

interface NativePlayerEventV1 {
  schemaVersion: 1;
  type: 'error' | 'media-item-transition';
  code?: 'player-error';
  itemId?: string | null;
  reason?: 'auto' | 'seek' | 'repeat' | 'playlist-changed' | 'unknown';
}

class ReconciliationConflictError extends Error {}

export class PlayerNativeCommandError extends Error {
  constructor(
    readonly operation: PlayerOperationName,
    readonly code: CommandRejectedEvent['code'],
  ) {
    super('Player command could not be applied');
    this.name = 'PlayerNativeCommandError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameSessionBinding(
  left: Readonly<PlayerSessionBinding>,
  right: Readonly<PlayerSessionBinding>,
): boolean {
  return left.accountScope === right.accountScope && left.origin === right.origin;
}

function exactInteger(value: unknown, label: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function exactSafeInteger(value: unknown, label: string): number {
  const exact = exactInteger(value, label) as number;
  if (!Number.isSafeInteger(exact)) throw new TypeError(`${label} must be a safe integer`);
  return exact;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const exact = [...expected].sort();
  if (!sameStrings(actual, exact)) throw new TypeError(`${label} has invalid fields`);
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string or null`);
  return value;
}

function copyMediaItem(item: MediaItem): QueueMediaItem {
  validateMediaItem(item);
  return JSON.parse(JSON.stringify(item)) as QueueMediaItem;
}

function queueIds(snapshot: Readonly<PlayerSnapshot>): string[] {
  return snapshot.queue.map((item) => item.mediaId);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snapshotsSemanticallyEqual(
  left: Readonly<PlayerSnapshot>,
  right: Readonly<PlayerSnapshot>,
): boolean {
  const { revision: _leftRevision, ...leftState } = left;
  const { revision: _rightRevision, ...rightState } = right;
  return JSON.stringify(leftState) === JSON.stringify(rightState);
}

function secondsToMilliseconds(value: number, label: string): number {
  const seconds = requireFinitePosition(value, label);
  const milliseconds = Math.round(seconds * 1_000);
  if (!Number.isSafeInteger(milliseconds)) throw new RangeError(`${label} is too large`);
  return milliseconds;
}

function millisecondsToSeconds(value: number): number {
  return value / 1_000;
}

function hasIsoControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function decodeNativeQueuePersistence(
  value: unknown,
  queueLength: number,
): Readonly<QueuePersistenceState> {
  if (!isRecord(value)) throw new TypeError('Native queue persistence is invalid');
  requireExactKeys(
    value,
    ['contextShuffleEnabled', 'contextShuffleRestoreOrder'],
    'Native queue persistence',
  );
  if (typeof value.contextShuffleEnabled !== 'boolean') {
    throw new TypeError('Native queue persistence is invalid');
  }
  if (
    !Array.isArray(value.contextShuffleRestoreOrder)
    || value.contextShuffleRestoreOrder.length > 2_000
    || value.contextShuffleRestoreOrder.length > queueLength
  ) {
    throw new TypeError('Native queue persistence restore order is invalid');
  }
  const seen = new Set<string>();
  const restoreOrder = value.contextShuffleRestoreOrder.map((id) => {
    if (
      typeof id !== 'string'
      || id.trim().length === 0
      || id.length > 512
      || hasIsoControl(id)
      || seen.has(id)
    ) {
      throw new TypeError('Native queue persistence restore order is invalid');
    }
    seen.add(id);
    return id;
  });
  if (!value.contextShuffleEnabled && restoreOrder.length > 0) {
    throw new TypeError('Native queue persistence restore order is invalid');
  }
  return deepFreeze({
    contextShuffleEnabled: value.contextShuffleEnabled,
    contextShuffleRestoreOrder: restoreOrder,
  });
}

function decodeNativeSleepTimer(value: unknown, queueLength: number): SleepTimerState {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new TypeError('Native sleep timer is invalid');
  }
  if (value.type === 'time') {
    requireExactKeys(value, ['type', 'remainingMs', 'fadeOutMs'], 'Native sleep timer');
    const remainingMs = exactSafeInteger(value.remainingMs, 'Native sleep remainingMs');
    const fadeOutMs = exactSafeInteger(value.fadeOutMs, 'Native sleep fadeOutMs');
    if (fadeOutMs > 86_400_000) throw new TypeError('Native sleep timer is invalid');
    return deepFreeze({
      type: 'time',
      remainingSeconds: millisecondsToSeconds(remainingMs),
      fadeOutSeconds: millisecondsToSeconds(fadeOutMs),
    });
  }
  if (value.type === 'mediaItem') {
    requireExactKeys(value, ['type', 'index'], 'Native sleep timer');
    const index = exactSafeInteger(value.index, 'Native sleep item index');
    requireQueueIndex(index, queueLength, 'Native sleep item');
    return deepFreeze({ type: 'mediaItem', index });
  }
  throw new TypeError('Native sleep timer is invalid');
}

function unavailableSourceUrl(mediaId: string): string {
  return `file:///__loggerythm_source_unavailable__/${encodeURIComponent(mediaId)}`;
}

function isUnavailableSourcePlaceholder(item: QueueMediaItem): boolean {
  const uri = typeof item.url === 'string'
    ? item.url
    : typeof item.url === 'object' && item.url !== null && typeof item.url.uri === 'string'
      ? item.url.uri
      : null;
  return uri === unavailableSourceUrl(item.mediaId);
}

function sourceUrl(item: MediaItem): { url: string; headers?: { Cookie: string } } {
  const source = item.url;
  if (typeof source === 'number') throw new TypeError('Playback assets are not native queue URLs');
  if (typeof source === 'string') return { url: source };
  if (typeof source.uri !== 'string') throw new TypeError('Playback asset URI is not supported');
  if (source.headers === undefined) return { url: source.uri };
  const names = Object.keys(source.headers);
  const cookie = source.headers.Cookie;
  if (
    names.length !== 1
    || names[0] !== 'Cookie'
    || typeof cookie !== 'string'
    || cookie.length < 1
    || cookie.length > 4_096
    || /[\r\n]/.test(cookie)
  ) {
    throw new TypeError('Playback headers may contain only one safe Cookie value');
  }
  if (source.uri.startsWith('file:')) {
    throw new TypeError('Local file playback must not carry Cookie headers');
  }
  return { url: source.uri, headers: { Cookie: cookie } };
}

function artworkUrl(item: MediaItem): string | undefined {
  const artwork = item.artworkUrl;
  if (typeof artwork === 'string') return artwork;
  if (typeof artwork === 'object' && artwork !== null && typeof artwork.uri === 'string') {
    return artwork.uri;
  }
  return undefined;
}

export function mapMediaItemToNativeQueueItem(item: MediaItem): NativeQueueWireItem {
  validateMediaItem(item);
  const source = sourceUrl(item);
  const publicItem = sanitizeMediaItemForPublic(item);
  const artwork = artworkUrl(item);
  return {
    id: item.mediaId,
    url: source.url,
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.artist === undefined ? {} : { artist: item.artist }),
    ...(item.albumTitle === undefined ? {} : { album: item.albumTitle }),
    ...(artwork === undefined ? {} : { artworkUrl: artwork }),
    ...(item.duration === undefined
      ? {}
      : { durationMs: secondsToMilliseconds(item.duration, 'media duration') }),
    ...(source.headers === undefined ? {} : { headers: source.headers }),
    ...(publicItem.extras === undefined ? {} : { extras: publicItem.extras }),
  };
}

/** Exact public Media3 browse schema. App-private extras never enter this tree. */
export function mapBrowseTreeToNative(
  categories: readonly BrowseCategory[],
): NativeBrowseTreeV1 {
  validateBrowseTree(categories);
  if (categories.some((category) => category.mediaId === 'loggerythm:root')) {
    throw new Error('Browse tree collides with the synthetic root ID');
  }
  let nodeCount = 1;
  const mapItem = (item: BrowseItem, depth: number): NativeBrowseNodeV1 => {
    if (item.mediaId === 'loggerythm:root') {
      throw new Error('Browse tree collides with the synthetic root ID');
    }
    if (depth > 8) throw new RangeError('Browse tree exceeds native depth 8');
    nodeCount += 1;
    if (nodeCount > 5_000) throw new RangeError('Browse tree exceeds 5000 nodes');
    if ((item.children?.length ?? 0) > 1_000) {
      throw new RangeError('Browse node exceeds 1000 children');
    }
    if (item.url !== undefined && (item.children?.length ?? 0) > 0) {
      throw new Error(`Playable browse item ${item.mediaId} cannot have children`);
    }
    const artwork = artworkUrl({
      mediaId: item.mediaId,
      url: item.url ?? 'https://redacted.invalid/container',
      artworkUrl: item.artworkUrl,
    });
    if (item.url !== undefined) {
      const source = sourceUrl({ mediaId: item.mediaId, url: item.url });
      return {
        id: item.mediaId,
        title: item.title,
        ...(item.artist === undefined ? {} : { artist: item.artist }),
        ...(artwork === undefined ? {} : { artworkUrl: artwork }),
        ...(item.duration === undefined
          ? {}
          : { durationMs: secondsToMilliseconds(item.duration, 'browse duration') }),
        playable: true,
        url: source.url,
        ...(source.headers === undefined ? {} : { headers: source.headers }),
      };
    }
    return {
      id: item.mediaId,
      title: item.title,
      ...(item.artist === undefined ? {} : { subtitle: item.artist }),
      ...(artwork === undefined ? {} : { artworkUrl: artwork }),
      playable: false,
      children: item.children?.map((child) => mapItem(child, depth + 1)) ?? [],
    };
  };
  if (categories.length > 1_000) throw new RangeError('Browse root exceeds 1000 children');
  return {
    root: {
      id: 'loggerythm:root',
      title: 'LoggeRythm',
      playable: false,
      children: categories.map((category) => {
        nodeCount += 1;
        if (nodeCount > 5_000) throw new RangeError('Browse tree exceeds 5000 nodes');
        if (category.items.length > 1_000) {
          throw new RangeError('Browse category exceeds 1000 children');
        }
        return {
          id: category.mediaId,
          title: category.title,
          playable: false,
          children: category.items.map((item) => mapItem(item, 2)),
        };
      }),
    },
  };
}

function safeJson(value: unknown): string {
  return JSON.stringify(value);
}

function requireNativeRemoteControlConfig(
  value: RemoteControlConfig,
): Readonly<{ capabilities: readonly PlayerCommand[]; handling: 'native' }> {
  if (!isRecord(value)) throw new TypeError('Remote control configuration is invalid');
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'capabilities' && key !== 'handling')) {
    throw new TypeError('Remote control configuration contains unsupported fields');
  }
  if (value.handling !== undefined && value.handling !== 'native') {
    throw new TypeError('Remote command handling must be native');
  }
  if (!Array.isArray(value.capabilities)) {
    throw new TypeError('Remote capabilities must be an array');
  }
  const supported = new Set<string>(Object.values(PlayerCommand));
  const seen = new Set<PlayerCommand>();
  const capabilities = value.capabilities.map((capability) => {
    if (typeof capability !== 'string' || !supported.has(capability)) {
      throw new TypeError('Remote capability is invalid');
    }
    const exact = capability as PlayerCommand;
    if (seen.has(exact)) throw new TypeError('Remote capabilities must be unique');
    seen.add(exact);
    return exact;
  });
  return deepFreeze({ capabilities, handling: 'native' as const });
}

export class NativeBackedPlayerPort implements PlayerPort {
  private authoritative: Readonly<PlayerSnapshot> = createInitialPlayerSnapshot();
  private visible: Readonly<PlayerSnapshot> = this.authoritative;
  private readonly snapshotListeners = new Set<() => void>();
  private readonly eventListeners = new Map<Event, Set<(payload: unknown) => void>>();
  private readonly sourceVault = new Map<string, QueueMediaItem>();
  private readonly browseSourceVault = new Map<string, QueueMediaItem>();
  private readonly unavailableSourceIds = new Set<string>();
  private readonly pending: PendingCommand[] = [];
  private readonly nativeSubscriptions: NativeEventSubscription[] = [];
  private backgroundFactory: (() => BackgroundEventHandler) | null = null;
  private tail: Promise<void> = Promise.resolve();
  private sequence = 0;
  private readonly failures: PlayerNativeCommandError[] = [];
  private sessionBinding: Readonly<PlayerSessionBinding> | null = null;
  private disposed = false;
  private readonly now: () => number;

  constructor(private readonly dependencies: NativePlayerPortDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.nativeSubscriptions.push(
      dependencies.emitter.addListener(NATIVE_SNAPSHOT_EVENT, (payload) => {
        this.handleNativeSnapshot(payload);
      }),
      dependencies.emitter.addListener(NATIVE_PLAYER_EVENT, (payload) => {
        this.handleNativeEvent(payload);
      }),
    );

    const constants = dependencies.nativeModule.getConstants?.();
    const initial = constants?.LoggeRythmPlayerSnapshot
      ?? dependencies.nativeModule.LoggeRythmPlayerSnapshot;
    if (initial !== undefined && initial !== NATIVE_SNAPSHOT_EVENT) {
      this.handleNativeSnapshot(initial);
    }
  }

  setupPlayer(options: PlayerConfig): Promise<void> {
    const binding = requirePlayerSessionBinding(
      isRecord(options) ? options.sessionBinding : undefined,
    );
    if (this.sessionBinding !== null && !sameSessionBinding(this.sessionBinding, binding)) {
      throw new PlayerNativeCommandError('setupPlayer', 'reconciliation-conflict');
    }
    // Reserve the identity before the awaitable is queued. Concurrent setup calls
    // can share this exact binding, while a different account fails closed even if
    // the first native connection has not settled yet. Only atomic cleanup releases it.
    this.sessionBinding = binding;
    return this.scheduleAwaitable(
      'setupPlayer',
      () => this.dependencies.nativeModule.setup(safeJson(binding)),
      (result) => {
        const reconciled = this.snapshotFromResult(result, this.authoritative);
        this.authoritative = nextSnapshot(reconciled ?? this.authoritative, { isSetup: true });
        this.recomputeVisible();
      },
    );
  }

  registerBackgroundEventHandler(factory: () => BackgroundEventHandler): void {
    this.assertUsable();
    this.backgroundFactory = factory;
  }

  addEventListener<T extends Event>(
    event: T,
    listener: (payload: EventPayloadByEvent[T]) => void,
  ): PlayerSubscription {
    this.assertUsable();
    const listeners = this.eventListeners.get(event) ?? new Set<(payload: unknown) => void>();
    listeners.add(listener as (payload: unknown) => void);
    this.eventListeners.set(event, listeners);
    return {
      remove: () => {
        listeners.delete(listener as (payload: unknown) => void);
      },
    };
  }

  subscribe(listener: () => void): () => void {
    this.assertUsable();
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  getSnapshot(): Readonly<PlayerSnapshot> {
    return this.visible;
  }

  play(): void {
    this.enqueue('play', (snapshot) => nextSnapshot(snapshot, {
      isPlaying: snapshot.queue.length > 0,
      playbackState: snapshot.queue.length > 0 ? PlaybackState.Ready : snapshot.playbackState,
    }), {});
  }

  pause(): void {
    this.enqueue('pause', (snapshot) => nextSnapshot(snapshot, { isPlaying: false }), {});
  }

  stop(): void {
    this.enqueue('stop', (snapshot) => nextSnapshot(snapshot, {
      isPlaying: false,
      playbackState: snapshot.queue.length === 0 ? PlaybackState.Idle : PlaybackState.Ready,
      progress: { ...snapshot.progress, position: 0 },
    }), {});
  }

  seekTo(position: number): void {
    const exact = requireFinitePosition(position);
    this.enqueue('seekTo', (snapshot) => nextSnapshot(snapshot, {
      progress: { ...snapshot.progress, position: exact },
    }), { positionMs: secondsToMilliseconds(exact, 'seek position') });
  }

  skipToNext(): void {
    const before = this.visible;
    const current = before.activeIndex;
    const nextIndex = current === null
      ? null
      : current + 1 < before.queue.length
        ? current + 1
        : before.repeatMode === RepeatMode.All && before.queue.length > 0
          ? 0
          : current;
    this.enqueue('skipToNext', (snapshot) => nextSnapshot(snapshot, {
      activeIndex: nextIndex,
      isPlaying: nextIndex === current && current === before.queue.length - 1
        && before.repeatMode !== RepeatMode.All
        ? false
        : snapshot.isPlaying,
      playbackState: nextIndex === current && current === before.queue.length - 1
        && before.repeatMode !== RepeatMode.All
        ? PlaybackState.Ended
        : snapshot.playbackState,
      progress: { position: 0, duration: 0, buffered: 0, cached: 0 },
    }), {});
  }

  skipToPrevious(): void {
    const before = this.visible;
    const current = before.activeIndex;
    const previousIndex = current === null
      ? null
      : current > 0
        ? current - 1
        : before.repeatMode === RepeatMode.All && before.queue.length > 0
          ? before.queue.length - 1
          : 0;
    this.enqueue('skipToPrevious', (snapshot) => nextSnapshot(snapshot, {
      activeIndex: previousIndex,
      progress: { position: 0, duration: 0, buffered: 0, cached: 0 },
    }), {});
  }

  skipToIndex(index: number): void {
    requireQueueIndex(index, this.visible.queue.length, 'Skip');
    const target = this.visible.queue as readonly MediaItem[];
    this.enqueueQueue('skipToIndex', target, index, 0, this.visible.isPlaying);
  }

  setMediaItem(mediaItem: MediaItem): void {
    this.setMediaItems([mediaItem], 0, 'setMediaItem');
  }

  setMediaItems(
    mediaItems: readonly MediaItem[],
    startIndex = 0,
    logicalName: 'setMediaItems' | 'setMediaItem' = 'setMediaItems',
  ): void {
    validateMediaItems(mediaItems);
    if (mediaItems.length === 0) {
      if (startIndex !== 0) throw new RangeError('Empty queue startIndex must be 0');
      this.clear();
      return;
    }
    requireQueueIndex(startIndex, mediaItems.length, 'Queue start');
    this.enqueueQueue(logicalName, mediaItems, startIndex, 0, false, mediaItems);
  }

  addMediaItem(mediaItem: MediaItem): void {
    this.addMediaItems([mediaItem], 'addMediaItem');
  }

  addMediaItems(
    mediaItems: readonly MediaItem[],
    logicalName: 'addMediaItems' | 'addMediaItem' = 'addMediaItems',
  ): void {
    validateMediaItems(mediaItems);
    if (mediaItems.length === 0) return;
    const target = [...this.visible.queue, ...mediaItems];
    validateMediaItems(target as MediaItem[]);
    const activeIndex = this.visible.activeIndex ?? 0;
    this.enqueueQueue(
      logicalName,
      target as MediaItem[],
      activeIndex,
      this.visible.progress.position,
      this.visible.isPlaying,
      mediaItems,
    );
  }

  insertMediaItem(index: number, mediaItem: MediaItem): void {
    validateMediaItem(mediaItem);
    requireQueueIndex(index, this.visible.queue.length, 'Insert', true);
    const target = [...this.visible.queue];
    target.splice(index, 0, sanitizeMediaItemForPublic(mediaItem));
    validateMediaItems(target as MediaItem[]);
    const activeIndex = this.visible.activeIndex === null
      ? 0
      : index <= this.visible.activeIndex
        ? this.visible.activeIndex + 1
        : this.visible.activeIndex;
    this.enqueueQueue(
      'insertMediaItem',
      target as MediaItem[],
      activeIndex,
      this.visible.progress.position,
      this.visible.isPlaying,
      [mediaItem],
    );
  }

  removeMediaItem(index: number): void {
    requireQueueIndex(index, this.visible.queue.length, 'Remove');
    this.removeMediaItems(index, index + 1, 'removeMediaItem');
  }

  removeMediaItems(
    fromIndex: number,
    toIndex: number,
    logicalName: 'removeMediaItems' | 'removeMediaItem' = 'removeMediaItems',
  ): void {
    requireQueueIndex(fromIndex, this.visible.queue.length, 'Remove start');
    if (!Number.isInteger(toIndex) || toIndex <= fromIndex || toIndex > this.visible.queue.length) {
      throw new RangeError('Remove end must be after start and inside the queue');
    }
    const oldActiveId = this.visible.activeIndex === null
      ? null
      : this.visible.queue[this.visible.activeIndex].mediaId;
    const target = this.visible.queue.filter((_item, index) => index < fromIndex || index >= toIndex);
    if (target.length === 0) {
      this.enqueue(logicalName, (snapshot) => nextSnapshot(snapshot, {
        queue: [],
        activeIndex: null,
        isPlaying: false,
        playbackState: PlaybackState.Idle,
        progress: { position: 0, duration: 0, buffered: 0, cached: 0 },
      }), {
        items: [],
        startIndex: 0,
        startPositionMs: 0,
      }, queueIds(this.visible));
      return;
    }
    const retainedActiveIndex = oldActiveId === null
      ? 0
      : target.findIndex((item) => item.mediaId === oldActiveId);
    const activeIndex = retainedActiveIndex >= 0
      ? retainedActiveIndex
      : Math.min(fromIndex, target.length - 1);
    this.enqueueQueue(
      logicalName,
      target as MediaItem[],
      activeIndex,
      retainedActiveIndex >= 0 ? this.visible.progress.position : 0,
      this.visible.isPlaying,
    );
  }

  replaceMediaItem(index: number, mediaItem: MediaItem): void {
    validateMediaItem(mediaItem);
    requireQueueIndex(index, this.visible.queue.length, 'Replace');
    const target = [...this.visible.queue];
    target[index] = sanitizeMediaItemForPublic(mediaItem);
    validateMediaItems(target as MediaItem[]);
    this.enqueueQueue(
      'replaceMediaItem',
      target as MediaItem[],
      this.visible.activeIndex ?? 0,
      index === this.visible.activeIndex ? 0 : this.visible.progress.position,
      this.visible.isPlaying,
      [mediaItem],
    );
  }

  moveMediaItem(fromIndex: number, toIndex: number): void {
    requireQueueIndex(fromIndex, this.visible.queue.length, 'Move source');
    requireQueueIndex(toIndex, this.visible.queue.length, 'Move target');
    const target = [...this.visible.queue];
    const [moved] = target.splice(fromIndex, 1);
    target.splice(toIndex, 0, moved);
    const activeId = this.visible.activeIndex === null
      ? null
      : this.visible.queue[this.visible.activeIndex].mediaId;
    const activeIndex = activeId === null ? 0 : target.findIndex((item) => item.mediaId === activeId);
    this.enqueueQueue(
      'moveMediaItem',
      target as MediaItem[],
      activeIndex,
      this.visible.progress.position,
      this.visible.isPlaying,
    );
  }

  clear(): void {
    this.enqueue('clear', (snapshot) => nextSnapshot(snapshot, {
      queue: [],
      activeIndex: null,
      isPlaying: false,
      playbackState: PlaybackState.Idle,
      progress: { position: 0, duration: 0, buffered: 0, cached: 0 },
    }), {}, queueIds(this.visible));
  }

  getPlaybackState(): PlaybackState {
    return this.visible.playbackState;
  }

  isPlaying(): boolean {
    return this.visible.isPlaying;
  }

  getProgress(): Progress {
    return { ...this.visible.progress };
  }

  getActiveMediaItem(): MediaItem | null {
    return this.visible.activeIndex === null
      ? null
      : this.visible.queue[this.visible.activeIndex] as MediaItem;
  }

  getActiveMediaItemIndex(): number | null {
    return this.visible.activeIndex;
  }

  getQueue(): MediaItem[] {
    return [...this.visible.queue] as MediaItem[];
  }

  getQueuePersistenceState(): Readonly<QueuePersistenceState> {
    return this.visible.queuePersistence;
  }

  getRepeatMode(): RepeatMode {
    return this.visible.repeatMode;
  }

  isShuffleEnabled(): boolean {
    return this.visible.shuffleEnabled;
  }

  getSleepTimer(): SleepTimerState {
    return this.visible.sleepTimer;
  }

  setQueuePersistenceState(state: QueuePersistenceState): void {
    const safe = validateQueuePersistenceState(state);
    this.enqueue('setQueuePersistenceState', (snapshot) => nextSnapshot(snapshot, {
      queuePersistence: safe,
    }), {
      contextShuffleEnabled: safe.contextShuffleEnabled,
      contextShuffleRestoreOrder: safe.contextShuffleRestoreOrder,
    });
  }

  setCommands(commands: RemoteControlConfig): Promise<void> {
    const safe = requireNativeRemoteControlConfig(commands);
    const translation = NATIVE_COMMAND_TRANSLATION.setCommands;
    return this.scheduleAwaitable(
      'setCommands',
      () => this.dependencies.nativeModule.command(
        translation.nativeName,
        safeJson(safe),
      ),
      (result) => {
        const fromNative = this.snapshotFromResult(result, this.authoritative);
        if (fromNative !== null) this.authoritative = fromNative;
        this.recomputeVisible();
      },
      false,
    );
  }

  setRepeatMode(mode: RepeatMode): void {
    if (!Object.values(RepeatMode).includes(mode)) throw new TypeError('Repeat mode is invalid');
    this.enqueue('setRepeatMode', (snapshot) => nextSnapshot(snapshot, { repeatMode: mode }), {
      mode,
    });
  }

  setShuffleEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('Shuffle state must be boolean');
    if (enabled) throw new RangeError('Native global shuffle cannot be enabled');
    this.enqueue('setShuffleEnabled', (snapshot) => nextSnapshot(snapshot, {
      shuffleEnabled: false,
    }), { enabled: false });
  }

  setBrowseTree(categories: readonly BrowseCategory[]): void {
    validateBrowseTree(categories);
    this.rememberBrowseSources(categories);
    const nativeTree = mapBrowseTreeToNative(categories);
    this.scheduleFireAndForget(
      'setBrowseTree',
      () => this.dependencies.nativeModule.setBrowseTree(safeJson(nativeTree)),
    );
  }

  sleepAfterTime(seconds: number, options?: { fadeOutSeconds?: number }): void {
    const exact = requireFinitePosition(seconds, 'Sleep timer seconds');
    if (exact <= 0) throw new RangeError('Sleep timer seconds must be positive');
    const fadeOutSeconds = options?.fadeOutSeconds ?? 0;
    requireFinitePosition(fadeOutSeconds, 'Sleep timer fade');
    if (fadeOutSeconds > exact) throw new RangeError('Sleep timer fade exceeds timer');
    this.enqueue('sleepAfterTime', (snapshot) => nextSnapshot(snapshot, {
      sleepTimer: { type: 'time', remainingSeconds: exact, fadeOutSeconds },
    }), { seconds: exact, fadeOutSeconds });
  }

  sleepAfterMediaItemAtIndex(index = this.visible.activeIndex ?? 0): void {
    requireQueueIndex(index, this.visible.queue.length, 'Sleep timer');
    this.enqueue('sleepAfterMediaItemAtIndex', (snapshot) => nextSnapshot(snapshot, {
      sleepTimer: { type: 'mediaItem', index },
    }), { index });
  }

  cancelSleepTimer(): void {
    this.enqueue('cancelSleepTimer', (snapshot) => nextSnapshot(snapshot, {
      sleepTimer: null,
    }), {});
  }

  clearPersistedQueue(): Promise<void> {
    return this.scheduleAwaitable(
      'clearPersistedQueue',
      () => this.dependencies.nativeModule.clearPersistedState(),
      (result) => {
        this.sourceVault.clear();
        this.browseSourceVault.clear();
        this.unavailableSourceIds.clear();
        const fromNative = this.snapshotFromResult(result, this.authoritative);
        const cleaned = fromNative ?? nextSnapshot(this.authoritative, {
          queue: [],
          activeIndex: null,
          playbackState: PlaybackState.Idle,
          isPlaying: false,
          progress: { position: 0, duration: 0, buffered: 0, cached: 0 },
          sleepTimer: null,
          queuePersistence: {
            contextShuffleEnabled: false,
            contextShuffleRestoreOrder: [],
          },
        });
        if (cleaned.queue.length !== 0 || cleaned.activeIndex !== null || cleaned.isPlaying) {
          throw new TypeError('Native player cleanup result is invalid');
        }
        this.authoritative = nextSnapshot(cleaned, { isSetup: false });
        this.sessionBinding = null;
        this.recomputeVisible();
      },
    );
  }

  clearCache(): Promise<void> {
    return this.scheduleAwaitable(
      'clearCache',
      () => this.dependencies.nativeModule.clearCache(),
      () => undefined,
    );
  }

  async flush(): Promise<void> {
    const barrier = this.tail;
    await barrier;
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.nativeSubscriptions.splice(0).forEach((subscription) => subscription.remove());
    this.snapshotListeners.clear();
    this.eventListeners.clear();
    this.sourceVault.clear();
    this.browseSourceVault.clear();
    this.unavailableSourceIds.clear();
    this.backgroundFactory = null;
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('PlayerPort has been disposed');
  }

  private sourceById(mediaId: string): QueueMediaItem | null {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const pendingSource = this.pending[index].sourceUpdates.get(mediaId);
      if (pendingSource !== undefined) return pendingSource;
    }
    return this.sourceVault.get(mediaId)
      ?? this.browseSourceVault.get(mediaId)
      ?? null;
  }

  private sourceFor(item: Readonly<QueueMediaItem>): QueueMediaItem | null {
    return this.sourceById(item.mediaId);
  }

  private rememberBrowseSources(categories: readonly BrowseCategory[]): void {
    this.browseSourceVault.clear();
    const visit = (item: BrowseItem): void => {
      if (item.url !== undefined) {
        this.browseSourceVault.set(item.mediaId, copyMediaItem({
          mediaId: item.mediaId,
          url: item.url,
          title: item.title,
          artist: item.artist,
          artworkUrl: item.artworkUrl,
          duration: item.duration,
          isLive: item.isLive,
          mimeType: item.mimeType,
          extras: item.extras,
        }));
      }
      item.children?.forEach(visit);
    };
    categories.forEach((category) => category.items.forEach(visit));
  }

  private enqueueQueue(
    logicalName: PendingCommand['logicalName'],
    targetItems: readonly MediaItem[],
    activeIndex: number,
    startPosition: number,
    resumeAfterQueueSet: boolean,
    sourceUpdates: readonly MediaItem[] = [],
  ): void {
    validateMediaItems(targetItems);
    validateMediaItems(sourceUpdates, 'queue source updates');
    if (targetItems.length === 0) throw new Error('Use clear for an empty native queue');
    requireQueueIndex(activeIndex, targetItems.length, 'Queue start');
    const expected = queueIds(this.visible);
    const safeItems = sanitizeMediaItemsForPublic(targetItems);
    const updates = new Map(
      sourceUpdates
        .filter((item) => !isUnavailableSourcePlaceholder(item))
        .map((item) => [item.mediaId, copyMediaItem(item)] as const),
    );
    const rawItems: QueueMediaItem[] = [];
    for (const item of safeItems) {
      const source = updates.get(item.mediaId) ?? this.sourceFor(item);
      if (source === null) {
        this.enqueueSourceUnavailable(logicalName);
        return;
      }
      rawItems.push(source);
    }
    const payload = {
      items: rawItems.map(mapMediaItemToNativeQueueItem),
      startIndex: activeIndex,
      startPositionMs: secondsToMilliseconds(startPosition, 'queue start position'),
    };
    this.enqueue(
      logicalName,
      (snapshot) => nextSnapshot(snapshot, {
        queue: safeItems,
        activeIndex,
        playbackState: PlaybackState.Ready,
        progress: {
          position: startPosition,
          duration: activeIndex === snapshot.activeIndex ? snapshot.progress.duration : 0,
          buffered: activeIndex === snapshot.activeIndex ? snapshot.progress.buffered : 0,
          cached: activeIndex === snapshot.activeIndex ? snapshot.progress.cached : 0,
        },
      }),
      payload,
      expected,
      resumeAfterQueueSet,
      updates,
    );
  }

  private enqueue(
    logicalName: PlayerPortCommandName,
    reducer: PendingCommand['reducer'],
    payload: Readonly<Record<string, unknown>>,
    expectedQueueIds?: readonly string[],
    resumeAfterQueueSet = false,
    sourceUpdates: ReadonlyMap<string, QueueMediaItem> = new Map(),
  ): void {
    this.assertUsable();
    const entry: PendingCommand = {
      sequence: ++this.sequence,
      logicalName,
      reducer,
      expectedQueueIds,
      payload,
      resumeAfterQueueSet,
      conflicted: false,
      sourceUpdates,
    };
    const optimistic = reducer(this.visible);
    this.pending.push(entry);
    this.publish(optimistic);
    this.tail = this.tail.then(async () => {
      const translation = NATIVE_COMMAND_TRANSLATION[logicalName];
      let result: unknown;
      try {
        if (entry.conflicted) throw new ReconciliationConflictError();
        result = await this.dependencies.nativeModule.command(
          translation.nativeName,
          safeJson(entry.payload),
        );
      } catch (error) {
        const code: CommandRejectedEvent['code'] = error instanceof ReconciliationConflictError
          ? 'reconciliation-conflict'
          : 'native-rejected';
        this.rejectCommand(entry, code);
        return;
      }

      if (translation.nativeName === 'setQueue' && entry.resumeAfterQueueSet) {
        try {
          const playResult = await this.dependencies.nativeModule.command('play', '{}');
          this.settleCommand(entry, playResult);
          return;
        } catch {
          // The queue command already succeeded. Keep that exact queue, reconcile
          // its snapshot, and report only the failed resume instead of rolling the
          // native mutation back in JS.
          this.settleCommand(entry, result);
          this.authoritative = nextSnapshot(this.authoritative, { isPlaying: false });
          this.recordFailure(entry.logicalName, 'native-rejected');
          this.recomputeVisible();
          return;
        }
      }
      this.settleCommand(entry, result);
    });
  }

  private enqueueSourceUnavailable(logicalName: PlayerPortCommandName): void {
    this.assertUsable();
    this.tail = this.tail.then(() => {
      this.recordFailure(logicalName, 'source-unavailable');
    });
  }

  private settleCommand(entry: PendingCommand, result: unknown): void {
    this.removePending(entry);
    entry.sourceUpdates.forEach((item, id) => {
      this.sourceVault.set(id, copyMediaItem(item));
      this.unavailableSourceIds.delete(id);
    });
    let fromNative: Readonly<PlayerSnapshot> | null;
    try {
      fromNative = this.snapshotFromResult(result, this.authoritative);
    } catch {
      // Native acknowledged the mutation, so rolling it back locally would be
      // less safe than retaining the validated optimistic state until the next
      // authoritative snapshot event.
      try {
        this.authoritative = entry.reducer(this.authoritative);
      } catch {
        // Keep the last authoritative snapshot; the reconciliation event below
        // makes the mismatch visible without exposing native payload details.
      }
      this.recordFailure(entry.logicalName, 'reconciliation-conflict');
      this.recomputeVisible();
      return;
    }
    if (fromNative !== null) {
      this.authoritative = fromNative;
    } else {
      try {
        this.authoritative = entry.reducer(this.authoritative);
      } catch {
        this.recordFailure(entry.logicalName, 'reconciliation-conflict');
      }
    }
    this.recomputeVisible();
  }

  private rejectCommand(entry: PendingCommand, code: CommandRejectedEvent['code']): void {
    this.removePending(entry);
    this.recordFailure(entry.logicalName, code);
    this.recomputeVisible();
  }

  private removePending(entry: PendingCommand): void {
    const index = this.pending.indexOf(entry);
    if (index >= 0) this.pending.splice(index, 1);
  }

  private recomputeVisible(): void {
    let candidate = this.authoritative;
    for (const entry of this.pending) {
      if (
        entry.expectedQueueIds !== undefined
        && !sameStrings(queueIds(candidate), entry.expectedQueueIds)
      ) {
        entry.conflicted = true;
        continue;
      }
      try {
        candidate = entry.reducer(candidate);
      } catch {
        entry.conflicted = true;
      }
    }
    this.publish(candidate);
  }

  private publish(candidate: Readonly<PlayerSnapshot>): void {
    const previous = this.visible;
    const next = deepFreeze({ ...candidate, revision: previous.revision + 1 });
    if (snapshotsSemanticallyEqual(previous, next)) return;
    this.visible = next;
    this.snapshotListeners.forEach((listener) => listener());

    const previousQueue = previous.queue.map((item) => item.mediaId);
    const nextQueue = this.visible.queue.map((item) => item.mediaId);
    if (!sameStrings(previousQueue, nextQueue)) this.dispatch(Event.QueueChanged, undefined);
    // Snapshot publication is presentation state, including optimistic queue state.
    // Product transition side effects run only from a confirmed native transition event.
    const nextItem = this.visible.activeIndex === null
      ? null
      : this.visible.queue[this.visible.activeIndex];
    if (previous.isPlaying !== this.visible.isPlaying) {
      this.dispatch(Event.IsPlayingChanged, { playing: this.visible.isPlaying });
    }
    if (previous.playbackState !== this.visible.playbackState) {
      this.dispatch(Event.PlaybackStateChanged, { state: this.visible.playbackState });
    }
    if (
      nextItem !== null
      && (
        previous.progress.position !== this.visible.progress.position
        || previous.progress.duration !== this.visible.progress.duration
      )
    ) {
      this.dispatch(Event.PlaybackProgressUpdated, {
        mediaId: nextItem.mediaId,
        position: this.visible.progress.position,
        duration: this.visible.progress.duration,
        timestamp: this.now(),
      });
    }
  }

  private dispatch<T extends Event>(event: T, payload: EventPayloadByEvent[T]): void {
    const safePayload = payload === undefined ? undefined : deepFreeze(payload);
    this.eventListeners.get(event)?.forEach((listener) => listener(safePayload));
  }

  private recordFailure(
    operation: PlayerOperationName,
    code: CommandRejectedEvent['code'],
    queueForFlush = true,
  ): PlayerNativeCommandError {
    const failure = new PlayerNativeCommandError(operation, code);
    if (queueForFlush) this.failures.push(failure);
    this.dispatch(Event.CommandRejected, {
      command: operation,
      code,
      message: 'Player command could not be applied',
    });
    return failure;
  }

  private scheduleAwaitable(
    operation: PlayerOperationName,
    task: () => Promise<unknown>,
    onSuccess: (result: unknown) => void,
    queueFailureForFlush = true,
  ): Promise<void> {
    this.assertUsable();
    let resolveResult!: () => void;
    let rejectResult!: (error: PlayerNativeCommandError) => void;
    const resultPromise = new Promise<void>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.tail = this.tail.then(async () => {
      try {
        const result = await task();
        onSuccess(result);
        resolveResult();
      } catch {
        const failure = this.recordFailure(
          operation,
          'native-rejected',
          queueFailureForFlush,
        );
        rejectResult(failure);
      }
    });
    return resultPromise;
  }

  private scheduleFireAndForget(
    operation: PlayerOperationName,
    task: () => Promise<unknown>,
  ): void {
    void this.scheduleAwaitable(operation, task, () => undefined).catch(() => undefined);
  }

  private snapshotFromResult(
    result: unknown,
    fallback: Readonly<PlayerSnapshot>,
  ): Readonly<PlayerSnapshot> | null {
    if (result === undefined || result === null) return null;
    const parsed = typeof result === 'string' ? parseJson(result, 'native command result') : result;
    if (!isRecord(parsed)) throw new TypeError('Native command result is invalid');
    const snapshotJson = parsed.snapshotJson;
    if (typeof snapshotJson !== 'string') return null;
    return this.decodeNativeV1(snapshotJson, fallback);
  }

  private decodeNativeV1(
    snapshotJson: string,
    fallback: Readonly<PlayerSnapshot>,
  ): Readonly<PlayerSnapshot> {
    const raw = parseJson(snapshotJson, 'native snapshot');
    if (!isRecord(raw) || raw.schemaVersion !== 1) {
      throw new TypeError('Native snapshot schema is unsupported');
    }
    const states = ['idle', 'buffering', 'ready', 'ended'] as const;
    if (!states.includes(raw.playbackState as typeof states[number])) {
      throw new TypeError('Native playback state is invalid');
    }
    if (typeof raw.playWhenReady !== 'boolean' || typeof raw.isPlaying !== 'boolean') {
      throw new TypeError('Native playback flags are invalid');
    }
    const positionMs = exactInteger(raw.positionMs, 'positionMs') as number;
    const durationMs = exactInteger(raw.durationMs, 'durationMs', true);
    const bufferedMs = exactInteger(raw.bufferedPositionMs, 'bufferedPositionMs') as number;
    if (!Array.isArray(raw.queue) || raw.queue.length > 2_000) {
      throw new TypeError('Native queue is invalid');
    }
    const seen = new Set<string>();
    const queue = raw.queue.map((entry, index): Readonly<QueueMediaItem> => {
      if (!isRecord(entry)) throw new TypeError(`Native queue item ${index} is invalid`);
      const id = requireMediaId(entry.id, `Native queue item ${index}.id`);
      if (seen.has(id)) throw new Error(`Native queue contains duplicate mediaId ${id}`);
      seen.add(id);
      const nativeItem: NativeQueueItemV1 = {
        id,
        title: nullableString(entry.title, 'Native title'),
        artist: nullableString(entry.artist, 'Native artist'),
        album: nullableString(entry.album, 'Native album'),
        artworkUrl: nullableString(entry.artworkUrl, 'Native artwork'),
        durationMs: exactInteger(entry.durationMs, 'Native duration', true),
        extras: isRecord(entry.extras) ? entry.extras : {},
      };
      const source = this.sourceById(id);
      if (source === null) this.unavailableSourceIds.add(id);
      else this.unavailableSourceIds.delete(id);
      const item: MediaItem = {
        ...(source ?? { mediaId: id, url: unavailableSourceUrl(id) }),
        mediaId: id,
        ...(nativeItem.title === null ? {} : { title: nativeItem.title }),
        ...(nativeItem.artist === null ? {} : { artist: nativeItem.artist }),
        ...(nativeItem.album === null ? {} : { albumTitle: nativeItem.album }),
        ...(nativeItem.artworkUrl === null ? {} : { artworkUrl: nativeItem.artworkUrl }),
        ...(nativeItem.durationMs === null
          ? {}
          : { duration: millisecondsToSeconds(nativeItem.durationMs) }),
        extras: nativeItem.extras,
      };
      return sanitizeMediaItemForPublic(item);
    });
    const reportedCurrentIndex = exactInteger(raw.currentIndex, 'currentIndex', true);
    const currentItemId = raw.currentItemId === null
      ? null
      : requireMediaId(raw.currentItemId, 'currentItemId');
    // Media3 reports index 0 for an empty timeline even though there is no
    // current MediaItem. Canonicalize only that documented empty sentinel to
    // the PlayerPort's null/null representation; every other index/ID
    // contradiction remains a rejected native snapshot.
    const currentIndex = queue.length === 0
      && reportedCurrentIndex === 0
      && currentItemId === null
      ? null
      : reportedCurrentIndex;
    if ((currentIndex === null) !== (currentItemId === null)) {
      throw new Error('Native current index and item ID must both be null or non-null');
    }
    if (currentIndex !== null) {
      requireQueueIndex(currentIndex, queue.length, 'Native current');
      if (queue[currentIndex].mediaId !== currentItemId) {
        throw new Error('Native current item ID does not match its exact queue index');
      }
    }
    if (!Object.values(RepeatMode).includes(raw.repeatMode as RepeatMode)) {
      throw new TypeError('Native repeat mode is invalid');
    }
    if (typeof raw.shuffleEnabled !== 'boolean') {
      throw new TypeError('Native shuffle state is invalid');
    }
    const queuePersistence = decodeNativeQueuePersistence(raw.queuePersistence, queue.length);
    const sleepTimer = decodeNativeSleepTimer(raw.sleepTimer, queue.length);
    if (raw.errorCode !== null && typeof raw.errorCode !== 'string') {
      throw new TypeError('Native error code is invalid');
    }
    const playbackState = raw.errorCode === null
      ? raw.playbackState as PlaybackState
      : PlaybackState.Error;
    return nextSnapshot(fallback, {
      isSetup: true,
      queue,
      activeIndex: currentIndex,
      playbackState,
      isPlaying: raw.isPlaying,
      progress: {
        position: millisecondsToSeconds(positionMs),
        duration: durationMs === null ? 0 : millisecondsToSeconds(durationMs),
        buffered: millisecondsToSeconds(bufferedMs),
        cached: 0,
      },
      repeatMode: raw.repeatMode as RepeatMode,
      queuePersistence,
      shuffleEnabled: raw.shuffleEnabled,
      sleepTimer,
    });
  }

  private handleNativeSnapshot(payload: unknown): void {
    if (this.disposed) return;
    try {
      const parsed = typeof payload === 'string' ? parseJson(payload, 'native snapshot event') : payload;
      const snapshotJson = isRecord(parsed) && typeof parsed.snapshotJson === 'string'
        ? parsed.snapshotJson
        : typeof payload === 'string' && isRecord(parsed) && parsed.schemaVersion === 1
          ? payload
          : null;
      if (snapshotJson === null) throw new TypeError('Native snapshot event is invalid');
      this.authoritative = this.decodeNativeV1(snapshotJson, this.authoritative);
      this.recomputeVisible();
    } catch {
      this.dispatch(Event.PlaybackError, { code: 'unknown', message: 'Playback failed' });
    }
  }

  private handleNativeEvent(payload: unknown): void {
    if (this.disposed) return;
    try {
      const wrapper = typeof payload === 'string' ? parseJson(payload, 'native player event') : payload;
      if (!isRecord(wrapper) || typeof wrapper.eventJson !== 'string') {
        throw new TypeError('Native player event is invalid');
      }
      const raw = parseJson(wrapper.eventJson, 'native player event payload');
      if (!isRecord(raw) || raw.schemaVersion !== 1) {
        throw new TypeError('Native player event schema is invalid');
      }
      const event = raw as unknown as NativePlayerEventV1;
      let backgroundEvent: BackgroundEvent;
      let dispatchForeground: () => void;
      if (event.type === 'error' && event.code === 'player-error') {
        this.authoritative = nextSnapshot(this.authoritative, {
          playbackState: PlaybackState.Error,
          isPlaying: false,
        });
        this.recomputeVisible();
        const safe = { code: 'unknown' as const, message: 'Playback failed' };
        backgroundEvent = { type: Event.PlaybackError, ...safe };
        dispatchForeground = () => this.dispatch(Event.PlaybackError, safe);
      } else if (event.type === 'media-item-transition') {
        const itemId = event.itemId === null ? null : requireMediaId(event.itemId, 'transition itemId');
        const reason = event.reason;
        if (!['auto', 'seek', 'repeat', 'playlist-changed', 'unknown'].includes(reason ?? '')) {
          throw new TypeError('Native transition reason is invalid');
        }
        const index = itemId === null
          ? -1
          : this.visible.queue.findIndex((item) => item.mediaId === itemId);
        if (itemId !== null && index < 0) throw new Error('Native transition item is not in queue');
        const safe: MediaItemTransitionEvent = {
          item: index < 0 ? null : this.visible.queue[index],
          index,
          reason,
        };
        backgroundEvent = { type: Event.MediaItemTransition, ...safe };
        dispatchForeground = () => this.dispatch(Event.MediaItemTransition, safe);
      } else {
        throw new TypeError('Native player event type is invalid');
      }
      if (wrapper.background === true && this.backgroundFactory !== null) {
        void this.backgroundFactory()(deepFreeze(backgroundEvent)).catch(() => undefined);
      } else {
        dispatchForeground();
      }
    } catch {
      this.dispatch(Event.PlaybackError, { code: 'unknown', message: 'Playback failed' });
    }
  }
}

export function createNativePlayerPort(
  dependencies: NativePlayerPortDependencies,
): NativeBackedPlayerPort {
  return new NativeBackedPlayerPort(dependencies);
}

/** Runtime-checked native journal seam used by foreground and Headless JS drains. */
export function getPlaybackEventJournalNativePort(): PlaybackEventJournalNativePort {
  const candidate = NativeModules.LoggeRythmPlayer as
    | Partial<LoggeRythmPlayerNativeModule>
    | undefined;
  if (
    candidate === undefined
    || typeof candidate.claimPlaybackEvents !== 'function'
    || typeof candidate.ackPlaybackEvent !== 'function'
    || typeof candidate.retryPlaybackEvent !== 'function'
    || typeof candidate.completeRadioPlaybackEvent !== 'function'
  ) {
    throw new Error('Playback event native contract is unavailable');
  }
  return {
    claimPlaybackEvents: (maxEvents, leaseMs) =>
      candidate.claimPlaybackEvents!(maxEvents, leaseMs),
    ackPlaybackEvent: (leaseId, eventId) =>
      candidate.ackPlaybackEvent!(leaseId, eventId),
    retryPlaybackEvent: (leaseId, eventId, notBeforeEpochMs) =>
      candidate.retryPlaybackEvent!(leaseId, eventId, notBeforeEpochMs),
    completeRadioPlaybackEvent: (leaseId, eventId, payloadJson) =>
      candidate.completeRadioPlaybackEvent!(leaseId, eventId, payloadJson),
  };
}

function nativeDependencies(): NativePlayerPortDependencies {
  const nativeModule = NativeModules.LoggeRythmPlayer as LoggeRythmPlayerNativeModule | undefined;
  if (nativeModule === undefined) {
    throw new Error('LoggeRythmPlayer native module is not linked');
  }
  return {
    nativeModule,
    emitter: new NativeEventEmitter(nativeModule as never),
  };
}

let defaultPlayerPort: PlayerPort | null = null;
let injectedPlayerPort: PlayerPort | null = null;

export function getDefaultPlayerPort(): PlayerPort {
  if (injectedPlayerPort !== null) return injectedPlayerPort;
  defaultPlayerPort ??= createNativePlayerPort(nativeDependencies());
  return defaultPlayerPort;
}

/** Injection seam for Vitest; returns an exact restoration callback. */
export function setPlayerPortForTests(player: PlayerPort): () => void {
  const previous = injectedPlayerPort;
  injectedPlayerPort = player;
  return () => {
    injectedPlayerPort = previous;
  };
}

export function resetPlayerPortForTests(): void {
  injectedPlayerPort = null;
  defaultPlayerPort?.dispose();
  defaultPlayerPort = null;
}
