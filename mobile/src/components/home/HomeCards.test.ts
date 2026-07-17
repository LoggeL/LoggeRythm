import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import type { HomeShelf, Track } from '../../api/types';
import type { RecentPlay } from '../../domain/listeningStats';
import { strings } from '../../localization';
import { HomeRecentCard, HomeShelfCard, HomeTrackCard } from './HomeCards';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../player/TrackPresentationProvider', () => ({
  useTrackPresentation: () => ({
    active: false,
    playback: 'inactive',
    serverCache: 'not-cached',
    rollingDeviceCache: null,
    explicitDownload: { kind: 'unknown' },
  }),
}));
vi.mock('../TrackStateIndicator', () => ({ default: 'TrackStateIndicator' }));
vi.mock('../track/TrackIdentityLinks', () => ({ default: 'TrackIdentityLinks' }));
vi.mock('../track/TrackShelfCard', () => ({ default: 'TrackShelfCard' }));

type ElementProps = Record<string, unknown> & {
  children?: React.ReactNode;
};

function propsOf(node: React.ReactNode): ElementProps {
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    throw new Error('Expected a React element');
  }
  return (node as React.ReactElement<ElementProps>).props;
}

function childrenOf(node: React.ReactNode): React.ReactNode[] {
  const children = propsOf(node).children;
  return Array.isArray(children) ? children : [children];
}

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

const recent: RecentPlay = {
  id: track.id,
  title: track.title,
  artist: track.artist,
  artist_id: String(track.artist_id),
  artists: track.artists,
  album: track.album,
  album_id: String(track.album_id),
  cover: track.cover,
  duration_sec: track.duration_sec,
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

describe('HomeRecentCard', () => {
  const occurrence = {
    queueContext: { type: 'recent' as const, id: '7' },
    originalContextOrder: 0,
  };

  it('keeps play and all route-safe identity credits as distinct controls', () => {
    const onPlay = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const card = HomeRecentCard({
      play: recent,
      testID: 'home-track-recent-track-1-0',
      occurrence,
      busy: false,
      disabled: false,
      onPlay,
      onOpenAlbum,
      onOpenArtist,
    });
    const [playControl, identity, state] = childrenOf(card);
    const playProps = propsOf(playControl);
    const identityProps = propsOf(identity);

    expect(playProps.testID).toBe('home-track-recent-track-1-0');
    expect(playProps.accessibilityRole).toBe('button');
    expect(playProps.accessibilityLabel).toBe(strings.home.playTrack(recent.title, recent.artist));
    expect(playProps.accessibilityState).toEqual({
      disabled: false,
      busy: false,
      selected: false,
    });
    expect((identity as React.ReactElement).type).toBe('TrackIdentityLinks');
    expect(identityProps.testID).toBe('home-track-recent-track-1-0-identity');
    expect(identityProps.showAlbumLabel).toBe(false);
    expect(identityProps.showDuration).toBe(false);
    expect(identityProps.showPopularity).toBe(false);
    expect(identityProps.metadata).toMatchObject({
      albumRoute: { albumId: '9', title: 'Parity' },
      artists: [
        { name: 'LoggeRythm', route: { artistId: '7', name: 'LoggeRythm' } },
        { name: 'Guest Artist', route: { artistId: '8', name: 'Guest Artist' } },
      ],
    });
    expect((state as React.ReactElement).type).toBe('TrackStateIndicator');

    (playProps.onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onOpenAlbum).not.toHaveBeenCalled();
    expect(onOpenArtist).not.toHaveBeenCalled();
    (identityProps.onOpenAlbum as (params: unknown) => void)({ albumId: '9' });
    (identityProps.onOpenArtist as (params: unknown) => void)({ artistId: '8' });
    expect(onOpenAlbum).toHaveBeenCalledOnce();
    expect(onOpenArtist).toHaveBeenCalledOnce();
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('keeps hydration busy state on the dedicated playback target', () => {
    const card = HomeRecentCard({
      play: recent,
      testID: 'home-track-recent-track-1-0',
      occurrence,
      busy: true,
      disabled: true,
      onPlay: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const [playControl] = childrenOf(card);
    const playProps = propsOf(playControl);

    expect(playProps.disabled).toBe(true);
    expect(playProps.accessibilityState).toEqual({
      disabled: true,
      busy: true,
      selected: false,
    });
  });
});

describe('HomeShelfCard', () => {
  it('announces direct playback and detail navigation as different actions', () => {
    const onPlay = vi.fn();
    const playCard = HomeShelfCard({ shelf, testID: 'home-shelf-play', onPress: onPlay });
    expect(propsOf(playCard).accessibilityRole).toBe('button');
    expect(propsOf(playCard).accessibilityLabel).toBe(
      strings.home.playShelf(shelf.title, shelf.tracks.length),
    );
    (propsOf(playCard).onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();

    const onOpen = vi.fn();
    const openCard = HomeShelfCard({
      shelf,
      testID: 'home-shelf-open',
      action: 'open',
      onPress: onOpen,
    });
    expect(propsOf(openCard).accessibilityRole).toBe('link');
    expect(propsOf(openCard).accessibilityLabel).toBe(
      strings.home.openShelf(shelf.title, shelf.tracks.length),
    );
    (propsOf(openCard).onPress as () => void)();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('renders and announces the radar unseen badge without changing open semantics', () => {
    const card = HomeShelfCard({
      shelf,
      testID: 'home-shelf-radar',
      action: 'open',
      highlighted: true,
      statusBadge: '3 neu',
      onPress: vi.fn(),
    });
    const cardProps = propsOf(card);
    const style = (cardProps.style as (state: { pressed: boolean }) => unknown[])({
      pressed: false,
    });
    const meta = childrenOf(card)[1];
    const badge = childrenOf(meta)[0];

    expect(cardProps.accessibilityRole).toBe('link');
    expect(cardProps.accessibilityLabel).toBe(
      `${strings.home.openShelf(shelf.title, shelf.tracks.length)}. 3 neu`,
    );
    expect(style).toHaveLength(3);
    expect(style[1]).toMatchObject({ borderColor: expect.any(String), borderWidth: 2 });
    expect(propsOf(badge).testID).toBe('home-shelf-radar-status');
    expect(propsOf(badge).children).toBe('3 neu');
  });
});
