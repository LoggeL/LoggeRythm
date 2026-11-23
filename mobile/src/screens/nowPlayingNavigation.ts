import type { ArtistRef, Track } from '../api/types';
import {
  openAlbumInActiveTab,
  openArtistInActiveTab,
  resolveActiveTabName,
  type AppTabName,
} from '../navigation/rootNavigation';
import { trackAlbumRoute, trackArtistRoute } from '../navigationLinks';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';

export type ActiveTabName = AppTabName;

export type NowPlayingCatalogDestination =
  | {
      screen: ActiveTabName;
      params: { screen: 'Album'; params: AlbumRouteParams };
    }
  | {
      screen: ActiveTabName;
      params: { screen: 'Artist'; params: ArtistRouteParams };
    };

/** Backwards-compatible alias kept for callers importing the previous type name. */
export type NowPlayingDiscoverDestination = NowPlayingCatalogDestination;

export type NowPlayingNavigationOutcome = 'opened' | 'invalid' | 'not-ready';

/**
 * Inspect the root stack state for the currently selected bottom/rail tab,
 * delegating to `rootNavigation.resolveActiveTabName` so fallback behavior
 * (`'HomeTab'`) stays unified across the app.
 */
export function resolveActiveTabScreen(rootState: unknown): ActiveTabName {
  return resolveActiveTabName(rootState as Parameters<typeof resolveActiveTabName>[0]);
}

export function catalogAlbumDestination(
  params: AlbumRouteParams,
  targetTab: ActiveTabName = 'HomeTab',
): NowPlayingCatalogDestination {
  return { screen: targetTab, params: { screen: 'Album', params } };
}

export function catalogArtistDestination(
  params: ArtistRouteParams,
  targetTab: ActiveTabName = 'HomeTab',
): NowPlayingCatalogDestination {
  return { screen: targetTab, params: { screen: 'Artist', params } };
}

/** Exact nested destination used by the album-linked current title. */
export function nowPlayingAlbumDestination(
  track: Pick<Track, 'album_id' | 'album'>,
  targetTab: ActiveTabName = 'HomeTab',
): NowPlayingCatalogDestination | null {
  const params = trackAlbumRoute(track);
  return params === null ? null : catalogAlbumDestination(params, targetTab);
}

/** Exact selected credit—not an implicit primary artist—owns this destination. */
export function nowPlayingArtistDestination(
  artist: ArtistRef,
  targetTab: ActiveTabName = 'HomeTab',
): NowPlayingCatalogDestination | null {
  const params = trackArtistRoute({ artist_id: artist.id, artist: artist.name });
  return params === null ? null : catalogArtistDestination(params, targetTab);
}

/**
 * Push a validated track album onto the active tab's section stack via
 * `openAlbumInActiveTab` (using `StackActions.push` and top-route dedup).
 */
export function openNowPlayingAlbum(
  track: Pick<Track, 'album_id' | 'album'>,
): NowPlayingNavigationOutcome {
  const params = trackAlbumRoute(track);
  if (params === null) return 'invalid';
  return openAlbumInActiveTab(params);
}

/**
 * Push a validated credited artist onto the active tab's section stack via
 * `openArtistInActiveTab` (using `StackActions.push` and top-route dedup).
 */
export function openNowPlayingArtist(
  artist: ArtistRef,
): NowPlayingNavigationOutcome {
  const params = trackArtistRoute({ artist_id: artist.id, artist: artist.name });
  if (params === null) return 'invalid';
  return openArtistInActiveTab(params);
}

export function openNowPlayingCatalogAlbum(params: AlbumRouteParams): 'opened' | 'not-ready' {
  return openAlbumInActiveTab(params);
}

export function openNowPlayingCatalogArtist(params: ArtistRouteParams): 'opened' | 'not-ready' {
  return openArtistInActiveTab(params);
}
