import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StatEntry, UserStats } from '../../domain/listeningStats';
import { triggerHaptic } from '../../hooks/useHaptics';
import { strings } from '../../localization';
import { accountStrings } from '../../screens/accountStrings';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import { AppText, Artwork } from '../ui';

type PeriodId = 'all-time' | '30-days';

export interface StatsPeriodsProps {
  data: UserStats;
  testID?: string;
  onPressTrack?: (entry: StatEntry) => void;
  onPressArtist?: (entry: StatEntry) => void;
}

const TOP_ENTRIES = 5;

function StatRows({
  id,
  title,
  entries,
  round,
  onPressEntry,
}: {
  id: string;
  title: string;
  entries: StatEntry[];
  round: boolean;
  onPressEntry: (entry: StatEntry) => void;
}) {
  return (
    <View testID={`profile-stats-${id}`} style={styles.list}>
      <AppText variant="overline" color="muted">{title}</AppText>
      {entries.length === 0 ? (
        <AppText testID={`profile-stats-${id}-empty`} variant="callout" color="secondary">
          {accountStrings.profile.statsNoEntries}
        </AppText>
      ) : entries.slice(0, TOP_ENTRIES).map((entry, index) => (
        <Pressable
          key={`${entry.key}:${index}`}
          testID={`profile-stats-${id}-${index}`}
          accessible
          focusable
          accessibilityRole="button"
          accessibilityLabel={`${accountStrings.profile.statRank(index + 1)}: ${entry.label}, ${entry.sublabel}, ${strings.profile.playCount(entry.count)}`}
          accessibilityHint={
            round
              ? strings.profile.openTopArtist(entry.label)
              : strings.profile.playTopTrack(entry.label)
          }
          onPress={() => {
            triggerHaptic('tap');
            onPressEntry(entry);
          }}
          style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
        >
          <AppText variant="label" color="muted" align="center" style={styles.rank}>
            {index + 1}
          </AppText>
          <Artwork
            uri={entry.cover}
            size={layout.artwork.xs}
            shape={round ? 'round' : 'square'}
            icon={round ? 'account-music' : 'music-note'}
          />
          <View style={styles.rowCopy}>
            <AppText variant="bodyStrong" numberOfLines={1}>{entry.label}</AppText>
            <AppText variant="callout" color="secondary" numberOfLines={1}>{entry.sublabel}</AppText>
          </View>
          <AppText variant="label" color="secondary">{entry.count}</AppText>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * StatsPeriods shows the listening totals as two stat cards — all time and
 * the last 30 days — that double as the period switch (tabs), followed by
 * the top tracks and artists of the selected period.
 */
export function StatsPeriods({
  data,
  testID,
  onPressTrack,
  onPressArtist,
}: StatsPeriodsProps) {
  const [period, setPeriod] = useState<PeriodId>('all-time');
  const handleTrackPress = onPressTrack ?? ((entry: StatEntry) => {
    void import('./statRowActions')
      .then((mod) => mod.playTopStatTrack(entry))
      .catch((error: unknown) => {
        console.error('[LoggeRythm] Failed to play top stat track:', error);
      });
  });
  const handleArtistPress = onPressArtist ?? ((entry: StatEntry) => {
    void import('./statRowActions')
      .then((mod) => mod.openTopStatArtist(entry))
      .catch((error: unknown) => {
        console.error('[LoggeRythm] Failed to open top stat artist:', error);
      });
  });
  const periods: readonly {
    id: PeriodId;
    title: string;
    total: number;
    tracks: StatEntry[];
    artists: StatEntry[];
  }[] = [
    {
      id: 'all-time',
      title: strings.profile.allTime,
      total: data.total_plays,
      tracks: data.top_tracks,
      artists: data.top_artists,
    },
    {
      id: '30-days',
      title: strings.profile.lastThirtyDays,
      total: data.total_plays_month,
      tracks: data.top_tracks_month,
      artists: data.top_artists_month,
    },
  ];
  const selected = periods.find((entry) => entry.id === period) ?? periods[0];

  return (
    <View testID={testID} style={styles.periods}>
      <View
        accessibilityRole="tablist"
        accessibilityLabel={accountStrings.profile.statsPeriod}
        style={styles.cards}
      >
        {periods.map((entry) => {
          const active = entry.id === selected.id;
          return (
            <Pressable
              key={entry.id}
              testID={`profile-stat-${entry.id}-tab`}
              accessibilityRole="tab"
              accessibilityLabel={`${entry.title}, ${strings.profile.playCount(entry.total)}`}
              accessibilityState={{ selected: active }}
              onPress={() => setPeriod(entry.id)}
              style={({ pressed }) => [
                styles.card,
                active ? styles.cardActive : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <AppText variant="caption" color={active ? 'accent' : 'secondary'} numberOfLines={1}>
                {entry.title}
              </AppText>
              <AppText variant="hero" numberOfLines={1} adjustsFontSizeToFit>
                {entry.total}
              </AppText>
              <AppText variant="caption" color="muted" numberOfLines={1}>
                {strings.profile.plays}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <View testID={`profile-stat-${selected.id}`} style={styles.lists}>
        <StatRows
          id={`${selected.id}-tracks`}
          title={strings.profile.topTracks}
          entries={selected.tracks}
          round={false}
          onPressEntry={handleTrackPress}
        />
        <StatRows
          id={`${selected.id}-artists`}
          title={strings.profile.topArtists}
          entries={selected.artists}
          round
          onPressEntry={handleArtistPress}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  periods: { gap: layout.stackGap },
  cards: { flexDirection: 'row', gap: spacing.sm },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    gap: spacing.xxs / 2,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  cardActive: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  pressed: { opacity: opacity.pressed },
  lists: { gap: layout.stackGap },
  list: { gap: spacing.xs },
  row: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rank: { width: spacing.lg },
  rowCopy: { flex: 1, minWidth: 0 },
});
