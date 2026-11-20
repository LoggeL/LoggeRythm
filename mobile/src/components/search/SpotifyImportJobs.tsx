import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { ImportJobStatus } from '../../api/types';
import { isActiveImportJob } from '../../data';
import { strings } from '../../localization';
import { colors, layout, opacity, radii, spacing } from '../../theme';
import { AppText, Artwork, IconButton, SectionHeader, Surface } from '../ui';
import {
  importJobProgressPercent,
  importJobSummary,
  importJobTitle,
} from './importJobModel';
import { SearchErrorNotice } from './SearchRemoteStates';

function ProgressBar({ percent, testID }: { percent: number; testID?: string }) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={strings.search.importProgressLabel}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
  );
}

interface SpotifyImportJobRowProps {
  job: ImportJobStatus;
  selected: boolean;
  removing: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

/** One import: tap opens it, the trailing button cancels (running) or removes it. */
export function SpotifyImportJobRow({
  job,
  selected,
  removing,
  onSelect,
  onRemove,
}: SpotifyImportJobRowProps) {
  const active = isActiveImportJob(job);
  const title = importJobTitle(job);
  return (
    <View
      testID={`spotify-import-job-${job.id}`}
      style={[styles.row, selected ? styles.rowSelected : null]}
    >
      <Pressable
        testID={`spotify-import-job-${job.id}-open`}
        accessibilityRole="button"
        accessibilityLabel={strings.search.importJobOpenLabel(title)}
        accessibilityHint={importJobSummary(job)}
        accessibilityState={{ selected }}
        onPress={onSelect}
        style={({ pressed }) => [styles.rowMain, pressed ? styles.pressed : null]}
      >
        <Artwork uri={job.image} size={layout.artwork.xs} icon="playlist-music" />
        <View style={styles.rowCopy}>
          <AppText variant="bodyStrong" numberOfLines={1}>{title}</AppText>
          <AppText
            variant="caption"
            color={job.status === 'failed' ? 'danger' : 'secondary'}
            numberOfLines={2}
          >
            {importJobSummary(job)}
          </AppText>
          {active && job.total > 0 ? (
            <View accessible={false} importantForAccessibility="no-hide-descendants">
              <ProgressBar percent={importJobProgressPercent(job)} />
            </View>
          ) : null}
        </View>
        {job.status === 'done' ? (
          <AppText variant="caption" color="accent">{strings.search.importJobOpen}</AppText>
        ) : null}
      </Pressable>
      <IconButton
        testID={`spotify-import-job-${job.id}-remove`}
        icon={active ? 'close' : 'trash-can-outline'}
        size="sm"
        accessibilityLabel={active
          ? strings.search.importJobCancel(title)
          : strings.search.importJobRemove(title)}
        busy={removing}
        disabled={removing}
        onPress={onRemove}
      />
    </View>
  );
}

interface SpotifyImportJobListProps {
  jobs: readonly ImportJobStatus[] | undefined;
  /** The list query failed; shown with a retry, above cached rows if any. */
  loadError: string | null;
  retryBusy: boolean;
  onRetry: () => void;
  selectedId: string | null;
  removingId: string | null;
  onSelect: (job: ImportJobStatus) => void;
  onRemove: (job: ImportJobStatus) => void;
}

/** "Deine Importe": every import of the account, newest first. */
export function SpotifyImportJobList({
  jobs,
  loadError,
  retryBusy,
  onRetry,
  selectedId,
  removingId,
  onSelect,
  onRemove,
}: SpotifyImportJobListProps) {
  if (jobs === undefined && loadError === null) {
    return (
      <View
        testID="spotify-import-jobs-loading"
        accessibilityLabel={strings.search.importJobsLoading}
        style={styles.loading}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if ((jobs === undefined || jobs.length === 0) && loadError === null) return null;
  return (
    <View testID="spotify-import-jobs" style={styles.section}>
      <View style={styles.heading}>
        <SectionHeader title={strings.search.importJobsTitle} padded={false} />
      </View>
      {loadError !== null ? (
        <SearchErrorNotice
          testID="spotify-import-jobs-error"
          message={strings.search.importJobsLoadFailed(loadError)}
          actionLabel={strings.search.retrySection(strings.search.importJobsTitle)}
          actionBusy={retryBusy}
          onAction={onRetry}
          liveRegion={jobs === undefined ? 'assertive' : 'polite'}
        />
      ) : null}
      {(jobs ?? []).map((job) => (
        <SpotifyImportJobRow
          key={job.id}
          job={job}
          selected={job.id === selectedId}
          removing={job.id === removingId}
          onSelect={() => onSelect(job)}
          onRemove={() => onRemove(job)}
        />
      ))}
    </View>
  );
}

/** The selected import while it is still queued or running. */
export function SpotifyImportProgress({ job }: { job: ImportJobStatus }) {
  const title = job.name || strings.search.importReadingLink;
  return (
    <Surface testID="spotify-import-progress" padded style={styles.panel}>
      <View style={styles.identity}>
        <Artwork uri={job.image} size={layout.artwork.lg} icon="playlist-music" />
        <View style={styles.copy}>
          <AppText variant="overline" color="accent">
            {job.type === '' ? strings.search.importInputLabel : strings.search.importType[job.type]}
          </AppText>
          <AppText variant="section" accessibilityRole="header" numberOfLines={3}>
            {title}
          </AppText>
          {job.name === '' ? (
            <AppText variant="caption" color="muted" numberOfLines={1}>{job.url}</AppText>
          ) : null}
        </View>
      </View>
      <View accessibilityLiveRegion="polite" style={styles.status}>
        <AppText variant="bodyStrong">{importJobSummary(job)}</AppText>
        <ProgressBar testID="spotify-import-progress-bar" percent={importJobProgressPercent(job)} />
      </View>
      <AppText variant="callout" color="secondary">{strings.search.importBackgroundHint}</AppText>
    </Surface>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: spacing.md },
  heading: { paddingHorizontal: layout.pagePadding, paddingBottom: spacing.xs },
  loading: { paddingVertical: spacing.md, alignItems: 'center' },
  row: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: layout.pagePadding,
    paddingRight: spacing.xs,
  },
  rowSelected: { backgroundColor: colors.fill },
  rowMain: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  pressed: { opacity: opacity.pressed },
  track: {
    height: 4,
    borderRadius: radii.xs,
    overflow: 'hidden',
    backgroundColor: colors.fillStrong,
  },
  fill: { height: '100%', borderRadius: radii.xs, backgroundColor: colors.accent },
  panel: { marginHorizontal: layout.pagePadding, marginTop: spacing.md, gap: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  status: { gap: spacing.xs },
});
