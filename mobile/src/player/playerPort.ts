/**
 * First-party playback contract owned by LoggeRythm.
 *
 * This file deliberately contains no dependency on a third-party player.  UI and
 * product code can depend on this surface while the native implementation evolves
 * independently.
 */

export type MediaUrl =
  | string
  | number
  | {
      uri: string | number;
      headers?: Readonly<Record<string, string>>;
      bundle?: string;
    };

export interface MediaItem {
  /** PlayerPort validates this as present and exact before an item enters a queue. */
  mediaId?: string;
  url: MediaUrl;
  title?: string;
  artist?: string;
  albumTitle?: string;
  artworkUrl?: MediaUrl;
  duration?: number;
  isLive?: boolean;
  mimeType?: string;
  extras?: Readonly<Record<string, unknown>>;
}

/** Validated representation used by every snapshot and synchronous queue getter. */
export interface QueueMediaItem extends MediaItem {
  mediaId: string;
}

export enum PlaybackState {
  Idle = 'idle',
  Ready = 'ready',
  Buffering = 'buffering',
  Ended = 'ended',
  Error = 'error',
}

export enum RepeatMode {
  Off = 'off',
  One = 'one',
  All = 'all',
}

export enum PlayerCommand {
  Seek = 'seek',
  PlayPause = 'playPause',
  Next = 'next',
  Previous = 'previous',
  Stop = 'stop',
  SkipForward = 'skipForward',
  SkipBackward = 'skipBackward',
}

export enum Event {
  PlaybackStateChanged = 'playback-state-changed',
  IsPlayingChanged = 'is-playing-changed',
  MediaItemTransition = 'media-item-transition',
  MediaMetadataChanged = 'media-metadata-changed',
  MetadataReceived = 'metadata-received',
  PlaybackError = 'playback-error',
  PlaybackProgressUpdated = 'playback-progress-updated',
  QueueChanged = 'queue-changed',
  RemotePlay = 'remote-play',
  RemotePause = 'remote-pause',
  RemoteNext = 'remote-next',
  RemotePrevious = 'remote-previous',
  RemoteStop = 'remote-stop',
  RemoteSeek = 'remote-seek',
  RemoteSkipForward = 'remote-skip-forward',
  RemoteSkipBackward = 'remote-skip-backward',
  RemoteToggleFavorite = 'remote-toggle-favorite',
  SleepTimerTriggered = 'sleep-timer-triggered',
  CommandRejected = 'command-rejected',
}

export interface Progress {
  position: number;
  duration: number;
  buffered: number;
  cached: number;
}

export interface QueuePersistenceState {
  contextShuffleEnabled: boolean;
  contextShuffleRestoreOrder: readonly string[];
}

export type SleepTimerState =
  | {
      type: 'time';
      remainingSeconds: number;
      fadeOutSeconds: number;
    }
  | {
      type: 'mediaItem';
      index: number;
    }
  | null;

export interface PlayerSnapshot {
  /** Monotonic JS publication revision; never a blocking native bridge read. */
  revision: number;
  isSetup: boolean;
  queue: readonly Readonly<QueueMediaItem>[];
  activeIndex: number | null;
  playbackState: PlaybackState;
  isPlaying: boolean;
  progress: Readonly<Progress>;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  playbackSpeed: number;
  volume: number;
  sleepTimer: SleepTimerState;
  queuePersistence: Readonly<QueuePersistenceState>;
}

export interface PlayerSessionBinding {
  /** Native persistence scope. The only accepted form is `user:<positive integer>`. */
  accountScope: string;
  /** Exact canonical HTTPS origin, without a trailing slash or explicit default port. */
  origin: string;
}

const MAX_ACCOUNT_SCOPE_LENGTH = 128;
const MAX_SESSION_ORIGIN_LENGTH = 512;
const ACCOUNT_SCOPE_PATTERN = /^user:[1-9][0-9]*$/;

function invalidSessionBinding(): never {
  throw new TypeError('Player session binding is invalid');
}

/** Validate and copy the only account identity allowed across native setup. */
export function requirePlayerSessionBinding(value: unknown): Readonly<PlayerSessionBinding> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidSessionBinding();
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (keys.length !== 2 || keys[0] !== 'accountScope' || keys[1] !== 'origin') {
    invalidSessionBinding();
  }
  const { accountScope, origin } = candidate;
  if (
    typeof accountScope !== 'string'
    || accountScope.length > MAX_ACCOUNT_SCOPE_LENGTH
    || !ACCOUNT_SCOPE_PATTERN.test(accountScope)
  ) {
    invalidSessionBinding();
  }
  const numericId = Number(accountScope.slice('user:'.length));
  if (!Number.isSafeInteger(numericId) || numericId <= 0) invalidSessionBinding();
  if (typeof origin !== 'string' || origin.length < 1 || origin.length > MAX_SESSION_ORIGIN_LENGTH) {
    invalidSessionBinding();
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    invalidSessionBinding();
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.length === 0
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.port === '0'
    || parsed.origin !== origin
    || parsed.pathname !== '/'
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    invalidSessionBinding();
  }
  return Object.freeze({ accountScope, origin });
}

export interface PlayerConfig {
  sessionBinding: PlayerSessionBinding;
  contentType?: 'music' | 'speech';
  handleAudioBecomingNoisy?: boolean;
  autoUpdateMetadataFromStream?: boolean;
  audioMixing?: 'exclusive' | 'mix';
  cache?: {
    maxSizeBytes?: number;
    preloading?: { window?: number };
  };
  progressSync?: {
    intervalSeconds?: number;
    http?: { url: string; headers?: Readonly<Record<string, string>> };
  };
  android?: {
    wakeMode?: 'none' | 'local' | 'network';
    skipSilenceEnabled?: boolean;
    taskRemovedBehavior?: 'continue' | 'stop';
    notification?: {
      channelId: string;
      channelName: string;
      smallIcon: string;
    };
    cast?: string;
  };
}

export interface RemoteControlConfig {
  capabilities: readonly PlayerCommand[];
  handling?: 'native' | 'js' | 'hybrid';
  perCommandHandling?: Partial<Record<PlayerCommand, 'native' | 'js'>>;
  forwardInterval?: number;
  backwardInterval?: number;
}

export interface BrowseItem {
  mediaId: string;
  title: string;
  artist?: string;
  artworkUrl?: MediaUrl;
  url?: MediaUrl;
  duration?: number;
  isLive?: boolean;
  mimeType?: string;
  extras?: Readonly<Record<string, unknown>>;
  children?: readonly BrowseItem[];
}

export interface BrowseCategory {
  mediaId: string;
  title: string;
  items: readonly BrowseItem[];
}

export interface PlaybackStateChangedEvent {
  state: PlaybackState;
}

export interface IsPlayingChangedEvent {
  playing: boolean;
}

export interface MediaItemTransitionEvent {
  item: MediaItem | null;
  index: number;
  reason?: 'auto' | 'seek' | 'repeat' | 'playlist-changed' | 'unknown';
}

export interface PlaybackProgressUpdatedEvent {
  mediaId: string;
  position: number;
  duration: number;
  timestamp: number;
}

export type PlaybackErrorCode =
  | 'network'
  | 'source'
  | 'renderer'
  | 'play-not-permitted'
  | 'unknown';

export interface PlaybackErrorEvent {
  code: PlaybackErrorCode;
  /** Redacted, stable copy only. Native error details never cross this boundary. */
  message: string;
}

export interface MediaMetadataEvent {
  title?: string;
  artist?: string;
  albumTitle?: string;
  artworkUrl?: string;
  genre?: string;
}

export interface CommandRejectedEvent {
  command: PlayerOperationName;
  code:
    | 'native-rejected'
    | 'unsupported-native-command'
    | 'reconciliation-conflict'
    | 'source-unavailable';
  /** Deliberately generic: native exceptions can contain URLs or request headers. */
  message: 'Player command could not be applied';
}

export interface EventPayloadByEvent {
  [Event.PlaybackStateChanged]: PlaybackStateChangedEvent;
  [Event.IsPlayingChanged]: IsPlayingChangedEvent;
  [Event.MediaItemTransition]: MediaItemTransitionEvent;
  [Event.MediaMetadataChanged]: MediaMetadataEvent;
  [Event.MetadataReceived]: MediaMetadataEvent;
  [Event.PlaybackError]: PlaybackErrorEvent;
  [Event.PlaybackProgressUpdated]: PlaybackProgressUpdatedEvent;
  [Event.QueueChanged]: undefined;
  [Event.RemotePlay]: undefined;
  [Event.RemotePause]: undefined;
  [Event.RemoteNext]: undefined;
  [Event.RemotePrevious]: undefined;
  [Event.RemoteStop]: undefined;
  [Event.RemoteSeek]: { position: number };
  [Event.RemoteSkipForward]: { interval: number };
  [Event.RemoteSkipBackward]: { interval: number };
  [Event.RemoteToggleFavorite]: { mediaId: string; requestedLiked: boolean };
  [Event.SleepTimerTriggered]: { type: 'time' | 'mediaItem' };
  [Event.CommandRejected]: CommandRejectedEvent;
}

export type BackgroundEvent = {
  [K in Event]: EventPayloadByEvent[K] extends undefined
    ? { type: K }
    : EventPayloadByEvent[K] & { type: K };
}[Event];

export type BackgroundEventHandler = (event: BackgroundEvent) => Promise<void>;

export interface PlayerSubscription {
  remove(): void;
}

export type PlayerPortCommandName =
  | 'play'
  | 'pause'
  | 'stop'
  | 'seekTo'
  | 'skipToNext'
  | 'skipToPrevious'
  | 'skipToIndex'
  | 'setMediaItem'
  | 'setMediaItems'
  | 'addMediaItem'
  | 'addMediaItems'
  | 'insertMediaItem'
  | 'removeMediaItem'
  | 'removeMediaItems'
  | 'replaceMediaItem'
  | 'moveMediaItem'
  | 'clear'
  | 'setQueuePersistenceState'
  | 'setCommands'
  | 'setRepeatMode'
  | 'setShuffleEnabled'
  | 'sleepAfterTime'
  | 'sleepAfterMediaItemAtIndex'
  | 'cancelSleepTimer';

export type PlayerOperationName =
  | PlayerPortCommandName
  | 'setNotificationFavoriteState'
  | 'setupPlayer'
  | 'setBrowseTree'
  | 'clearPersistedQueue'
  | 'clearCache';

export interface PlayerPort {
  setupPlayer(options: PlayerConfig): Promise<void>;
  registerBackgroundEventHandler(factory: () => BackgroundEventHandler): void;
  addEventListener<T extends Event>(
    event: T,
    listener: (payload: EventPayloadByEvent[T]) => void,
  ): PlayerSubscription;

  /** Subscribe to immutable snapshot identity changes (for useSyncExternalStore). */
  subscribe(listener: () => void): () => void;
  getSnapshot(): Readonly<PlayerSnapshot>;

  play(): void;
  pause(): void;
  stop(): void;
  seekTo(position: number): void;
  skipToNext(): void;
  skipToPrevious(): void;
  skipToIndex(index: number): void;

  setMediaItem(mediaItem: MediaItem): void;
  setMediaItems(mediaItems: readonly MediaItem[], startIndex?: number): void;
  addMediaItem(mediaItem: MediaItem): void;
  addMediaItems(mediaItems: readonly MediaItem[]): void;
  insertMediaItem(index: number, mediaItem: MediaItem): void;
  removeMediaItem(index: number): void;
  removeMediaItems(fromIndex: number, toIndex: number): void;
  replaceMediaItem(index: number, mediaItem: MediaItem): void;
  moveMediaItem(fromIndex: number, toIndex: number): void;
  clear(): void;

  getPlaybackState(): PlaybackState;
  isPlaying(): boolean;
  getProgress(): Progress;
  getActiveMediaItem(): MediaItem | null;
  getActiveMediaItemIndex(): number | null;
  /** Mutable copy for drop-in controller compatibility; snapshot storage stays frozen. */
  getQueue(): MediaItem[];
  getQueuePersistenceState(): Readonly<QueuePersistenceState>;
  getRepeatMode(): RepeatMode;
  isShuffleEnabled(): boolean;
  getSleepTimer(): SleepTimerState;

  setQueuePersistenceState(state: QueuePersistenceState): void;
  /** Resolve only after MediaSession has installed this exact remote-command policy. */
  setCommands(commands: RemoteControlConfig): Promise<void>;
  /** Publish exact current-item favorite state to Android notification controls. */
  setNotificationFavoriteState(mediaId: string | null, liked: boolean | null): Promise<void>;
  setRepeatMode(mode: RepeatMode): void;
  setShuffleEnabled(enabled: boolean): void;
  setBrowseTree(categories: readonly BrowseCategory[]): void;
  sleepAfterTime(seconds: number, options?: { fadeOutSeconds?: number }): void;
  sleepAfterMediaItemAtIndex(index?: number): void;
  cancelSleepTimer(): void;

  /** Account-cleanup operations are awaited and bypass a connected controller. */
  clearPersistedQueue(): Promise<void>;
  clearCache(): Promise<void>;

  /** Test/cleanup barrier for fire-and-reconcile commands. */
  flush(): Promise<void>;
  dispose(): void;
}
