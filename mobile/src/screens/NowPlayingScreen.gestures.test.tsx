import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import NowPlayingScreen from './NowPlayingScreen';

const harness = vi.hoisted(() => {
  const animatedSetValue = vi.fn();
  const animatedSpringStart = vi.fn();
  const backHandlers: (() => boolean | void)[] = [];
  return {
    tab: 'playing',
    setTab: vi.fn(),
    isFocused: true,
    goBack: vi.fn(),
    navigate: vi.fn(),
    openAlbumInActiveTab: vi.fn<() => 'opened' | 'not-ready'>(() => 'opened'),
    openArtistInActiveTab: vi.fn<() => 'opened' | 'not-ready'>(() => 'opened'),
    tvFocusReturnOptions: null as Record<string, unknown> | null,
    reducedMotion: false,
    hapticTrigger: vi.fn(() => true),
    popAndRestore: vi.fn(),
    useProgress: vi.fn(),
    reportPlayerError: vi.fn(),
    animatedSetValue,
    animatedSpringStart,
    backHandlers,
    tv: {
      isTv: false,
      isWidescreen: false,
      width: 390,
      height: 844,
      contentWidth: 390,
      overscan: { top: 0, right: 0, bottom: 0, left: 0 },
      contentPaddingHorizontal: 20,
      splitPrimaryRatio: 0.44,
    },
    mediaItem: {
      mediaId: 'queue:1:0:track-1',
      url: 'https://example.test/stream.mp3',
      extras: {
        queueContextType: 'playlist',
        queueContextId: 'pl-1',
        queueContextLabel: 'Late Night Drive',
      },
    } as Record<string, unknown>,
    track: {
      id: 'track-1', title: 'Without Me', artist: 'Eminem', artist_id: 13,
      artists: [{ id: 13, name: 'Eminem' }], album: 'The Eminem Show', album_id: 1 as number | string,
      cover: 'https://example.test/cover.jpg', duration_sec: 300,
      preview_url: null, rank: 1, release_date: '2002-05-26',
    },
  };
});

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useEffect: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: (initial: unknown) => [
    initial === 'playing' ? harness.tab : typeof initial === 'function' ? initial() : initial,
    initial === 'playing' ? harness.setTab : vi.fn(),
  ],
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    Value: class MockAnimatedValue {
      setValue = harness.animatedSetValue;
      interpolate = () => 'interpolated-opacity';
    },
    View: 'Animated.View',
    spring: () => ({ start: harness.animatedSpringStart }),
  },
  Platform: { OS: 'android' },
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles },
  useWindowDimensions: () => ({ width: harness.tv.width, height: harness.tv.height }),
  PanResponder: {
    create: (config: Record<string, unknown>) => ({
      panHandlers: {
        onMoveShouldSetResponderCapture: config.onMoveShouldSetPanResponderCapture,
        onResponderMove: config.onPanResponderMove,
        onResponderRelease: config.onPanResponderRelease,
        onResponderTerminate: config.onPanResponderTerminate,
      },
    }),
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => harness.isFocused,
}));
vi.mock('../navigation/rootNavigation', () => ({
  openAlbumInActiveTab: harness.openAlbumInActiveTab,
  openArtistInActiveTab: harness.openArtistInActiveTab,
  resolveActiveTabName: () => 'LibraryTab',
}));
vi.mock('../player/player', () => ({
  default: { getRepeatMode: () => 0, addEventListener: () => ({ remove: vi.fn() }) },
  Event: { QueueChanged: 'queue-changed' },
  PlaybackState: { Buffering: 'buffering' },
  RepeatMode: { Off: 0, One: 1, All: 2 },
  useActiveMediaItem: () => harness.mediaItem,
  useIsPlaying: () => false,
  usePlaybackState: () => 'paused',
  useProgress: harness.useProgress,
}));
vi.mock('../player/mediaItem', () => ({ mediaItemToTrack: () => harness.track }));
vi.mock('../player/setup', () => ({ isPlayerReady: () => true }));
vi.mock('../player/errors', () => ({
  clearPlayerError: vi.fn(),
  reportPlayerError: harness.reportPlayerError,
  usePlayerError: () => null,
}));
vi.mock('../player/controller', () => ({
  cycleRepeat: vi.fn(), isContextShuffleEnabled: () => false,
  next: vi.fn(), prev: vi.fn(), seekTo: vi.fn(), toggleShuffle: vi.fn(), togglePlay: vi.fn(),
}));
vi.mock('../hooks/useBackHandler', () => ({
  useBackHandler: (enabled: boolean, onBack: () => boolean | void) => {
    if (enabled) harness.backHandlers.push(onBack);
  },
}));
vi.mock('../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: harness.hapticTrigger }),
  triggerHaptic: harness.hapticTrigger,
}));
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => harness.reducedMotion,
  getReducedMotionSnapshot: () => harness.reducedMotion,
}));
vi.mock('../tv', () => ({
  TvFocusScope: 'TvFocusScope',
  useTvEnvironment: () => harness.tv,
  useTvFocusReturn: (options: Record<string, unknown>) => {
    harness.tvFocusReturnOptions = options;
    return {
      lastFocusedKey: null,
      restore: vi.fn(),
      pushCheckpoint: vi.fn(),
      popAndRestore: harness.popAndRestore,
    };
  },
}));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../components/connect/devicePicker', () => ({ showDevicePicker: vi.fn() }));
vi.mock('../connect/activeConnect', async (importOriginal) => ({
  ...await importOriginal<typeof import('../connect/activeConnect')>(),
  useActiveConnectSnapshot: () => ({
    phase: 'idle',
    enabled: true,
    selfDeviceId: null,
    selfDeviceName: '',
    selfDeviceType: 'mobile',
    state: null,
    activeDevice: null,
    isSelfActive: false,
    isControllingRemote: false,
    transferringToDeviceId: null,
    error: null,
  }),
  activeConnectRouter: () => null,
  transferActiveConnectPlayback: vi.fn(async () => undefined),
}));
vi.mock('../party/activeParty', async (importOriginal) => ({
  ...await importOriginal<typeof import('../party/activeParty')>(),
  useActivePartySnapshot: () => ({
    code: null,
    party: null,
    phase: 'idle',
    error: null,
    detached: false,
    controlOnly: false,
    playbackError: null,
    endedNotice: null,
  }),
  activePartyRouter: () => null,
}));
vi.mock('../components/TrackLikeButton', () => ({ default: 'TrackLikeButton' }));
vi.mock('../components/PlayerNoticeBanner', () => ({ default: 'PlayerNoticeBanner' }));
vi.mock('../components/player/NowPlayingArtwork', () => ({
  MemoNowPlayingArtwork: 'NowPlayingArtwork',
  MemoNowPlayingBackdrop: 'NowPlayingBackdrop',
}));
vi.mock('../components/player/LyricsPanel', () => ({
  LiveLyricsPanel: 'LiveLyricsPanel',
}));
vi.mock('../components/player/NowPlayingLyricsSurface', () => ({
  LiveNowPlayingLyricsSurface: 'LyricsSurface',
}));
vi.mock('../components/player/NowPlayingMetadata', () => ({
  MemoNowPlayingMetadata: 'Metadata',
}));
vi.mock('../components/player/NowPlayingTransport', () => ({
  LiveNowPlayingTransport: 'Transport',
}));
vi.mock('../components/player/NowPlayingToolsBar', () => ({
  NowPlayingToolsBar: 'NowPlayingToolsBar',
}));
vi.mock('../components/player/SimilarPanel', () => ({ default: 'SimilarPanel' }));
vi.mock('../components/player/NowPlayingTabs', () => ({
  DEFAULT_NOW_PLAYING_TAB: 'playing',
  MemoNowPlayingTabs: 'NowPlayingTabs',
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
    navigation: {
      goBack: harness.goBack,
      navigate: harness.navigate,
      addListener: vi.fn(() => vi.fn()),
    },
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

describe('fullscreen player gesture ownership, progress isolation, Back, context & TV split', () => {
  beforeEach(() => {
    harness.tab = 'playing';
    harness.isFocused = true;
    harness.reducedMotion = false;
    harness.tvFocusReturnOptions = null;
    harness.tv = {
      isTv: false,
      isWidescreen: false,
      width: 390,
      height: 844,
      contentWidth: 390,
      overscan: { top: 0, right: 0, bottom: 0, left: 0 },
      contentPaddingHorizontal: 20,
      splitPrimaryRatio: 0.44,
    };
    harness.backHandlers.length = 0;
    harness.setTab.mockClear();
    harness.goBack.mockClear();
    harness.navigate.mockClear();
    harness.openAlbumInActiveTab.mockReset().mockReturnValue('opened');
    harness.openArtistInActiveTab.mockReset().mockReturnValue('opened');
    harness.hapticTrigger.mockClear();
    harness.popAndRestore.mockClear();
    harness.useProgress.mockClear();
    harness.reportPlayerError.mockClear();
    harness.animatedSetValue.mockClear();
    harness.animatedSpringStart.mockClear();
    harness.track = {
      id: 'track-1', title: 'Without Me', artist: 'Eminem', artist_id: 13,
      artists: [{ id: 13, name: 'Eminem' }], album: 'The Eminem Show', album_id: 1 as number | string,
      cover: 'https://example.test/cover.jpg', duration_sec: 300,
      preview_url: null, rank: 1, release_date: '2002-05-26',
    };
  });

  it('never subscribes NowPlayingScreen root to useProgress', () => {
    screen();
    expect(harness.useProgress).not.toHaveBeenCalled();
  });

  it.each(['lyrics', 'playing', 'queue', 'similar'])('keeps %s interactive controls outside every gesture ancestor', (tab) => {
    harness.tab = tab;
    const rendered = screen();
    expect(hasGestureHandler(byId(rendered, 'now-playing-screen').element)).toBe(false);
    for (const { element, ancestors } of paths(rendered)) {
      if (['Pressable', 'TrackLikeButton', 'Transport', 'LyricsSurface', 'QueueSurface', 'SimilarPanel', 'NowPlayingTabs', 'Metadata'].includes(String(element.type))) {
        expect(hasGestureHandler(element)).toBe(false);
        expect(ancestors.some(hasGestureHandler)).toBe(false);
      }
    }
    const surfaces = paths(rendered).filter(({ element }) => hasGestureHandler(element));
    expect(surfaces.map(({ element }) => element.props.testID)).toEqual(
      tab === 'playing'
        ? ['now-playing-gesture-header', 'now-playing-artwork-gesture-surface']
        : ['now-playing-gesture-header'],
    );
  });

  it('displays the queue context header ("Playing from ...") when present', () => {
    const rendered = screen();
    expect(byId(rendered, 'now-playing-context-eyebrow').element.props.children)
      .toBe(strings.player.playingFrom);
    expect(byId(rendered, 'now-playing-context-label').element.props.children)
      .toBe('Late Night Drive');
  });

  it('retains directional tab swipes from the header while Lyrics is selected', () => {
    harness.tab = 'lyrics';
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

  it('tracks downward finger drags from the artwork area and minimizes on commit (respecting reduced motion)', () => {
    harness.tab = 'playing';
    const { element } = byId(screen(), 'now-playing-artwork-gesture-surface');
    const capture = element.props.onMoveShouldSetResponderCapture as (...args: unknown[]) => boolean;
    const move = element.props.onResponderMove as (...args: unknown[]) => void;
    const release = element.props.onResponderRelease as (...args: unknown[]) => void;
    const pull = { dx: 0, dy: 72, vx: 0, vy: 0.7 };
    expect(capture({}, pull)).toBe(true);
    move({}, { dx: 0, dy: 48 });
    expect(harness.animatedSetValue).toHaveBeenCalledWith(48);
    release({}, pull);
    expect(harness.hapticTrigger).toHaveBeenCalledWith('tap');
    expect(harness.goBack).toHaveBeenCalledOnce();
    expect(harness.setTab).not.toHaveBeenCalled();

    // Under reduced motion, live translation is skipped while swipe commit still works.
    harness.animatedSetValue.mockClear();
    harness.goBack.mockClear();
    harness.reducedMotion = true;
    const reducedEl = byId(screen(), 'now-playing-artwork-gesture-surface').element;
    (reducedEl.props.onResponderMove as (...args: unknown[]) => void)({}, { dx: 0, dy: 48 });
    expect(harness.animatedSetValue).not.toHaveBeenCalled();
    (reducedEl.props.onResponderRelease as (...args: unknown[]) => void)({}, pull);
    expect(harness.goBack).toHaveBeenCalledOnce();
  });

  it('steps Android Back from secondary tabs back to playing before dismissing and gates Back on focus', () => {
    harness.tab = 'queue';
    screen();
    expect(harness.backHandlers[0]()).toBe(true);
    expect(harness.setTab).toHaveBeenCalledWith('playing');
    expect(harness.goBack).not.toHaveBeenCalled();

    harness.backHandlers.length = 0;
    harness.setTab.mockClear();
    harness.tab = 'playing';
    screen();
    expect(harness.backHandlers[0]()).toBe(true);
    expect(harness.goBack).toHaveBeenCalledOnce();

    // Unfocused NowPlaying (e.g. Profile/Party pushed above it) must NOT register a Back handler.
    harness.backHandlers.length = 0;
    harness.isFocused = false;
    screen();
    expect(harness.backHandlers).toHaveLength(0);
  });

  it('pushes Album and Artist via openAlbumInActiveTab/openArtistInActiveTab and reports real Error causes', () => {
    const rendered = screen();
    const metadata = paths(rendered).find(({ element }) => element.type === 'Metadata')?.element;
    expect(metadata).toBeDefined();
    (metadata?.props.onOpenAlbum as () => void)();
    expect(harness.openAlbumInActiveTab).toHaveBeenCalledWith({
      albumId: '1',
      title: 'The Eminem Show',
    });

    harness.openAlbumInActiveTab.mockClear();
    harness.track = { ...harness.track, album_id: '' };
    const invalidRendered = screen();
    const invalidMeta = paths(invalidRendered).find(({ element }) => element.type === 'Metadata')?.element;
    (invalidMeta?.props.onOpenAlbum as () => void)();
    expect(harness.reportPlayerError).toHaveBeenCalledOnce();
    expect(harness.reportPlayerError.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('renders 16:9 TV split without double overscan, uses tv.contentWidth artwork sizing, registers focus key, and consumes checkpoints cleanly', () => {
    harness.tv = {
      isTv: true,
      isWidescreen: true,
      width: 960,
      height: 540,
      contentWidth: 652,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      splitPrimaryRatio: 0.44,
    };
    const rendered = screen();
    expect(byId(rendered, 'now-playing-tv-split')).toBeDefined();
    expect(byId(rendered, 'now-playing-tv-panel')).toBeDefined();
    expect(harness.tvFocusReturnOptions).toMatchObject({
      scope: 'now-playing',
      active: true,
      fallbackKey: 'now-playing-play-pause',
      enabled: true,
    });

    // No double TV overscan padding: TvShellLayout already applies tv.overscan.*.
    const screenStyle = (byId(rendered, 'now-playing-screen').element.props.style as Record<string, unknown>[])[1];
    expect(screenStyle).toEqual({
      paddingTop: 4,
      paddingBottom: 4,
      paddingHorizontal: 16,
    });

    // Artwork is bounded by tv.contentWidth (652) and overscan-adjusted height (486) so header and full transport fit inside 486dp.
    const artwork = paths(rendered).find(({ element }) => element.type === 'NowPlayingArtwork')?.element;
    expect(artwork?.props.style).toEqual({ width: 155, height: 155 });

    const transport = paths(rendered).find(({ element }) => element.type === 'Transport')?.element;
    expect(transport?.props.isTv).toBe(true);
    expect(transport?.props.tvPreferredPlayFocus).toBe(true);
    expect(transport?.props.tvPlayFocusKey).toBe('now-playing-play-pause');
    const tvTabs = paths(rendered).find(({ element }) => element.type === 'NowPlayingTabs')?.element;
    expect(tvTabs?.props.tabs).toEqual(['lyrics', 'similar', 'queue']);
    expect(tvTabs?.props.compact).toBe(true);
    expect(tvTabs?.props.selected).toBe('lyrics');
    expect(paths(rendered).some(({ element }) => element.type === 'LiveLyricsPanel')).toBe(true);

    // Navigating forward out of NowPlaying consumes the TV checkpoint so it never leaks.
    const metadata = paths(rendered).find(({ element }) => element.type === 'Metadata')?.element;
    (metadata?.props.onOpenAlbum as () => void)();
    expect(harness.openAlbumInActiveTab).toHaveBeenCalledOnce();
    expect(harness.popAndRestore).toHaveBeenCalledOnce();

    // Subsequent dismiss does not double-pop the already-consumed checkpoint.
    expect(harness.backHandlers[0]()).toBe(true);
    expect(harness.popAndRestore).toHaveBeenCalledOnce();
    expect(harness.goBack).toHaveBeenCalledOnce();
  });
});
