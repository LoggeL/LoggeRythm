import { createNavigationContainerRef } from '@react-navigation/native';
import type { Track } from '../api/types';
import { navigateToSearch } from '../navigationActions';
import { trackAlbumRoute, trackArtistRoute } from '../navigationLinks';
import type { RootStackParams } from './types';

/** The one container ref: imperative navigation from outside the React tree. */
export const rootNavigation = createNavigationContainerRef<RootStackParams>();

export type TrackDetailNavigationResult = 'opened' | 'invalid-track' | 'not-ready';

/** Route global track actions through one typed, validated catalog stack. */
export function openTrackAlbum(track: Track): TrackDetailNavigationResult {
  const params = trackAlbumRoute(track);
  if (params === null) return 'invalid-track';
  if (!rootNavigation.isReady()) return 'not-ready';
  rootNavigation.navigate('Tabs', {
    screen: 'DiscoverTab',
    params: { screen: 'Album', params },
  });
  return 'opened';
}

export function openTrackArtist(track: Track): TrackDetailNavigationResult {
  const params = trackArtistRoute(track);
  if (params === null) return 'invalid-track';
  if (!rootNavigation.isReady()) return 'not-ready';
  rootNavigation.navigate('Tabs', {
    screen: 'DiscoverTab',
    params: { screen: 'Artist', params },
  });
  return 'opened';
}

/** Shared-text import lands on the Search tab; false while the container is not mounted. */
export function openSpotifyImport(): boolean {
  if (!rootNavigation.isReady()) return false;
  navigateToSearch(rootNavigation);
  return true;
}
