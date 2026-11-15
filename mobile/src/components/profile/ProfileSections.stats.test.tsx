import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { UserStats } from '../../domain/listeningStats';
import { strings } from '../../localization';
import { elements, queryByTestId as byTestId } from '../../test/render';
import { ListeningStatsPanel } from './ProfileSections';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
// Skeleton animates and StatsPeriods owns the period state; string mocks keep their props.
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Skeleton: 'Skeleton',
}));
vi.mock('./StatsPeriods', () => ({ StatsPeriods: 'StatsPeriods' }));
vi.mock('../../player/setup', () => ({
  ensurePlayer: vi.fn(),
  isPlayerReady: vi.fn(() => false),
}));
vi.mock('../../screens/profileSleepTimer', () => ({
  SleepTimerOperationError: class SleepTimerOperationError extends Error {},
  clearSleepTimer: vi.fn(),
  nativeSleepTimerGateway: { read: vi.fn() },
  setCurrentTrackRemainingSleepTimer: vi.fn(),
  setEndOfTrackSleepTimer: vi.fn(),
  setPresetSleepTimer: vi.fn(),
}));

const emptyStats: UserStats = {
  total_plays: 0,
  total_plays_month: 0,
  top_tracks: [],
  top_artists: [],
  top_tracks_month: [],
  top_artists_month: [],
  recent: [],
};

const populatedStats: UserStats = {
  ...emptyStats,
  total_plays: 2,
  total_plays_month: 1,
  top_tracks: [{ key: '1', label: 'Track', sublabel: 'Artist', cover: '', count: 2 }],
};

function panel(
  overrides: Partial<Parameters<typeof ListeningStatsPanel>[0]> = {},
): React.ReactElement {
  return ListeningStatsPanel({
    data: emptyStats,
    pending: false,
    fetching: false,
    fetchStatus: 'idle',
    stale: false,
    error: null,
    onRefresh: vi.fn(),
    ...overrides,
  });
}

describe('ListeningStatsPanel remote-state contract', () => {
  it('renders a labeled live loading body exclusively before the first response', () => {
    const tree = panel({ data: undefined, pending: true, fetching: true, fetchStatus: 'fetching' });
    const loading = byTestId(tree, 'profile-stats-loading');

    expect(loading?.props.accessibilityRole).toBe('progressbar');
    expect(loading?.props.accessibilityLabel).toBe(strings.profile.statsLoading);
    expect(loading?.props.accessibilityLiveRegion).toBe('polite');
    expect(byTestId(tree, 'profile-stats-empty')).toBeNull();
    expect(byTestId(tree, 'profile-stats-periods')).toBeNull();
    expect(elements(loading).some((element) => element.type === 'Skeleton')).toBe(true);
  });

  it('renders a safe retryable offline body instead of raw transport diagnostics', () => {
    const onRefresh = vi.fn();
    const transport = Object.assign(new Error('GET /api/stats secret detail'), { status: 0 });
    const tree = panel({ data: undefined, pending: false, error: transport, onRefresh });
    const offline = byTestId(tree, 'profile-stats-offline');

    expect(offline?.props.accessibilityRole).toBe('alert');
    expect(offline?.props.accessibilityLiveRegion).toBe('assertive');
    expect(elements(offline).some((element) => element.props.children === transport.message)).toBe(false);
    (byTestId(tree, 'profile-stats-retry')?.props.onPress as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('preserves a successful empty response under a retryable refresh failure', () => {
    const onRefresh = vi.fn();
    const tree = panel({ error: new Error('refresh failed'), stale: true, onRefresh });

    expect(byTestId(tree, 'profile-stats-empty')).not.toBeNull();
    expect(byTestId(tree, 'profile-stats-cached-error')?.props.accessibilityLiveRegion)
      .toBe('polite');
    expect(byTestId(tree, 'profile-stats-stale')).toBeNull();
    expect(byTestId(tree, 'profile-stats-periods')).toBeNull();
    (byTestId(tree, 'profile-stats-notice-retry')?.props.onPress as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps content mounted under cached offline and prioritizes that notice', () => {
    const tree = panel({
      data: populatedStats,
      fetchStatus: 'paused',
      stale: true,
      fetching: true,
    });

    expect(byTestId(tree, 'profile-stats-periods')?.props.data).toBe(populatedStats);
    expect(byTestId(tree, 'profile-stats-cached-offline')).not.toBeNull();
    expect(byTestId(tree, 'profile-stats-refreshing')).toBeNull();
    expect(byTestId(tree, 'profile-stats-stale')).toBeNull();
  });

  it('exposes refresh progress once and disables duplicate refresh controls', () => {
    const tree = panel({ data: populatedStats, fetching: true, fetchStatus: 'fetching', stale: true });
    const status = byTestId(tree, 'profile-stats-refreshing');
    const refresh = byTestId(tree, 'profile-stats-refresh');

    expect(status?.props.accessibilityRole).toBe('progressbar');
    expect(status?.props.accessibilityLiveRegion).toBe('polite');
    expect(byTestId(tree, 'profile-stats-stale')).toBeNull();
    expect(refresh?.props.disabled).toBe(true);
    expect(refresh?.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
