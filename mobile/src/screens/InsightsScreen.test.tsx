import { describe, expect, it, vi } from 'vitest';
import type { UserStatsInsights } from '../api/types';
import { byTestId, textContent } from '../test/render';
import { formatInsightsDuration, InsightsScreenView } from './InsightsScreen';

vi.mock('react-native', () => ({
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
  musicQueries: { statsInsights: vi.fn() },
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

describe('InsightsScreenView', () => {
  it('renders KPI summary, charts, range chips, and routes artist/album/track taps', () => {
    const onSelectRange = vi.fn();
    const onOpenArtist = vi.fn();
    const onOpenAlbum = vi.fn();
    const onPlayTrack = vi.fn();

    const tree = InsightsScreenView({
      range: '30d',
      insights: sampleInsights,
      isPending: false,
      isError: false,
      refreshing: false,
      bottomInset: 24,
      shareError: null,
      onSelectRange,
      onRefresh: vi.fn(),
      onShare: vi.fn(),
      onPlayTrack,
      onOpenArtist,
      onOpenAlbum,
    });

    expect(formatInsightsDuration(7500)).toContain('2');
    expect(textContent(byTestId(tree, 'insights-play-count')).join('')).toBe('42');
    expect(byTestId(tree, 'insights-hourly-chart')).toBeDefined();
    expect(byTestId(tree, 'insights-weekday-chart')).toBeDefined();

    (byTestId(tree, 'insights-range-year').props.onPress as () => void)();
    expect(onSelectRange).toHaveBeenCalledWith('year');

    (byTestId(tree, 'insights-top-tracks-item-0').props.onPress as () => void)();
    expect(onPlayTrack).toHaveBeenCalledWith(sampleInsights.top_tracks[0]);

    (byTestId(tree, 'insights-top-artists-item-0').props.onPress as () => void)();
    expect(onOpenArtist).toHaveBeenCalledWith(sampleInsights.top_artists[0]);

    (byTestId(tree, 'insights-top-albums-item-0').props.onPress as () => void)();
    expect(onOpenAlbum).toHaveBeenCalledWith(sampleInsights.top_albums[0]);
  });
});
