import TrackPlayer, { PlayerCommand } from '@rntp/player';
import { strings } from '../localization';
import { clearBrowseTree } from './browseTree';
import {
  installPlaybackListeners,
  resetControllerState,
  restoreControllerStateFromNativeQueue,
} from './controller';

let nativeSetupComplete = false;
let ready = false;
let initializationPromise: Promise<void> | null = null;

export type PlayerCleanupBoundary =
  | 'android-auto-library'
  | 'persisted-queue-before-connect'
  | 'native-player-connection'
  | 'pause'
  | 'queue'
  | 'sleep-timer'
  | 'audio-cache'
  | 'persisted-queue-confirmation'
  | 'javascript-controller-state';

interface PlayerCleanupFailure {
  boundary: PlayerCleanupBoundary;
  detail: string;
}

export class PlayerSessionCleanupError extends Error {
  constructor(
    public readonly failedBoundaries: readonly PlayerCleanupBoundary[],
    message: string,
  ) {
    super(message);
    this.name = 'PlayerSessionCleanupError';
  }
}

async function initializePlayer(): Promise<void> {
  try {
    if (!nativeSetupComplete) {
      console.info('[LoggeRythm] native player setup starting');
      await TrackPlayer.setupPlayer({
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
      nativeSetupComplete = true;
      console.info('[LoggeRythm] native MediaController connected');
    }

    restoreControllerStateFromNativeQueue();
    TrackPlayer.setCommands({
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
  } catch (error) {
    ready = false;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Native audio player initialization failed: ${detail}`);
  }
}

/**
 * Resolve only after the native MediaController and the app's command/listener layer are ready.
 * Concurrent callers share one attempt. A rejected attempt is cleared so an explicit retry can
 * reconnect natively (or re-apply the command layer if the native connection already succeeded).
 */
export function ensurePlayer(): Promise<void> {
  if (ready) return Promise.resolve();
  if (initializationPromise !== null) return initializationPromise;

  const attempt = initializePlayer();
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

/** Remove all account-scoped player state before logging out or switching users. */
export async function clearPlayerSession(): Promise<void> {
  const failures: PlayerCleanupFailure[] = [];
  const attempt = async (
    boundary: PlayerCleanupBoundary,
    label: string,
    operation: () => void | Promise<void>,
  ): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      failures.push({ boundary, detail: `${label}: ${(error as Error).message}` });
    }
  };

  // The persisted Android Auto tree is account-scoped even when this JS
  // process has not initialized a MediaController yet.
  await attempt('android-auto-library', 'Android Auto library', clearBrowseTree);

  // Delete the disk snapshot before connecting. A newly-created service must
  // never restore the departing user's authenticated queue while cleanup is in
  // progress. The second deletion below closes the race with a final native
  // persistence checkpoint.
  await attempt(
    'persisted-queue-before-connect',
    'persisted queue',
    () => TrackPlayer.clearPersistedQueue(),
  );

  // A Media3 service and notification can outlive the React Native JS process.
  // Connecting here lets logout clear that live in-memory session as well as
  // the encrypted disk snapshot. setupPlayer is idempotent and ensurePlayer
  // shares any already-running connection attempt.
  await attempt('native-player-connection', 'native player connection', ensurePlayer);
  if (nativeSetupComplete) {
    await attempt('pause', 'pause', () => TrackPlayer.pause());
    await attempt('queue', 'queue', () => TrackPlayer.clear());
    await attempt('sleep-timer', 'sleep timer', () => TrackPlayer.cancelSleepTimer());
    // This clears only RNTP's automatic rolling stream cache. The separate,
    // user-managed encrypted download store is erased by AuthContext's account
    // storage boundary. Both awaitable boundaries gate account replacement.
    await attempt('audio-cache', 'audio cache', () => TrackPlayer.clearCache());
  }
  await attempt(
    'persisted-queue-confirmation',
    'persisted queue confirmation',
    () => TrackPlayer.clearPersistedQueue(),
  );
  await attempt(
    'javascript-controller-state',
    'JavaScript controller state',
    resetControllerState,
  );

  if (failures.length > 0) {
    const failedBoundaries = failures.map(({ boundary }) => boundary);
    console.warn(
      `[LoggeRythm] player cleanup failed: ${failedBoundaries.join(',')}`,
    );
    throw new PlayerSessionCleanupError(
      failedBoundaries,
      `Failed to clear native playback state (${failures.map(({ detail }) => detail).join('; ')})`,
    );
  }
}
