import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserStats } from '../../domain/listeningStats';
import { strings } from '../../localization';
import { byTestId, flatStyle, queryByTestId } from '../../test/render';
import { colors } from '../../theme';
import { StatsPeriods } from './StatsPeriods';

const mocks = vi.hoisted(() => ({ useState: vi.fn() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});
vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

const data: UserStats = {
  total_plays: 120,
  total_plays_month: 9,
  top_tracks: Array.from({ length: 7 }, (_, index) => ({
    key: `t${index}`, label: `Track ${index}`, sublabel: 'Artist', cover: '', count: 20 - index,
  })),
  top_artists: [{ key: 'a1', label: 'Artist', sublabel: '3 tracks', cover: '', count: 40 }],
  top_tracks_month: [{ key: 'm1', label: 'Month track', sublabel: 'Artist', cover: '', count: 4 }],
  top_artists_month: [],
  recent: [],
};

function render(period: 'all-time' | '30-days') {
  const setPeriod = vi.fn();
  mocks.useState.mockReturnValueOnce([period, setPeriod]);
  return { tree: StatsPeriods({ data, testID: 'profile-stats-periods' }), setPeriod };
}

describe('StatsPeriods', () => {
  beforeEach(() => {
    mocks.useState.mockReset();
  });

  it('presents both totals as tabs and marks the selected period', () => {
    const { tree, setPeriod } = render('all-time');
    const allTime = byTestId(tree, 'profile-stat-all-time-tab');
    const month = byTestId(tree, 'profile-stat-30-days-tab');

    expect(allTime.props.accessibilityRole).toBe('tab');
    expect(allTime.props.accessibilityLabel)
      .toBe(`${strings.profile.allTime}, ${strings.profile.playCount(120)}`);
    expect(allTime.props.accessibilityState).toEqual({ selected: true });
    expect(month.props.accessibilityState).toEqual({ selected: false });
    expect(flatStyle(allTime.props.style).borderColor).toBe(colors.accent);
    expect(flatStyle(month.props.style).borderColor).toBe(colors.hairline);
    (month.props.onPress as () => void)();
    expect(setPeriod).toHaveBeenCalledExactlyOnceWith('30-days');
  });

  it('lists at most five ranked rows of the selected period only', () => {
    const { tree } = render('all-time');

    expect(byTestId(tree, 'profile-stat-all-time')).toBeDefined();
    expect(queryByTestId(tree, 'profile-stat-30-days')).toBeNull();
    expect(byTestId(tree, 'profile-stats-all-time-tracks-4')).toBeDefined();
    expect(queryByTestId(tree, 'profile-stats-all-time-tracks-5')).toBeNull();
    expect(byTestId(tree, 'profile-stats-all-time-tracks-0').props.accessibilityLabel)
      .toContain(`Track 0, Artist, ${strings.profile.playCount(20)}`);
  });

  it('switches the lists with the period and explains an empty list', () => {
    const { tree } = render('30-days');

    expect(byTestId(tree, 'profile-stat-30-days-tab').props.accessibilityState).toEqual({ selected: true });
    expect(byTestId(tree, 'profile-stats-30-days-tracks-0')).toBeDefined();
    expect(byTestId(tree, 'profile-stats-30-days-artists-empty')).toBeDefined();
    expect(queryByTestId(tree, 'profile-stat-all-time')).toBeNull();
  });

  it('invokes track and artist press handlers from ranked stat rows', () => {
    const onPressTrack = vi.fn();
    const onPressArtist = vi.fn();
    mocks.useState.mockReturnValueOnce(['all-time', vi.fn()]);
    const tree = StatsPeriods({
      data,
      testID: 'profile-stats-periods',
      onPressTrack,
      onPressArtist,
    });

    const trackRow = byTestId(tree, 'profile-stats-all-time-tracks-0');
    const artistRow = byTestId(tree, 'profile-stats-all-time-artists-0');
    expect(trackRow.props.accessibilityRole).toBe('button');
    expect(artistRow.props.accessibilityRole).toBe('button');
    (trackRow.props.onPress as () => void)();
    (artistRow.props.onPress as () => void)();
    expect(onPressTrack).toHaveBeenCalledExactlyOnceWith(data.top_tracks[0]);
    expect(onPressArtist).toHaveBeenCalledExactlyOnceWith(data.top_artists[0]);
  });
});
