import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import type { Track } from '../api/types';
import { strings } from '../localization';
import TrackLikeButton, { EpicLikeGlyph, getLikedTrackIdSet } from './TrackLikeButton';

const hooks = vi.hoisted(() => ({
  liked: false as boolean | undefined,
  queryPending: false,
  queryFetching: false,
  queryStale: false,
  queryFetchStatus: 'idle' as 'fetching' | 'paused' | 'idle',
  queryError: null as unknown,
  mutationPending: false,
  matchingMutations: 0,
  reducedMotion: false,
  mutate: vi.fn(),
  refetch: vi.fn(),
  announce: vi.fn(),
  isReduceMotionEnabled: vi.fn(),
  addEventListener: vi.fn(),
  triggerHaptic: vi.fn(() => true),
  createOptions: vi.fn((_options: unknown) => ({})),
  reportPlayerNotice: vi.fn(),
  lastSelect: undefined as ((tracks: readonly Track[]) => boolean) | undefined,
  stateSlots: [] as unknown[],
  refSlots: [] as { current: unknown }[],
  stateCursor: 0,
  refCursor: 0,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] => {
      const index = hooks.stateCursor++;
      if (!(index in hooks.stateSlots)) {
        hooks.stateSlots[index] = typeof initial === 'function'
          ? (initial as () => T)()
          : initial;
      }
      const setter = (next: T | ((prev: T) => T)) => {
        hooks.stateSlots[index] = typeof next === 'function'
          ? (next as (prev: T) => T)(hooks.stateSlots[index] as T)
          : next;
      };
      return [hooks.stateSlots[index] as T, setter];
    },
    useRef: <T,>(initial: T) => {
      const index = hooks.refCursor++;
      if (!(index in hooks.refSlots)) {
        hooks.refSlots[index] = { current: initial };
      }
      return hooks.refSlots[index] as { current: T };
    },
    useCallback: <T,>(callback: T): T => callback,
    useMemo: <T,>(factory: () => T): T => factory(),
    useEffect: () => undefined,
  };
});

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    announceForAccessibility: hooks.announce,
    isReduceMotionEnabled: hooks.isReduceMotionEnabled,
    addEventListener: hooks.addEventListener,
  },
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    Value: class {
      setValue = vi.fn();
      interpolate = vi.fn(() => 'interpolated');
    },
    View: 'Animated.View',
    parallel: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    sequence: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    timing: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    spring: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
  Easing: {
    out: (fn: unknown) => fn,
    quad: () => 0,
    cubic: () => 0,
  },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  ToastAndroid: { SHORT: 0, show: vi.fn() },
  View: 'View',
}));

vi.mock('@tanstack/react-query', () => ({
  useIsMutating: () => hooks.matchingMutations,
  useMutation: () => ({ isPending: hooks.mutationPending, mutate: hooks.mutate }),
  useQuery: (options: { select?: (tracks: readonly Track[]) => boolean }) => {
    hooks.lastSelect = options.select;
    return {
      data: hooks.liked,
      isPending: hooks.queryPending,
      isFetching: hooks.queryFetching,
      isStale: hooks.queryStale,
      fetchStatus: hooks.queryFetchStatus,
      error: hooks.queryError,
      refetch: hooks.refetch,
    };
  },
  useQueryClient: () => ({}),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
vi.mock('../config', () => ({
  getCurrentApiBase: () => 'https://music.example.test',
}));
vi.mock('../data', () => ({
  createTrackLikeMutationOptions: hooks.createOptions,
  musicCacheScope: (_origin: string, userId: number) => `account-${userId}`,
  musicQueries: { likes: (scope: string) => ({ queryKey: ['likes', scope] }) },
  trackLikeMutationKey: (scope: string, trackId: string) => ['like', scope, trackId],
}));
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => hooks.reducedMotion,
}));
vi.mock('../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: hooks.triggerHaptic }),
}));
vi.mock('../player/browseTree', () => ({ refreshBrowseTree: vi.fn() }));
vi.mock('../player/notices', () => ({ reportPlayerNotice: hooks.reportPlayerNotice }));
vi.mock('./AppIcon', () => ({ default: 'AppIcon' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function renderLike(props: Parameters<typeof TrackLikeButton>[0]) {
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  return TrackLikeButton(props);
}

function propsOf(node: React.ReactNode): ElementProps {
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    throw new Error('Expected a React element');
  }
  return (node as React.ReactElement<ElementProps>).props;
}

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

const track: Track = {
  id: 'track-1',
  title: 'Midnight Signal',
  artist: 'LoggeRythm',
  artist_id: 'artist-1',
  artists: [{ id: 'artist-1', name: 'LoggeRythm' }],
  album: 'Parity',
  album_id: 'album-1',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

const otherTrack: Track = {
  ...track,
  id: 'track-2',
  title: 'Second Track',
};

describe('TrackLikeButton', () => {
  beforeEach(() => {
    hooks.liked = false;
    hooks.queryPending = false;
    hooks.queryFetching = false;
    hooks.queryStale = false;
    hooks.queryFetchStatus = 'idle';
    hooks.queryError = null;
    hooks.mutationPending = false;
    hooks.matchingMutations = 0;
    hooks.reducedMotion = false;
    hooks.stateSlots = [];
    hooks.refSlots = [];
    hooks.stateCursor = 0;
    hooks.refCursor = 0;
    hooks.lastSelect = undefined;
    hooks.mutate.mockClear();
    hooks.refetch.mockClear();
    hooks.announce.mockClear();
    hooks.isReduceMotionEnabled.mockClear();
    hooks.addEventListener.mockClear();
    hooks.triggerHaptic.mockClear();
    hooks.createOptions.mockClear();
    hooks.reportPlayerNotice.mockClear();
  });

  it('caches one O(1) liked ID Set per React Query likes array reference', () => {
    const likesArray = [track];
    const firstSet = getLikedTrackIdSet(likesArray);
    const secondSet = getLikedTrackIdSet(likesArray);

    expect(secondSet).toBe(firstSet);
    expect(firstSet.has('track-1')).toBe(true);
    expect(firstSet.has('track-2')).toBe(false);

    const nextArray = [track, otherTrack];
    const nextSet = getLikedTrackIdSet(nextArray);
    expect(nextSet).not.toBe(firstSet);
    expect(nextSet.has('track-2')).toBe(true);

    renderLike({ track });
    expect(hooks.lastSelect?.(likesArray)).toBe(true);
    expect(hooks.lastSelect?.([otherTrack])).toBe(false);
  });

  it('exposes an explicit track-specific TalkBack action, fires haptic on like, and registers zero per-row AccessibilityInfo listeners', () => {
    const props = propsOf(renderLike({ track, testID: 'row-like' }));

    expect(props.testID).toBe('row-like');
    expect(props.accessibilityRole).toBe('button');
    expect(props.accessibilityLabel).toBe(`${strings.player.likeTrack}: ${track.title}`);
    expect(props.accessibilityState).toEqual({ checked: false, disabled: false, busy: false });
    expect(hooks.isReduceMotionEnabled).not.toHaveBeenCalled();
    expect(hooks.addEventListener).not.toHaveBeenCalled();

    (props.onPress as () => void)();
    expect(hooks.triggerHaptic).toHaveBeenCalledExactlyOnceWith('like');
    expect(hooks.mutate).toHaveBeenCalledWith(true);
  });

  it('announces unlike state and disables every duplicate while the track mutates', () => {
    hooks.liked = true;
    hooks.matchingMutations = 1;
    const props = propsOf(renderLike({ track }));

    expect(props.accessibilityLabel).toBe(`${strings.player.unlikeTrack}: ${track.title}`);
    expect(props.accessibilityState).toEqual({ checked: true, disabled: true, busy: true });
    expect(props.disabled).toBe(true);
  });

  it('mounts zero celebration particles at rest, on passive sync, or on FlatList recycle, and celebrates ONLY on user-triggered like', () => {
    // At rest (unliked): zero celebration, plain AppIcon.
    const unliked = renderLike({ track });
    const unlikedGlyph = elements(unliked).find(
      (element) => element.type === EpicLikeGlyph,
    );
    expect(unlikedGlyph?.props.liked).toBe(false);
    expect(unlikedGlyph?.props.celebrating).toBe(false);
    const restingTree = EpicLikeGlyph(
      unlikedGlyph?.props as unknown as Parameters<typeof EpicLikeGlyph>[0],
    );
    expect(restingTree.type).toBe('AppIcon');

    // Passive sync transition (false -> true without user tap): MUST NOT celebrate!
    hooks.liked = true;
    const passivelySynced = renderLike({ track });
    const syncedGlyph = elements(passivelySynced).find(
      (element) => element.type === EpicLikeGlyph,
    );
    expect(syncedGlyph?.props.liked).toBe(true);
    expect(syncedGlyph?.props.celebrating).toBe(false);

    // User-triggered like: celebrates immediately!
    hooks.liked = false;
    const beforeTap = propsOf(renderLike({ track }));
    (beforeTap.onPress as () => void)();
    hooks.liked = true;
    const celebrating = renderLike({ track });
    const activeGlyph = elements(celebrating).find(
      (element) => element.type === EpicLikeGlyph,
    );
    expect(activeGlyph?.props.celebrating).toBe(true);

    // FlatList row recycle to another track immediately drops celebration ownership!
    const recycled = renderLike({ track: otherTrack });
    const recycledGlyph = elements(recycled).find(
      (element) => element.type === EpicLikeGlyph,
    );
    expect(recycledGlyph?.props.celebrating).toBe(false);
  });

  it('suppresses celebration particles under reduced motion', () => {
    hooks.reducedMotion = true;
    const beforeTap = propsOf(renderLike({ track }));
    (beforeTap.onPress as () => void)();
    hooks.liked = true;
    const afterTap = renderLike({ track });
    const glyph = elements(afterTap).find(
      (element) => element.type === EpicLikeGlyph,
    );
    expect(glyph?.props.celebrating).toBe(false);
  });

  it('forwards Android TV focus props and renders FocusRingOverlay', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const rendered = renderLike({
      track,
      testID: 'tv-like',
      focusable: true,
      hasTVPreferredFocus: true,
      focused: true,
      onFocus,
      onBlur,
    });
    const props = propsOf(rendered);
    expect(props.focusable).toBe(true);
    expect(props.hasTVPreferredFocus).toBe(true);
    (props.onFocus as (event: unknown) => void)({ nativeEvent: {} });
    (props.onBlur as (event: unknown) => void)({ nativeEvent: {} });
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it('turns an authoritative query failure into a generic, enabled retry action', () => {
    hooks.liked = undefined;
    hooks.queryError = new Error('private likes diagnostic');
    const props = propsOf(renderLike({ track }));

    expect(props.disabled).toBe(false);
    expect(props.accessibilityLabel).toBe(strings.player.retryLikeState(track.title));
    expect(props.accessibilityHint).toBe(strings.player.likeStateLoadFailed);
    expect(String(props.accessibilityHint)).not.toContain('private likes diagnostic');
    expect(props.accessibilityState).toEqual({ disabled: false, busy: false });
    (props.onPress as () => void)();
    expect(hooks.refetch).toHaveBeenCalledOnce();
    expect(hooks.mutate).not.toHaveBeenCalled();
    expect(hooks.triggerHaptic).not.toHaveBeenCalled();
  });

  it('labels initial loading and keeps cached offline like state actionable', () => {
    hooks.liked = undefined;
    hooks.queryPending = true;
    hooks.queryFetching = true;
    hooks.queryStale = true;
    hooks.queryFetchStatus = 'fetching';
    const loading = propsOf(renderLike({ track }));
    expect(loading.accessibilityLabel).toBe(strings.player.likeStateLoading(track.title));
    expect(loading.accessibilityState).toEqual({ disabled: true, busy: true });

    hooks.liked = true;
    hooks.queryPending = false;
    hooks.queryFetching = false;
    hooks.queryFetchStatus = 'paused';
    const cachedOffline = propsOf(renderLike({ track }));
    expect(cachedOffline.accessibilityLabel).toBe(`${strings.player.unlikeTrack}: ${track.title}`);
    expect(cachedOffline.accessibilityHint).toBe(strings.player.likeStateOffline);
    expect(cachedOffline.accessibilityState).toEqual({ checked: true, disabled: false, busy: false });
    (cachedOffline.onPress as () => void)();
    expect(hooks.mutate).toHaveBeenCalledExactlyOnceWith(false);
    expect(hooks.refetch).not.toHaveBeenCalled();
  });

  it('announces the confirmed semantic mutation result', () => {
    renderLike({ track });
    const options = hooks.createOptions.mock.calls[0]?.[0] as {
      onMutationSuccess: (nextLiked: boolean) => void;
    };

    options.onMutationSuccess(true);
    options.onMutationSuccess(false);

    expect(hooks.announce).toHaveBeenNthCalledWith(1, strings.player.likedTrack(track.title));
    expect(hooks.announce).toHaveBeenNthCalledWith(2, strings.player.unlikedTrack(track.title));
  });

  it('reports Android Auto refresh as safe non-fatal bookkeeping', () => {
    renderLike({ track });
    const options = hooks.createOptions.mock.calls[0]?.[0] as {
      onAutoBrowseError: (error: unknown) => void;
    };

    options.onAutoBrowseError(new Error('sf_session=must-not-leak'));

    expect(hooks.reportPlayerNotice).toHaveBeenCalledWith(
      'bookkeeping',
      'auto-library-refresh',
      strings.player.autoLibraryFailed,
      strings.player.autoLibraryRefreshFailedMessage,
    );
    expect(hooks.reportPlayerNotice.mock.calls[0]).not.toContain('sf_session=must-not-leak');
  });
});
