import TrackPlayer, { PlayerCommand } from '@rntp/player';
import { installPlaybackListeners } from './controller';

let started = false;

/**
 * Initialize the native player exactly once. Must run in the foreground on
 * Android (call from the app root after auth). Configures the media
 * notification / lock-screen controls (the "media bar") and native command
 * handling, plus a 500 MB disk cache with next-track preloading.
 */
export async function ensurePlayer(): Promise<void> {
  if (started) return;
  started = true;

  TrackPlayer.setupPlayer({
    contentType: 'music',
    handleAudioBecomingNoisy: true,
    android: {
      wakeMode: 'network',
      notification: {
        channelId: 'lr.playback',
        channelName: 'Playback',
        // Monochrome music-note glyph written by plugins/withNotificationIcon.js.
        smallIcon: 'ic_stat_music',
      },
    },
    cache: {
      maxSizeBytes: 500 * 1024 * 1024,
      preloading: { window: 1 },
    },
  });

  // Native handling: lock screen / notification / Bluetooth / Android Auto all
  // work without the JS runtime. We still install in-app listeners for radio
  // auto-extend and play recording while the UI is foregrounded.
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
}
