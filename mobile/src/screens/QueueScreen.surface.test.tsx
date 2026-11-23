import { describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import { elements, queryByTestId as byTestId } from '../test/render';
import QueueScreen, {
  QueueSurface,
  QueueSurfaceGlobalFeedback,
  QueueSurfaceHeader,
  queueSurfacePadding,
} from './QueueScreen';

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Animated: { Value: vi.fn(), View: 'Animated.View' },
  Image: 'Image',
  Pressable: 'Pressable',
  SectionList: 'SectionList',
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
    hairlineWidth: 1,
  },
  Text: 'Text',
  View: 'View',
}));

const navMocks = vi.hoisted(() => ({
  openAlbumInActiveTab: vi.fn<() => 'opened' | 'not-ready'>(() => 'opened'),
  openArtistInActiveTab: vi.fn<() => 'opened' | 'not-ready'>(() => 'opened'),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 20, left: 0 }),
}));
vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));
vi.mock('../navigation/rootNavigation', () => ({
  openAlbumInActiveTab: navMocks.openAlbumInActiveTab,
  openArtistInActiveTab: navMocks.openArtistInActiveTab,
  resolveActiveTabName: () => 'HomeTab',
}));

vi.mock('../player/player', async () => {
  const { Event } = await import('../player/playerPort');
  return {
    default: { addEventListener: vi.fn() },
    Event,
  };
});

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../components/PlayerNoticeBanner', () => ({ default: 'PlayerNoticeBanner' }));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  TrackRowSkeleton: 'TrackRowSkeleton',
}));
vi.mock('../data', () => ({ musicQueries: { cachedTrackIds: vi.fn(() => ({})) } }));
vi.mock('../player/controller', () => ({
  clearUpcomingQueue: vi.fn(),
  getQueueSnapshot: vi.fn(),
  isContextShuffleEnabled: vi.fn(() => false),
  moveQueueItem: vi.fn(),
  removeQueueItem: vi.fn(),
  skipToQueueItem: vi.fn(),
  toggleShuffle: vi.fn(),
}));
vi.mock('../player/errors', () => ({
  clearPlayerError: vi.fn(),
  reportPlayerError: vi.fn(),
  usePlayerError: vi.fn(() => null),
}));
vi.mock('../player/mediaItem', () => ({ mediaItemToTrack: vi.fn() }));
vi.mock('../party/partyErrors', () => ({ partyErrorDetail: vi.fn(String) }));
vi.mock('../party/partyRuntime', () => ({
  startPartyFromQueue: vi.fn(),
  usePartySession: vi.fn(() => ({ party: null, detached: false })),
}));
vi.mock('../tv', () => ({
  TvFocusable: 'TvFocusable',
  TvFocusScope: 'TvFocusScope',
  useTvEnvironment: () => ({
    isTv: false,
    isWidescreen: false,
    overscan: { top: 0, right: 0, bottom: 0, left: 0 },
    contentPaddingHorizontal: 20,
  }),
  useTvFocusReturn: () => ({
    lastFocusedKey: null,
    restore: vi.fn(),
    pushCheckpoint: vi.fn(),
    popAndRestore: vi.fn(),
  }),
}));
vi.mock('../player/queueContract', () => ({
  queueContextOf: vi.fn(),
  queueOriginOf: vi.fn(),
  queueStableIdOf: vi.fn(),
}));


describe('Queue surface standalone and embedded contracts', () => {
  it('keeps the navigation route as a thin standalone QueueSurface wrapper delegating Album/Artist to openAlbumInActiveTab/openArtistInActiveTab', () => {
    navMocks.openAlbumInActiveTab.mockClear();
    navMocks.openArtistInActiveTab.mockClear();
    const goBack = vi.fn();
    const navigate = vi.fn();
    const rendered = QueueScreen({ navigation: { goBack, navigate } } as never);

    expect(rendered.type).toBe(QueueSurface);
    expect(rendered.props.embedded).toBeUndefined();
    (rendered.props.onClose as () => void)();
    expect(goBack).toHaveBeenCalledOnce();
    (rendered.props.onOpenAlbum as (params: { albumId: string; title: string }) => void)({
      albumId: '42',
      title: 'Discovery',
    });
    expect(navMocks.openAlbumInActiveTab).toHaveBeenCalledWith({
      albumId: '42',
      title: 'Discovery',
    });
    (rendered.props.onOpenArtist as (params: { artistId: string; name: string }) => void)({
      artistId: '7',
      name: 'Daft Punk',
    });
    expect(navMocks.openArtistInActiveTab).toHaveBeenCalledWith({
      artistId: '7',
      name: 'Daft Punk',
    });
  });

  it('owns safe-area padding only when rendered as the standalone route', () => {
    expect(queueSurfacePadding(false, 24, 20)).toEqual({
      paddingTop: 32,
      paddingBottom: 20,
    });
    expect(queueSurfacePadding(false, 0, 0)).toEqual({
      paddingTop: 8,
      paddingBottom: 12,
    });
    expect(queueSurfacePadding(true, 24, 20)).toEqual({
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it('keeps the title/count and standalone dismissal semantics', () => {
    const onClose = vi.fn();
    const rendered = QueueSurfaceHeader({ embedded: false, upcomingCount: 3, onClose });
    const close = byTestId(rendered, 'queue-close');

    expect(byTestId(rendered, 'queue-header')).not.toBeNull();
    expect(elements(rendered).some((element) =>
      element.props.children === strings.queue.upcomingCount(3))).toBe(true);
    expect(close?.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: strings.queue.close,
    });
    (close?.props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the title/count but removes the duplicate close affordance when embedded', () => {
    const rendered = QueueSurfaceHeader({
      embedded: true,
      upcomingCount: 2,
      onClose: vi.fn(),
    });

    expect(byTestId(rendered, 'queue-header')).not.toBeNull();
    expect(elements(rendered).some((element) =>
      element.props.children === strings.queue.upcomingCount(2))).toBe(true);
    expect(byTestId(rendered, 'queue-close')).toBeNull();
  });

  it('registers queue-close via TvFocusable in standalone TV mode', () => {
    const onClose = vi.fn();
    const rendered = QueueSurfaceHeader({
      embedded: false,
      upcomingCount: 2,
      onClose,
      isTv: true,
      tvPreferredCloseFocus: true,
    });
    const close = byTestId(rendered, 'queue-close');
    expect(close?.type).toBe('TvFocusable');
    expect(close?.props).toMatchObject({
      focusKey: 'queue-close',
      preferredFocus: true,
      accessibilityRole: 'button',
      accessibilityLabel: strings.queue.close,
    });
    (close?.props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps standalone global errors/notices and suppresses both for an embedded owner', () => {
    const standalone = QueueSurfaceGlobalFeedback({
      embedded: false,
      playerError: 'Safe player error',
    });

    expect(byTestId(standalone, 'queue-error')?.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(elements(standalone).some((element) => element.type === 'PlayerNoticeBanner'))
      .toBe(true);
    expect(QueueSurfaceGlobalFeedback({ embedded: true, playerError: 'Duplicate' })).toBeNull();
  });
});
