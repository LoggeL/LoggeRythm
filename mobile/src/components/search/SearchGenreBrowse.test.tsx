import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId, byType, queryByTestId, textContent } from '../../test/render';
import { SearchGenreBrowse } from './SearchGenreBrowse';
import {
  SearchAlbumSection,
  SearchArtistSection,
  SearchPlaylistSection,
} from './SearchResultSections';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../track/StandardTrackRow', () => ({ default: 'StandardTrackRow' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
  Skeleton: 'Skeleton',
}));

const genres = [
  { id: '132', name: 'Pop', picture: '' },
  { id: '116', name: 'Rap', picture: '' },
];

function browse(overrides: Partial<Parameters<typeof SearchGenreBrowse>[0]> = {}) {
  return SearchGenreBrowse({
    testID: 'search-genre-browse',
    id: 'search-genres',
    genres,
    genresState: { body: 'content', notice: null },
    retryBusy: false,
    onRetry: vi.fn(),
    onOpenGenre: vi.fn(),
    ...overrides,
  });
}

describe('SearchGenreBrowse', () => {
  it('opens a genre from its tile under the browse heading', () => {
    const onOpenGenre = vi.fn();
    const rendered = browse({ onOpenGenre });

    expect(byTestId(rendered, 'search-genre-browse')).not.toBeNull();
    expect(textContent(rendered)[0]).toBe(strings.search.browseTitle);
    const tile = byTestId(rendered, 'search-genre-132');
    expect(tile.props.accessibilityLabel).toBe(strings.search.openGenre('Pop'));
    (tile.props.onPress as () => void)();
    expect(onOpenGenre).toHaveBeenCalledWith({ genreId: '132', name: 'Pop' });
  });

  it('shows a grid-shaped placeholder, never tiles, while genres load', () => {
    const rendered = browse({ genres: [], genresState: { body: 'loading', notice: null } });

    expect(byTestId(rendered, 'search-genres-loading').props).toMatchObject({
      accessibilityRole: 'progressbar',
      accessibilityLabel: strings.search.browseLoading,
    });
    expect(byType(rendered, 'Skeleton').length).toBeGreaterThan(0);
    expect(queryByTestId(rendered, 'search-genre-132')).toBeNull();
  });

  it.each([
    ['hard-error', 'search-genres-error'],
    ['offline', 'search-genres-offline'],
  ] as const)('fails loud on %s with a retry that names the section', (body, testID) => {
    const onRetry = vi.fn();
    const rendered = browse({ genres: [], genresState: { body, notice: null }, onRetry });

    expect(byTestId(rendered, testID).props.accessibilityRole).toBe('alert');
    const retry = byTestId(rendered, `${testID}-action`);
    expect(retry.props.accessibilityLabel)
      .toBe(strings.search.retrySection(strings.search.browseTitle));
    (retry.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(queryByTestId(rendered, 'search-genre-132')).toBeNull();
  });

  it('presents a successful empty genre list as an empty state', () => {
    const rendered = browse({ genres: [], genresState: { body: 'empty', notice: null } });

    expect(byTestId(rendered, 'search-genres-empty').props.accessibilityLiveRegion).toBe('polite');
    expect(textContent(rendered)).toContain(strings.search.browsePrompt);
  });
});

type RailProps = {
  data: unknown[];
  renderItem: (info: { item: unknown; index: number }) => React.ReactElement;
};

function railCards(section: React.ReactElement, railId: string) {
  const rail = byTestId(section, `search-rail-${railId}`).props as unknown as RailProps;
  return rail.data.map((item, index) => rail.renderItem({ item, index }));
}

describe('search result sections', () => {
  it('routes artist and album cards with their existing ids and labels', () => {
    const onOpenArtist = vi.fn();
    const onOpenAlbum = vi.fn();
    const artists = SearchArtistSection({
      artists: [{ id: '9', name: 'Kraftwerk', picture: '' }],
      onOpenArtist,
    });
    const albums = SearchAlbumSection({
      albums: [{ id: '4', title: 'Autobahn', artistName: 'Kraftwerk', artworkUrl: null }],
      onOpenAlbum,
    });

    expect(byTestId(artists, 'search-section-artists')).not.toBeNull();
    const artist = byTestId(railCards(artists, 'artists')[0], 'search-artist-9');
    expect(artist.props.accessibilityLabel).toBe(strings.search.openArtist('Kraftwerk'));
    (artist.props.onPress as () => void)();
    expect(onOpenArtist).toHaveBeenCalledWith({ artistId: '9', name: 'Kraftwerk' });

    expect(byTestId(albums, 'search-section-albums')).not.toBeNull();
    const album = byTestId(railCards(albums, 'albums')[0], 'search-album-4-0');
    expect(album.props.accessibilityLabel).toBe(strings.search.openAlbum('Autobahn', 'Kraftwerk'));
    (album.props.onPress as () => void)();
    expect(onOpenAlbum).toHaveBeenCalledWith({ albumId: '4', title: 'Autobahn' });
  });

  it('locks every playlist card while one playlist is being started', () => {
    const onStartPlaylist = vi.fn();
    const playlists = [
      { id: 'a', title: 'One', cover: '', track_count: 3 },
      { id: 'b', title: 'Two', cover: '', track_count: 1 },
    ];
    const idle = railCards(
      SearchPlaylistSection({ playlists, startingPlaylistId: null, onStartPlaylist }),
      'playlists',
    );
    (byTestId(idle[1], 'search-playlist-b').props.onPress as () => void)();
    expect(onStartPlaylist).toHaveBeenCalledWith('b');
    expect(textContent(idle[0])).toEqual(['One', strings.common.trackCount(3)]);

    const starting = railCards(
      SearchPlaylistSection({ playlists, startingPlaylistId: 'a', onStartPlaylist }),
      'playlists',
    );
    expect(byTestId(starting[0], 'search-playlist-a').props.accessibilityState)
      .toEqual({ disabled: true, busy: true });
    expect(byTestId(starting[1], 'search-playlist-b').props.accessibilityState)
      .toEqual({ disabled: true, busy: false });
    expect(textContent(starting[0])).toContain(strings.search.playlistLoading);
  });
});
