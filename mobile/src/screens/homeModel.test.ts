import { describe, expect, it } from 'vitest';
import type { HomeShelf, RecentPlay } from '../api/types';
import {
  assertHomeRouteCallbacks,
  findHomeMix,
  formatRadarReleaseDate,
  greetingKeyForHour,
  homeAlbumRoute,
  homeDisplayName,
  homeGenreRoute,
  homeMixRoute,
  homePlaylistRoute,
  homeQueueContext,
  homeRecentShelf,
  recentCatalogRoutes,
  testIdSegment,
} from './homeModel';

function recent(overrides: Partial<RecentPlay> = {}): RecentPlay {
  return {
    id: 'track-1',
    title: 'Midnight Signal',
    artist: 'Primary Artist',
    artist_id: '42',
    artists: [{ id: '42', name: 'Primary Artist' }],
    album: 'Night Drive',
    album_id: '17',
    cover: '',
    duration_sec: 180,
    ...overrides,
  };
}

describe('home model', () => {
  it('selects deterministic German greeting periods', () => {
    expect(greetingKeyForHour(0)).toBe('greetingNight');
    expect(greetingKeyForHour(5)).toBe('greetingMorning');
    expect(greetingKeyForHour(11)).toBe('greetingDay');
    expect(greetingKeyForHour(18)).toBe('greetingEvening');
    expect(() => greetingKeyForHour(24)).toThrow('0 to 23');
  });

  it('normalizes optional names and stable automation ids', () => {
    expect(homeDisplayName('  Ada  ')).toBe('Ada');
    expect(homeDisplayName('  ')).toBeNull();
    expect(testIdSegment('Top 50 – Global')).toBe('top-50-global');
  });

  it('fails loudly when navigation callbacks are not integrated', () => {
    expect(() => assertHomeRouteCallbacks({})).toThrow('HomeScreen requires');
    expect(() =>
      assertHomeRouteCallbacks({
        onOpenAlbum: () => undefined,
        onOpenArtist: () => undefined,
        onOpenGenre: () => undefined,
        onOpenPlaylist: () => undefined,
        onOpenMix: () => undefined,
        onOpenRadar: () => undefined,
      }),
    ).not.toThrow();
  });

  it('routes recent history to exact album and primary-artist catalog identities', () => {
    expect(recentCatalogRoutes(recent())).toEqual({
      album: { albumId: '17', title: 'Night Drive' },
      artist: { artistId: '42', name: 'Primary Artist' },
    });
    expect(
      recentCatalogRoutes(recent({ album_id: ' 00017 ', artist_id: ' 00042 ' })),
    ).toEqual({
      album: { albumId: '00017', title: 'Night Drive' },
      artist: { artistId: '00042', name: 'Primary Artist' },
    });
  });

  it('routes a public Home playlist to the shared detail screen without a slug guess', () => {
    expect(homePlaylistRoute({ id: 17, name: '  Community Signals  ' })).toEqual({
      playlistId: 17,
      name: 'Community Signals',
    });
    expect(() => homePlaylistRoute({ id: 0, name: 'Invalid' })).toThrow('positive integer');
    expect(() => homePlaylistRoute({ id: 17, name: ' ' })).toThrow('must not be empty');
  });

  it('routes album and genre cards by canonical catalog identity', () => {
    expect(homeAlbumRoute({ id: ' 313 ', title: '  Parity  ' })).toEqual({
      albumId: '313',
      title: 'Parity',
    });
    expect(homeGenreRoute({ id: ' 8 ', name: '  Jazz  ' })).toEqual({
      genreId: '8',
      name: 'Jazz',
    });
    expect(() => homeAlbumRoute({ id: ' ', title: 'No identity' })).toThrow(
      'album id must not be empty',
    );
    expect(() => homeGenreRoute({ id: '8', name: ' ' })).toThrow(
      'genre name must not be empty',
    );
  });

  it('builds a stable mix route and resolves only the exact returned shelf key', () => {
    const shelf: HomeShelf = {
      key: 'daily-focus',
      title: '  Daily Focus  ',
      subtitle: 'For Ada',
      cover: '',
      tracks: [],
    };

    expect(homeMixRoute(shelf)).toEqual({ mixKey: 'daily-focus', title: 'Daily Focus' });
    expect(findHomeMix([shelf], ' daily-focus ')).toBe(shelf);
    expect(findHomeMix([shelf], 'other')).toBeNull();
    expect(() => findHomeMix([shelf], ' ')).toThrow('must not be empty');
  });

  it('assigns every directly playable Home card a stable semantic queue context', () => {
    const shelf = { key: ' artist-42 ', title: ' Because Ada ' };
    expect(homeQueueContext({ kind: 'mood', moodKey: 'focus', label: ' Focus for you ' }))
      .toEqual({ type: 'home', id: 'mood:focus', label: 'Focus for you' });
    expect(homeQueueContext({ kind: 'release-radar', label: ' Release Radar ' })).toEqual({
      type: 'home',
      id: 'release-radar',
      label: 'Release Radar',
    });
    expect(homeQueueContext({ kind: 'because', shelf })).toEqual({
      type: 'home',
      id: 'because:artist-42',
      label: 'Because Ada',
    });
    expect(homeQueueContext({ kind: 'chart-collection', shelf })).toEqual({
      type: 'chart',
      id: 'collection:artist-42',
      label: 'Because Ada',
    });
    expect(homeQueueContext({ kind: 'charts', label: ' Charts ' })).toEqual({
      type: 'chart',
      id: 'home',
      label: 'Charts',
    });
    expect(() => homeQueueContext({ kind: 'mood', moodKey: 'top', label: 'Top' })).toThrow(
      'not a playable mood',
    );
    expect(() => homeQueueContext({ kind: 'because', shelf: { ...shelf, key: ' ' } })).toThrow(
      'mix key must not be empty',
    );
  });

  it('formats radar dates with the production web calendar-day thresholds', () => {
    const copy = {
      today: 'today',
      yesterday: 'yesterday',
      daysAgo: (days: number) => `${days} days ago`,
      oneWeekAgo: 'one week ago',
      weeksAgo: (weeks: number) => `${weeks} weeks ago`,
      oneMonthAgo: 'one month ago',
      monthsAgo: (months: number) => `${months} months ago`,
    };
    const now = new Date(2026, 6, 16, 12, 0, 0);

    expect(formatRadarReleaseDate('2026-07-16', now, copy)).toBe('today');
    expect(formatRadarReleaseDate('2026-07-17', now, copy)).toBe('today');
    expect(formatRadarReleaseDate('2026-07-15', now, copy)).toBe('yesterday');
    expect(formatRadarReleaseDate('2026-07-11', now, copy)).toBe('5 days ago');
    expect(formatRadarReleaseDate('2026-07-09', now, copy)).toBe('one week ago');
    expect(formatRadarReleaseDate('2026-06-26', now, copy)).toBe('2 weeks ago');
    expect(formatRadarReleaseDate('2026-06-15', now, copy)).toBe('one month ago');
    expect(formatRadarReleaseDate('2026-05-16', now, copy)).toBe('2 months ago');
    expect(formatRadarReleaseDate('2026-02-30', now, copy)).toBe('');
    expect(formatRadarReleaseDate('not-a-date', now, copy)).toBe('');
  });

  it('shows the first seven history events without mutating or deduplicating full context', () => {
    const fullHistory = Array.from({ length: 9 }, (_, index) =>
      recent({ id: index === 6 ? 'duplicate' : String(index), title: `History ${index}` }),
    );
    fullHistory[8] = recent({ id: 'duplicate', title: 'Older duplicate' });

    const shelf = homeRecentShelf(fullHistory);

    expect(shelf).toEqual(fullHistory.slice(0, 7));
    expect(shelf.map((play) => play.id)).toEqual(['0', '1', '2', '3', '4', '5', 'duplicate']);
    expect(fullHistory).toHaveLength(9);
    expect(fullHistory[8].id).toBe('duplicate');
    expect(() => homeRecentShelf(fullHistory, -1)).toThrow('non-negative integer');
  });

  it('omits invalid legacy routes and labels fallback artist identities correctly', () => {
    expect(
      recentCatalogRoutes(
        recent({
          artist: 'Legacy display artist',
          artist_id: ' ',
          artists: [{ id: 42, name: 'Credited Artist' }],
          album: ' ',
          album_id: '',
        }),
      ),
    ).toEqual({
      album: null,
      artist: { artistId: '42', name: 'Credited Artist' },
    });
  });

  it('checks every credited artist in order and uses the first valid fallback identity', () => {
    expect(
      recentCatalogRoutes(
        recent({
          artist: 'Legacy display artist',
          artist_id: 'artist-primary',
          artists: [
            { id: 'artist-one', name: 'Alphanumeric' },
            { id: 0, name: 'Zero' },
            { id: -2, name: 'Negative' },
            { id: Number.MAX_SAFE_INTEGER + 1, name: 'Unsafe' },
            { id: '0007', name: '  First valid credit  ' },
            { id: 8, name: 'Later valid credit' },
          ],
        }),
      ),
    ).toEqual({
      album: { albumId: '17', title: 'Night Drive' },
      artist: { artistId: '0007', name: 'First valid credit' },
    });
  });

  it.each([
    ['alphanumeric', 'album-1'],
    ['zero', '0'],
    ['negative', '-1'],
    ['too long', '1'.repeat(33)],
  ])('rejects %s persisted history ids instead of exposing a catalog route', (_label, id) => {
    expect(
      recentCatalogRoutes(
        recent({
          album_id: id,
          artist_id: id,
          artists: [{ id, name: 'Invalid credit' }],
        }),
      ),
    ).toEqual({ album: null, artist: null });
  });

  it('rejects unsafe numeric history ids at the runtime boundary', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expect(
      recentCatalogRoutes(
        recent({
          album_id: unsafe as unknown as string,
          artist_id: unsafe as unknown as string,
          artists: [{ id: unsafe, name: 'Unsafe credit' }],
        }),
      ),
    ).toEqual({ album: null, artist: null });
  });
});
