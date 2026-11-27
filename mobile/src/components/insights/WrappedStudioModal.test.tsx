import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WrappedCardTemplateId, WrappedReport, WrappedThemeId } from '../../api/types';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import { WRAPPED_TEMPLATES, WRAPPED_THEMES, WrappedCardView } from './WrappedCardView';
import {
  buildWrappedSharePayload,
  openWrappedCardSvg,
  shareWrappedCard,
  WRAPPED_STORY_CHAPTERS,
  WrappedStudioModalContent,
} from './WrappedStudioModal';

const mocks = vi.hoisted(() => ({
  share: vi.fn(),
  openURL: vi.fn(),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: { View: 'Animated.View', Value: class {}, timing: vi.fn() },
  Image: 'Image',
  Linking: { openURL: mocks.openURL },
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Share: { share: mocks.share },
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 12, bottom: 16, left: 0, right: 0 }),
}));
vi.mock('../../config', () => ({ getCurrentApiBase: () => 'https://music.example.test' }));
vi.mock('../../hooks/useBackHandler', () => ({ useBackHandler: vi.fn() }));
vi.mock('../../hooks/useHaptics', () => ({
  triggerHaptic: vi.fn(),
  useHaptics: () => ({ trigger: vi.fn() }),
}));
vi.mock('../../hooks/useReducedMotion', () => ({
  getReducedMotionSnapshot: () => false,
  useReducedMotion: () => false,
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

const sampleReport: WrappedReport = {
  range: '30d',
  generated_at: '2026-11-27T15:00:00Z',
  period_start: '2026-10-28T15:00:00Z',
  period_end: '2026-11-27T15:00:00Z',
  user: {
    display_name: 'Logge',
    avatar_url: '',
  },
  totals: {
    play_count: 84,
    listening_sec: 18420,
    unique_tracks: 42,
    unique_artists: 19,
    unique_albums: 24,
    new_artists_count: 6,
    active_days: 18,
    total_days: 30,
    avg_daily_sec: 614,
    current_streak_days: 5,
    longest_streak_days: 11,
  },
  persona: {
    id: 'night_owl',
    title: 'Nachtschwärmer',
    subtitle: 'Zwischen Mitternacht und Neon',
    tagline: 'Deine stärksten Sessions laufen nach 22 Uhr.',
    emblem: 'moon_wave',
    traits: ['Peak 23 Uhr', '38 % Wochenende', '19 Artists'],
  },
  aura: {
    id: 'neon_pulse',
    title: 'Mitternachts-Signal',
    description: 'Tiefe Basslinien treffen auf späte Entdecker-Energie.',
    colors: ['#d6ff4b', '#6fe0a8', '#8f73ff'],
    mood_tags: ['Hypnotisch', 'Spät', 'Fokussiert'],
  },
  rhythm: {
    chronotype: 'night_owl',
    chronotype_label: 'Nachteule',
    peak_hour: 23,
    peak_weekday: 4,
    weekend_share_pct: 38,
    discovery_score_pct: 32,
    repeat_score_pct: 68,
    hourly_distribution: Array.from({ length: 24 }, (_, idx) => (idx === 23 ? 18 : 2)),
    weekday_distribution: [8, 10, 11, 13, 18, 14, 10],
  },
  obsession: {
    track_key: 'track-101',
    title: 'Midnight Signal',
    artist: 'Neon Drift',
    album: 'Afterhours',
    cover: 'https://cdn.example.test/cover-1.jpg',
    play_count: 19,
    listening_sec: 4180,
    share_pct: 23,
    peak_day_date: '2026-11-22',
    peak_day_plays: 7,
  },
  peak_day: {
    date: '2026-11-22',
    weekday: 6,
    play_count: 14,
    listening_sec: 3240,
    top_track_title: 'Midnight Signal',
    top_track_artist: 'Neon Drift',
    top_track_cover: 'https://cdn.example.test/cover-1.jpg',
  },
  tempo: {
    avg_bpm: 124,
    min_bpm: 92,
    max_bpm: 142,
    analyzed_plays: 51,
    vibe_label: 'Club-Puls',
  },
  equivalents: [
    { icon: 'vinyl', value: '6,8', label: 'Vinyl-LPs durchgehört' },
  ],
  top_tracks: [
    {
      rank: 1,
      key: 'track-101',
      label: 'Midnight Signal',
      sublabel: 'Neon Drift',
      cover: 'https://cdn.example.test/cover-1.jpg',
      count: 19,
      listening_sec: 4180,
      share_pct: 23,
    },
  ],
  top_artists: [
    {
      rank: 1,
      key: 'artist-201',
      label: 'Neon Drift',
      sublabel: 'Synthwave',
      cover: '',
      count: 27,
      listening_sec: 5900,
      share_pct: 32,
    },
    {
      rank: 2,
      key: 'artist-202',
      label: 'Solaris',
      sublabel: 'Ambient',
      cover: '',
      count: 14,
      listening_sec: 3100,
      share_pct: 17,
    },
  ],
  top_albums: [
    {
      rank: 1,
      key: 'album-301',
      label: 'Afterhours',
      sublabel: 'Neon Drift',
      cover: 'https://cdn.example.test/cover-1.jpg',
      count: 21,
      listening_sec: 4520,
      share_pct: 25,
    },
  ],
};

function renderStudioContent(
  overrides: Partial<Parameters<typeof WrappedStudioModalContent>[0]> = {},
) {
  return WrappedStudioModalContent({
    report: sampleReport,
    mode: 'story',
    chapterIndex: 0,
    paused: false,
    template: 'summary',
    theme: 'signal',
    showUser: true,
    showCounts: true,
    sharing: false,
    openingSvg: false,
    actionError: null,
    topInset: 12,
    bottomInset: 16,
    onClose: vi.fn(),
    onSelectMode: vi.fn(),
    onSelectChapter: vi.fn(),
    onPrevChapter: vi.fn(),
    onNextChapter: vi.fn(),
    onTogglePause: vi.fn(),
    onOpenChapterCard: vi.fn(),
    onSelectTemplate: vi.fn(),
    onSelectTheme: vi.fn(),
    onToggleShowUser: vi.fn(),
    onToggleShowCounts: vi.fn(),
    onShare: vi.fn(),
    onOpenSvg: vi.fn(),
    ...overrides,
  });
}

describe('WrappedCardView & WrappedStudioModalContent', () => {
  beforeEach(() => {
    mocks.share.mockReset();
    mocks.openURL.mockReset();
  });

  it('renders every one of the 7 card templates across all 5 palettes', () => {
    for (const template of WRAPPED_TEMPLATES as readonly WrappedCardTemplateId[]) {
      for (const theme of WRAPPED_THEMES as readonly WrappedThemeId[]) {
        const tree = WrappedCardView({
          report: sampleReport,
          template,
          theme,
          showUser: true,
          showCounts: true,
        });
        expect(byTestId(tree, `wrapped-card-template-${template}`)).toBeDefined();
      }
    }
  });

  it('hides listener identity and exact play counts when toggles are disabled', () => {
    const tree = WrappedCardView({
      report: sampleReport,
      template: 'summary',
      theme: 'paper',
      showUser: false,
      showCounts: false,
    });
    const text = textContent(tree).join(' ');
    expect(text).not.toContain('FÜR LOGGE');
    expect(text).not.toContain('84 WIEDERGABEN');
  });

  it('renders Story Mode with 7 segments, navigation controls, and Card öffnen shortcut', () => {
    const onNextChapter = vi.fn();
    const onPrevChapter = vi.fn();
    const onTogglePause = vi.fn();
    const onOpenChapterCard = vi.fn();
    const onSelectChapter = vi.fn();

    const tree = renderStudioContent({
      mode: 'story',
      chapterIndex: 1,
      onNextChapter,
      onPrevChapter,
      onTogglePause,
      onOpenChapterCard,
      onSelectChapter,
    });

    expect(byTestId(tree, 'wrapped-story-progress')).toBeDefined();
    expect(byTestId(tree, 'wrapped-story-chapter-obsession')).toBeDefined();
    for (let idx = 0; idx < WRAPPED_STORY_CHAPTERS.length; idx += 1) {
      expect(byTestId(tree, `wrapped-story-segment-${idx}`)).toBeDefined();
    }

    (byTestId(tree, 'wrapped-story-next').props.onPress as () => void)();
    expect(onNextChapter).toHaveBeenCalledOnce();

    (byTestId(tree, 'wrapped-story-prev').props.onPress as () => void)();
    expect(onPrevChapter).toHaveBeenCalledOnce();

    (byTestId(tree, 'wrapped-story-pause').props.onPress as () => void)();
    expect(onTogglePause).toHaveBeenCalledOnce();

    (byTestId(tree, 'wrapped-story-open-card').props.onPress as () => void)();
    expect(onOpenChapterCard).toHaveBeenCalledWith('obsession');

    (byTestId(tree, 'wrapped-story-segment-4').props.onPress as () => void)();
    expect(onSelectChapter).toHaveBeenCalledWith(4);
  });

  it('renders Card Studio controls, theme swatches, toggles, share actions, and loud errors', () => {
    const onSelectTemplate = vi.fn();
    const onSelectTheme = vi.fn();
    const onToggleShowUser = vi.fn();
    const onToggleShowCounts = vi.fn();
    const onShare = vi.fn();
    const onOpenSvg = vi.fn();

    const tree = renderStudioContent({
      mode: 'studio',
      template: 'festival',
      theme: 'neon',
      actionError: 'Wrapped-Card konnte nicht geteilt werden. (Share cancelled)',
      onSelectTemplate,
      onSelectTheme,
      onToggleShowUser,
      onToggleShowCounts,
      onShare,
      onOpenSvg,
    });

    expect(byTestId(tree, 'wrapped-studio-card')).toBeDefined();
    expect(byTestId(tree, 'wrapped-card-template-festival')).toBeDefined();

    (byTestId(tree, 'wrapped-template-receipt').props.onPress as () => void)();
    expect(onSelectTemplate).toHaveBeenCalledWith('receipt');

    (byTestId(tree, 'wrapped-theme-vinyl').props.onPress as () => void)();
    expect(onSelectTheme).toHaveBeenCalledWith('vinyl');
    expect(byTestId(tree, 'wrapped-theme-neon').props.accessibilityState).toEqual({
      checked: true,
    });

    (byTestId(tree, 'wrapped-toggle-user').props.onPress as () => void)();
    expect(onToggleShowUser).toHaveBeenCalledOnce();

    (byTestId(tree, 'wrapped-toggle-counts').props.onPress as () => void)();
    expect(onToggleShowCounts).toHaveBeenCalledOnce();

    (byTestId(tree, 'wrapped-share-button').props.onPress as () => void)();
    expect(onShare).toHaveBeenCalledOnce();

    (byTestId(tree, 'wrapped-open-svg-button').props.onPress as () => void)();
    expect(onOpenSvg).toHaveBeenCalledOnce();

    const errorNode = byTestId(tree, 'wrapped-action-error');
    expect(errorNode.props.accessibilityRole).toBe('alert');
    expect(textContent(errorNode).join('')).toContain('Wrapped-Card konnte nicht geteilt werden.');
  });

  it('shows an explicit empty state when play_count is zero instead of faking cards', () => {
    const empty: WrappedReport = {
      ...sampleReport,
      totals: {
        ...sampleReport.totals,
        play_count: 0,
        listening_sec: 0,
      },
      persona: null,
      aura: null,
      obsession: null,
      peak_day: null,
      tempo: null,
      equivalents: [],
      top_tracks: [],
      top_artists: [],
      top_albums: [],
    };
    const tree = renderStudioContent({ report: empty, mode: 'studio' });
    expect(byTestId(tree, 'wrapped-modal-empty')).toBeDefined();
    expect(queryByTestId(tree, 'wrapped-studio-card')).toBeNull();
  });

  it('builds a share payload containing the authenticated SVG card URL and highlights', async () => {
    const payload = buildWrappedSharePayload(
      sampleReport,
      { template: 'obsession', theme: 'vinyl' },
      'https://music.example.test',
    );
    expect(payload.url).toBe(
      'https://music.example.test/api/me/stats/wrapped/card.svg?range=30d&template=obsession&theme=vinyl&format=story',
    );
    expect(payload.message).toContain('Neon Drift');
    expect(payload.message).toContain('Midnight Signal');
    expect(payload.message).toContain(payload.url);

    mocks.share.mockRejectedValueOnce(new Error('Share sheet failed'));
    await expect(
      shareWrappedCard(sampleReport, { template: 'obsession', theme: 'vinyl' }, 'https://music.example.test'),
    ).rejects.toThrow('Share sheet failed');

    mocks.openURL.mockRejectedValueOnce(new Error('No browser installed'));
    await expect(
      openWrappedCardSvg(sampleReport, { template: 'receipt', theme: 'paper' }, 'https://music.example.test'),
    ).rejects.toThrow('No browser installed');
  });

  it('renders all 7 templates and 7 story chapters safely when optional blocks are null', () => {
    const minimalReport: WrappedReport = {
      ...sampleReport,
      persona: null,
      aura: null,
      obsession: null,
      peak_day: null,
      tempo: null,
      equivalents: [],
    };
    for (const template of WRAPPED_TEMPLATES as readonly WrappedCardTemplateId[]) {
      const tree = WrappedCardView({
        report: minimalReport,
        template,
        theme: 'cover',
      });
      expect(byTestId(tree, `wrapped-card-template-${template}`)).toBeDefined();
    }
    for (let idx = 0; idx < WRAPPED_STORY_CHAPTERS.length; idx += 1) {
      const tree = renderStudioContent({
        report: minimalReport,
        mode: 'story',
        chapterIndex: idx,
      });
      expect(byTestId(tree, `wrapped-story-chapter-${WRAPPED_STORY_CHAPTERS[idx].id}`)).toBeDefined();
    }
  });
});
