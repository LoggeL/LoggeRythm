import type { ArtistRef, Track } from '../api/types';
import { trackAlbumRoute, trackArtistRoute } from '../navigationLinks';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';

export type NowPlayingDiscoverDestination =
  | {
      screen: 'DiscoverTab';
      params: { screen: 'Album'; params: AlbumRouteParams };
    }
  | {
      screen: 'DiscoverTab';
      params: { screen: 'Artist'; params: ArtistRouteParams };
    };

/** Exact nested destination used by the album-linked current title. */
export function nowPlayingAlbumDestination(
  track: Pick<Track, 'album_id' | 'album'>,
): NowPlayingDiscoverDestination | null {
  const params = trackAlbumRoute(track);
  return params === null
    ? null
    : { screen: 'DiscoverTab', params: { screen: 'Album', params } };
}

/** Exact selected credit—not an implicit primary artist—owns this destination. */
export function nowPlayingArtistDestination(
  artist: ArtistRef,
): NowPlayingDiscoverDestination | null {
  const params = trackArtistRoute({ artist_id: artist.id, artist: artist.name });
  return params === null
    ? null
    : { screen: 'DiscoverTab', params: { screen: 'Artist', params } };
}
