import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlbumSummary, Genre, HomeShelf, Track } from '../../api/types';
import { strings } from '../../localization';
import { layout } from '../../theme';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { HomeAlbumCard, HomeGenreCard, HomeShelfCard, HomeTrackCard } from './HomeCards';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../track/TrackShelfCard', () => ({ default: 'TrackShelfCard' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
}));

const track: Track = {
  id: 'track-1',
  title: 'Midnight Signal',
  artist: 'LoggeRythm',
  artist_id: '7',
  artists: [
    { id: '7', name: 'LoggeRythm' },
    { id: '8', name: 'Guest Artist' },
  ],
  album: 'Parity',
  album_id: '9',
  cover: 'https://example.test/cover.jpg',
  duration_sec: 180,
  preview_url: 'https://example.test/preview.mp3',
  rank: 1,
  release_date: '2026-07-16',
};

const shelf: HomeShelf = {
  key: 'daily-focus',
  title: 'Daily Focus',
  subtitle: 'Made for you',
  cover: track.cover,
  tracks: [track],
};

describe('HomeTrackCard', () => {
  const onPress = vi.fn();
  const onActions = vi.fn();

  beforeEach(() => {
    onPress.mockClear();
    onActions.mockClear();
  });

  it('delegates exact occurrence, links, Like, and More to the shared card', () => {
    const occurrence = {
      queueContext: { type: 'chart' as const, id: 'home' },
      originalContextOrder: 2,
    };
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const card = HomeTrackCard({
      track,
      testID: 'home-track-test',
      occurrence,
      onPress,
      onLongPress: onActions,
      onOpenAlbum,
      onOpenArtist,
    });

    expect(card.type).toBe('TrackShelfCard');
    expect(card.props).toMatchObject({
      track,
      testID: 'home-track-test',
      occurrence,
      onPlay: onPress,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });
  });
});

describe('HomeShelfCard', () => {
  it('announces direct playback and detail navigation as different actions', () => {
    const onPlay = vi.fn();
    const playCard = byTestId(
      HomeShelfCard({ shelf, testID: 'home-shelf-play', onPress: onPlay }),
      'home-shelf-play',
    );
    expect(playCard.props.accessibilityRole).toBe('button');
    expect(playCard.props.accessibilityLabel).toBe(
      strings.home.playShelf(shelf.title, shelf.tracks.length),
    );
    (playCard.props.onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();

    const onOpen = vi.fn();
    const openCard = byTestId(
      HomeShelfCard({ shelf, testID: 'home-shelf-open', action: 'open', onPress: onOpen }),
      'home-shelf-open',
    );
    expect(openCard.props.accessibilityRole).toBe('link');
    expect(openCard.props.accessibilityLabel).toBe(
      strings.home.openShelf(shelf.title, shelf.tracks.length),
    );
    (openCard.props.onPress as () => void)();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows the play disc only on directly playable shelves', () => {
    const playCard = HomeShelfCard({ shelf, testID: 'home-shelf-play', onPress: vi.fn() });
    const openCard = HomeShelfCard({
      shelf,
      testID: 'home-shelf-open',
      action: 'open',
      onPress: vi.fn(),
    });

    expect(byTestId(playCard, 'home-shelf-play-play').props.accessible).toBe(false);
    expect(queryByTestId(openCard, 'home-shelf-open-play')).toBeNull();
  });

  it('truncates long copy and falls back to the first track cover and the track count', () => {
    const bare = HomeShelfCard({
      shelf: { ...shelf, cover: '', subtitle: '' },
      testID: 'home-shelf-bare',
      onPress: vi.fn(),
    });
    const [title, subtitle] = byType(bare, 'Text');

    expect(byType(bare, 'Image')[0].props.source).toEqual({ uri: track.cover });
    expect(textContent(bare)).toEqual([shelf.title, strings.common.trackCount(1)]);
    expect(title.props.numberOfLines).toBe(2);
    expect(subtitle.props.numberOfLines).toBe(1);
    expect(flatStyle(byTestId(bare, 'home-shelf-bare').props.style).width).toBe(layout.artwork.card);
  });
});

describe('HomeAlbumCard', () => {
  it('opens the album as one labelled button and renders the placeholder without a cover', () => {
    const album = { id: '12', title: 'Parity', artist: 'LoggeRythm', cover: '' } as AlbumSummary;
    const onPress = vi.fn();
    const tree = HomeAlbumCard({ album, testID: 'home-album-12', onPress });
    const card = byTestId(tree, 'home-album-12');

    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe(strings.home.openAlbum('Parity', 'LoggeRythm'));
    expect(byType(tree, 'Image')).toHaveLength(0);
    expect(textContent(tree)).toEqual(['Parity', strings.home.albumBy('LoggeRythm')]);
    (card.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe('HomeGenreCard', () => {
  it('opens the genre as one labelled button with a one-line name', () => {
    const genre = { id: '152', name: 'Rock', picture: 'https://example.test/rock.jpg' } as Genre;
    const onPress = vi.fn();
    const tree = HomeGenreCard({ genre, testID: 'home-genre-152', onPress });
    const card = byTestId(tree, 'home-genre-152');

    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe(strings.home.openGenre('Rock'));
    expect(flatStyle(card.props.style).height).toBeGreaterThanOrEqual(48);
    expect(byType(tree, 'Image')[0].props.source).toEqual({ uri: genre.picture });
    expect(byType(tree, 'Text')[0].props.numberOfLines).toBe(1);
    (card.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });
});
