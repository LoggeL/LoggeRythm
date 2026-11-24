import { ApiError } from '../api/error';
import { libraryStrings } from './libraryStrings';

export type PlaylistFailureKind = 'playback' | 'mutation' | 'track-action' | 'create' | 'leave';

/** Backend and native error details are diagnostic data, not user-facing copy. */
export function playlistFailureMessage(kind: PlaylistFailureKind, error: unknown): string {
  switch (kind) {
    case 'playback':
      return libraryStrings.common.playbackFailed;
    case 'mutation':
      if (error instanceof ApiError && error.status === 409) {
        return libraryStrings.playlist.reorderConflict;
      }
      return libraryStrings.playlist.mutationFailed;
    case 'track-action':
      return libraryStrings.playlist.actionFailed;
    case 'create':
      return libraryStrings.library.createFailed;
    case 'leave':
      return libraryStrings.playlist.leaveFailed;
  }
}

/** Validation remains actionable and specific because it is derived locally. */
export function playlistNameValidation(name: string): string | null {
  return name.trim().length === 0 ? libraryStrings.playlist.nameRequired : null;
}
