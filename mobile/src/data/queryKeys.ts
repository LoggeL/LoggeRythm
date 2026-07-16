import type { DeezerId, TrackPlayQuery } from '../api/types';

export type QueryScope = string | number;

function scalar(value: QueryScope, label: string): string {
  const normalized = String(value).trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

export function normalizeSearchQuery(query: string): string {
  return query.trim();
}

export function canonicalDeezerIds(ids: readonly DeezerId[]): DeezerId[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

export function trackPlaySignature(
  tracks: readonly TrackPlayQuery[],
): readonly (readonly [DeezerId, string, string])[] {
  return tracks.map(({ id, artist, title }) => [id, artist, title] as const);
}

const root = ['music'] as const;

export const queryKeys = {
  root,
  search: {
    root: () => [...root, 'search'] as const,
    tracks: (query: string) =>
      [...queryKeys.search.root(), 'track', normalizeSearchQuery(query)] as const,
    albums: (query: string) =>
      [...queryKeys.search.root(), 'album', normalizeSearchQuery(query)] as const,
    artists: (query: string) =>
      [...queryKeys.search.root(), 'artist', normalizeSearchQuery(query)] as const,
    playlists: (query: string) =>
      [...queryKeys.search.root(), 'playlist', normalizeSearchQuery(query)] as const,
  },
  catalog: {
    root: () => [...root, 'catalog'] as const,
    charts: () => [...queryKeys.catalog.root(), 'charts'] as const,
    genres: () => [...queryKeys.catalog.root(), 'genres'] as const,
    genre: (id: DeezerId) => [...queryKeys.catalog.genres(), scalar(id, 'genre id')] as const,
    newReleases: () => [...queryKeys.catalog.root(), 'new-releases'] as const,
    track: (id: DeezerId) => [...queryKeys.catalog.root(), 'track', scalar(id, 'track id')] as const,
    album: (id: DeezerId) => [...queryKeys.catalog.root(), 'album', scalar(id, 'album id')] as const,
    artist: (id: DeezerId) =>
      [...queryKeys.catalog.root(), 'artist', scalar(id, 'artist id')] as const,
    artistAbout: (name: string) =>
      [...queryKeys.catalog.root(), 'artist-about', scalar(name, 'artist name')] as const,
  },
  radio: {
    root: () => [...root, 'radio'] as const,
    similar: (seedId: DeezerId) =>
      [...queryKeys.radio.root(), 'similar', scalar(seedId, 'radio seed id')] as const,
  },
  external: {
    root: () => [...root, 'external'] as const,
    resolve: (url: string) =>
      [...queryKeys.external.root(), 'resolve', scalar(url, 'external URL')] as const,
    deezerPlaylist: (id: DeezerId) =>
      [...queryKeys.external.root(), 'deezer-playlist', scalar(id, 'Deezer playlist id')] as const,
  },
  lyrics: (artist: string, title: string, deezerId?: DeezerId) =>
    [
      ...root,
      'lyrics',
      scalar(artist, 'lyrics artist'),
      scalar(title, 'lyrics title'),
      deezerId === undefined ? null : scalar(deezerId, 'lyrics track id'),
    ] as const,
  storage: {
    root: () => [...root, 'storage'] as const,
    cachedTrackIds: () => [...queryKeys.storage.root(), 'cached-track-ids'] as const,
  },
  plays: {
    root: () => [...root, 'plays'] as const,
    counts: (tracks: readonly TrackPlayQuery[]) =>
      [...queryKeys.plays.root(), 'counts', trackPlaySignature(tracks)] as const,
  },
  playlists: {
    root: () => [...root, 'playlists'] as const,
    scoped: (scope: QueryScope) =>
      [...queryKeys.playlists.root(), 'scope', scalar(scope, 'playlist scope')] as const,
    owned: (scope: QueryScope) => [...queryKeys.playlists.scoped(scope), 'owned'] as const,
    public: (scope: QueryScope) => [...queryKeys.playlists.scoped(scope), 'public'] as const,
    detail: (scope: QueryScope, id: number) =>
      [...queryKeys.playlists.scoped(scope), 'detail', scalar(id, 'playlist id')] as const,
  },
  library: {
    root: (scope: QueryScope) =>
      [...root, 'library', scalar(scope, 'library scope')] as const,
    likes: (scope: QueryScope) => [...queryKeys.library.root(scope), 'likes'] as const,
  },
  home: {
    root: () => [...root, 'home'] as const,
    personalized: (scope: QueryScope) =>
      [...queryKeys.home.root(), 'scope', scalar(scope, 'home scope')] as const,
    mixes: (scope: QueryScope) => [...queryKeys.home.personalized(scope), 'mixes'] as const,
    becauseYouListened: (scope: QueryScope) =>
      [...queryKeys.home.personalized(scope), 'because-you-listened'] as const,
    releaseRadar: (scope: QueryScope) =>
      [...queryKeys.home.personalized(scope), 'release-radar'] as const,
    chartCollections: () => [...queryKeys.home.root(), 'charts-collections'] as const,
    mood: (tag: string) => [...queryKeys.home.root(), 'mood', scalar(tag, 'mood tag')] as const,
  },
  follows: {
    root: (scope: QueryScope) =>
      [...root, 'follows', scalar(scope, 'follow scope')] as const,
    artists: (scope: QueryScope) => [...queryKeys.follows.root(scope), 'artists'] as const,
    contains: (scope: QueryScope, ids: readonly DeezerId[]) =>
      [...queryKeys.follows.artists(scope), 'contains', canonicalDeezerIds(ids)] as const,
  },
  profile: {
    root: () => [...root, 'profile'] as const,
    public: (userId: QueryScope) =>
      [...queryKeys.profile.root(), 'public', scalar(userId, 'profile user id')] as const,
    privateRoot: () => [...queryKeys.profile.root(), 'private'] as const,
    private: (scope: QueryScope) =>
      [...queryKeys.profile.privateRoot(), scalar(scope, 'profile scope')] as const,
    stats: (scope: QueryScope) => [...queryKeys.profile.private(scope), 'stats'] as const,
    settings: (scope: QueryScope) => [...queryKeys.profile.private(scope), 'settings'] as const,
  },
  party: {
    root: () => [...root, 'party'] as const,
    state: (scope: QueryScope, code: string) =>
      [
        ...queryKeys.party.root(),
        'scope',
        scalar(scope, 'party scope'),
        scalar(code, 'party code'),
      ] as const,
  },
  admin: {
    root: (scope: QueryScope) => [...root, 'admin', scalar(scope, 'admin scope')] as const,
    users: (scope: QueryScope) => [...queryKeys.admin.root(scope), 'users'] as const,
    status: (scope: QueryScope) => [...queryKeys.admin.root(scope), 'status'] as const,
    storage: (scope: QueryScope) => [...queryKeys.admin.root(scope), 'storage'] as const,
    invites: (scope: QueryScope) => [...queryKeys.admin.root(scope), 'invites'] as const,
  },
};
