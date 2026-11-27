import React, { useEffect, useState } from 'react';
import {
  Animated,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  WrappedCardTemplateId,
  WrappedReport,
  WrappedThemeId,
} from '../../api/types';
import { getCurrentApiBase } from '../../config';
import { buildWrappedCardSvgUrl } from '../../data/mappers/wrapped';
import { useBackHandler } from '../../hooks/useBackHandler';
import { useHaptics } from '../../hooks/useHaptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { wave2Strings } from '../../localization/wave2Strings';
import { colors, elevation, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import {
  ActionButton,
  AppText,
  Artwork,
  EmptyState,
  FilterChip,
  IconButton,
  Surface,
} from '../ui';
import {
  emblemIconName,
  equivalentIconName,
  formatWrappedDuration,
  resolveWrappedPalette,
  WRAPPED_TEMPLATES,
  WRAPPED_THEMES,
  WrappedCardView,
} from './WrappedCardView';

export type WrappedStudioMode = 'story' | 'studio';

export type WrappedStoryChapterId =
  | 'intro'
  | 'obsession'
  | 'festival'
  | 'aura'
  | 'peak'
  | 'persona'
  | 'finale';

export interface WrappedStoryChapter {
  readonly id: WrappedStoryChapterId;
  readonly template: WrappedCardTemplateId;
}

export const WRAPPED_STORY_CHAPTERS: readonly WrappedStoryChapter[] = [
  { id: 'intro', template: 'summary' },
  { id: 'obsession', template: 'obsession' },
  { id: 'festival', template: 'festival' },
  { id: 'aura', template: 'aura' },
  { id: 'peak', template: 'peak' },
  { id: 'persona', template: 'persona' },
  { id: 'finale', template: 'receipt' },
] as const;

export const STORY_AUTO_ADVANCE_MS = 6500;

export function buildWrappedSharePayload(
  report: WrappedReport,
  options: {
    template: WrappedCardTemplateId;
    theme: WrappedThemeId;
  },
  apiBase: string,
): { title: string; message: string; url: string } {
  const copy = wave2Strings.wrapped;
  const templateLabel = copy.templates[options.template].label;
  const rangeLabel = wave2Strings.insights.ranges[report.range];
  const url = buildWrappedCardSvgUrl(apiBase, {
    range: report.range,
    template: options.template,
    theme: options.theme,
    format: 'story',
  });
  const title = `${copy.studioTitle} · ${templateLabel}`;
  const message = copy.card.shareMessage(
    templateLabel,
    rangeLabel,
    formatWrappedDuration(report.totals.listening_sec),
    report.totals.play_count,
    report.top_artists[0]?.label ?? '',
    report.obsession?.title ?? report.top_tracks[0]?.label ?? '',
    url,
  );
  return { title, message, url };
}

export async function shareWrappedCard(
  report: WrappedReport,
  options: { template: WrappedCardTemplateId; theme: WrappedThemeId },
  apiBase: string,
): Promise<void> {
  const payload = buildWrappedSharePayload(report, options, apiBase);
  await Share.share(payload);
}

export async function openWrappedCardSvg(
  report: WrappedReport,
  options: { template: WrappedCardTemplateId; theme: WrappedThemeId },
  apiBase: string,
): Promise<void> {
  const url = buildWrappedCardSvgUrl(apiBase, {
    range: report.range,
    template: options.template,
    theme: options.theme,
    format: 'story',
  });
  await Linking.openURL(url);
}

function formatErrorDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message.trim();
  }
  return String(cause);
}

function StoryChapterSlide({
  chapter,
  report,
  onOpenCard,
  onEnterStudio,
}: {
  chapter: WrappedStoryChapter;
  report: WrappedReport;
  onOpenCard: (template: WrappedCardTemplateId) => void;
  onEnterStudio: () => void;
}) {
  const copy = wave2Strings.wrapped;
  const chaptersCopy = copy.chapters;

  if (chapter.id === 'intro') {
    return (
      <View testID="wrapped-story-chapter-intro" style={styles.storyBody}>
        <AppText variant="overline" color="accent">
          {chaptersCopy.intro.eyebrow}
        </AppText>
        <AppText variant="hero">{chaptersCopy.intro.title}</AppText>
        <AppText variant="body" color="secondary">
          {chaptersCopy.intro.subtitle}
        </AppText>

        <View style={styles.storyKpiGrid}>
          <Surface padded style={styles.storyKpiCard}>
            <AppText variant="overline" color="muted">
              {chaptersCopy.intro.hoursLabel}
            </AppText>
            <AppText testID="wrapped-story-hours" variant="display" color="accent">
              {formatWrappedDuration(report.totals.listening_sec)}
            </AppText>
          </Surface>
          <Surface padded style={styles.storyKpiCard}>
            <AppText variant="overline" color="muted">
              {chaptersCopy.intro.playsLabel}
            </AppText>
            <AppText variant="title">{String(report.totals.play_count)}</AppText>
            <AppText variant="caption" color="secondary">
              {`${chaptersCopy.intro.avgDailyLabel}: ${formatWrappedDuration(report.totals.avg_daily_sec)}`}
            </AppText>
          </Surface>
        </View>

        {report.equivalents.length > 0 ? (
          <View style={styles.equivalentsList}>
            {report.equivalents.slice(0, 3).map((eq, index) => (
              <Surface key={`${eq.icon}-${index}`} padded style={styles.equivalentCard}>
                <AppIcon name={equivalentIconName(eq.icon)} size={22} color={colors.accent} />
                <View style={styles.equivalentCopy}>
                  <AppText variant="section" color="accent">
                    {eq.value}
                  </AppText>
                  <AppText variant="callout" color="secondary">
                    {eq.label}
                  </AppText>
                </View>
              </Surface>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  if (chapter.id === 'obsession') {
    const obs = report.obsession;
    return (
      <View testID="wrapped-story-chapter-obsession" style={styles.storyBody}>
        <AppText variant="overline" color="accent">
          {chaptersCopy.obsession.eyebrow}
        </AppText>
        <AppText variant="hero">{chaptersCopy.obsession.title}</AppText>
        {obs === null ? (
          <Surface padded>
            <AppText variant="body" color="secondary">
              {chaptersCopy.obsession.emptyNote}
            </AppText>
          </Surface>
        ) : (
          <Surface padded style={styles.highlightCard}>
            <View style={styles.obsessionHero}>
              <Artwork uri={obs.cover} size={layout.artwork.lg} radius="card" icon="music-note" />
              <View style={styles.obsessionMeta}>
                <AppText variant="title" numberOfLines={2}>
                  {obs.title}
                </AppText>
                <AppText variant="body" color="secondary" numberOfLines={1}>
                  {obs.artist}
                </AppText>
                <View style={styles.accentBadge}>
                  <AppText variant="label" color="onAccent">
                    {chaptersCopy.obsession.replayBadge(obs.play_count)}
                  </AppText>
                </View>
              </View>
            </View>
            <AppText variant="callout" color="secondary">
              {`${chaptersCopy.obsession.shareLabel}: ${obs.share_pct}%`}
            </AppText>
            {obs.peak_day_date !== null ? (
              <AppText variant="caption" color="accent">
                {chaptersCopy.obsession.peakDayLabel(obs.peak_day_date, obs.peak_day_plays)}
              </AppText>
            ) : null}
          </Surface>
        )}
      </View>
    );
  }

  if (chapter.id === 'festival') {
    const headliner = report.top_artists[0];
    const coHeadliners = report.top_artists.slice(1, 4);
    const undercard = report.top_artists.slice(4, 10);
    return (
      <View testID="wrapped-story-chapter-festival" style={styles.storyBody}>
        <AppText variant="overline" color="accent">
          {chaptersCopy.festival.eyebrow}
        </AppText>
        <AppText variant="hero">{chaptersCopy.festival.title}</AppText>
        {headliner === undefined ? (
          <Surface padded>
            <AppText variant="body" color="secondary">
              {chaptersCopy.festival.emptyNote}
            </AppText>
          </Surface>
        ) : (
          <Surface padded style={styles.highlightCard}>
            <View style={styles.headlinerRow}>
              <Artwork uri={headliner.cover} size={76} shape="round" icon="account-music" />
              <View style={styles.obsessionMeta}>
                <AppText variant="overline" color="muted">
                  {chaptersCopy.festival.headlinerLabel}
                </AppText>
                <AppText variant="title" color="accent">
                  {headliner.label}
                </AppText>
              </View>
            </View>
            {coHeadliners.length > 0 ? (
              <View style={styles.lineupSection}>
                <AppText variant="overline" color="muted">
                  {chaptersCopy.festival.coHeadlinersLabel}
                </AppText>
                <AppText variant="section">
                  {coHeadliners.map((artist) => artist.label).join(' · ')}
                </AppText>
              </View>
            ) : null}
            {undercard.length > 0 ? (
              <View style={styles.lineupSection}>
                <AppText variant="overline" color="muted">
                  {chaptersCopy.festival.undercardLabel}
                </AppText>
                <AppText variant="callout" color="secondary">
                  {undercard.map((artist) => artist.label).join(' · ')}
                </AppText>
              </View>
            ) : null}
          </Surface>
        )}
      </View>
    );
  }

  if (chapter.id === 'aura') {
    const aura = report.aura;
    return (
      <View testID="wrapped-story-chapter-aura" style={styles.storyBody}>
        <AppText variant="overline" color="accent">
          {chaptersCopy.aura.eyebrow}
        </AppText>
        <AppText variant="hero">{chaptersCopy.aura.title}</AppText>
        <Surface padded style={styles.highlightCard}>
          {aura !== null ? (
            <>
              <View style={styles.auraSwatches}>
                {aura.colors.map((hex, idx) => (
                  <View key={`${hex}-${idx}`} style={[styles.auraSwatchOrb, { backgroundColor: hex }]} />
                ))}
              </View>
              <AppText variant="title">{aura.title}</AppText>
              <AppText variant="body" color="secondary">
                {aura.description}
              </AppText>
              <View style={styles.chipWrap}>
                {aura.mood_tags.map((tag, idx) => (
                  <View key={`${tag}-${idx}`} style={styles.tagChip}>
                    <AppText variant="caption" color="accent">
                      {tag}
                    </AppText>
                  </View>
                ))}
              </View>
            </>
          ) : null}
          <View style={styles.chipWrap}>
            <View style={styles.tagChip}>
              <AppText variant="caption">
                {chaptersCopy.aura.peakHourLabel(report.rhythm.peak_hour)}
              </AppText>
            </View>
            <View style={styles.tagChip}>
              <AppText variant="caption">
                {`${chaptersCopy.aura.weekendLabel}: ${report.rhythm.weekend_share_pct}%`}
              </AppText>
            </View>
            <View style={styles.tagChip}>
              <AppText variant="caption">
                {`${chaptersCopy.aura.discoveryLabel}: ${report.rhythm.discovery_score_pct}%`}
              </AppText>
            </View>
            {report.tempo !== null ? (
              <View style={styles.tagChip}>
                <AppText variant="caption" color="accent">
                  {chaptersCopy.aura.bpmLabel(report.tempo.avg_bpm, report.tempo.vibe_label)}
                </AppText>
              </View>
            ) : null}
          </View>
        </Surface>
      </View>
    );
  }

  if (chapter.id === 'peak') {
    const peak = report.peak_day;
    return (
      <View testID="wrapped-story-chapter-peak" style={styles.storyBody}>
        <AppText variant="overline" color="accent">
          {chaptersCopy.peak.eyebrow}
        </AppText>
        <AppText variant="hero">{chaptersCopy.peak.title}</AppText>
        <View style={styles.storyKpiGrid}>
          <Surface padded style={styles.storyKpiCard}>
            <AppText variant="overline" color="muted">
              {chaptersCopy.peak.longestStreakLabel}
            </AppText>
            <AppText variant="display" color="accent">
              {wave2Strings.insights.streakDays(report.totals.longest_streak_days)}
            </AppText>
          </Surface>
          <Surface padded style={styles.storyKpiCard}>
            <AppText variant="overline" color="muted">
              {chaptersCopy.peak.currentStreakLabel}
            </AppText>
            <AppText variant="title">
              {wave2Strings.insights.streakDays(report.totals.current_streak_days)}
            </AppText>
            <AppText variant="caption" color="secondary">
              {chaptersCopy.peak.activeDaysLabel(report.totals.active_days, report.totals.total_days)}
            </AppText>
          </Surface>
        </View>
        {peak !== null ? (
          <Surface padded style={styles.highlightCard}>
            <AppText variant="overline" color="accent">
              {chaptersCopy.peak.peakDayLabel}
            </AppText>
            <View style={styles.headlinerRow}>
              <Artwork uri={peak.top_track_cover} size={56} radius="sm" icon="music-note" />
              <View style={styles.obsessionMeta}>
                <AppText variant="bodyStrong">{`${peak.date} · ${peak.play_count}×`}</AppText>
                <AppText variant="callout" color="secondary" numberOfLines={1}>
                  {`${peak.top_track_title} — ${peak.top_track_artist}`}
                </AppText>
              </View>
            </View>
          </Surface>
        ) : null}
      </View>
    );
  }

  if (chapter.id === 'persona') {
    const persona = report.persona;
    return (
      <View testID="wrapped-story-chapter-persona" style={styles.storyBody}>
        <AppText variant="overline" color="accent">
          {chaptersCopy.persona.eyebrow}
        </AppText>
        <AppText variant="hero">{chaptersCopy.persona.title}</AppText>
        {persona === null ? (
          <Surface padded>
            <AppText variant="body" color="secondary">
              {chaptersCopy.persona.emptyNote}
            </AppText>
          </Surface>
        ) : (
          <Surface padded style={styles.highlightCard}>
            <View style={styles.personaSlideHead}>
              <View style={styles.personaEmblemDisc}>
                <AppIcon name={emblemIconName(persona.emblem)} size={34} color={colors.onAccent} />
              </View>
              <View style={styles.obsessionMeta}>
                <AppText variant="title" color="accent">
                  {persona.title}
                </AppText>
                <AppText variant="callout" color="secondary">
                  {persona.subtitle}
                </AppText>
              </View>
            </View>
            <AppText variant="body">{persona.tagline}</AppText>
            <View style={styles.chipWrap}>
              {persona.traits.map((trait, idx) => (
                <View key={`${trait}-${idx}`} style={styles.tagChip}>
                  <AppText variant="caption" color="accent">
                    {trait}
                  </AppText>
                </View>
              ))}
            </View>
          </Surface>
        )}
      </View>
    );
  }

  return (
    <View testID="wrapped-story-chapter-finale" style={styles.storyBody}>
      <AppText variant="overline" color="accent">
        {chaptersCopy.finale.eyebrow}
      </AppText>
      <AppText variant="hero">{chaptersCopy.finale.title}</AppText>
      <AppText variant="body" color="secondary">
        {chaptersCopy.finale.body}
      </AppText>
      <WrappedCardView
        report={report}
        template="summary"
        theme="signal"
        testID="wrapped-story-finale-preview"
      />
      <ActionButton
        testID="wrapped-story-finale-cta"
        variant="accent"
        icon="palette"
        label={chaptersCopy.finale.cta}
        fullWidth
        onPress={() => {
          onOpenCard('summary');
          onEnterStudio();
        }}
      />
    </View>
  );
}

export interface WrappedStudioModalContentProps {
  report: WrappedReport;
  mode: WrappedStudioMode;
  chapterIndex: number;
  paused: boolean;
  template: WrappedCardTemplateId;
  theme: WrappedThemeId;
  showUser: boolean;
  showCounts: boolean;
  sharing: boolean;
  openingSvg: boolean;
  actionError: string | null;
  topInset: number;
  bottomInset: number;
  onClose: () => void;
  onSelectMode: (mode: WrappedStudioMode) => void;
  onSelectChapter: (index: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onTogglePause: () => void;
  onOpenChapterCard: (template: WrappedCardTemplateId) => void;
  onSelectTemplate: (template: WrappedCardTemplateId) => void;
  onSelectTheme: (theme: WrappedThemeId) => void;
  onToggleShowUser: () => void;
  onToggleShowCounts: () => void;
  onShare: () => void;
  onOpenSvg: () => void;
}

/** Pure presentational view for the Wrapped Story Mode + Card Studio modal. */
export function WrappedStudioModalContent({
  report,
  mode,
  chapterIndex,
  paused,
  template,
  theme,
  showUser,
  showCounts,
  sharing,
  openingSvg,
  actionError,
  topInset,
  bottomInset,
  onClose,
  onSelectMode,
  onSelectChapter,
  onPrevChapter,
  onNextChapter,
  onTogglePause,
  onOpenChapterCard,
  onSelectTemplate,
  onSelectTheme,
  onToggleShowUser,
  onToggleShowCounts,
  onShare,
  onOpenSvg,
}: WrappedStudioModalContentProps) {
  const copy = wave2Strings.wrapped;
  const clampedIndex = Math.max(0, Math.min(WRAPPED_STORY_CHAPTERS.length - 1, chapterIndex));
  const chapter = WRAPPED_STORY_CHAPTERS[clampedIndex];
  const emptyReport = report.totals.play_count === 0;

  return (
    <View
      testID="wrapped-studio-modal-content"
      style={[
        styles.root,
        {
          paddingTop: topInset + spacing.sm,
          paddingBottom: bottomInset + spacing.md,
        },
      ]}
    >
      <View style={styles.topBar}>
        <View style={styles.topTitle}>
          <AppText variant="overline" color="accent">
            {wave2Strings.insights.ranges[report.range]}
          </AppText>
          <AppText variant="section" numberOfLines={1}>
            {copy.studioTitle}
          </AppText>
        </View>
        <IconButton
          testID="wrapped-modal-close"
          icon="close"
          variant="tonal"
          accessibilityLabel={copy.closeButton}
          onPress={onClose}
        />
      </View>

      <View style={styles.modeSwitchRow}>
        <FilterChip
          testID="wrapped-mode-story"
          icon="play"
          label={copy.modes.story}
          accessibilityRole="tab"
          selected={mode === 'story'}
          onPress={() => onSelectMode('story')}
        />
        <FilterChip
          testID="wrapped-mode-studio"
          icon="palette"
          label={copy.modes.studio}
          accessibilityRole="tab"
          selected={mode === 'studio'}
          onPress={() => onSelectMode('studio')}
        />
      </View>

      {emptyReport ? (
        <EmptyState
          testID="wrapped-modal-empty"
          layout="page"
          icon="chart-bar"
          title={wave2Strings.insights.emptyTitle}
          message={copy.errors.emptyReport}
        />
      ) : mode === 'story' ? (
        <View testID="wrapped-story-view" style={styles.flexPane}>
          <View testID="wrapped-story-progress" style={styles.progressRow}>
            {WRAPPED_STORY_CHAPTERS.map((item, idx) => {
              const active = idx <= clampedIndex;
              return (
                <Pressable
                  key={item.id}
                  testID={`wrapped-story-segment-${idx}`}
                  accessibilityRole="button"
                  accessibilityLabel={copy.storyControls.chapterCounter(
                    idx + 1,
                    WRAPPED_STORY_CHAPTERS.length,
                  )}
                  onPress={() => onSelectChapter(idx)}
                  style={styles.progressSegmentTouch}
                >
                  <View
                    style={[
                      styles.progressSegmentBar,
                      { backgroundColor: active ? colors.accent : colors.fillStrong },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          <ScrollView
            style={styles.scrollPane}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <StoryChapterSlide
              chapter={chapter}
              report={report}
              onOpenCard={onOpenChapterCard}
              onEnterStudio={() => onSelectMode('studio')}
            />
          </ScrollView>

          <View style={styles.storyControlsBar}>
            <IconButton
              testID="wrapped-story-prev"
              icon="chevron-left"
              variant="tonal"
              disabled={clampedIndex === 0}
              accessibilityLabel={copy.storyControls.previous}
              onPress={onPrevChapter}
            />
            <IconButton
              testID="wrapped-story-pause"
              icon={paused ? 'play' : 'pause'}
              variant="tonal"
              accessibilityLabel={paused ? copy.storyControls.play : copy.storyControls.pause}
              onPress={onTogglePause}
            />
            <ActionButton
              testID="wrapped-story-open-card"
              variant="secondary"
              icon="palette"
              label={copy.storyControls.openCard}
              onPress={() => onOpenChapterCard(chapter.template)}
            />
            <IconButton
              testID="wrapped-story-next"
              icon="chevron-right"
              variant="filled"
              disabled={clampedIndex === WRAPPED_STORY_CHAPTERS.length - 1}
              accessibilityLabel={copy.storyControls.next}
              onPress={onNextChapter}
            />
          </View>
        </View>
      ) : (
        <ScrollView
          testID="wrapped-studio-view"
          style={styles.scrollPane}
          contentContainerStyle={styles.studioContent}
          showsVerticalScrollIndicator={false}
        >
          <WrappedCardView
            testID="wrapped-studio-card"
            report={report}
            template={template}
            theme={theme}
            showUser={showUser}
            showCounts={showCounts}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
          >
            {WRAPPED_TEMPLATES.map((tpl) => (
              <FilterChip
                key={tpl}
                testID={`wrapped-template-${tpl}`}
                label={copy.templates[tpl].label}
                selected={template === tpl}
                accessibilityRole="tab"
                onPress={() => onSelectTemplate(tpl)}
              />
            ))}
          </ScrollView>

          <View testID="wrapped-theme-swatches" style={styles.swatchRow}>
            {WRAPPED_THEMES.map((themeId) => {
              const palette = resolveWrappedPalette(themeId, report);
              const selected = theme === themeId;
              return (
                <Pressable
                  key={themeId}
                  testID={`wrapped-theme-${themeId}`}
                  accessibilityRole="radio"
                  accessibilityLabel={copy.themes[themeId]}
                  accessibilityState={{ checked: selected }}
                  onPress={() => onSelectTheme(themeId)}
                  style={({ pressed }) => [
                    styles.swatchButton,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <View
                    style={[
                      styles.swatchOuter,
                      { borderColor: selected ? colors.textPrimary : colors.hairline },
                    ]}
                  >
                    <View style={[styles.swatchDot, { backgroundColor: palette.swatch }]} />
                  </View>
                  <AppText
                    variant="micro"
                    color={selected ? 'primary' : 'muted'}
                    numberOfLines={1}
                  >
                    {copy.themes[themeId]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.togglesRow}>
            <FilterChip
              testID="wrapped-toggle-user"
              icon={showUser ? 'eye' : 'eye-off'}
              label={copy.toggles.showUser}
              selected={showUser}
              onPress={onToggleShowUser}
            />
            <FilterChip
              testID="wrapped-toggle-counts"
              icon={showCounts ? 'numeric' : 'eye-off'}
              label={copy.toggles.showCounts}
              selected={showCounts}
              onPress={onToggleShowCounts}
            />
          </View>

          <View style={styles.actionsStack}>
            <ActionButton
              testID="wrapped-share-button"
              variant="primary"
              icon="share-variant"
              label={sharing ? copy.actions.sharing : copy.actions.share}
              busy={sharing}
              fullWidth
              onPress={onShare}
            />
            <ActionButton
              testID="wrapped-open-svg-button"
              variant="secondary"
              icon="open-in-new"
              label={openingSvg ? copy.actions.openingSvg : copy.actions.openSvg}
              busy={openingSvg}
              fullWidth
              onPress={onOpenSvg}
            />
          </View>

          {actionError !== null ? (
            <AppText
              testID="wrapped-action-error"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              variant="callout"
              color="danger"
            >
              {actionError}
            </AppText>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

export interface WrappedStudioModalProps {
  visible: boolean;
  report: WrappedReport;
  initialMode?: WrappedStudioMode;
  initialTemplate?: WrappedCardTemplateId;
  onClose: () => void;
}

/**
 * Interactive Wrapped Story Mode & Share Card Studio modal.
 * Manages Story chapter auto-advance, template/theme customization, and native share/SVG actions.
 */
export function WrappedStudioModal({
  visible,
  report,
  initialMode = 'story',
  initialTemplate = 'summary',
  onClose,
}: WrappedStudioModalProps) {
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<WrappedStudioMode>(initialMode);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [template, setTemplate] = useState<WrappedCardTemplateId>(initialTemplate);
  const [theme, setTheme] = useState<WrappedThemeId>('signal');
  const [showUser, setShowUser] = useState(true);
  const [showCounts, setShowCounts] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [openingSvg, setOpeningSvg] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [prevVisible, setPrevVisible] = useState(visible);
  const [fadeAnim] = useState(() => new Animated.Value(1));

  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMode(initialMode);
      setTemplate(initialTemplate);
      setChapterIndex(0);
      setPaused(false);
      setActionError(null);
    }
  }

  useBackHandler(visible, () => {
    onClose();
    return true;
  });

  useEffect(() => {
    if (!visible || mode !== 'story' || paused || reducedMotion || report.totals.play_count === 0) {
      return undefined;
    }
    if (chapterIndex >= WRAPPED_STORY_CHAPTERS.length - 1) return undefined;
    const timer = setTimeout(() => {
      setChapterIndex((prev) => Math.min(WRAPPED_STORY_CHAPTERS.length - 1, prev + 1));
    }, STORY_AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [chapterIndex, mode, paused, reducedMotion, report.totals.play_count, visible]);

  useEffect(() => {
    if (!visible || mode !== 'story' || reducedMotion) {
      fadeAnim.setValue(1);
      return;
    }
    fadeAnim.setValue(0.82);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [chapterIndex, fadeAnim, mode, reducedMotion, visible]);

  const handleShare = async () => {
    setActionError(null);
    setSharing(true);
    haptics.trigger('tap');
    try {
      await shareWrappedCard(report, { template, theme }, getCurrentApiBase());
    } catch (cause: unknown) {
      console.error('[LoggeRythm] Failed to share Wrapped card:', cause);
      setActionError(`${wave2Strings.wrapped.errors.shareFailed} (${formatErrorDetail(cause)})`);
    } finally {
      setSharing(false);
    }
  };

  const handleOpenSvg = async () => {
    setActionError(null);
    setOpeningSvg(true);
    haptics.trigger('tap');
    try {
      await openWrappedCardSvg(report, { template, theme }, getCurrentApiBase());
    } catch (cause: unknown) {
      console.error('[LoggeRythm] Failed to open Wrapped SVG card:', cause);
      setActionError(`${wave2Strings.wrapped.errors.openSvgFailed} (${formatErrorDetail(cause)})`);
    } finally {
      setOpeningSvg(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType={reducedMotion ? 'none' : 'slide'}
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.modalHost, mode === 'story' ? { opacity: fadeAnim } : null]}>
        <WrappedStudioModalContent
          report={report}
          mode={mode}
          chapterIndex={chapterIndex}
          paused={paused}
          template={template}
          theme={theme}
          showUser={showUser}
          showCounts={showCounts}
          sharing={sharing}
          openingSvg={openingSvg}
          actionError={actionError}
          topInset={insets.top}
          bottomInset={insets.bottom}
          onClose={onClose}
          onSelectMode={(nextMode) => {
            haptics.trigger('tap');
            setActionError(null);
            setMode(nextMode);
          }}
          onSelectChapter={(index) => {
            haptics.trigger('tap');
            setChapterIndex(index);
          }}
          onPrevChapter={() => {
            haptics.trigger('tap');
            setChapterIndex((prev) => Math.max(0, prev - 1));
          }}
          onNextChapter={() => {
            haptics.trigger('tap');
            setChapterIndex((prev) => Math.min(WRAPPED_STORY_CHAPTERS.length - 1, prev + 1));
          }}
          onTogglePause={() => {
            haptics.trigger('tap');
            setPaused((prev) => !prev);
          }}
          onOpenChapterCard={(nextTemplate) => {
            haptics.trigger('tap');
            setActionError(null);
            setTemplate(nextTemplate);
            setMode('studio');
          }}
          onSelectTemplate={(nextTemplate) => {
            setActionError(null);
            setTemplate(nextTemplate);
          }}
          onSelectTheme={(nextTheme) => {
            haptics.trigger('tap');
            setActionError(null);
            setTheme(nextTheme);
          }}
          onToggleShowUser={() => setShowUser((prev) => !prev)}
          onToggleShowCounts={() => setShowCounts((prev) => !prev)}
          onShare={() => void handleShare()}
          onOpenSvg={() => void handleOpenSvg()}
        />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalHost: {
    flex: 1,
    backgroundColor: colors.background,
  },
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.pagePadding,
    gap: spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topTitle: {
    flex: 1,
    gap: 2,
  },
  modeSwitchRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  flexPane: {
    flex: 1,
    gap: spacing.sm,
  },
  progressRow: {
    flexDirection: 'row',
    gap: spacing.xxs,
    alignItems: 'center',
  },
  progressSegmentTouch: {
    flex: 1,
    minHeight: metrics.minimumTouchTarget / 2,
    justifyContent: 'center',
  },
  progressSegmentBar: {
    height: 4,
    borderRadius: radii.pill,
  },
  scrollPane: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  storyBody: {
    gap: spacing.md,
  },
  storyKpiGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  storyKpiCard: {
    flex: 1,
    gap: spacing.xxs,
  },
  equivalentsList: {
    gap: spacing.xs,
  },
  equivalentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  equivalentCopy: {
    flex: 1,
    gap: 2,
  },
  highlightCard: {
    gap: spacing.md,
  },
  obsessionHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  obsessionMeta: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  accentBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    marginTop: spacing.xxs,
  },
  headlinerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  lineupSection: {
    gap: spacing.xxs,
  },
  auraSwatches: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  auraSwatchOrb: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tagChip: {
    backgroundColor: colors.fill,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  personaSlideHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  personaEmblemDisc: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.card,
  },
  storyControlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  studioContent: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  chipsScroll: {
    gap: spacing.xs,
  },
  swatchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  swatchButton: {
    flex: 1,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  swatchOuter: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDot: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
  },
  togglesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  actionsStack: {
    gap: spacing.xs,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
