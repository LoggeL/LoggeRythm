import { libraryStrings } from './libraryStrings';

export type PlaylistFailureKind = 'playback' | 'mutation' | 'track-action' | 'create';

/** Backend and native error details are diagnostic data, not user-facing copy. */
export function playlistFailureMessage(kind: PlaylistFailureKind, _error: unknown): string {
  switch (kind) {
    case 'playback':
      return libraryStrings.common.playbackFailed;
    case 'mutation':
      return libraryStrings.playlist.mutationFailed;
    case 'track-action':
      return libraryStrings.playlist.actionFailed;
    case 'create':
      return libraryStrings.library.createFailed;
  }
}

/** Validation remains actionable and specific because it is derived locally. */
export function playlistNameValidation(name: string): string | null {
  return name.trim().length === 0 ? libraryStrings.playlist.nameRequired : null;
}
