import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, metrics } from '../../theme';

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

interface ActionButtonProps {
  testID: string;
  label: string;
  tone: 'primary' | 'secondary' | 'danger';
  disabled: boolean;
  busy: boolean;
  onPress(): void;
}

function ActionButton({
  testID,
  label,
  tone,
  disabled,
  busy,
  onPress,
}: ActionButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        tone === 'primary' && styles.primaryAction,
        tone === 'secondary' && styles.secondaryAction,
        tone === 'danger' && styles.dangerAction,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          accessible={false}
          color={tone === 'primary' ? colors.onAccent : colors.textSecondary}
          size="small"
        />
      ) : null}
      <Text
        accessible={false}
        style={[
          styles.actionText,
          tone === 'primary' && styles.primaryActionText,
          tone === 'danger' && styles.dangerActionText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface ProgressBarProps {
  percent: number;
}

function ProgressBar({ percent }: ProgressBarProps) {
  return (
    <View accessible={false} style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percent}%` }]} />
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
        style={[
          styles.status,
          state.kind === 'error' && styles.errorStatus,
          state.kind === 'partial' && styles.partialStatus,
          state.kind === 'downloaded' && styles.downloadedStatus,
        ]}
      >
        <View style={styles.statusLine}>
          {busy ? (
            <ActivityIndicator
              accessible={false}
              color={state.kind === 'downloading' ? colors.accent : colors.textSecondary}
              size="small"
            />
          ) : null}
          <Text
            accessible={false}
            style={[
              styles.statusText,
              state.kind === 'error' && styles.errorText,
              state.kind === 'partial' && styles.partialText,
              state.kind === 'downloaded' && styles.downloadedText,
            ]}
          >
            {statusText}
          </Text>
        </View>
        {progress !== null && progress.totalTracks > 0 ? (
          <ProgressBar percent={progress.percent} />
        ) : null}
      </View>

      <View testID={`${testID}-actions`} style={styles.actions}>
        {state.kind === 'idle' ? (
          <ActionButton
            testID={`${testID}-download`}
            label={copy.downloadAction}
            tone="primary"
            disabled={disabled}
            busy={false}
            onPress={onDownload}
          />
        ) : null}

        {state.kind === 'downloading' ? (
          <ActionButton
            testID={`${testID}-download`}
            label={copy.downloadingAction}
            tone="primary"
            disabled={actionDisabled}
            busy
            onPress={onDownload}
          />
        ) : null}

        {state.kind === 'partial' || state.kind === 'error' ? (
          <ActionButton
            testID={`${testID}-retry`}
            label={copy.retryAction}
            tone="primary"
            disabled={actionDisabled}
            busy={false}
            onPress={onRetry}
          />
        ) : null}

        {(state.kind === 'partial'
          || state.kind === 'downloaded'
          || state.kind === 'removing'
          || (state.kind === 'error' && progress !== null && progress.completedTracks > 0)) ? (
            <ActionButton
              testID={`${testID}-remove`}
              label={state.kind === 'removing' ? copy.removingAction : copy.removeAction}
              tone={state.kind === 'removing' ? 'secondary' : 'danger'}
              disabled={actionDisabled}
              busy={state.kind === 'removing'}
              onPress={onRemove}
            />
          ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  status: {
    gap: 9,
    padding: 11,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  errorStatus: { borderWidth: 1, borderColor: colors.danger },
  partialStatus: { borderWidth: 1, borderColor: colors.warning },
  downloadedStatus: { borderWidth: 1, borderColor: colors.success },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusText: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  errorText: { color: colors.danger },
  partialText: { color: colors.warning },
  downloadedText: { color: colors.success },
  progressTrack: {
    height: 5,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  progressFill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  action: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 24,
  },
  primaryAction: { borderColor: colors.accent, backgroundColor: colors.accent },
  secondaryAction: { borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  dangerAction: { borderColor: colors.danger, backgroundColor: colors.surfaceElevated },
  actionText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  primaryActionText: { color: colors.onAccent },
  dangerActionText: { color: colors.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
});
