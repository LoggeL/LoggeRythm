import {
  createNavigationContainerRef,
  StackActions,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native';
import type { Track } from '../api/types';
import { navigateToSearch } from '../navigationActions';
import { trackAlbumRoute, trackArtistRoute } from '../navigationLinks';
import type { AlbumRouteParams, ArtistRouteParams } from '../screens/catalogModel';
import type { TvNavDestinationKey } from '../tv';
import type { RootStackParams } from './types';

/** The one container ref: imperative navigation from outside the React tree. */
export const rootNavigation = createNavigationContainerRef<RootStackParams>();

export type TrackDetailNavigationResult = 'opened' | 'invalid-track' | 'not-ready';

export const APP_TAB_NAMES = [
  'HomeTab',
  'DiscoverTab',
  'SearchTab',
  'RadioTab',
  'LibraryTab',
] as const;

export type AppTabName = (typeof APP_TAB_NAMES)[number];

type NavStateLike =
  | NavigationState
  | PartialState<NavigationState>
  | {
      readonly key?: string;
      readonly index?: number;
      readonly routes?: readonly {
        readonly name: string;
        readonly params?: Record<string, unknown>;
        readonly state?: NavStateLike;
      }[];
    }
  | null
  | undefined;

function isAppTabName(value: unknown): value is AppTabName {
  return typeof value === 'string' && (APP_TAB_NAMES as readonly string[]).includes(value);
}

function activeChildRoute(state: NavStateLike) {
  const routes = state?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;
  const rawIndex = state?.index;
  const index =
    typeof rawIndex === 'number' && Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < routes.length
      ? rawIndex
      : routes.length - 1;
  return routes[index] ?? null;
}

function findTabsRoute(state: NavStateLike) {
  const routes = state?.routes;
  if (!Array.isArray(routes)) return null;
  return routes.find((route) => route.name === 'Tabs') ?? null;
}

/**
 * Resolves the currently active tab inside `Tabs`, even while a transient root
 * modal (`NowPlaying`, `Queue`, `Profile`, `Party`) is stacked above `Tabs`.
 * Defaults to `'HomeTab'` before tab state is initialized.
 */
export function resolveActiveTabName(state: NavStateLike): AppTabName {
  const tabsRoute = findTabsRoute(state);
  const activeTab = activeChildRoute(tabsRoute?.state);
  if (activeTab !== null && isAppTabName(activeTab.name)) {
    return activeTab.name;
  }
  return 'HomeTab';
}

const PROFILE_FAMILY_ROUTES: ReadonlySet<string> = new Set([
  'Profile',
  'PlaybackSettings',
  'DevicesStorageSettings',
  'AccountAppSettings',
  'Insights',
]);

/** Resolves the active destination key for the Android TV left navigation rail. */
export function resolveActiveTvRoute(state: NavStateLike): TvNavDestinationKey {
  const topRoot = activeChildRoute(state);
  if (topRoot?.name === 'NowPlaying' || topRoot?.name === 'Queue') {
    return topRoot.name;
  }
  if (topRoot !== null && PROFILE_FAMILY_ROUTES.has(topRoot.name)) {
    return 'Profile';
  }
  return resolveActiveTabName(state);
}

function matchesDetailRoute(
  topRoute: { readonly name: string; readonly params?: Readonly<object> } | null,
  screen: 'Album' | 'Artist',
  params: AlbumRouteParams | ArtistRouteParams,
): boolean {
  if (topRoute === null || topRoute.name !== screen || !topRoute.params) return false;
  const routeParams = topRoute.params as Record<string, unknown>;
  if (screen === 'Album') {
    return String(routeParams.albumId ?? '') === String((params as AlbumRouteParams).albumId);
  }
  return String(routeParams.artistId ?? '') === String((params as ArtistRouteParams).artistId);
}

function openDetailInActiveTab(
  screen: 'Album',
  params: AlbumRouteParams,
): 'opened' | 'not-ready';
function openDetailInActiveTab(
  screen: 'Artist',
  params: ArtistRouteParams,
): 'opened' | 'not-ready';
function openDetailInActiveTab(
  screen: 'Album' | 'Artist',
  params: AlbumRouteParams | ArtistRouteParams,
): 'opened' | 'not-ready' {
  if (!rootNavigation.isReady()) return 'not-ready';
  const rootState = typeof rootNavigation.getRootState === 'function'
    ? rootNavigation.getRootState()
    : undefined;
  const activeTab = resolveActiveTabName(rootState);
  const topRoot = activeChildRoute(rootState);
  const onTabsRoot = topRoot === null || topRoot.name === 'Tabs';
  const tabsRoute = findTabsRoute(rootState);
  const tabRoute = activeChildRoute(tabsRoute?.state);
  const sectionState = tabRoute?.state;
  const topSectionRoute = activeChildRoute(sectionState);

  // If the active tab is already displaying this exact album/artist, avoid pushing a duplicate.
  if (matchesDetailRoute(topSectionRoute, screen, params)) {
    if (!onTabsRoot) {
      rootNavigation.navigate('Tabs', { screen: activeTab });
    }
    return 'opened';
  }

  // Push onto the active tab's own section stack so Back always returns to the caller's screen.
  const sectionKey = sectionState && 'key' in sectionState && typeof sectionState.key === 'string'
    ? sectionState.key
    : null;
  if (sectionKey !== null && typeof rootNavigation.dispatch === 'function') {
    if (!onTabsRoot) {
      rootNavigation.navigate('Tabs', { screen: activeTab });
    }
    rootNavigation.dispatch({
      ...StackActions.push(screen, params),
      target: sectionKey,
    });
    return 'opened';
  }

  // Before the active tab stack has a mounted navigator key, navigate into the active tab.
  if (screen === 'Album') {
    rootNavigation.navigate('Tabs', {
      screen: activeTab,
      params: { screen: 'Album', params: params as AlbumRouteParams },
    });
  } else {
    rootNavigation.navigate('Tabs', {
      screen: activeTab,
      params: { screen: 'Artist', params: params as ArtistRouteParams },
    });
  }
  return 'opened';
}

/** Push a validated album detail screen onto the active tab's stack (never hijacking to DiscoverTab). */
export function openAlbumInActiveTab(params: AlbumRouteParams): 'opened' | 'not-ready' {
  return openDetailInActiveTab('Album', params);
}

/** Push a validated artist detail screen onto the active tab's stack (never hijacking to DiscoverTab). */
export function openArtistInActiveTab(params: ArtistRouteParams): 'opened' | 'not-ready' {
  return openDetailInActiveTab('Artist', params);
}

/** Route global track actions through the active tab's stack while validating track refs. */
export function openTrackAlbum(track: Track): TrackDetailNavigationResult {
  const params = trackAlbumRoute(track);
  if (params === null) return 'invalid-track';
  return openAlbumInActiveTab(params);
}

export function openTrackArtist(track: Track): TrackDetailNavigationResult {
  const params = trackArtistRoute(track);
  if (params === null) return 'invalid-track';
  return openArtistInActiveTab(params);
}

/** Shared-text import lands on the Search tab; false while the container is not mounted. */
export function openSpotifyImport(): boolean {
  if (!rootNavigation.isReady()) return false;
  navigateToSearch(rootNavigation);
  return true;
}
