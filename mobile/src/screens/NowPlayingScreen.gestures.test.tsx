import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NowPlayingScreen from './NowPlayingScreen';

const harness = vi.hoisted(() => ({
  tab: 'lyrics',
  setTab: vi.fn(),
  goBack: vi.fn(),
  track: {
    id: 'track-1', title: 'Without Me', artist: 'Eminem', artist_id: 13,
    artists: [{ id: 13, name: 'Eminem' }], album: 'The Eminem Show', album_id: 1,
    cover: 'https://example.test/cover.jpg', duration_sec: 300,
    preview_url: null, rank: 1, release_date: '2002-05-26',
  },
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [
    initial === 'lyrics' ? harness.tab : typeof initial === 'function' ? initial() : initial,
    initial === 'lyrics' ? harness.setTab : vi.fn(),
  ],
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  PanResponder: {
    create: (config: Record<string, unknown>) => ({
      panHandlers: {
        onMoveShouldSetResponderCapture: config.onMoveShouldSetPanResponderCapture,
        onResponderRelease: config.onPanResponderRelease,
      },
    }),
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
vi.mock('../player/player', () => ({
  default: { getRepeatMode: () => 0 },
  Event: { QueueChanged: 'queue-changed' },
  PlaybackState: { Buffering: 'buffering' },
  RepeatMode: { Off: 0, One: 1, All: 2 },
  useActiveMediaItem: () => harness.track,
  useIsPlaying: () => false,
  usePlaybackState: () => 'paused',
  useProgress: () => ({ position: 3, duration: 300 }),
}));
vi.mock('../player/mediaItem', () => ({ mediaItemToTrack: () => harness.track }));
vi.mock('../player/setup', () => ({ isPlayerReady: () => true }));
vi.mock('../player/errors', () => ({
  clearPlayerError: vi.fn(), reportPlayerError: vi.fn(), usePlayerError: () => null,
}));
vi.mock('../player/controller', () => ({
  cycleRepeat: vi.fn(), isContextShuffleEnabled: () => false,
  next: vi.fn(), prev: vi.fn(), seekTo: vi.fn(), toggleShuffle: vi.fn(), togglePlay: vi.fn(),
}));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../components/TrackLikeButton', () => ({ default: 'TrackLikeButton' }));
vi.mock('../components/PlayerNoticeBanner', () => ({ default: 'PlayerNoticeBanner' }));
vi.mock('../components/player/NowPlayingArtwork', () => ({
  NowPlayingArtwork: 'NowPlayingArtwork', NowPlayingBackdrop: 'NowPlayingBackdrop',
}));
vi.mock('../components/player/NowPlayingLyricsSurface', () => ({ default: 'LyricsSurface' }));
vi.mock('../components/player/NowPlayingMetadata', () => ({ default: 'Metadata' }));
vi.mock('../components/player/NowPlayingTransport', () => ({ default: 'Transport' }));
vi.mock('../components/player/SimilarPanel', () => ({ default: 'SimilarPanel' }));
vi.mock('../components/player/NowPlayingTabs', () => ({
  DEFAULT_NOW_PLAYING_TAB: 'lyrics', NowPlayingTabs: 'NowPlayingTabs',
}));
vi.mock('./QueueScreen', () => ({ QueueSurface: 'QueueSurface' }));

type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
type RenderedPath = { element: Element; ancestors: Element[] };

function paths(node: React.ReactNode, ancestors: Element[] = []): RenderedPath[] {
  if (Array.isArray(node)) return node.flatMap((child) => paths(child, ancestors));
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [
    { element, ancestors },
    ...paths(element.props.children, [...ancestors, element]),
  ];
}

function screen() {
  return NowPlayingScreen({
    navigation: { goBack: harness.goBack, navigate: vi.fn() },
  } as never);
}

function hasGestureHandler(element: Element): boolean {
  return typeof element.props.onMoveShouldSetResponderCapture === 'function';
}

function byId(rendered: React.ReactNode, id: string): RenderedPath {
  const found = paths(rendered).find(({ element }) => element.props.testID === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
}

describe('fullscreen player gesture ownership', () => {
  beforeEach(() => {
    harness.tab = 'lyrics';
    harness.setTab.mockClear();
    harness.goBack.mockClear();
  });

  it.each(['lyrics', 'playing', 'queue', 'similar'])('keeps %s controls outside every gesture ancestor', (tab) => {
    harness.tab = tab;
    const rendered = screen();
    expect(hasGestureHandler(byId(rendered, 'now-playing-screen').element)).toBe(false);
    for (const { element, ancestors } of paths(rendered)) {
      if (['Pressable', 'TrackLikeButton', 'Transport', 'LyricsSurface', 'QueueSurface', 'SimilarPanel', 'NowPlayingTabs'].includes(String(element.type))) {
        expect(hasGestureHandler(element)).toBe(false);
        expect(ancestors.some(hasGestureHandler)).toBe(false);
      }
    }
    const surfaces = paths(rendered).filter(({ element }) => hasGestureHandler(element));
    expect(surfaces.map(({ element }) => element.props.testID)).toEqual(['now-playing-gesture-header']);
  });

  it('retains directional tab swipes from the header while Lyrics is selected', () => {
    const { element } = byId(screen(), 'now-playing-gesture-header');
    const capture = element.props.onMoveShouldSetResponderCapture as (...args: unknown[]) => boolean;
    const release = element.props.onResponderRelease as (...args: unknown[]) => void;
    const swipe = { dx: -72, dy: 0, vx: -0.7, vy: 0 };
    expect(capture({}, swipe)).toBe(true);
    release({}, swipe);
    const update = harness.setTab.mock.calls[0][0] as (tab: string) => string;
    expect(update('lyrics')).toBe('similar');
    expect(harness.goBack).not.toHaveBeenCalled();
  });

  it('retains pull-down dismissal on the noninteractive header', () => {
    harness.tab = 'playing';
    const { element } = byId(screen(), 'now-playing-gesture-header');
    const capture = element.props.onMoveShouldSetResponderCapture as (...args: unknown[]) => boolean;
    const release = element.props.onResponderRelease as (...args: unknown[]) => void;
    const pull = { dx: 0, dy: 72, vx: 0, vy: 0.7 };
    expect(capture({}, pull)).toBe(true);
    release({}, pull);
    expect(harness.goBack).toHaveBeenCalledOnce();
    expect(harness.setTab).not.toHaveBeenCalled();
  });
});
