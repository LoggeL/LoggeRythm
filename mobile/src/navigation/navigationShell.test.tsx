import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TvShellHost } from '../navigation';
import { computeTvEnvironment, type TvEnvironment } from '../tv/tvEnvironment';
import { brandedRootOptions, buildSectionScreenOptions } from './headerChrome';
import { HomeRoute } from './routes';
import { renderHiddenTabBar } from './tabBar';

const mocks = vi.hoisted(() => ({
  tvEnv: null as unknown as TvEnvironment,
  navReady: true,
  navigate: vi.fn(),
  pushCheckpoint: vi.fn(),
  activeItem: null as Record<string, unknown> | null,
  isPlaying: false,
  updateAttention: 'none' as 'none' | 'update-available' | 'install-failed',
  hookCursor: 0,
  hookSlots: [] as { deps: readonly unknown[]; value: unknown }[],
  trackHooks: false,
}));

function depsEqual(
  prev: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (prev === undefined || next === undefined || prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) return false;
  }
  return true;
}

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useCallback: <T,>(cb: T, deps?: readonly unknown[]): T => {
      if (!mocks.trackHooks) return cb;
      const index = mocks.hookCursor++;
      const slot = mocks.hookSlots[index];
      if (slot && depsEqual(slot.deps, deps)) return slot.value as T;
      mocks.hookSlots[index] = { deps: deps ?? [], value: cb };
      return cb;
    },
    useMemo: <T,>(factory: () => T, deps?: readonly unknown[]): T => {
      if (!mocks.trackHooks) return factory();
      const index = mocks.hookCursor++;
      const slot = mocks.hookSlots[index];
      if (slot && depsEqual(slot.deps, deps)) return slot.value as T;
      const value = factory();
      mocks.hookSlots[index] = { deps: deps ?? [], value };
      return value;
    },
  };
});

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('@react-navigation/native', () => ({
  DarkTheme: { colors: {} },
  NavigationContainer: 'NavigationContainer',
  useIsFocused: () => true,
  createNavigationContainerRef: () => ({
    isReady: () => mocks.navReady,
    navigate: mocks.navigate,
    dispatch: vi.fn(),
    getRootState: () => undefined,
  }),
  StackActions: { push: vi.fn() },
}));
vi.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }),
}));
vi.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({ Navigator: 'TabNavigator', Screen: 'TabScreen' }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));
vi.mock('../auth/presentationError', () => ({ presentError: vi.fn() }));
vi.mock('../config', () => ({
  getCurrentApiBase: () => 'https://music.example.test',
  PRODUCTION_API_BASE: 'https://loggerythm.logge.top',
}));
vi.mock('../components/MiniPlayer', () => ({ default: 'MiniPlayer' }));
vi.mock('../components/connect/DevicePickerSheet', () => ({ default: 'DevicePickerHost' }));
vi.mock('../connect/connectRuntime', () => ({
  connectSession: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock('../connect/activeConnect', () => ({
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
}));
vi.mock('../party/partyErrors', () => ({ partyErrorDetail: (e: unknown) => String(e) }));
vi.mock('../party/partyRuntime', () => ({
  partySession: () => ({ restoreActive: vi.fn(async () => null) }),
}));
vi.mock('../party/activeParty', () => ({
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
vi.mock('../components/player/TrackPresentationProvider', () => ({
  TrackPresentationProvider: 'TrackPresentationProvider',
}));
vi.mock('../components/BrandLockup', () => ({ default: 'BrandLockup' }));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
vi.mock('../localization/LocaleProvider', () => ({ useLocaleRevision: () => 0 }));
vi.mock('../player/player', () => ({
  PlaybackState: { Buffering: 'buffering', Playing: 'playing', Paused: 'paused' },
  useActiveMediaItem: () => mocks.activeItem,
  useIsPlaying: () => mocks.isPlaying,
  usePlaybackState: () => (mocks.isPlaying ? 'playing' : 'paused'),
}));
vi.mock('../share/sharedTextRuntime', () => ({
  spotifySharedTextCoordinator: {
    attachNavigator: vi.fn(),
    attachSearchOwner: vi.fn(),
  },
}));
vi.mock('../voice/voicePlaybackRuntime', () => ({
  attachMediaPlayFromSearchIntake: vi.fn(() => () => undefined),
}));
vi.mock('../update/androidUpdateStore', () => ({
  useAndroidUpdateSnapshot: () => ({ supported: true }),
  androidUpdateAttention: () => mocks.updateAttention,
}));
vi.mock('../tv', () => ({
  TvShellLayout: 'TvShellLayout',
  tvFocusRegistry: { pushCheckpoint: mocks.pushCheckpoint },
  useTvEnvironment: () => mocks.tvEnv,
}));
vi.mock('./playerOverlays', () => ({
  PlayerErrorBanner: 'PlayerErrorBanner',
  PlayerNoticeWithoutMiniPlayer: 'PlayerNoticeWithoutMiniPlayer',
}));
vi.mock('./PlayerStartup', () => ({
  PlayerStartupError: 'PlayerStartupError',
  PlayerStartupStatus: 'PlayerStartupStatus',
}));
vi.mock('./useApprovedAccountScope', () => ({
  useApprovedAccountScope: () => 'account-1',
}));
vi.mock('./useNavigationRestoration', () => ({
  useNavigationRestoration: () => ({ ready: true, initialState: undefined, persist: vi.fn() }),
}));
vi.mock('./usePlayerBootstrap', () => ({
  usePlayerBootstrap: () => ({ ready: true, error: null, retry: vi.fn() }),
}));
vi.mock('../navigationLinking', () => ({ appLinking: {} }));
vi.mock('../screens/HomeScreen', () => ({ default: 'HomeScreen' }));
vi.mock('../screens/SearchScreen', () => ({ default: 'SearchScreen' }));
vi.mock('../screens/DiscoverScreen', () => ({ default: 'DiscoverScreen' }));
vi.mock('../screens/RadioScreen', () => ({ default: 'RadioScreen' }));
vi.mock('../screens/LibraryScreen', () => ({ default: 'LibraryScreen' }));
vi.mock('../screens/AlbumScreen', () => ({ default: 'AlbumScreen' }));
vi.mock('../screens/ArtistScreen', () => ({ default: 'ArtistScreen' }));
vi.mock('../screens/GenreScreen', () => ({ default: 'GenreScreen' }));
vi.mock('../screens/MixScreen', () => ({ default: 'MixScreen' }));
vi.mock('../screens/RadarScreen', () => ({ default: 'RadarScreen' }));
vi.mock('../screens/PlaylistScreen', () => ({ default: 'PlaylistScreen' }));
vi.mock('../screens/ProfileScreen', () => ({ default: 'ProfileScreen' }));
vi.mock('../screens/InsightsScreen', () => ({ default: 'InsightsScreen' }));
vi.mock('../screens/UserProfileScreen', () => ({ default: 'UserProfileScreen' }));
vi.mock('../screens/NowPlayingScreen', () => ({ default: 'NowPlayingScreen' }));
vi.mock('../screens/QueueScreen', () => ({ default: 'QueueScreen' }));
vi.mock('../screens/PartyScreen', () => ({
  default: 'PartyScreen',
  InvalidPartyLink: 'InvalidPartyLink',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function expand(node: React.ReactNode): React.ReactElement<ElementProps> {
  const element = node as React.ReactElement<ElementProps>;
  if (typeof element.type === 'function') {
    return expand((element.type as (props: ElementProps) => React.ReactNode)(element.props));
  }
  return element;
}

describe('navigation shell & TV rail integration', () => {
  beforeEach(() => {
    mocks.tvEnv = computeTvEnvironment({ width: 390, height: 844 }, false);
    mocks.navReady = true;
    mocks.navigate.mockClear();
    mocks.pushCheckpoint.mockClear();
    mocks.activeItem = null;
    mocks.isPlaying = false;
    mocks.updateAttention = 'none';
    mocks.trackHooks = false;
    mocks.hookCursor = 0;
    mocks.hookSlots = [];
  });

  it('leaves phones untouched in TvShellHost and keeps phone root headers intact', () => {
    const child = React.createElement('RootStack', { testID: 'root-stack' });
    const phoneShell = TvShellHost({ activeRoute: 'HomeTab', children: child });

    expect(phoneShell.type).toBe(React.Fragment);
    expect(phoneShell.props.children).toBe(child);
    expect(brandedRootOptions('Home', false).headerShown).toBe(true);
    expect(brandedRootOptions('Home', true)).toEqual({ headerShown: false });
    expect(renderHiddenTabBar()).toBeNull();
    expect(buildSectionScreenOptions(false).animation).toBe('slide_from_right');
    expect(buildSectionScreenOptions(true).animation).toBe('none');
  });

  it('wires TvShellLayout + rail navigation + focus checkpoints cleanly in Android TV mode', () => {
    mocks.tvEnv = computeTvEnvironment({ width: 960, height: 540 }, true);
    mocks.activeItem = {
      mediaId: 'track:1',
      title: 'Midnight Groove',
      artist: 'Neon Pulse',
      extras: {
        track: {
          id: '1',
          title: 'Midnight Groove',
          artist: 'Neon Pulse',
          artist_id: '7',
          artists: [{ id: '7', name: 'Neon Pulse' }],
          album: 'Parity',
          album_id: '9',
          cover: '',
          duration_sec: 180,
          preview_url: null,
          rank: 0,
          release_date: '',
        },
      },
    };
    mocks.isPlaying = true;
    mocks.updateAttention = 'update-available';

    const child = React.createElement('RootStack', { testID: 'root-stack' });
    const shell = expand(TvShellHost({ activeRoute: 'LibraryTab', children: child }));

    expect(shell.type).toBe('TvShellLayout');
    expect(shell.props.activeRoute).toBe('LibraryTab');
    expect(shell.props.preferredFocus).toBeUndefined();
    expect(shell.props.profileAttention).toBe(true);
    expect(shell.props.nowPlaying).toEqual({
      title: 'Midnight Groove',
      artist: 'Neon Pulse',
      isPlaying: true,
    });

    (shell.props.onSelectTab as (tab: string) => void)('SearchTab');
    expect(mocks.navigate).toHaveBeenCalledWith('Tabs', { screen: 'SearchTab' });

    (shell.props.onOpenNowPlaying as () => void)();
    expect(mocks.pushCheckpoint).toHaveBeenCalledWith('tv-now-playing');
    expect(mocks.navigate).toHaveBeenCalledWith('NowPlaying');

    (shell.props.onOpenQueue as () => void)();
    expect(mocks.pushCheckpoint).toHaveBeenCalledWith('tv-queue');
    expect(mocks.navigate).toHaveBeenCalledWith('Queue');

    (shell.props.onOpenProfile as () => void)();
    expect(mocks.pushCheckpoint).toHaveBeenCalledWith('tv-profile');
    expect(mocks.navigate).toHaveBeenCalledWith('Profile');
  });

  it('memoizes route callbacks so screens do not receive fresh callback refs on re-render', () => {
    mocks.trackHooks = true;
    const navigation = { push: vi.fn(), goBack: vi.fn(), canGoBack: vi.fn() } as never;
    const route = { key: 'Home-1', name: 'Home' } as never;

    mocks.hookCursor = 0;
    const first = HomeRoute({ navigation, route });
    mocks.hookCursor = 0;
    const second = HomeRoute({ navigation, route });

    expect(second.props.onOpenAlbum).toBe(first.props.onOpenAlbum);
    expect(second.props.onOpenArtist).toBe(first.props.onOpenArtist);
    expect(second.props.onOpenGenre).toBe(first.props.onOpenGenre);
    expect(second.props.onOpenPlaylist).toBe(first.props.onOpenPlaylist);
    expect(second.props.onOpenMix).toBe(first.props.onOpenMix);
    expect(second.props.onOpenRadar).toBe(first.props.onOpenRadar);
    expect(second.props.onOpenSearch).toBe(first.props.onOpenSearch);
  });
});
