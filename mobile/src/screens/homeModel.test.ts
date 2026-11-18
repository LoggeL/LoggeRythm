import { describe, expect, it } from 'vitest';
import type { HomeShelf, RadarReason, ReleaseRadarEntry, Track } from '../api/types';
import type { RecentPlay } from '../domain/listeningStats';
import { catalogs } from '../localization';
import {
  HOME_QUICK_GRID_LIMIT,
  assertHomeRouteCallbacks,
  findHomeMix,
  formatRadarReason,
  formatRadarReleaseDate,
  greetingKeyForHour,
  homeAlbumRoute,
  homeDisplayName,
  homeGenreRoute,
  homeMixRoute,
  homePlaylistRoute,
  homeQueueContext,
  homeRecentShelf,
  joinRadarFacts,
  playableHomeShelves,
  radarSourceArtist,
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

function radarEntry(
  reason: Partial<RadarReason> = {},
  track: Partial<Track> = {},
): ReleaseRadarEntry {
  return {
    track: {
      id: '900',
      title: 'Blaue Stunde',
      artist: 'Nina Chuba',
      artist_id: '42',
      artists: [{ id: '42', name: 'Nina Chuba' }],
      album: 'Blaue Stunde',
      album_id: '17',
      cover: '',
      duration_sec: 161,
      preview_url: null,
      rank: 0,
      release_date: '2026-07-16',
      ...track,
    },
    radar_reason: {
      kind: 'played',
      artist_id: '42',
      artist_name: 'Nina Chuba',
      play_count: 3,
      ...reason,
    },
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
        onOpenSearch: () => undefined,
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

  it('resolves the watched radar artist without guessing a name', () => {
    expect(radarSourceArtist(radarEntry())).toEqual({ name: 'Nina Chuba', isPrimary: true });
    // Numeric and string ids name the same artist.
    expect(radarSourceArtist(radarEntry({}, { artist_id: 42 })).isPrimary).toBe(true);
    // A contributor that put the track into the radar is not the primary artist.
    const feature = radarEntry(
      { artist_id: '7', artist_name: ' Kraftklub ' },
      { artists: [{ id: '42', name: 'Nina Chuba' }, { id: 7, name: 'KRAFTKLUB' }] },
    );
    expect(radarSourceArtist(feature)).toEqual({ name: 'Kraftklub', isPrimary: false });
    // A legacy reason without a name takes it from the track's own credit of that id.
    expect(radarSourceArtist({
      ...feature,
      radar_reason: { ...feature.radar_reason, artist_name: '' },
    })).toEqual({ name: 'KRAFTKLUB', isPrimary: false });
    expect(radarSourceArtist(radarEntry({ artist_name: ' ' }, { artists: [] }))).toEqual({
      name: 'Nina Chuba',
      isPrimary: true,
    });
    // Neither the reason nor the credits know the artist: no name is invented.
    expect(radarSourceArtist(radarEntry({ artist_id: '7', artist_name: '' }))).toEqual({
      name: null,
      isPrimary: false,
    });
    expect(() => radarSourceArtist(radarEntry({ artist_id: ' ' }))).toThrow(
      'track 900 has no source artist id',
    );
  });

  it('explains in German and English why a track is in the radar', () => {
    const { de, en } = catalogs;
    const ownPlayed = radarEntry();
    const ownFollowed = radarEntry({ kind: 'followed', play_count: 5 });
    const otherPlayed = radarEntry({ artist_id: '7', artist_name: 'Kraftklub', play_count: 2 });
    const otherFollowed = radarEntry({
      kind: 'followed',
      artist_id: '7',
      artist_name: 'Kraftklub',
      play_count: 0,
    });
    const unknownPlayed = radarEntry({ artist_id: '7', artist_name: '', play_count: 4 });
    const unknownFollowed = radarEntry({ kind: 'followed', artist_id: '7', artist_name: '' });

    // The row never repeats the artist shown directly above it.
    expect(formatRadarReason(ownPlayed, de.home.radarReason, 'row')).toBe('Artist 3× gehört');
    expect(formatRadarReason(ownFollowed, de.home.radarReason, 'row')).toBe('Gefolgt');
    expect(formatRadarReason(otherPlayed, de.home.radarReason, 'row')).toBe(
      '2× gehört: Kraftklub',
    );
    expect(formatRadarReason(otherFollowed, de.home.radarReason, 'row')).toBe(
      'Du folgst Kraftklub',
    );
    expect(formatRadarReason(unknownPlayed, de.home.radarReason, 'row')).toBe('Artist 4× gehört');
    expect(formatRadarReason(unknownFollowed, de.home.radarReason, 'row')).toBe('Gefolgt');

    expect(formatRadarReason(ownPlayed, en.home.radarReason, 'row')).toBe('Artist played 3×');
    expect(formatRadarReason(ownFollowed, en.home.radarReason, 'row')).toBe('Following');
    expect(formatRadarReason(otherPlayed, en.home.radarReason, 'row')).toBe(
      'Played 2×: Kraftklub',
    );
    expect(formatRadarReason(otherFollowed, en.home.radarReason, 'row')).toBe(
      'You follow Kraftklub',
    );

    // Screen readers get a full sentence that names the artist whenever it is known.
    expect(formatRadarReason(ownPlayed, de.home.radarReasonSpoken, 'spoken')).toBe(
      'Im Radar, weil du Nina Chuba 3-mal gehört hast',
    );
    expect(formatRadarReason(ownFollowed, de.home.radarReasonSpoken, 'spoken')).toBe(
      'Im Radar, weil du Nina Chuba folgst',
    );
    expect(formatRadarReason(unknownPlayed, de.home.radarReasonSpoken, 'spoken')).toBe(
      'Im Radar, weil du einen Artist dieses Titels 4-mal gehört hast',
    );
    expect(formatRadarReason(unknownFollowed, de.home.radarReasonSpoken, 'spoken')).toBe(
      'Im Radar, weil du einem Artist dieses Titels folgst',
    );
    expect(formatRadarReason(otherPlayed, en.home.radarReasonSpoken, 'spoken')).toBe(
      'In your radar because you played Kraftklub 2 times',
    );
    expect(formatRadarReason(otherFollowed, en.home.radarReasonSpoken, 'spoken')).toBe(
      'In your radar because you follow Kraftklub',
    );
    expect(formatRadarReason(unknownPlayed, en.home.radarReasonSpoken, 'spoken')).toBe(
      'In your radar because you played an artist on this track 4 times',
    );
    expect(formatRadarReason(unknownFollowed, en.home.radarReasonSpoken, 'spoken')).toBe(
      'In your radar because you follow an artist on this track',
    );
  });

  it('rejects a radar reason the server can never send', () => {
    const copy = catalogs.en.home.radarReason;

    expect(() => formatRadarReason(radarEntry({ play_count: 0 }), copy, 'row')).toThrow(
      'reason "played" for artist 42 needs a positive play count; received 0',
    );
    expect(() =>
      formatRadarReason(radarEntry({ kind: 'liked' as RadarReason['kind'] }), copy, 'row'),
    ).toThrow('Unknown Release Radar reason kind: liked');
  });

  it('joins radar facts into one line and leaves blank ones out', () => {
    expect(joinRadarFacts(['Neu', 'heute', 'Gefolgt'], ' · ')).toBe('Neu · heute · Gefolgt');
    // An unparseable release date yields no date; the reason still stands alone.
    expect(joinRadarFacts(['', '', 'Artist 3× gehört'], ' · ')).toBe('Artist 3× gehört');
    expect(joinRadarFacts(['Neu', ' ', 'Du folgst Kraftklub'], ', ')).toBe(
      'Neu, Du folgst Kraftklub',
    );
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

  it('fills the two-column quick grid with whole rows from the newest history events', () => {
    const fullHistory = Array.from({ length: 9 }, (_, index) => recent({ id: String(index) }));

    expect(HOME_QUICK_GRID_LIMIT % 2).toBe(0);
    expect(homeRecentShelf(fullHistory, HOME_QUICK_GRID_LIMIT)).toEqual(
      fullHistory.slice(0, HOME_QUICK_GRID_LIMIT),
    );
    expect(homeRecentShelf(fullHistory.slice(0, 3), HOME_QUICK_GRID_LIMIT)).toHaveLength(3);
  });

  it('lists only shelves that have tracks and tolerates a response that has not arrived', () => {
    const filled = { key: 'a', title: 'A', tracks: [{ id: '1' }] } as unknown as HomeShelf;
    const hollow = { key: 'b', title: 'B', tracks: [] } as unknown as HomeShelf;

    expect(playableHomeShelves([hollow, filled])).toEqual([filled]);
    expect(playableHomeShelves(undefined)).toEqual([]);
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
