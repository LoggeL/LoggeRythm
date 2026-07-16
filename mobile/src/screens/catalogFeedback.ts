import { strings } from '../localization';
import { catalogStrings } from './catalogStrings';

export type CatalogFailureKind =
  | 'playback'
  | 'home-playback'
  | 'artist-follow'
  | 'radar-seen-state';

/** Transport, storage, and native details are diagnostic data, not UI copy. */
export function catalogFailureMessage(kind: CatalogFailureKind, _error: unknown): string {
  switch (kind) {
    case 'playback':
      return catalogStrings.common.playbackFailed;
    case 'home-playback':
      return strings.home.playFailed;
    case 'artist-follow':
      return catalogStrings.artist.followFailed;
    case 'radar-seen-state':
      return strings.home.radarSeenStateFailed;
  }
}
