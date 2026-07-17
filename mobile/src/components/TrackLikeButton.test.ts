import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import type { Track } from '../api/types';
import { strings } from '../localization';
import TrackLikeButton from './TrackLikeButton';

const hooks = vi.hoisted(() => ({
  liked: false as boolean | undefined,
  queryPending: false,
  queryFetching: false,
  queryStale: false,
  queryFetchStatus: 'idle' as 'fetching' | 'paused' | 'idle',
  queryError: null as unknown,
  mutationPending: false,
  matchingMutations: 0,
  mutate: vi.fn(),
  refetch: vi.fn(),
  announce: vi.fn(),
  createOptions: vi.fn((_options: unknown) => ({})),
  reportPlayerNotice: vi.fn(),
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: hooks.announce },
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T): T => styles },
  Text: 'Text',
  ToastAndroid: { SHORT: 0, show: vi.fn() },
}));

vi.mock('@tanstack/react-query', () => ({
  useIsMutating: () => hooks.matchingMutations,
  useMutation: () => ({ isPending: hooks.mutationPending, mutate: hooks.mutate }),
  useQuery: () => ({
    data: hooks.liked,
    isPending: hooks.queryPending,
    isFetching: hooks.queryFetching,
    isStale: hooks.queryStale,
    fetchStatus: hooks.queryFetchStatus,
    error: hooks.queryError,
    refetch: hooks.refetch,
  }),
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
vi.mock('../player/browseTree', () => ({ refreshBrowseTree: vi.fn() }));
vi.mock('../player/notices', () => ({ reportPlayerNotice: hooks.reportPlayerNotice }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

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
    hooks.mutate.mockClear();
    hooks.refetch.mockClear();
    hooks.announce.mockClear();
    hooks.createOptions.mockClear();
    hooks.reportPlayerNotice.mockClear();
  });

  it('exposes an explicit track-specific TalkBack action and optimistic toggle', () => {
    const props = propsOf(TrackLikeButton({ track, testID: 'row-like' }));

    expect(props.testID).toBe('row-like');
    expect(props.accessibilityRole).toBe('button');
    expect(props.accessibilityLabel).toBe(`${strings.player.likeTrack}: ${track.title}`);
    expect(props.accessibilityState).toEqual({ checked: false, disabled: false, busy: false });

    (props.onPress as () => void)();
    expect(hooks.mutate).toHaveBeenCalledWith(true);
  });

  it('announces unlike state and disables every duplicate while the track mutates', () => {
    hooks.liked = true;
    hooks.matchingMutations = 1;
    const props = propsOf(TrackLikeButton({ track }));

    expect(props.accessibilityLabel).toBe(`${strings.player.unlikeTrack}: ${track.title}`);
    expect(props.accessibilityState).toEqual({ checked: true, disabled: true, busy: true });
    expect(props.disabled).toBe(true);
  });

  it('hands authoritative liked transitions to the shared celebration glyph', () => {
    const unliked = TrackLikeButton({ track });
    const unlikedGlyph = elements(unliked).find(
      (element) =>
        typeof element.type === 'function'
        && element.type.name === 'EpicLikeGlyph',
    );
    expect(unlikedGlyph?.props.liked).toBe(false);

    hooks.liked = true;
    const liked = TrackLikeButton({ track });
    const likedGlyph = elements(liked).find(
      (element) =>
        typeof element.type === 'function'
        && element.type.name === 'EpicLikeGlyph',
    );
    expect(likedGlyph?.props.liked).toBe(true);
  });

  it('turns an authoritative query failure into a generic, enabled retry action', () => {
    hooks.liked = undefined;
    hooks.queryError = new Error('private likes diagnostic');
    const props = propsOf(TrackLikeButton({ track }));

    expect(props.disabled).toBe(false);
    expect(props.accessibilityLabel).toBe(strings.player.retryLikeState(track.title));
    expect(props.accessibilityHint).toBe(strings.player.likeStateLoadFailed);
    expect(String(props.accessibilityHint)).not.toContain('private likes diagnostic');
    expect(props.accessibilityState).toEqual({ disabled: false, busy: false });
    (props.onPress as () => void)();
    expect(hooks.refetch).toHaveBeenCalledOnce();
    expect(hooks.mutate).not.toHaveBeenCalled();
  });

  it('labels initial loading and keeps cached offline like state actionable', () => {
    hooks.liked = undefined;
    hooks.queryPending = true;
    hooks.queryFetching = true;
    hooks.queryStale = true;
    hooks.queryFetchStatus = 'fetching';
    const loading = propsOf(TrackLikeButton({ track }));
    expect(loading.accessibilityLabel).toBe(strings.player.likeStateLoading(track.title));
    expect(loading.accessibilityState).toEqual({ disabled: true, busy: true });

    hooks.liked = true;
    hooks.queryPending = false;
    hooks.queryFetching = false;
    hooks.queryFetchStatus = 'paused';
    const cachedOffline = propsOf(TrackLikeButton({ track }));
    expect(cachedOffline.accessibilityLabel).toBe(`${strings.player.unlikeTrack}: ${track.title}`);
    expect(cachedOffline.accessibilityHint).toBe(strings.player.likeStateOffline);
    expect(cachedOffline.accessibilityState).toEqual({ checked: true, disabled: false, busy: false });
    (cachedOffline.onPress as () => void)();
    expect(hooks.mutate).toHaveBeenCalledExactlyOnceWith(false);
    expect(hooks.refetch).not.toHaveBeenCalled();
  });

  it('announces the confirmed semantic mutation result', () => {
    TrackLikeButton({ track });
    const options = hooks.createOptions.mock.calls[0]?.[0] as {
      onMutationSuccess: (nextLiked: boolean) => void;
    };

    options.onMutationSuccess(true);
    options.onMutationSuccess(false);

    expect(hooks.announce).toHaveBeenNthCalledWith(1, strings.player.likedTrack(track.title));
    expect(hooks.announce).toHaveBeenNthCalledWith(2, strings.player.unlikedTrack(track.title));
  });

  it('reports Android Auto refresh as safe non-fatal bookkeeping', () => {
    TrackLikeButton({ track });
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
