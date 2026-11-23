import { AccessibilityInfo } from 'react-native';
import { musicRepository } from '../data/repositories';
import { strings } from '../localization';
import { playTracks, playTrackWithRadio, TrackRadioError } from '../player/controller';
import { playerFailureMessage, reportPlayerError, UserFacingPlayerError } from '../player/errors';
import { mediaItemToTrack } from '../player/mediaItem';
import { reportPlayerNotice } from '../player/notices';
import Player from '../player/player';
import {
  executeMediaPlayFromSearch,
  type VoicePlaybackPort,
  type VoiceSearchDeps,
} from './mediaPlayFromSearch';
import {
  startMediaPlayFromSearchIntake,
  type MediaPlayFromSearchRequest,
} from './mediaPlayFromSearchIntent';

function createDefaultPlaybackPort(): VoicePlaybackPort {
  return {
    hasActiveQueue: () => Player.getActiveMediaItem() !== null || Player.getQueue().length > 0,
    activeTrackId: () => {
      const activeItem = Player.getActiveMediaItem();
      return activeItem === null ? null : (mediaItemToTrack(activeItem)?.id ?? null);
    },
    isPlaying: () => Player.isPlaying(),
    resume: () => Player.play(),
    playTracks,
    playTrackWithRadio,
    isTrackRadioError: (error) => error instanceof TrackRadioError,
  };
}

function createDefaultDeps(onNavigateNowPlaying: () => void): VoiceSearchDeps {
  return {
    repository: musicRepository,
    player: createDefaultPlaybackPort(),
    onNavigateNowPlaying,
    onAnnounce: (message) => {
      AccessibilityInfo.announceForAccessibility(message);
    },
    onRadioNotice: (title, message) => {
      reportPlayerNotice('bookkeeping', 'voice-search-radio-failed', title, message);
    },
  };
}

/**
 * Connect native `MEDIA_PLAY_FROM_SEARCH` Activity intents to authenticated
 * playback execution. Serializes back-to-back voice requests so concurrent
 * intents never race queue replacement, and surfaces every error loudly.
 */
export function attachMediaPlayFromSearchIntake(
  accountScope: string | null,
  onNavigateNowPlaying: () => void,
): () => void {
  if (accountScope === null) return () => undefined;

  let active = true;
  let queue: Promise<void> = Promise.resolve();

  const enqueueRequest = (request: MediaPlayFromSearchRequest) => {
    queue = queue.then(async () => {
      if (!active) return;
      try {
        await executeMediaPlayFromSearch(request, createDefaultDeps(onNavigateNowPlaying));
      } catch (error) {
        if (!active) return;
        const spoken = playerFailureMessage(strings.voice.playFromSearchFailed, error);
        reportPlayerError(strings.voice.playFromSearchFailed, error);
        AccessibilityInfo.announceForAccessibility(spoken);
      }
    });
  };

  const handleIntakeError = (error: unknown) => {
    if (!active) return;
    const surfaced =
      error instanceof UserFacingPlayerError
        ? error
        : new UserFacingPlayerError(strings.voice.invalidIntentPayload);
    const spoken = playerFailureMessage(strings.voice.playFromSearchFailed, surfaced);
    reportPlayerError(strings.voice.playFromSearchFailed, surfaced);
    AccessibilityInfo.announceForAccessibility(spoken);
  };

  const stop = startMediaPlayFromSearchIntake(enqueueRequest, handleIntakeError);
  return () => {
    active = false;
    stop();
  };
}
