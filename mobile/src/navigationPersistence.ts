import type { InitialState } from '@react-navigation/native';
import {
  deezerReferenceIdFromRouteValue,
  mixKeyFromRouteValue,
  playlistIdFromRouteValue,
} from './navigationLinks';
import { TRANSIENT_ROOT_ROUTE_NAMES } from './navigationPolicy';

export const NAVIGATION_STATE_VERSION = 1 as const;
export const NAVIGATION_STATE_PREFIX = `lr.navigation-state.v${NAVIGATION_STATE_VERSION}:`;
export const MAX_NAVIGATION_STATE_CHARS = 16_384;

const MAX_SECTION_ROUTES = 12;
const MAX_LABEL_LENGTH = 200;

const TAB_ROOTS = {
  HomeTab: 'Home',
  SearchTab: 'Search',
  DiscoverTab: 'Discover',
  RadioTab: 'Radio',
  LibraryTab: 'Library',
} as const;

type TabName = keyof typeof TAB_ROOTS;

export interface NavigationStateStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

interface SanitizedRoute {
  readonly name: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly state?: SanitizedState;
}

interface SanitizedState {
  readonly index: number;
  readonly routes: readonly SanitizedRoute[];
}

const pendingWrites = new Map<string, Promise<void>>();

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function normalizedAccountScope(accountScope: string): string {
  const normalized = accountScope.trim();
  if (normalized.length === 0) throw new Error('Navigation storage scope must not be empty');
  return normalized;
}

export function navigationStateStorageKey(accountScope: string): string {
  return `${NAVIGATION_STATE_PREFIX}${encodeURIComponent(normalizedAccountScope(accountScope))}`;
}

function label(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_LABEL_LENGTH
    ? normalized
    : undefined;
}

function route(name: string, params?: Readonly<Record<string, unknown>>): SanitizedRoute {
  return params === undefined ? { name } : { name, params };
}

function sanitizeSectionRoute(value: unknown): SanitizedRoute | null {
  const candidate = record(value);
  if (candidate === null || typeof candidate.name !== 'string') return null;
  const params = record(candidate.params) ?? {};
  switch (candidate.name) {
    case 'Home':
    case 'Search':
    case 'Discover':
    case 'Radio':
    case 'Library':
    case 'Radar':
      return route(candidate.name);
    case 'Mix': {
      const mixKey = mixKeyFromRouteValue(params.mixKey);
      if (mixKey === null) return null;
      const title = label(params.title);
      return route('Mix', { mixKey, ...(title === undefined ? {} : { title }) });
    }
    case 'Album': {
      const albumId = deezerReferenceIdFromRouteValue(params.albumId);
      if (albumId === null) return null;
      const title = label(params.title);
      return route('Album', { albumId, ...(title === undefined ? {} : { title }) });
    }
    case 'Genre': {
      const genreId = deezerReferenceIdFromRouteValue(params.genreId);
      if (genreId === null) return null;
      const name = label(params.name);
      return route('Genre', { genreId, ...(name === undefined ? {} : { name }) });
    }
    case 'Artist': {
      const artistId = deezerReferenceIdFromRouteValue(params.artistId);
      if (artistId === null) return null;
      const name = label(params.name);
      return route('Artist', { artistId, ...(name === undefined ? {} : { name }) });
    }
    case 'Playlist': {
      const name = label(params.name) ?? '';
      if (params.kind === 'liked') return route('Playlist', { kind: 'liked', name });
      const playlistId = playlistIdFromRouteValue(params.playlistId);
      if (playlistId === null) return null;
      return route('Playlist', { kind: 'playlist', playlistId, name });
    }
    default:
      return null;
  }
}

function stateIndex(value: unknown, routeCount: number): number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < routeCount
    ? Number(value)
    : routeCount - 1;
}

function sanitizeSectionState(value: unknown, requiredRoot: string): SanitizedState | null {
  const candidate = record(value);
  if (candidate === null || !Array.isArray(candidate.routes)) return null;
  if (candidate.routes.length === 0 || candidate.routes.length > MAX_SECTION_ROUTES) return null;
  const routes: SanitizedRoute[] = [];
  for (const entry of candidate.routes) {
    const sanitized = sanitizeSectionRoute(entry);
    if (sanitized === null) return null;
    routes.push(sanitized);
  }
  if (routes[0]?.name !== requiredRoot) return null;
  return { index: stateIndex(candidate.index, routes.length), routes };
}

function isTabName(value: unknown): value is TabName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TAB_ROOTS, value);
}

function sanitizeTabRoute(value: unknown): SanitizedRoute | null {
  const candidate = record(value);
  if (candidate === null || !isTabName(candidate.name)) return null;
  if (candidate.state === undefined) return route(candidate.name);
  const state = sanitizeSectionState(candidate.state, TAB_ROOTS[candidate.name]);
  return state === null ? null : { name: candidate.name, state };
}

function sanitizeTabState(value: unknown): SanitizedState | null {
  const candidate = record(value);
  if (candidate === null || !Array.isArray(candidate.routes)) return null;
  if (candidate.routes.length === 0 || candidate.routes.length > Object.keys(TAB_ROOTS).length) {
    return null;
  }
  const routes: SanitizedRoute[] = [];
  const names = new Set<string>();
  for (const entry of candidate.routes) {
    const sanitized = sanitizeTabRoute(entry);
    if (sanitized === null || names.has(sanitized.name)) return null;
    names.add(sanitized.name);
    routes.push(sanitized);
  }
  return { index: stateIndex(candidate.index, routes.length), routes };
}

/**
 * Retain only Tabs and its feature stacks. Route keys, history, paths, unknown
 * params, Profile, Now Playing, and Queue are intentionally discarded.
 */
export function sanitizeNavigationState(value: unknown): InitialState | null {
  const candidate = record(value);
  if (candidate === null || !Array.isArray(candidate.routes)) return null;
  const allowedRootNames = new Set<string>(['Tabs', ...TRANSIENT_ROOT_ROUTE_NAMES]);
  if (candidate.routes.some((entry) => {
    const candidateRoute = record(entry);
    return candidateRoute === null || !allowedRootNames.has(String(candidateRoute.name));
  })) return null;
  const tabRoutes = candidate.routes.filter((entry) => record(entry)?.name === 'Tabs');
  if (tabRoutes.length !== 1) return null;
  const tabRoute = record(tabRoutes[0]);
  const state = sanitizeTabState(tabRoute?.state);
  if (state === null) return null;
  return { index: 0, routes: [{ name: 'Tabs', state }] } as InitialState;
}

async function writeNavigationState(
  storage: NavigationStateStorage,
  accountScope: string,
  value: unknown,
): Promise<void> {
  const key = navigationStateStorageKey(accountScope);
  const state = sanitizeNavigationState(value);
  if (state === null) {
    await storage.removeItem(key);
    return;
  }
  const serialized = JSON.stringify({ version: NAVIGATION_STATE_VERSION, state });
  if (serialized.length > MAX_NAVIGATION_STATE_CHARS) {
    await storage.removeItem(key);
    return;
  }
  await storage.setItem(key, serialized);
}

/** Serialize writes so a slow older snapshot cannot overwrite a newer one. */
export function persistNavigationState(
  storage: NavigationStateStorage,
  accountScope: string,
  value: unknown,
): Promise<void> {
  const scope = normalizedAccountScope(accountScope);
  const previous = pendingWrites.get(scope) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => writeNavigationState(storage, scope, value));
  pendingWrites.set(scope, task);
  void task.then(
    () => {
      if (pendingWrites.get(scope) === task) pendingWrites.delete(scope);
    },
    () => {
      if (pendingWrites.get(scope) === task) pendingWrites.delete(scope);
    },
  );
  return task;
}

export async function waitForNavigationStateWrites(accountScope: string | null): Promise<void> {
  if (accountScope === null) {
    await Promise.all([...pendingWrites.values()].map((write) => write.catch(() => undefined)));
    return;
  }
  await pendingWrites.get(normalizedAccountScope(accountScope))?.catch(() => undefined);
}

export async function readNavigationState(
  storage: NavigationStateStorage,
  accountScope: string,
): Promise<InitialState | null> {
  const scope = normalizedAccountScope(accountScope);
  await waitForNavigationStateWrites(scope);
  const key = navigationStateStorageKey(scope);
  const serialized = await storage.getItem(key);
  if (serialized === null) return null;
  if (serialized.length === 0 || serialized.length > MAX_NAVIGATION_STATE_CHARS) {
    await storage.removeItem(key);
    return null;
  }
  try {
    const envelope = record(JSON.parse(serialized));
    if (envelope?.version !== NAVIGATION_STATE_VERSION) throw new Error('version');
    const state = sanitizeNavigationState(envelope.state);
    if (state === null) throw new Error('state');
    return state;
  } catch {
    await storage.removeItem(key);
    return null;
  }
}

/** A cold app link always wins; persisted navigation is consulted only after a proven null URL. */
export async function readNavigationStateUnlessLinked(
  storage: NavigationStateStorage,
  accountScope: string,
  getInitialUrl: () => Promise<string | null>,
): Promise<InitialState | null> {
  let initialUrl: string | null;
  try {
    initialUrl = await getInitialUrl();
  } catch {
    return null;
  }
  if (typeof initialUrl === 'string' && initialUrl.trim().length > 0) return null;
  return readNavigationState(storage, accountScope);
}
