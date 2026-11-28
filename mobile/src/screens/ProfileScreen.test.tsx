import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileScreen, {
  ProfileBackgroundUpdateCheck,
  ProfileBottomSafeSpacer,
  ProfileTvFocusEffect,
  ProfileUrgentUpdateCard,
} from './ProfileScreen';

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useEffect: vi.fn(),
  useRef: vi.fn((initial: unknown) => ({ current: initial })),
  isFocused: true,
  useAuth: vi.fn(),
  useQuery: vi.fn(),
  resolveServerUrl: vi.fn(),
  updatePlacement: vi.fn(),
  showDevicePicker: vi.fn(),
  updateStoreSupported: true,
  updateStoreCheck: vi.fn(() => Promise.resolve()),
  safeInsets: { top: 0, right: 0, bottom: 24, left: 0 },
  tvEnv: {
    isTv: false,
    overscan: { top: 0, right: 0, bottom: 0, left: 0 },
    contentPaddingHorizontal: 20,
    gridGap: 14,
  },
  useTvFocusReturn: vi.fn(),
  pushCheckpoint: vi.fn(),
  popAndRestore: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: mocks.useState,
    useEffect: mocks.useEffect,
    useRef: mocks.useRef,
  };
});

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => mocks.isFocused,
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../components/connect/devicePicker', () => ({
  showDevicePicker: mocks.showDevicePicker,
}));
vi.mock('../components/player/AudioEffectsSheet', () => ({
  AudioEffectsSheet: 'AudioEffectsSheet',
}));
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  BottomSheet: 'BottomSheet',
}));
vi.mock('../hooks/useBottomInset', () => ({ useBottomInset: () => 96 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mocks.safeInsets,
}));
vi.mock('../tv', () => ({
  TvFocusScope: 'TvFocusScope',
  tvFocusRegistry: {
    pushCheckpoint: mocks.pushCheckpoint,
    popAndRestore: mocks.popAndRestore,
  },
  useTvEnvironment: () => mocks.tvEnv,
  useTvFocusReturn: mocks.useTvFocusReturn,
}));
vi.mock('../components/profile/ProfileSections', () => ({
  ListeningStatsPanel: 'ListeningStatsPanel',
  ProfileIdentityCard: 'ProfileIdentityCard',
  SleepTimerPanel: 'SleepTimerPanel',
}));
vi.mock('../components/profile/AdminHubPanel', () => ({ default: 'AdminHubPanel' }));
vi.mock('../components/profile/ProfileOverviewNavigation', () => ({
  ProfileQuickActions: 'ProfileQuickActions',
  ProfileSettingsMenu: 'ProfileSettingsMenu',
}));
vi.mock('../components/profile/AndroidUpdateCard', () => ({ default: 'AndroidUpdateCard' }));
vi.mock('../components/profile/useAndroidUpdatePlacement', () => ({
  useAndroidUpdatePlacement: mocks.updatePlacement,
}));
vi.mock('../update/androidUpdateStore', () => ({
  androidUpdateStore: {
    getSnapshot: () => ({ supported: mocks.updateStoreSupported }),
    check: mocks.updateStoreCheck,
  },
}));
vi.mock('../api/url', () => ({ resolveServerUrl: mocks.resolveServerUrl }));
vi.mock('../config', () => ({
  getCurrentApiBase: () => 'https://music.example.test',
}));
vi.mock('../data', () => ({
  musicCacheScope: () => 'https://music.example.test::user:7',
  musicQueries: { stats: () => ({ queryKey: ['stats'] }) },
}));
vi.mock('../localization', () => ({
  strings: {
    profile: {
      refreshStats: 'Reload listening stats',
    },
    player: {
      sleepTimerSheetClose: 'Close sleep timer',
    },
  },
}));
vi.mock('../localization/wave2Strings', () => ({
  wave2Strings: {
    audioEffects: {
      closeButton: 'Close audio effects',
    },
  },
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`No element has testID ${testID}`);
  return found;
}

function byType(node: React.ReactNode, type: unknown): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.type === type);
  if (found === undefined) throw new Error(`No element has type ${String(type)}`);
  return found;
}

function renderOverview(
  sleepSheetOpen = false,
  effectsSheetOpen = false,
) {
  const setSleepSheetOpen = vi.fn();
  const setEffectsSheetOpen = vi.fn();
  mocks.useState
    .mockReturnValueOnce([sleepSheetOpen, setSleepSheetOpen])
    .mockReturnValueOnce([effectsSheetOpen, setEffectsSheetOpen]);
  const callbacks = {
    onOpenPlaybackSettings: vi.fn(),
    onOpenDevicesStorageSettings: vi.fn(),
    onOpenAccountAppSettings: vi.fn(),
    onOpenInsights: vi.fn(),
  };
  return {
    tree: ProfileScreen(callbacks),
    callbacks,
    setSleepSheetOpen,
    setEffectsSheetOpen,
  };
}

function scrollOrder(tree: React.ReactNode): string[] {
  const scroll = elements(tree).find((element) => element.type === 'ScrollView');
  if (scroll === undefined) throw new Error('Profile has no ScrollView');
  const children = (Array.isArray(scroll.props.children)
    ? scroll.props.children
    : [scroll.props.children]) as (React.ReactElement<ElementProps> | null)[];
  return children.filter((child) => child !== null).map((child) => {
    if (child.type === ProfileUrgentUpdateCard) return 'ProfileUrgentUpdateCard';
    if (typeof child.type === 'string') return child.type;
    return String(child.props.testID);
  });
}

describe('ProfileScreen overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFocused = true;
    mocks.resolveServerUrl.mockImplementation((value: string) => value);
    mocks.updatePlacement.mockReturnValue('bottom');
    mocks.updateStoreSupported = true;
    mocks.safeInsets = { top: 0, right: 0, bottom: 24, left: 0 };
    mocks.tvEnv = {
      isTv: false,
      overscan: { top: 0, right: 0, bottom: 0, left: 0 },
      contentPaddingHorizontal: 20,
      gridGap: 14,
    };
    mocks.useAuth.mockReturnValue({
      user: {
        id: 7,
        email: 'person@example.test',
        display_name: 'Person',
        avatar_url: null,
        is_admin: false,
        is_approved: true,
      },
    });
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: null,
      isPending: false,
      isFetching: false,
      fetchStatus: 'idle',
      isStale: false,
      refetch: vi.fn(),
    });
  });

  it('reports an invalid configured avatar URL loudly', () => {
    const auth = mocks.useAuth();
    mocks.useAuth.mockReturnValue({ ...auth, user: { ...auth.user, avatar_url: 'invalid-avatar' } });
    mocks.resolveServerUrl.mockImplementation(() => {
      throw new Error('Unsafe avatar origin');
    });
    expect(() => renderOverview()).toThrow(
      'Profile avatar URL is invalid for the selected server',
    );
  });

  it('renders a concise overview without duplicating the native header or embedding detail settings panels', () => {
    const { tree, callbacks } = renderOverview();

    expect(scrollOrder(tree)).toEqual([
      'ProfileIdentityCard',
      'ProfileQuickActions',
      'ProfileSettingsMenu',
      'ListeningStatsPanel',
    ]);
    expect(elements(tree).some((el) => el.type === ProfileBackgroundUpdateCheck)).toBe(true);
    expect(elements(tree).some((el) => el.type === ProfileUrgentUpdateCard)).toBe(false);
    expect(byType(tree, 'ProfileIdentityCard').props.compact).toBe(true);

    const menu = byType(tree, 'ProfileSettingsMenu');
    expect(menu.props.onOpenPlaybackSettings).toBe(callbacks.onOpenPlaybackSettings);
    expect(menu.props.onOpenDevicesStorageSettings).toBe(callbacks.onOpenDevicesStorageSettings);
    expect(menu.props.onOpenAccountAppSettings).toBe(callbacks.onOpenAccountAppSettings);

    const quick = byType(tree, 'ProfileQuickActions');
    expect(quick.props.onOpenInsights).toBe(callbacks.onOpenInsights);
    (quick.props.onOpenDevices as () => void)();
    expect(mocks.showDevicePicker).toHaveBeenCalledExactlyOnceWith('devices');
  });

  it('surfaces the urgent Android update card at the top slot when an update needs attention', () => {
    mocks.updatePlacement.mockReturnValue('top');
    const { tree } = renderOverview();

    expect(mocks.updatePlacement).toHaveBeenCalledOnce();
    expect(scrollOrder(tree)).toEqual([
      'ProfileUrgentUpdateCard',
      'ProfileIdentityCard',
      'ProfileQuickActions',
      'ProfileSettingsMenu',
      'ListeningStatsPanel',
    ]);
    expect(elements(tree).some((el) => el.type === ProfileBackgroundUpdateCheck)).toBe(false);
  });

  it('exposes the administration panel only to administrators on phone and TV', () => {
    const auth = mocks.useAuth();
    for (const isTv of [false, true]) {
      mocks.tvEnv.isTv = isTv;
      for (const isAdmin of [false, true]) {
        mocks.useAuth.mockReturnValue({ ...auth, user: { ...auth.user, is_admin: isAdmin } });
        const panel = elements(renderOverview(false, false).tree).find((el) => el.type === 'AdminHubPanel');
        expect(Boolean(panel)).toBe(isAdmin);
        if (panel) expect(panel.props.currentUserId).toBe(auth.user.id);
      }
    }
  });

  it('opens and closes quick Sleep Timer and Audio Effects sheets and tracks TV checkpoints', () => {
    mocks.tvEnv = {
      isTv: true,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      gridGap: 16,
    };

    const closed = renderOverview(false, false);
    const quick = byType(closed.tree, 'ProfileQuickActions');
    (quick.props.onOpenSleepTimer as () => void)();
    expect(mocks.pushCheckpoint).toHaveBeenCalledWith('profile-sleep-timer');
    expect(closed.setSleepSheetOpen).toHaveBeenCalledWith(true);

    (quick.props.onOpenAudioEffects as () => void)();
    expect(mocks.pushCheckpoint).toHaveBeenCalledWith('profile-audio-effects');
    expect(closed.setEffectsSheetOpen).toHaveBeenCalledWith(true);

    expect(elements(byTestId(closed.tree, 'profile-quick-sleep-sheet')).some((el) => el.type === 'SleepTimerPanel'))
      .toBe(false);
    expect(elements(byTestId(closed.tree, 'profile-quick-audio-effects-sheet')).some((el) => el.type === 'AudioEffectsSheet'))
      .toBe(false);

    mocks.useState.mockReset();
    const open = renderOverview(true, true);
    const sleepSheet = byTestId(open.tree, 'profile-quick-sleep-sheet');
    const effectsSheet = byTestId(open.tree, 'profile-quick-audio-effects-sheet');
    expect(elements(sleepSheet).some((el) => el.type === 'SleepTimerPanel')).toBe(true);
    expect(elements(effectsSheet).some((el) => el.type === 'AudioEffectsSheet')).toBe(true);

    (sleepSheet.props.onClose as () => void)();
    expect(open.setSleepSheetOpen).toHaveBeenCalledWith(false);
    expect(mocks.popAndRestore).toHaveBeenCalledTimes(1);

    (effectsSheet.props.onClose as () => void)();
    expect(open.setEffectsSheetOpen).toHaveBeenCalledWith(false);
    expect(mocks.popAndRestore).toHaveBeenCalledTimes(2);
  });

  it('guards the bottom Android gesture bar with ProfileBottomSafeSpacer and renders a 2-column TV layout without double overscan', () => {
    mocks.safeInsets = { top: 0, right: 0, bottom: 28, left: 0 };
    const spacer = ProfileBottomSafeSpacer();
    expect(spacer?.props.testID).toBe('profile-bottom-safe-spacer');
    expect(spacer?.props.style).toMatchObject({ height: 28 });

    mocks.safeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(ProfileBottomSafeSpacer()).toBeNull();

    mocks.useState.mockReset();
    mocks.tvEnv = {
      isTv: true,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      gridGap: 16,
    };
    const tvTree = renderOverview().tree;
    expect(byTestId(tvTree, 'profile-tv-columns')).toBeDefined();
    expect(JSON.stringify(byTestId(tvTree, 'profile-screen').props.style)).not.toContain('"paddingTop":27');
    expect(byTestId(tvTree, 'profile-scroll').props.contentContainerStyle).toEqual([
      expect.any(Object),
      { paddingHorizontal: 28, paddingBottom: 96 },
    ]);
    expect(elements(tvTree).some((el) => el.type === ProfileTvFocusEffect)).toBe(true);
  });

  it('pops the tv-profile focus checkpoint on unmount and gates useTvFocusReturn on isFocused', () => {
    let cleanup: (() => void) | undefined;
    mocks.useEffect.mockImplementation((effect: () => (() => void) | void) => {
      cleanup = effect() ?? undefined;
    });
    mocks.tvEnv = {
      isTv: true,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      gridGap: 16,
    };
    mocks.isFocused = false;

    expect(ProfileTvFocusEffect()).toBeNull();
    expect(mocks.useTvFocusReturn).toHaveBeenCalledWith({
      scope: 'profile',
      active: false,
      enabled: true,
    });
    expect(mocks.popAndRestore).not.toHaveBeenCalled();
    cleanup?.();
    expect(mocks.popAndRestore).toHaveBeenCalledOnce();
  });

  it('suppresses urgent update announcements while Profile is covered and keeps background check active otherwise', () => {
    mocks.useEffect.mockImplementation((effect: () => (() => void) | void) => {
      effect();
    });
    mocks.isFocused = false;
    const urgentCard = ProfileUrgentUpdateCard();
    expect(urgentCard.type).toBe('AndroidUpdateCard');
    expect((urgentCard.props.shouldAnnounce as () => boolean)()).toBe(false);

    mocks.isFocused = true;
    const focusedCard = ProfileUrgentUpdateCard();
    expect((focusedCard.props.shouldAnnounce as () => boolean)()).toBe(true);

    expect(ProfileBackgroundUpdateCheck()).toBeNull();
    expect(mocks.updateStoreCheck).toHaveBeenCalledExactlyOnceWith('profile');
  });
});
