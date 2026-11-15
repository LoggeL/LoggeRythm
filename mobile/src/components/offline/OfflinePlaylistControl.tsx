import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import { ActionButton, AppText, type AppTextColor } from '../ui';

export interface OfflinePlaylistProgress {
  completedTracks: number;
  totalTracks: number;
  failedTracks: number;
}

export interface OfflinePlaylistProgressView extends OfflinePlaylistProgress {
  percent: number;
}

export type OfflinePlaylistControlState =
  | { kind: 'unavailable' }
  | { kind: 'idle' }
  | {
    kind: 'downloading' | 'partial' | 'downloaded' | 'removing' | 'error';
    progress: OfflinePlaylistProgress;
  };

/**
 * Every user-visible string is injected so this view remains independent of
 * the active runtime locale. Progress callbacks receive a sanitized snapshot.
 */
export interface OfflinePlaylistControlCopy {
  unavailable: string;
  idle: string;
  downloading(progress: OfflinePlaylistProgressView): string;
  partial(progress: OfflinePlaylistProgressView): string;
  downloaded(progress: OfflinePlaylistProgressView): string;
  removing(progress: OfflinePlaylistProgressView): string;
  error(progress: OfflinePlaylistProgressView): string;
  progress(progress: OfflinePlaylistProgressView): string;
  downloadAction: string;
  downloadingAction: string;
  retryAction: string;
  removeAction: string;
  removingAction: string;
}

export interface OfflinePlaylistControlProps {
  state: OfflinePlaylistControlState;
  copy: OfflinePlaylistControlCopy;
  onDownload(): void;
  onRetry(): void;
  onRemove(): void;
  /** Disables user-initiated actions without presenting an operation as busy. */
  disabled?: boolean;
  testID?: string;
}

function finiteWhole(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function normalizeOfflinePlaylistProgress(
  progress: OfflinePlaylistProgress,
): OfflinePlaylistProgressView {
  const totalTracks = finiteWhole(progress.totalTracks);
  const completedTracks = Math.min(finiteWhole(progress.completedTracks), totalTracks);
  const failedTracks = Math.min(
    finiteWhole(progress.failedTracks),
    Math.max(0, totalTracks - completedTracks),
  );
  return {
    completedTracks,
    totalTracks,
    failedTracks,
    percent: totalTracks === 0 ? 0 : Math.round((completedTracks / totalTracks) * 100),
  };
}

const PROGRESS_HEIGHT = 6;

type StatusKind = OfflinePlaylistControlState['kind'];

/** Idle/unavailable are neutral; every other state names its outcome by colour and glyph. */
const statusLook: Record<StatusKind, { icon: AppIconName; glyph: string; text: AppTextColor }> = {
  unavailable: { icon: 'cloud-off-outline', glyph: colors.textMuted, text: 'secondary' },
  idle: { icon: 'download-circle-outline', glyph: colors.textSecondary, text: 'secondary' },
  downloading: { icon: 'download-circle-outline', glyph: colors.accentSoft, text: 'primary' },
  partial: { icon: 'alert-circle-outline', glyph: colors.warning, text: 'warning' },
  downloaded: { icon: 'check-circle', glyph: colors.success, text: 'success' },
  removing: { icon: 'delete-outline', glyph: colors.textSecondary, text: 'secondary' },
  error: { icon: 'alert-circle-outline', glyph: colors.danger, text: 'danger' },
};

interface ProgressBarProps {
  percent: number;
  kind: StatusKind;
}

function ProgressBar({ percent, kind }: ProgressBarProps) {
  const fill = kind === 'downloaded'
    ? colors.success
    : kind === 'partial'
      ? colors.warning
      : kind === 'error'
        ? colors.danger
        : colors.accent;
  return (
    <View accessible={false} style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: fill }]} />
    </View>
  );
}

/** A reusable view only: all storage, network, and mutation ownership stays outside. */
export default function OfflinePlaylistControl({
  state,
  copy,
  onDownload,
  onRetry,
  onRemove,
  disabled = false,
  testID = 'offline-playlist-control',
}: OfflinePlaylistControlProps) {
  const busy = state.kind === 'downloading' || state.kind === 'removing';
  const progress = state.kind === 'unavailable' || state.kind === 'idle'
    ? null
    : normalizeOfflinePlaylistProgress(state.progress);

  let statusText: string;
  switch (state.kind) {
    case 'unavailable':
      statusText = copy.unavailable;
      break;
    case 'idle':
      statusText = copy.idle;
      break;
    case 'downloading':
      statusText = copy.downloading(progress!);
      break;
    case 'partial':
      statusText = copy.partial(progress!);
      break;
    case 'downloaded':
      statusText = copy.downloaded(progress!);
      break;
    case 'removing':
      statusText = copy.removing(progress!);
      break;
    case 'error':
      statusText = copy.error(progress!);
      break;
  }

  const actionDisabled = disabled || busy;
  const statusRole = state.kind === 'error'
    ? 'alert'
    : busy
      ? 'progressbar'
      : 'text';
  const look = statusLook[state.kind];
  const removable = state.kind === 'partial'
    || state.kind === 'downloaded'
    || state.kind === 'removing'
    || (state.kind === 'error' && progress !== null && progress.completedTracks > 0);

  return (
    <View testID={testID} style={styles.container}>
      <View
        testID={`${testID}-status`}
        accessibilityRole={statusRole}
        accessibilityLabel={statusText}
        accessibilityLiveRegion={state.kind === 'error' ? 'assertive' : 'polite'}
        accessibilityState={busy ? { busy: true } : undefined}
        accessibilityValue={progress === null ? undefined : {
          min: 0,
          max: Math.max(1, progress.totalTracks),
          now: progress.completedTracks,
          text: copy.progress(progress),
        }}
        style={styles.status}
      >
        <View style={styles.statusLine}>
          {busy ? (
            <ActivityIndicator accessible={false} color={look.glyph} size="small" />
          ) : (
            <AppIcon name={look.icon} color={look.glyph} size={22} />
          )}
          <AppText accessible={false} variant="callout" color={look.text} style={styles.statusText}>
            {statusText}
          </AppText>
        </View>
        {progress !== null && progress.totalTracks > 0 ? (
          <ProgressBar percent={progress.percent} kind={state.kind} />
        ) : null}
      </View>

      <View testID={`${testID}-actions`} style={styles.actions}>
        {state.kind === 'idle' ? (
          <ActionButton
            testID={`${testID}-download`}
            label={copy.downloadAction}
            icon="download"
            disabled={disabled}
            onPress={onDownload}
            style={styles.action}
          />
        ) : null}

        {state.kind === 'downloading' ? (
          <ActionButton
            testID={`${testID}-download`}
            label={copy.downloadingAction}
            busy
            disabled={actionDisabled}
            onPress={onDownload}
            style={styles.action}
          />
        ) : null}

        {state.kind === 'partial' || state.kind === 'error' ? (
          <ActionButton
            testID={`${testID}-retry`}
            label={copy.retryAction}
            icon="refresh"
            disabled={actionDisabled}
            onPress={onRetry}
            style={styles.action}
          />
        ) : null}

        {removable ? (
          <ActionButton
            testID={`${testID}-remove`}
            label={state.kind === 'removing' ? copy.removingAction : copy.removeAction}
            icon="delete-outline"
            variant={state.kind === 'removing' ? 'secondary' : 'danger'}
            disabled={actionDisabled}
            busy={state.kind === 'removing'}
            onPress={onRemove}
            style={styles.action}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  status: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { flex: 1 },
  progressTrack: {
    height: PROGRESS_HEIGHT,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.fillStrong,
  },
  progressFill: { height: PROGRESS_HEIGHT, borderRadius: radii.pill },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  action: { flexGrow: 1 },
});
