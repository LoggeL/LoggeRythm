import React from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  StatsInsightsRange,
  WrappedCardTemplateId,
  WrappedEmblemId,
  WrappedEquivalentIcon,
  WrappedRankedItem,
  WrappedReport,
  WrappedThemeId,
} from '../../api/types';
import { wave2Strings } from '../../localization/wave2Strings';
import { colors, elevation, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import { AppText, Artwork } from '../ui';

export const WRAPPED_TEMPLATES: readonly WrappedCardTemplateId[] = [
  'summary',
  'persona',
  'receipt',
  'festival',
  'obsession',
  'aura',
  'peak',
] as const;

export const WRAPPED_THEMES: readonly WrappedThemeId[] = [
  'signal',
  'cover',
  'vinyl',
  'neon',
  'paper',
] as const;

export interface WrappedPalette {
  readonly id: WrappedThemeId;
  readonly bg: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentAlt: string;
  readonly onAccent: string;
  readonly border: string;
  readonly swatch: string;
  readonly isLight: boolean;
}

const STATIC_PALETTES: Readonly<Record<Exclude<WrappedThemeId, 'cover'>, WrappedPalette>> = {
  signal: {
    id: 'signal',
    bg: colors.background,
    surface: colors.surface,
    surfaceAlt: colors.surfaceElevated,
    text: colors.textPrimary,
    muted: colors.textSecondary,
    accent: colors.accent,
    accentAlt: colors.success,
    onAccent: colors.onAccent,
    border: colors.hairline,
    swatch: colors.accent,
    isLight: false,
  },
  vinyl: {
    id: 'vinyl',
    bg: '#18110e',
    surface: '#241813',
    surfaceAlt: '#31211a',
    text: colors.textPrimary,
    muted: '#d2bfb2',
    accent: '#ff9b54',
    accentAlt: colors.warning,
    onAccent: '#140c07',
    border: 'rgba(255,155,84,0.22)',
    swatch: '#ff9b54',
    isLight: false,
  },
  neon: {
    id: 'neon',
    bg: '#0b0c1a',
    surface: '#141730',
    surfaceAlt: '#1e2245',
    text: '#eef1ff',
    muted: '#a6b3de',
    accent: '#4ff3ff',
    accentAlt: '#ff66c4',
    onAccent: '#07131a',
    border: 'rgba(79,243,255,0.24)',
    swatch: '#4ff3ff',
    isLight: false,
  },
  paper: {
    id: 'paper',
    bg: colors.textPrimary,
    surface: '#e8e2d2',
    surfaceAlt: '#ddd5c2',
    text: colors.onLight,
    muted: '#4a4640',
    accent: '#b8321b',
    accentAlt: '#1f574b',
    onAccent: colors.textPrimary,
    border: 'rgba(12,11,13,0.16)',
    swatch: colors.textPrimary,
    isLight: true,
  },
};

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return 0;
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(clean.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastInkFor(hex: string): string {
  return relativeLuminance(hex) > 0.36 ? colors.onAccent : colors.textPrimary;
}

export function resolveWrappedPalette(
  theme: WrappedThemeId,
  report: WrappedReport,
): WrappedPalette {
  if (theme !== 'cover') {
    return STATIC_PALETTES[theme];
  }
  const auraColors = report.aura?.colors;
  const accent = auraColors?.[0] ?? colors.accent;
  const accentAlt = auraColors?.[1] ?? colors.success;
  const tint = auraColors?.[2] ?? colors.surfaceElevated;
  return {
    id: 'cover',
    bg: colors.backdrop,
    surface: colors.surface,
    surfaceAlt: colors.surfaceElevated,
    text: colors.textPrimary,
    muted: colors.textSecondary,
    accent,
    accentAlt,
    onAccent: contrastInkFor(accent),
    border: `${accent}44`,
    swatch: tint,
    isLight: false,
  };
}

export function emblemIconName(emblem: WrappedEmblemId): AppIconName {
  switch (emblem) {
    case 'moon_wave':
      return 'weather-night';
    case 'infinite_vinyl':
      return 'infinity';
    case 'compass_radar':
      return 'compass';
    case 'tonearm_disc':
      return 'record-player';
    case 'strobe_bars':
      return 'equalizer';
    case 'sunrise_pulse':
      return 'weather-sunset-up';
    case 'flame_metro':
      return 'fire';
    case 'prism_beat':
      return 'star-four-points';
  }
}

export function equivalentIconName(icon: WrappedEquivalentIcon): AppIconName {
  switch (icon) {
    case 'vinyl':
      return 'disc';
    case 'movie':
      return 'filmstrip';
    case 'flight':
      return 'airplane';
    case 'marathon':
      return 'run-fast';
    case 'concert':
      return 'microphone-variant';
  }
}

export function formatWrappedDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return wave2Strings.insights.formatDuration(hours, minutes);
}

export function formatReceiptDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rem = safe % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${minutes}:${String(rem).padStart(2, '0')}`;
}

function rangeLabel(range: StatsInsightsRange): string {
  return wave2Strings.insights.ranges[range];
}

function BrandGridMark({ palette }: { palette: WrappedPalette }) {
  const activeIndices = new Set([0, 1, 4, 5, 6, 9, 10, 11, 14, 15]);
  return (
    <View accessible={false} style={styles.brandGrid}>
      {Array.from({ length: 16 }, (_, idx) => (
        <View
          key={idx}
          style={[
            styles.brandDot,
            {
              backgroundColor: activeIndices.has(idx) ? palette.accent : palette.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

function RankedBarRows({
  title,
  items,
  palette,
  showCounts,
  maxItems = 3,
}: {
  title: string;
  items: readonly WrappedRankedItem[];
  palette: WrappedPalette;
  showCounts: boolean;
  maxItems?: number;
}) {
  const slice = items.slice(0, maxItems);
  const maxCount = Math.max(1, ...slice.map((entry) => entry.count));
  return (
    <View style={styles.rankBlock}>
      <AppText variant="overline" style={{ color: palette.muted }}>
        {title}
      </AppText>
      {slice.map((item) => {
        const widthPct = Math.max(18, Math.round((item.count / maxCount) * 100));
        return (
          <View key={`${item.rank}-${item.key}`} style={styles.rankBarItem}>
            <View style={styles.rankBarHead}>
              <AppText
                variant="caption"
                numberOfLines={1}
                style={[styles.rankBarLabel, { color: palette.text }]}
              >
                {`${item.rank}. ${item.label}`}
              </AppText>
              {showCounts ? (
                <AppText variant="micro" style={{ color: palette.muted }}>
                  {`${item.count}×`}
                </AppText>
              ) : null}
            </View>
            <View style={[styles.progressTrack, { backgroundColor: palette.surfaceAlt }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${widthPct}%`,
                    backgroundColor: item.rank === 1 ? palette.accent : palette.accentAlt,
                  },
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SummaryCardBody({
  report,
  palette,
  showCounts,
}: {
  report: WrappedReport;
  palette: WrappedPalette;
  showCounts: boolean;
}) {
  const copy = wave2Strings.wrapped.card;
  const topArtist = report.top_artists[0];
  const topTrack = report.top_tracks[0];
  const leadCover = topTrack?.cover || topArtist?.cover || '';
  const leadEquivalent = report.equivalents[0];

  return (
    <View testID="wrapped-card-template-summary" style={styles.templateBody}>
      <View style={styles.summaryHeroRow}>
        <View style={styles.summaryHeroStats}>
          <AppText variant="overline" style={{ color: palette.muted }}>
            {copy.listeningHours}
          </AppText>
          <AppText variant="display" style={{ color: palette.accent }}>
            {showCounts
              ? formatWrappedDuration(report.totals.listening_sec)
              : report.persona?.title ?? report.rhythm.chronotype_label}
          </AppText>
          <View style={styles.pillWrap}>
            {showCounts ? (
              <View style={[styles.pill, { backgroundColor: palette.surfaceAlt }]}>
                <AppText variant="micro" style={{ color: palette.text }}>
                  {`${report.totals.play_count} ${copy.plays}`}
                </AppText>
              </View>
            ) : null}
            {report.persona !== null ? (
              <View style={[styles.pill, { backgroundColor: palette.accent }]}>
                <AppIcon
                  name={emblemIconName(report.persona.emblem)}
                  size={13}
                  color={palette.onAccent}
                />
                <AppText variant="micro" style={{ color: palette.onAccent }}>
                  {report.persona.title}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
        <Artwork uri={leadCover} size={84} radius="card" icon="music-note" />
      </View>

      {leadEquivalent !== undefined ? (
        <View
          style={[
            styles.equivalentBanner,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <AppIcon
            name={equivalentIconName(leadEquivalent.icon)}
            size={18}
            color={palette.accent}
          />
          <AppText variant="label" style={{ color: palette.text }}>
            {`${leadEquivalent.value} · ${leadEquivalent.label}`}
          </AppText>
        </View>
      ) : null}

      <View style={[styles.splitPanels, { borderColor: palette.border }]}>
        <View style={[styles.splitCol, { backgroundColor: palette.surface }]}>
          <RankedBarRows
            title={copy.topArtists}
            items={report.top_artists}
            palette={palette}
            showCounts={showCounts}
          />
        </View>
        <View style={[styles.splitCol, { backgroundColor: palette.surface }]}>
          <RankedBarRows
            title={copy.topTracks}
            items={report.top_tracks}
            palette={palette}
            showCounts={showCounts}
          />
        </View>
      </View>
    </View>
  );
}

function PersonaCardBody({
  report,
  palette,
}: {
  report: WrappedReport;
  palette: WrappedPalette;
}) {
  const persona = report.persona;
  const copy = wave2Strings.wrapped;
  const bars = report.rhythm.hourly_distribution.slice(8, 24);
  const maxBar = Math.max(1, ...bars);

  return (
    <View testID="wrapped-card-template-persona" style={styles.templateBody}>
      <View style={styles.personaCenter}>
        <View style={[styles.emblemOuter, { borderColor: palette.accent }]}>
          <View style={[styles.emblemInner, { backgroundColor: palette.accent }]}>
            <AppIcon
              name={persona !== null ? emblemIconName(persona.emblem) : 'waveform'}
              size={44}
              color={palette.onAccent}
            />
          </View>
        </View>
        <AppText variant="overline" align="center" style={{ color: palette.muted }}>
          {persona?.subtitle ?? copy.chapters.persona.eyebrow}
        </AppText>
        <AppText variant="hero" align="center" style={{ color: palette.text }}>
          {persona?.title ?? report.rhythm.chronotype_label}
        </AppText>
        <AppText variant="callout" align="center" style={{ color: palette.muted }}>
          {persona?.tagline ?? copy.chapters.persona.emptyNote}
        </AppText>
      </View>

      {persona !== null && persona.traits.length > 0 ? (
        <View style={styles.traitsCenter}>
          {persona.traits.slice(0, 3).map((trait, index) => (
            <View
              key={`${trait}-${index}`}
              style={[
                styles.traitPill,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <AppText variant="caption" style={{ color: palette.accent }}>
                {trait}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.dnaBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <AppText variant="micro" style={{ color: palette.muted }}>
          {copy.card.dnaWave}
        </AppText>
        <View style={styles.waveRow}>
          {bars.map((val, idx) => {
            const height = Math.max(8, Math.round((val / maxBar) * 34));
            return (
              <View
                key={idx}
                style={[
                  styles.waveBar,
                  {
                    height,
                    backgroundColor: val === maxBar ? palette.accent : palette.accentAlt,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

function ReceiptCardBody({
  report,
  palette,
  showUser,
  showCounts,
}: {
  report: WrappedReport;
  palette: WrappedPalette;
  showUser: boolean;
  showCounts: boolean;
}) {
  const copy = wave2Strings.wrapped.card;
  const listener = showUser && report.user.display_name.trim().length > 0
    ? report.user.display_name.trim()
    : copy.anonymousListener;
  const tracks = report.top_tracks.slice(0, 6);
  const barcodeWidths = [2, 4, 1, 3, 2, 1, 4, 2, 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3];

  return (
    <View testID="wrapped-card-template-receipt" style={styles.templateBody}>
      <View
        style={[
          styles.receiptSheet,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={[styles.receiptToothRow, { borderBottomColor: palette.border }]}>
          <AppText variant="section" style={{ color: palette.text }}>
            {copy.receiptHeader}
          </AppText>
          <AppText variant="micro" style={{ color: palette.muted }}>
            {copy.receiptOrder(rangeLabel(report.range), listener)}
          </AppText>
        </View>

        <View style={[styles.receiptColumns, { borderBottomColor: palette.border }]}>
          <AppText variant="micro" style={{ color: palette.muted }}>
            {`${copy.receiptQty}  ${copy.receiptItem}`}
          </AppText>
          <AppText variant="micro" style={{ color: palette.muted }}>
            {copy.receiptTime}
          </AppText>
        </View>

        <View style={styles.receiptRows}>
          {tracks.map((item) => (
            <View key={`${item.rank}-${item.key}`} style={styles.receiptRow}>
              <AppText
                variant="caption"
                numberOfLines={1}
                style={[styles.receiptItemText, { color: palette.text }]}
              >
                {showCounts
                  ? `${String(item.count).padStart(2, '0')}× ${item.label}`
                  : `${String(item.rank).padStart(2, '0')}. ${item.label}`}
              </AppText>
              <AppText variant="caption" style={{ color: palette.muted }}>
                {showCounts ? formatReceiptDuration(item.listening_sec) : `#${item.rank}`}
              </AppText>
            </View>
          ))}
        </View>

        <View style={[styles.receiptTotals, { borderTopColor: palette.border }]}>
          <View style={styles.receiptRow}>
            <AppText variant="caption" style={{ color: palette.muted }}>
              {copy.receiptSubtotal}
            </AppText>
            <AppText variant="caption" style={{ color: palette.text }}>
              {showCounts
                ? `${report.totals.unique_tracks} / ${report.totals.unique_artists}`
                : rangeLabel(report.range)}
            </AppText>
          </View>
          <View style={styles.receiptRow}>
            <AppText variant="bodyStrong" style={{ color: palette.accent }}>
              {copy.receiptTotal}
            </AppText>
            <AppText variant="bodyStrong" style={{ color: palette.accent }}>
              {showCounts
                ? formatWrappedDuration(report.totals.listening_sec)
                : `${report.top_tracks.length} TOP`}
            </AppText>
          </View>
        </View>

        <View style={styles.barcodeRow}>
          {barcodeWidths.map((w, idx) => (
            <View
              key={idx}
              style={{
                width: w * 2,
                height: idx % 3 === 0 ? 22 : 16,
                backgroundColor: palette.text,
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function FestivalCardBody({
  report,
  palette,
  showCounts,
}: {
  report: WrappedReport;
  palette: WrappedPalette;
  showCounts: boolean;
}) {
  const copy = wave2Strings.wrapped.card;
  const headliner = report.top_artists[0];
  const coHeadliners = report.top_artists.slice(1, 4);
  const undercard = report.top_artists.slice(4, 10);

  return (
    <View testID="wrapped-card-template-festival" style={styles.templateBody}>
      <View style={styles.festivalHeader}>
        <AppText variant="overline" style={{ color: palette.accent }}>
          {copy.festivalTitle}
        </AppText>
      </View>

      {headliner !== undefined ? (
        <View style={styles.headlinerBox}>
          <Artwork uri={headliner.cover} size={88} shape="round" icon="account-music" />
          <AppText variant="overline" style={{ color: palette.muted }}>
            {copy.headliner}
          </AppText>
          <AppText variant="hero" align="center" numberOfLines={2} style={{ color: palette.text }}>
            {headliner.label.toUpperCase()}
          </AppText>
          {showCounts ? (
            <AppText variant="caption" style={{ color: palette.accent }}>
              {`${headliner.count} Plays · ${headliner.share_pct}%`}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {coHeadliners.length > 0 ? (
        <View
          style={[
            styles.festivalBand,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <AppText variant="overline" align="center" style={{ color: palette.muted }}>
            {copy.coHeadliners}
          </AppText>
          <AppText variant="section" align="center" style={{ color: palette.text }}>
            {coHeadliners.map((artist) => artist.label).join('  ★  ')}
          </AppText>
        </View>
      ) : null}

      {undercard.length > 0 ? (
        <View style={styles.undercardWrap}>
          <AppText variant="overline" align="center" style={{ color: palette.muted }}>
            {copy.undercard}
          </AppText>
          <AppText variant="callout" align="center" style={{ color: palette.muted }}>
            {undercard.map((artist) => artist.label).join('  ·  ')}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function ObsessionCardBody({
  report,
  palette,
  showCounts,
}: {
  report: WrappedReport;
  palette: WrappedPalette;
  showCounts: boolean;
}) {
  const copy = wave2Strings.wrapped.card;
  const obs = report.obsession;
  const fallback = report.top_tracks[0];
  const title = obs?.title ?? fallback?.label ?? copy.anonymousListener;
  const artist = obs?.artist ?? fallback?.sublabel ?? '';
  const cover = obs?.cover ?? fallback?.cover ?? '';
  const plays = obs?.play_count ?? fallback?.count ?? 0;
  const sharePct = obs?.share_pct ?? fallback?.share_pct ?? 0;

  return (
    <View testID="wrapped-card-template-obsession" style={styles.templateBody}>
      <View style={styles.vinylStage}>
        <View
          style={[
            styles.vinylDisc,
            { backgroundColor: colors.backdrop, borderColor: palette.accent },
          ]}
        >
          <View style={[styles.vinylRing, { borderColor: palette.border }]} />
          <View style={[styles.vinylCenter, { backgroundColor: palette.accent }]}>
            <View style={[styles.vinylSpindle, { backgroundColor: palette.bg }]} />
          </View>
        </View>
        <View style={styles.vinylSleeve}>
          <Artwork uri={cover} size={118} radius="card" icon="music-note" />
        </View>
      </View>

      <View style={styles.obsessionCopy}>
        <AppText variant="title" align="center" numberOfLines={2} style={{ color: palette.text }}>
          {title}
        </AppText>
        {artist.trim().length > 0 ? (
          <AppText variant="body" align="center" numberOfLines={1} style={{ color: palette.muted }}>
            {artist}
          </AppText>
        ) : null}
      </View>

      {showCounts ? (
        <View style={styles.traitsCenter}>
          <View style={[styles.pill, { backgroundColor: palette.accent }]}>
            <AppText variant="label" style={{ color: palette.onAccent }}>
              {copy.obsessionLoops(plays)}
            </AppText>
          </View>
          <View style={[styles.pill, { backgroundColor: palette.surface }]}>
            <AppText variant="caption" style={{ color: palette.text }}>
              {copy.obsessionShare(sharePct)}
            </AppText>
          </View>
          {obs !== null && obs.peak_day_date !== null ? (
            <View style={[styles.pill, { backgroundColor: palette.surface }]}>
              <AppText variant="caption" style={{ color: palette.muted }}>
                {copy.obsessionPeak(obs.peak_day_date, obs.peak_day_plays)}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AuraCardBody({
  report,
  palette,
  showCounts,
}: {
  report: WrappedReport;
  palette: WrappedPalette;
  showCounts: boolean;
}) {
  const copy = wave2Strings.wrapped.card;
  const aura = report.aura;
  const auraColors = aura?.colors ?? [palette.accent, palette.accentAlt, palette.surfaceAlt];
  const hourly = report.rhythm.hourly_distribution;
  const maxHour = Math.max(1, ...hourly);

  return (
    <View testID="wrapped-card-template-aura" style={styles.templateBody}>
      <View
        style={[
          styles.auraPanel,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={styles.swatchRow}>
          {auraColors.map((swatch, idx) => (
            <View
              key={`${swatch}-${idx}`}
              style={[styles.auraOrb, { backgroundColor: swatch, borderColor: palette.border }]}
            />
          ))}
        </View>
        <AppText variant="title" align="center" style={{ color: palette.text }}>
          {aura?.title ?? report.rhythm.chronotype_label}
        </AppText>
        {aura !== null ? (
          <AppText variant="callout" align="center" style={{ color: palette.muted }}>
            {aura.description}
          </AppText>
        ) : null}
        {aura !== null && aura.mood_tags.length > 0 ? (
          <View style={styles.traitsCenter}>
            {aura.mood_tags.slice(0, 3).map((tag, idx) => (
              <View
                key={`${tag}-${idx}`}
                style={[styles.pill, { backgroundColor: palette.surfaceAlt }]}
              >
                <AppText variant="micro" style={{ color: palette.accent }}>
                  {tag}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.radarPanel,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={styles.radarHeader}>
          <AppText variant="overline" style={{ color: palette.muted }}>
            {copy.auraClockTitle}
          </AppText>
          <AppText variant="micro" style={{ color: palette.accent }}>
            {copy.auraPeakHour(report.rhythm.peak_hour)}
          </AppText>
        </View>
        <View style={styles.hourlyBars}>
          {hourly.map((val, hour) => {
            const height = Math.max(4, Math.round((val / maxHour) * 44));
            const isPeak = hour === report.rhythm.peak_hour && val > 0;
            return (
              <View
                key={hour}
                style={[
                  styles.hourlyBar,
                  {
                    height,
                    backgroundColor: isPeak ? palette.accent : palette.accentAlt,
                    opacity: val === 0 ? 0.25 : 0.92,
                  },
                ]}
              />
            );
          })}
        </View>
        <View style={styles.traitsCenter}>
          <View style={[styles.pill, { backgroundColor: palette.surfaceAlt }]}>
            <AppText variant="micro" style={{ color: palette.text }}>
              {report.rhythm.chronotype_label}
            </AppText>
          </View>
          {showCounts ? (
            <View style={[styles.pill, { backgroundColor: palette.surfaceAlt }]}>
              <AppText variant="micro" style={{ color: palette.text }}>
                {copy.auraDiscovery(report.rhythm.discovery_score_pct)}
              </AppText>
            </View>
          ) : null}
          {report.tempo !== null ? (
            <View style={[styles.pill, { backgroundColor: palette.accent }]}>
              <AppText variant="micro" style={{ color: palette.onAccent }}>
                {showCounts
                  ? `${report.tempo.avg_bpm} BPM · ${report.tempo.vibe_label}`
                  : report.tempo.vibe_label}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function PeakCardBody({
  report,
  palette,
  showCounts,
}: {
  report: WrappedReport;
  palette: WrappedPalette;
  showCounts: boolean;
}) {
  const copy = wave2Strings.wrapped.card;
  const peak = report.peak_day;
  const weekdays = report.rhythm.weekday_distribution;
  const weekdayLabels = wave2Strings.insights.weekdays;
  const maxWeekday = Math.max(1, ...weekdays);

  return (
    <View testID="wrapped-card-template-peak" style={styles.templateBody}>
      <AppText variant="overline" style={{ color: palette.muted }}>
        {copy.peakTitle}
      </AppText>

      <View style={styles.streakRow}>
        <View
          style={[
            styles.streakCard,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <AppText variant="micro" style={{ color: palette.muted }}>
            {copy.longestStreak}
          </AppText>
          <AppText variant="hero" style={{ color: palette.accent }}>
            {wave2Strings.insights.streakDays(report.totals.longest_streak_days)}
          </AppText>
        </View>
        <View
          style={[
            styles.streakCard,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <AppText variant="micro" style={{ color: palette.muted }}>
            {copy.currentStreak}
          </AppText>
          <AppText variant="hero" style={{ color: palette.text }}>
            {wave2Strings.insights.streakDays(report.totals.current_streak_days)}
          </AppText>
        </View>
      </View>

      {showCounts ? (
        <View style={[styles.pill, { backgroundColor: palette.surfaceAlt, alignSelf: 'flex-start' }]}>
          <AppIcon name="calendar-check" size={14} color={palette.accent} />
          <AppText variant="caption" style={{ color: palette.text }}>
            {copy.activeDays(report.totals.active_days, report.totals.total_days)}
          </AppText>
        </View>
      ) : null}

      {peak !== null ? (
        <View
          style={[
            styles.peakDayBox,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Artwork uri={peak.top_track_cover} size={56} radius="sm" icon="music-note" />
          <View style={styles.peakDayCopy}>
            <AppText variant="overline" style={{ color: palette.accent }}>
              {peak.date}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ color: palette.text }}>
              {peak.top_track_title}
            </AppText>
            <AppText variant="caption" numberOfLines={1} style={{ color: palette.muted }}>
              {showCounts
                ? copy.peakDayPlays(peak.play_count, formatWrappedDuration(peak.listening_sec))
                : peak.top_track_artist}
            </AppText>
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.radarPanel,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={styles.weekdayBars}>
          {weekdays.map((val, idx) => {
            const height = Math.max(6, Math.round((val / maxWeekday) * 38));
            const isPeak = idx === report.rhythm.peak_weekday && val > 0;
            return (
              <View key={idx} style={styles.weekdayCol}>
                <View
                  style={[
                    styles.weekdayBar,
                    {
                      height,
                      backgroundColor: isPeak ? palette.accent : palette.accentAlt,
                    },
                  ]}
                />
                <AppText variant="micro" style={{ color: palette.muted }}>
                  {weekdayLabels[idx] ?? ''}
                </AppText>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export interface WrappedCardViewProps {
  report: WrappedReport;
  template: WrappedCardTemplateId;
  theme: WrappedThemeId;
  showUser?: boolean;
  showCounts?: boolean;
  testID?: string;
}

/**
 * Pure React Native renderer for all 7 LoggeRythm Wrapped Share Card templates
 * across 5 curated color palettes.
 */
export function WrappedCardView({
  report,
  template,
  theme,
  showUser = true,
  showCounts = true,
  testID = 'wrapped-card-view',
}: WrappedCardViewProps) {
  const palette = resolveWrappedPalette(theme, report);
  const copy = wave2Strings.wrapped;
  const userName = report.user.display_name.trim();

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.brandRow}>
          <BrandGridMark palette={palette} />
          <AppText variant="overline" style={{ color: palette.text }}>
            {copy.card.brandMark}
          </AppText>
        </View>
        <View style={[styles.rangePill, { backgroundColor: palette.surface }]}>
          <AppText variant="micro" style={{ color: palette.accent }}>
            {rangeLabel(report.range)}
          </AppText>
        </View>
      </View>

      {template === 'summary' ? (
        <SummaryCardBody report={report} palette={palette} showCounts={showCounts} />
      ) : template === 'persona' ? (
        <PersonaCardBody report={report} palette={palette} />
      ) : template === 'receipt' ? (
        <ReceiptCardBody
          report={report}
          palette={palette}
          showUser={showUser}
          showCounts={showCounts}
        />
      ) : template === 'festival' ? (
        <FestivalCardBody report={report} palette={palette} showCounts={showCounts} />
      ) : template === 'obsession' ? (
        <ObsessionCardBody report={report} palette={palette} showCounts={showCounts} />
      ) : template === 'aura' ? (
        <AuraCardBody report={report} palette={palette} showCounts={showCounts} />
      ) : (
        <PeakCardBody report={report} palette={palette} showCounts={showCounts} />
      )}

      <View style={[styles.cardFooter, { borderTopColor: palette.border }]}>
        <AppText variant="micro" style={{ color: palette.muted }}>
          {showUser && userName.length > 0
            ? copy.card.userBadge(userName)
            : copy.card.anonymousListener}
        </AppText>
        <AppText variant="micro" style={{ color: palette.accent }}>
          {copy.templates[template].label}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.panel,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
    ...elevation.floating,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  brandGrid: {
    width: 18,
    height: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  brandDot: {
    width: 3,
    height: 3,
    borderRadius: radii.xs,
  },
  rangePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
  },
  templateBody: {
    gap: spacing.md,
  },
  summaryHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  summaryHeroStats: {
    flex: 1,
    gap: spacing.xxs,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
  },
  equivalentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.card,
    borderWidth: 1,
  },
  splitPanels: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  splitCol: {
    flex: 1,
    borderRadius: radii.card,
    padding: spacing.sm,
  },
  rankBlock: {
    gap: spacing.xs,
  },
  rankBarItem: {
    gap: spacing.xxs,
  },
  rankBarHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xxs,
  },
  rankBarLabel: {
    flex: 1,
  },
  progressTrack: {
    height: 5,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  personaCenter: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  emblemOuter: {
    width: 96,
    height: 96,
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emblemInner: {
    width: 78,
    height: 78,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  traitsCenter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  traitPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  dnaBox: {
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 36,
    gap: 3,
  },
  waveBar: {
    flex: 1,
    borderRadius: radii.xs,
  },
  receiptSheet: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: spacing.md,
    gap: spacing.sm,
  },
  receiptToothRow: {
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    gap: spacing.xxs,
  },
  receiptColumns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xxs,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
  },
  receiptRows: {
    gap: spacing.xxs,
  },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  receiptItemText: {
    flex: 1,
  },
  receiptTotals: {
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    gap: spacing.xxs,
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    paddingTop: spacing.xs,
  },
  festivalHeader: {
    alignItems: 'center',
  },
  headlinerBox: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  festivalBand: {
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.xxs,
  },
  undercardWrap: {
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  vinylStage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 124,
  },
  vinylDisc: {
    width: 112,
    height: 112,
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.xl,
  },
  vinylRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  vinylCenter: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylSpindle: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  vinylSleeve: {
    ...elevation.card,
  },
  obsessionCopy: {
    alignItems: 'center',
    gap: spacing.xxs,
  },
  auraPanel: {
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatchRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  auraOrb: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  radarPanel: {
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  radarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hourlyBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 46,
    gap: 2,
  },
  hourlyBar: {
    flex: 1,
    borderRadius: radii.xs,
  },
  streakRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  streakCard: {
    flex: 1,
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.xxs,
  },
  peakDayBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.sm,
  },
  peakDayCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  weekdayBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 56,
    gap: spacing.xs,
  },
  weekdayCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xxs,
  },
  weekdayBar: {
    width: '100%',
    borderRadius: radii.xs,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
});
