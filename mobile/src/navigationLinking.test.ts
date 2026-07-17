import { getStateFromPath } from '@react-navigation/core';
import { describe, expect, it } from 'vitest';
import {
  appLinkingConfig,
  getAppStateFromPath,
  isAppLinkAllowedForActiveServer,
  validateAppLinkedState,
} from './navigationLinking';
import { activateApiBase, resetApiBase } from './config';

interface RouteLike {
  name?: string;
  params?: Record<string, unknown>;
  state?: unknown;
}

function findRoute(state: unknown, name: string): RouteLike | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const routes = (state as { routes?: unknown }).routes;
  if (!Array.isArray(routes)) return undefined;
  for (const value of routes) {
    if (value === null || typeof value !== 'object') continue;
    const route = value as RouteLike;
    if (route.name === name) return route;
    const nested = findRoute(route.state, name);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

describe('cold app-link state construction', () => {
  it.each([
    ['album/302127', 'Album', { albumId: '302127' }],
    ['artist/42', 'Artist', { artistId: '42' }],
    ['genre/7', 'Genre', { genreId: '7' }],
    ['playlist/17-road-trip', 'Playlist', { playlistId: 17 }],
  ])('uses React Navigation for %s and seeds Discover Back', (path, target, params) => {
    const parsed = getStateFromPath(path, appLinkingConfig);
    expect(findRoute(parsed, 'Discover')).toBeDefined();
    expect(findRoute(parsed, target)?.params).toMatchObject(params);

    const validated = getAppStateFromPath(path);
    expect(findRoute(validated, 'Discover')).toBeDefined();
    expect(findRoute(validated, target)?.params).toMatchObject(params);
  });

  it.each([
    'album/0',
    'album/not-a-number',
    'artist/-1',
    'genre/12%2Fprivate',
    'playlist/0-list',
    'playlist/name-only',
  ])('rejects an unsafe detail parameter in %s', (path) => {
    expect(getAppStateFromPath(path)).toBeUndefined();
  });

  it.each([
    ['account', 'Profile'],
    ['now-playing', 'NowPlaying'],
    ['queue', 'Queue'],
  ])('retains the validated transient destination for %s', (path, target) => {
    const state = getAppStateFromPath(path);
    expect(state?.index).toBe(1);
    expect(state?.routes.map((route) => route.name)).toEqual(['Tabs', target]);
    expect(findRoute(state, 'Home')).toBeDefined();
    expect(findRoute(state, target)).toBeDefined();
  });

  it('rejects a malformed Tabs route even when followed by a params-free transient route', () => {
    expect(validateAppLinkedState({
      routes: [
        { name: 'Tabs', state: { routes: [{ name: 'UnknownTab' }] } },
        { name: 'Profile' },
      ],
    })).toBeUndefined();
  });

  it('does not bind production or originless app links to a custom session', () => {
    resetApiBase();
    expect(isAppLinkAllowedForActiveServer(
      'https://loggerythm.logge.top/playlist/7',
    )).toBe(true);
    expect(isAppLinkAllowedForActiveServer('loggerythm://playlist/7')).toBe(true);

    activateApiBase('https://music.example.test');
    expect(isAppLinkAllowedForActiveServer(
      'https://loggerythm.logge.top/playlist/7',
    )).toBe(false);
    expect(isAppLinkAllowedForActiveServer('loggerythm://playlist/7')).toBe(false);
    resetApiBase();
  });
});
