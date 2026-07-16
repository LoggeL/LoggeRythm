import { strings } from '../localization';

export type TrackActionFailureKind =
  | 'play-next'
  | 'add-to-queue'
  | 'start-radio'
  | 'add-to-playlist'
  | 'create-playlist'
  | 'remove'
  | 'generic';

/** External failure details stay in diagnostics; this is the complete UI-copy boundary. */
export function trackActionFailureMessage(
  kind: TrackActionFailureKind,
  _error: unknown,
): string {
  switch (kind) {
    case 'play-next':
      return strings.trackActions.playNextFailed;
    case 'add-to-queue':
      return strings.trackActions.addToQueueFailed;
    case 'start-radio':
      return strings.trackActions.startRadioFailed;
    case 'add-to-playlist':
      return strings.trackActions.addToPlaylistFailed;
    case 'create-playlist':
      return strings.trackActions.createPlaylistFailed;
    case 'remove':
      return strings.trackActions.removeFailed;
    case 'generic':
      return strings.trackActions.actionFailed;
  }
}
