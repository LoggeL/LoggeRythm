import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import NotificationFavoriteHost from './NotificationFavoriteHost';

const state = vi.hoisted(() => ({
  user: null as { id: number; is_approved: boolean } | null,
  likesData: undefined as Track[] | undefined,
  effects: [] as (() => void | (() => void))[],
  ensurePlayer: vi.fn(async () => undefined),
  syncNativeLikedTrackIds: vi.fn(async () => undefined),
  reportPlayerError: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useEffect: (effect: () => void | (() => void)) => {
      state.effects.push(effect);
    },
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: state.likesData }),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: state.user }),
}));

vi.mock('../config', () => ({
  getCurrentApiBase: () => 'https://loggerythm.logge.top',
}));

vi.mock('../data', () => ({
  musicCacheScope: (origin: string, userId: number) => `${origin}::user:${userId}`,
  musicQueries: {
    likes: (scope: string) => ({ queryKey: ['music', scope, 'library', 'likes'] }),
  },
}));

vi.mock('../localization', () => ({
  strings: { player: { likeFailed: 'Like failed' } },
}));

vi.mock('../player/errors', () => ({
  reportPlayerError: state.reportPlayerError,
}));

vi.mock('../player/favoriteNativePort', () => ({
  syncNativeLikedTrackIds: state.syncNativeLikedTrackIds,
}));

vi.mock('../player/setup', () => ({
  ensurePlayer: state.ensurePlayer,
}));

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    artist_id: '10',
    artists: [{ id: '10', name: 'Artist' }],
    album: 'Album',
    album_id: '20',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 1,
    release_date: '',
  };
}

function renderHost(): React.ReactElement | null {
  const root = NotificationFavoriteHost();
  if (root === null) return null;
  const Component = root.type as (props: Record<string, unknown>) => React.ReactElement | null;
  return Component(root.props as Record<string, unknown>);
}

describe('NotificationFavoriteHost', () => {
  beforeEach(() => {
    state.user = null;
    state.likesData = undefined;
    state.effects = [];
    state.ensurePlayer.mockReset().mockResolvedValue(undefined);
    state.syncNativeLikedTrackIds.mockReset().mockResolvedValue(undefined);
    state.reportPlayerError.mockReset();
  });

  it('does nothing while signed out or unapproved', () => {
    expect(renderHost()).toBeNull();
    expect(state.effects).toHaveLength(0);

    state.user = { id: 7, is_approved: false };
    expect(renderHost()).toBeNull();
    expect(state.effects).toHaveLength(0);
  });

  it('does not wipe native state while likes are still loading', () => {
    state.user = { id: 7, is_approved: true };
    state.likesData = undefined;
    renderHost();
    state.effects.forEach((effect) => effect());

    expect(state.ensurePlayer).not.toHaveBeenCalled();
    expect(state.syncNativeLikedTrackIds).not.toHaveBeenCalled();
  });

  it('waits for player readiness and syncs sorted account-scoped liked IDs including empty', async () => {
    state.user = { id: 7, is_approved: true };
    state.likesData = [track('200'), track('100')];
    renderHost();
    state.effects.forEach((effect) => effect());

    await vi.waitFor(() =>
      expect(state.syncNativeLikedTrackIds).toHaveBeenCalledWith(['100', '200']),
    );
    expect(state.ensurePlayer).toHaveBeenCalledWith('https://loggerythm.logge.top::user:7');

    // Syncing an empty liked library sends [] (never null), so unfilled hearts still display.
    state.effects = [];
    state.likesData = [];
    renderHost();
    state.effects.forEach((effect) => effect());

    await vi.waitFor(() =>
      expect(state.syncNativeLikedTrackIds).toHaveBeenCalledWith([]),
    );
  });

  it('reports native sync failures loudly via reportPlayerError', async () => {
    const cause = new Error('native-sync-failed');
    state.user = { id: 7, is_approved: true };
    state.likesData = [track('100')];
    state.syncNativeLikedTrackIds.mockRejectedValueOnce(cause);
    renderHost();
    state.effects.forEach((effect) => effect());

    await vi.waitFor(() =>
      expect(state.reportPlayerError).toHaveBeenCalledWith('Like failed', cause),
    );
  });
});
