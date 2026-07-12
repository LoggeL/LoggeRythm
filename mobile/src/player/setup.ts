import TrackPlayer, { PlayerCommand } from '@rntp/player';
import { clearBrowseTree } from './browseTree';
import { installPlaybackListeners, resetControllerState } from './controller';

let nativeSetupComplete = false;
let ready = false;

/** Initialize the native player exactly once while the Android app is foregrounded. */
export function ensurePlayer(): void {
  if (ready) return;
  try {
    if (!nativeSetupComplete) {
      console.info('[LoggeRythm] native player setup starting');
      TrackPlayer.setupPlayer({
        contentType: 'music',
        handleAudioBecomingNoisy: true,
        android: {
          wakeMode: 'network',
          notification: {
            channelId: 'lr.playback',
            channelName: 'Playback',
            smallIcon: 'ic_stat_music',
          },
        },
        cache: {
          maxSizeBytes: 500 * 1024 * 1024,
          preloading: { window: 1 },
        },
      });
      nativeSetupComplete = true;
      console.info('[LoggeRythm] native player setup requested');
    }

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
    throw new Error(`Native audio player initialization failed: ${(error as Error).message}`);
  }
}

export function isPlayerReady(): boolean {
  return ready;
}

/** Remove all account-scoped player state before logging out or switching users. */
export function clearPlayerSession(): void {
  const failures: string[] = [];
  const attempt = (label: string, operation: () => void): void => {
    try {
      operation();
    } catch (error) {
      failures.push(`${label}: ${(error as Error).message}`);
    }
  };

  // The persisted Android Auto tree is account-scoped even when this JS
  // process has not initialized a MediaController yet.
  attempt('Android Auto library', clearBrowseTree);
  if (nativeSetupComplete) {
    attempt('pause', () => TrackPlayer.pause());
    attempt('queue', () => TrackPlayer.clear());
    attempt('sleep timer', () => TrackPlayer.cancelSleepTimer());
  }
  attempt('JavaScript controller state', resetControllerState);

  if (failures.length > 0) {
    throw new Error(`Failed to clear native playback state (${failures.join('; ')})`);
  }
}
