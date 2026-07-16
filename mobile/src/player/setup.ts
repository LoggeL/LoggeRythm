import Player, {
  PlayerCommand,
  type PlayerSessionBinding,
} from './player';
import { requirePlayerSessionBinding } from './playerPort';
import { strings } from '../localization';
import {
  installPlaybackListeners,
  resetControllerState,
  restoreControllerStateFromNativeQueue,
} from './controller';

let nativeSetupComplete = false;
let ready = false;
let initializationPromise: Promise<void> | null = null;
let cleanupPromise: Promise<void> | null = null;
let cleanupRequired = false;
let activeSessionBinding: Readonly<PlayerSessionBinding> | null = null;

export type PlayerCleanupBoundary =
  | 'native-player-session'
  | 'javascript-controller-state';

export class PlayerSessionCleanupError extends Error {
  constructor(public readonly failedBoundaries: readonly PlayerCleanupBoundary[]) {
    super('Player session cleanup could not be completed');
    this.name = 'PlayerSessionCleanupError';
  }
}

function invalidAccountScope(): never {
  throw new TypeError('Player account scope is invalid');
}

/** Convert the existing query-cache scope into the minimal native session identity. */
export function playerSessionBindingFromQueryScope(
  queryScope: string,
): Readonly<PlayerSessionBinding> {
  if (typeof queryScope !== 'string' || queryScope.length > 642) invalidAccountScope();
  const delimiter = '::user:';
  const delimiterIndex = queryScope.lastIndexOf(delimiter);
  if (delimiterIndex <= 0) invalidAccountScope();
  const origin = queryScope.slice(0, delimiterIndex);
  const numericId = queryScope.slice(delimiterIndex + delimiter.length);
  if (!/^[1-9][0-9]*$/.test(numericId)) invalidAccountScope();
  let binding: Readonly<PlayerSessionBinding>;
  try {
    binding = requirePlayerSessionBinding({
      accountScope: `user:${numericId}`,
      origin,
    });
  } catch {
    invalidAccountScope();
  }
  if (queryScope !== `${binding.origin}::${binding.accountScope}`) invalidAccountScope();
  return binding;
}

function sameBinding(
  left: Readonly<PlayerSessionBinding>,
  right: Readonly<PlayerSessionBinding>,
): boolean {
  return left.accountScope === right.accountScope && left.origin === right.origin;
}

async function initializePlayer(binding: Readonly<PlayerSessionBinding>): Promise<void> {
  try {
    if (!nativeSetupComplete) {
      console.info('[LoggeRythm] native player setup starting');
      await Player.setupPlayer({
        sessionBinding: binding,
        contentType: 'music',
        audioMixing: 'exclusive',
        handleAudioBecomingNoisy: true,
        android: {
          wakeMode: 'network',
          notification: {
            channelId: 'lr.playback',
            channelName: strings.player.notificationChannelName,
            smallIcon: 'ic_stat_music',
          },
        },
        cache: {
          maxSizeBytes: 500 * 1024 * 1024,
          preloading: { window: 1 },
        },
      });
      if (cleanupRequired) throw new Error('Player session cleanup is required');
      nativeSetupComplete = true;
      console.info('[LoggeRythm] native MediaController connected');
    }

    if (cleanupRequired) throw new Error('Player session cleanup is required');
    restoreControllerStateFromNativeQueue();
    await Player.setCommands({
      capabilities: [
        PlayerCommand.PlayPause,
        PlayerCommand.Next,
        PlayerCommand.Previous,
        PlayerCommand.Seek,
      ],
      handling: 'native',
    });
    installPlaybackListeners();
    ready = true;
    console.info('[LoggeRythm] native player commands/listeners ready');
  } catch {
    ready = false;
    throw new Error('Native audio player initialization failed');
  }
}

function rejectedPlayerSession(): Promise<void> {
  return Promise.reject(new Error('Player session is unavailable'));
}

/**
 * Resolve only after the native MediaController and command/listener layer are ready.
 * The first caller must provide an account query scope. That identity remains reserved
 * across concurrent calls and retries, and only confirmed atomic cleanup can release it.
 */
export function ensurePlayer(accountScope?: string): Promise<void> {
  if (cleanupRequired) return rejectedPlayerSession();

  let requestedBinding: Readonly<PlayerSessionBinding> | null = null;
  if (accountScope !== undefined) {
    try {
      requestedBinding = playerSessionBindingFromQueryScope(accountScope);
    } catch {
      return rejectedPlayerSession();
    }
  }

  if (activeSessionBinding === null) {
    if (requestedBinding === null) return rejectedPlayerSession();
    activeSessionBinding = requestedBinding;
  } else if (
    requestedBinding !== null
    && !sameBinding(activeSessionBinding, requestedBinding)
  ) {
    return rejectedPlayerSession();
  }

  if (ready) return Promise.resolve();
  if (initializationPromise !== null) return initializationPromise;

  const attempt = initializePlayer(activeSessionBinding);
  initializationPromise = attempt;
  const clearAttempt = (): void => {
    if (initializationPromise === attempt) initializationPromise = null;
  };
  void attempt.then(clearAttempt, clearAttempt);
  return attempt;
}

export function isPlayerReady(): boolean {
  return ready;
}

async function performPlayerSessionCleanup(): Promise<void> {
  try {
    // One awaitable native boundary owns the live Media3 queue, notification,
    // Cookie vault, browse tree, rolling cache, timers, and encrypted snapshot.
    await Player.clearPersistedQueue();
  } catch {
    throw new PlayerSessionCleanupError(['native-player-session']);
  }

  try {
    resetControllerState();
  } catch {
    throw new PlayerSessionCleanupError(['javascript-controller-state']);
  }

  // Do not release account identity or readiness flags until native cleanup and
  // the process-local controller reset have both been confirmed.
  ready = false;
  nativeSetupComplete = false;
  initializationPromise = null;
  activeSessionBinding = null;
  cleanupRequired = false;
}

/** Remove every account-scoped player resource before logout or account replacement. */
export function clearPlayerSession(): Promise<void> {
  if (cleanupPromise !== null) return cleanupPromise;
  cleanupRequired = true;
  const attempt = performPlayerSessionCleanup();
  cleanupPromise = attempt;
  const clearAttempt = (): void => {
    if (cleanupPromise === attempt) cleanupPromise = null;
  };
  void attempt.then(clearAttempt, clearAttempt);
  return attempt;
}
