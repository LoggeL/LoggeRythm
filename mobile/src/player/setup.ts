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
  if (!nativeSetupComplete) return;
  try {
    TrackPlayer.pause();
    TrackPlayer.clear();
    clearBrowseTree();
    TrackPlayer.cancelSleepTimer();
    resetControllerState();
  } catch (error) {
    throw new Error(`Failed to clear native playback state: ${(error as Error).message}`);
  }
}
