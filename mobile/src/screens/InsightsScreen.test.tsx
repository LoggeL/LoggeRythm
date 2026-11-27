import { describe, expect, it, vi } from 'vitest';
import type { UserStatsInsights, WrappedReport } from '../api/types';
import { byTestId, textContent } from '../test/render';
import { formatInsightsDuration, InsightsScreenView } from './InsightsScreen';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: { View: 'Animated.View', Value: class {}, timing: vi.fn() },
  Image: 'Image',
  Linking: { openURL: vi.fn() },
  Modal: 'Modal',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Share: { share: vi.fn() },
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../config', () => ({ getCurrentApiBase: () => 'https://music.example' }));
vi.mock('../data', () => ({
  musicCacheScope: vi.fn(),
  musicQueries: { statsInsights: vi.fn(), statsWrapped: vi.fn() },
  musicRepository: { getTrack: vi.fn() },
}));
vi.mock('../hooks/useBottomInset', () => ({ useBottomInset: () => 24 }));
vi.mock('../hooks/useHaptics', () => ({
  triggerHaptic: vi.fn(),
  useHaptics: () => ({ trigger: vi.fn() }),
}));
vi.mock('../player/controller', () => ({ playTrackRow: vi.fn() }));
vi.mock('../player/errors', () => ({ reportPlayerError: vi.fn() }));
vi.mock('../tv', () => ({ TvFocusScope: 'TvFocusScope' }));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));

const sampleInsights: UserStatsInsights = {
  range: '30d',
  listening_sec: 7500,
  play_count: 42,
  unique_tracks: 28,
  unique_artists: 12,
  top_tracks: [{ key: '101', label: 'Midnight Signal', sublabel: 'Neon', cover: '', count: 9 }],
  top_artists: [{ key: '201', label: 'Neon', sublabel: '', cover: '', count: 15 }],
  top_albums: [{ key: '301', label: 'Afterhours', sublabel: 'Neon', cover: '', count: 11 }],
  current_streak_days: 5,
  longest_streak_days: 14,
  hourly_distribution: Array.from({ length: 24 }, (_, i) => (i === 21 ? 10 : 1)),
  weekday_distribution: [3, 5, 4, 8, 9, 7, 6],
  new_artists_count: 4,
  recent_plays: [],
};

const sampleWrapped: WrappedReport = {
  range: '30d',
  generated_at: '2026-11-27T15:00:00Z',
  period_start: '2026-10-28T15:00:00Z',
  period_end: '2026-11-27T15:00:00Z',
  user: { display_name: 'Logge', avatar_url: '' },
  totals: {
    play_count: 42,
    listening_sec: 7500,
    unique_tracks: 28,
    unique_artists: 12,
    unique_albums: 10,
    new_artists_count: 4,
    active_days: 12,
    total_days: 30,
    avg_daily_sec: 250,
    current_streak_days: 5,
    longest_streak_days: 14,
  },
  persona: {
    id: 'night_owl',
    title: 'Nachtschwärmer',
    subtitle: 'Zwischen Mitternacht und Neon',
    tagline: 'Deine Sessions starten spät.',
    emblem: 'moon_wave',
    traits: ['Peak 21 Uhr', '42 Plays', '12 Artists'],
  },
  aura: {
    id: 'neon_pulse',
    title: 'Mitternachts-Signal',
    description: 'Fokussierte Abende.',
    colors: ['#d6ff4b', '#6fe0a8', '#8f73ff'],
    mood_tags: ['Hypnotisch', 'Spät', 'Klar'],
  },
  rhythm: {
    chronotype: 'night_owl',
    chronotype_label: 'Nachteule',
    peak_hour: 21,
    peak_weekday: 4,
    weekend_share_pct: 35,
    discovery_score_pct: 30,
    repeat_score_pct: 70,
    hourly_distribution: Array.from({ length: 24 }, (_, i) => (i === 21 ? 10 : 1)),
    weekday_distribution: [3, 5, 4, 8, 9, 7, 6],
  },
  obsession: null,
  peak_day: null,
  tempo: null,
  equivalents: [],
  top_tracks: [],
  top_artists: [],
  top_albums: [],
};

describe('InsightsScreenView', () => {
  it('renders Wrapped hero launcher, KPI summary, charts, range chips, and routes taps', () => {
    const onSelectRange = vi.fn();
    const onOpenWrapped = vi.fn();
    const onOpenArtist = vi.fn();
    const onOpenAlbum = vi.fn();
    const onPlayTrack = vi.fn();

    const tree = InsightsScreenView({
      range: '30d',
      insights: sampleInsights,
      wrapped: sampleWrapped,
      wrappedPending: false,
      wrappedError: false,
      isPending: false,
      isError: false,
      refreshing: false,
      bottomInset: 24,
      onSelectRange,
      onRefresh: vi.fn(),
      onOpenWrapped,
      onRetryWrapped: vi.fn(),
      onPlayTrack,
      onOpenArtist,
      onOpenAlbum,
    });

    expect(formatInsightsDuration(7500)).toContain('2');
    expect(textContent(byTestId(tree, 'insights-play-count')).join('')).toBe('42');
    expect(byTestId(tree, 'insights-hourly-chart')).toBeDefined();
    expect(byTestId(tree, 'insights-weekday-chart')).toBeDefined();
    expect(byTestId(tree, 'insights-wrapped-launch')).toBeDefined();
    expect(textContent(byTestId(tree, 'insights-wrapped-launch')).join(' ')).toContain(
      'Nachtschwärmer',
    );

    (byTestId(tree, 'insights-wrapped-launch').props.onPress as () => void)();
    expect(onOpenWrapped).toHaveBeenCalledOnce();

    (byTestId(tree, 'insights-range-year').props.onPress as () => void)();
    expect(onSelectRange).toHaveBeenCalledWith('year');

    (byTestId(tree, 'insights-top-tracks-item-0').props.onPress as () => void)();
    expect(onPlayTrack).toHaveBeenCalledWith(sampleInsights.top_tracks[0]);

    (byTestId(tree, 'insights-top-artists-item-0').props.onPress as () => void)();
    expect(onOpenArtist).toHaveBeenCalledWith(sampleInsights.top_artists[0]);

    (byTestId(tree, 'insights-top-albums-item-0').props.onPress as () => void)();
    expect(onOpenAlbum).toHaveBeenCalledWith(sampleInsights.top_albums[0]);
  });

  it('surfaces Wrapped loading failure loudly with an explicit Retry action', () => {
    const onRetryWrapped = vi.fn();

    const tree = InsightsScreenView({
      range: '30d',
      insights: sampleInsights,
      wrapped: undefined,
      wrappedPending: false,
      wrappedError: true,
      isPending: false,
      isError: false,
      refreshing: false,
      bottomInset: 24,
      onSelectRange: vi.fn(),
      onRefresh: vi.fn(),
      onOpenWrapped: vi.fn(),
      onRetryWrapped,
      onPlayTrack: vi.fn(),
      onOpenArtist: vi.fn(),
      onOpenAlbum: vi.fn(),
    });

    expect(byTestId(tree, 'insights-wrapped-error')).toBeDefined();
    (byTestId(tree, 'insights-wrapped-retry').props.onPress as () => void)();
    expect(onRetryWrapped).toHaveBeenCalledOnce();
    // Existing KPIs and charts remain visible below the Wrapped error.
    expect(byTestId(tree, 'insights-kpis')).toBeDefined();
  });
});
