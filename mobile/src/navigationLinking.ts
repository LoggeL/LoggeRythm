import { getStateFromPath as getReactNavigationStateFromPath } from '@react-navigation/core';
import type { LinkingOptions } from '@react-navigation/native';
import { mixKeyFromRouteValue, playlistIdFromRouteValue } from './navigationLinks';
import { normalizePartyCode } from './party/partyCode';
import { sanitizeNavigationState } from './navigationPersistence';
import { TRANSIENT_ROOT_ROUTE_NAMES } from './navigationPolicy';
import { getCurrentApiBase, PRODUCTION_API_BASE } from './config';
import type { RootStackParams } from './navigation';

export const appLinkingConfig: NonNullable<LinkingOptions<RootStackParams>['config']> = {
  initialRouteName: 'Tabs',
  screens: {
    Tabs: {
      initialRouteName: 'HomeTab',
      screens: {
        HomeTab: {
          initialRouteName: 'Home' as never,
          screens: {
            Home: '',
            Mix: {
              path: 'mix/:mixKey',
              parse: { mixKey: (value: string) => mixKeyFromRouteValue(value) ?? '' },
            },
            Radar: 'radar',
          },
        },
        SearchTab: { screens: { Search: 'search' } },
        DiscoverTab: {
          // Seed the Discover root so cold detail links retain a Back destination.
          initialRouteName: 'Discover' as never,
          screens: {
            Discover: 'genre',
            Album: 'album/:albumId',
            Genre: 'genre/:genreId',
            Artist: 'artist/:artistId',
            Playlist: {
              path: 'playlist/:playlistId',
              parse: { playlistId: playlistIdFromRouteValue },
            },
            UserProfile: {
              path: 'user/:userId',
              parse: { userId: playlistIdFromRouteValue },
            },
          },
        },
        RadioTab: { screens: { Radio: 'radio' } },
        LibraryTab: { screens: { Library: 'library' } },
      },
    },
    Profile: 'account',
    Insights: 'insights',
    NowPlaying: 'now-playing',
    Queue: 'queue',
    PartyStart: 'party/start',
    Party: {
      path: 'party/:code',
      parse: { code: (value: string) => normalizePartyCode(value) ?? '' },
    },
  },
};

/** Transient roots that carry params; every other transient root must have none. */
function hasValidTransientParams(name: unknown, params: unknown): boolean {
  if (name === 'Party') {
    if (params === null || typeof params !== 'object') return false;
    const keys = Object.keys(params);
    return keys.length === 1 && keys[0] === 'code' &&
      normalizePartyCode((params as { code?: unknown }).code) !== null;
  }
  return params === undefined || (
    params !== null && typeof params === 'object' && Object.keys(params).length === 0
  );
}

function isValidatedTransientLinkState(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const routes = (value as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || (routes.length !== 1 && routes.length !== 2)) return false;
  const transientIndex = routes.length - 1;
  if (routes.length === 2) {
    const placeholder = routes[0];
    if (placeholder === null || typeof placeholder !== 'object') return false;
    const candidate = placeholder as {
      name?: unknown;
      params?: unknown;
      path?: unknown;
      state?: unknown;
    };
    // React Navigation injects this empty initial-route placeholder. Accept no
    // state-bearing or parameter-bearing Tabs fallback here.
    if (
      candidate.name !== 'Tabs' ||
      candidate.params !== undefined ||
      candidate.path !== undefined ||
      candidate.state !== undefined
    ) return false;
  }
  const transient = routes[transientIndex];
  if (transient === null || typeof transient !== 'object') return false;
  const candidate = transient as { name?: unknown; params?: unknown };
  if (!TRANSIENT_ROOT_ROUTE_NAMES.includes(candidate.name as never)) return false;
  return hasValidTransientParams(candidate.name, candidate.params);
}

interface TransientRoute {
  name: (typeof TRANSIENT_ROOT_ROUTE_NAMES)[number];
  params?: object;
}

function transientRoute(value: unknown): TransientRoute | null {
  if (value === null || typeof value !== 'object') return null;
  const routes = (value as { routes?: unknown }).routes;
  if (!Array.isArray(routes)) return null;
  for (const route of routes) {
    if (route === null || typeof route !== 'object') continue;
    const { name, params } = route as { name?: unknown; params?: unknown };
    if (
      typeof name === 'string' &&
      (TRANSIENT_ROOT_ROUTE_NAMES as readonly string[]).includes(name)
    ) {
      const transientName = name as TransientRoute['name'];
      if (name === 'Party' && params !== null && typeof params === 'object') {
        return { name: transientName, params: { code: (params as { code?: unknown }).code } };
      }
      return { name: transientName };
    }
  }
  return null;
}

function transientStateWithHomeBack<T>(parsed: T): T {
  const route = transientRoute(parsed);
  if (route === null) return parsed;
  return {
    index: 1,
    routes: [
      {
        name: 'Tabs',
        state: {
          index: 0,
          routes: [{
            name: 'HomeTab',
            state: { index: 0, routes: [{ name: 'Home' }] },
          }],
        },
      },
      route,
    ],
  } as T;
}

export function validateAppLinkedState<T>(parsed: T | undefined): T | undefined {
  if (parsed === undefined) return undefined;
  if (sanitizeNavigationState(parsed) !== null) {
    return transientRoute(parsed) === null ? parsed : transientStateWithHomeBack(parsed);
  }
  return isValidatedTransientLinkState(parsed)
    ? transientStateWithHomeBack(parsed)
    : undefined;
}

/** Parse with React Navigation, then reject any path that cannot form a safe durable state. */
export function getAppStateFromPath(path: string) {
  const parsed = getReactNavigationStateFromPath<RootStackParams>(path, appLinkingConfig);
  // Validation and persistence are deliberately separate: a safe transient
  // root remains the cold destination but will never be persisted.
  return validateAppLinkedState(parsed);
}

/**
 * Production HTTPS/app-scheme links must never be rebound to a custom account
 * origin. Custom-server navigation remains in-app and origin-scoped.
 */
export function isAppLinkAllowedForActiveServer(url: string): boolean {
  if (getCurrentApiBase() !== PRODUCTION_API_BASE) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'loggerythm:'
      || parsed.origin === PRODUCTION_API_BASE;
  } catch {
    return false;
  }
}

export const appLinking: LinkingOptions<RootStackParams> = {
  prefixes: ['https://loggerythm.logge.top', 'loggerythm://'],
  config: appLinkingConfig,
  filter: isAppLinkAllowedForActiveServer,
  getStateFromPath: (path, options) => {
    const parsed = getReactNavigationStateFromPath<RootStackParams>(path, options);
    return validateAppLinkedState(parsed);
  },
};
