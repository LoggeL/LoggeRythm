import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminStorageInfo } from '../../api/types';
import { musicMutations, musicQueries, queryKeys } from '../../data';
import { resolveRemoteVisualState, type RemoteFetchStatus } from '../../data/remoteState';
import { strings } from '../../localization';
import { colors, layout, radii, spacing } from '../../theme';
import { RemoteNoticeView } from '../RemoteNoticeView';
import { ActionButton, AppText, BottomSheet, ErrorState, IconButton, Skeleton } from '../ui';
import { formatAdminBytes, formatAdminErrorDetail } from './adminFormat';

export interface AdminStorageSectionViewProps {
  data: AdminStorageInfo | undefined;
  pending: boolean;
  fetching: boolean;
  fetchStatus: RemoteFetchStatus;
  stale: boolean;
  error: unknown;
  confirmingCleanup: boolean;
  cleaning: boolean;
  feedback: string | null;
  cleanupError: string | null;
  onRefresh: () => void;
  onOpenCleanup: () => void;
  onCloseCleanup: () => void;
  onConfirmCleanup: () => void;
}

export function AdminStorageSectionView({
  data,
  pending,
  fetching,
  fetchStatus,
  stale,
  error,
  confirmingCleanup,
  cleaning,
  feedback,
  cleanupError,
  onRefresh,
  onOpenCleanup,
  onCloseCleanup,
  onConfirmCleanup,
}: AdminStorageSectionViewProps) {
  const visual = resolveRemoteVisualState({
    hasData: data !== undefined,
    empty: false,
    pending,
    fetching,
    stale,
    fetchStatus,
    error,
  });
  const failure =
    visual.body === 'offline' ? 'offline' : visual.body === 'hard-error' ? 'error' : null;
  const usedPct =
    data && data.disk_total > 0 ? Math.min(100, (data.disk_used / data.disk_total) * 100) : null;

  return (
    <View testID="profile-admin-storage" style={styles.root}>
      <View style={styles.header}>
        <AppText variant="callout" color="secondary" style={styles.flexCopy}>
          {data
            ? data.retention_days > 0
              ? strings.admin.storageSection.retentionAuto(data.retention_days)
              : strings.admin.storageSection.retentionManual
            : strings.admin.loading}
        </AppText>
        <IconButton
          testID="profile-admin-storage-refresh"
          icon="refresh"
          size="sm"
          variant="tonal"
          busy={fetching}
          accessibilityLabel={strings.admin.refresh}
          onPress={onRefresh}
        />
      </View>

      {feedback !== null ? (
        <AppText
          testID="profile-admin-storage-feedback"
          variant="callout"
          color="success"
          accessibilityLiveRegion="polite"
        >
          {feedback}
        </AppText>
      ) : null}
      {cleanupError !== null && !confirmingCleanup ? (
        <AppText
          testID="profile-admin-storage-cleanup-error"
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {cleanupError}
        </AppText>
      ) : null}

      {visual.body === 'loading' ? (
        <View
          testID="profile-admin-storage-loading"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.admin.loading}
          style={styles.skeleton}
        >
          <View style={styles.grid}>
            <Skeleton height={72} radius="card" style={styles.tileSkeleton} />
            <Skeleton height={72} radius="card" style={styles.tileSkeleton} />
          </View>
          <Skeleton height={44} radius="card" />
        </View>
      ) : null}

      {failure !== null ? (
        <ErrorState
          testID={`profile-admin-storage-${failure}`}
          retryTestID="profile-admin-storage-retry"
          kind={failure}
          message={
            failure === 'offline'
              ? strings.admin.offline
              : strings.admin.loadFailed(formatAdminErrorDetail(error))
          }
          onRetry={onRefresh}
          retryBusy={fetching}
          retryAccessibilityLabel={strings.admin.refresh}
          style={styles.flatError}
        />
      ) : null}

      <RemoteNoticeView
        notice={visual.notice}
        testIDPrefix="profile-admin-storage"
        retryTestID={() => 'profile-admin-storage-notice-retry'}
        copy={{
          cachedOffline: strings.admin.cachedOffline,
          cachedRefreshFailed: strings.admin.cachedRefreshFailed,
          refreshing: strings.admin.refreshing,
          stale: strings.admin.stale,
        }}
        retryAccessibilityLabel={strings.admin.refresh}
        busy={fetching}
        onRetry={onRefresh}
      />

      {visual.body === 'content' && data ? (
        <View testID="profile-admin-storage-content" style={styles.content}>
          <View style={styles.grid}>
            <View style={styles.tile}>
              <AppText variant="caption" color="muted">
                {strings.admin.storageSection.tracksLabel}
              </AppText>
              <AppText variant="title">{data.track_count}</AppText>
            </View>
            <View style={styles.tile}>
              <AppText variant="caption" color="muted">
                {strings.admin.storageSection.audioBytesLabel}
              </AppText>
              <AppText variant="title">{formatAdminBytes(data.total_bytes)}</AppText>
            </View>
          </View>

          <View style={styles.grid}>
            <View style={styles.tile}>
              <AppText variant="caption" color="muted">
                {strings.admin.storageSection.diskFreeLabel}
              </AppText>
              <AppText variant="title">{formatAdminBytes(data.disk_free)}</AppText>
            </View>
            <View style={styles.tile}>
              <AppText variant="caption" color="muted">
                {strings.admin.storageSection.diskTotalLabel}
              </AppText>
              <AppText variant="title">{formatAdminBytes(data.disk_total)}</AppText>
            </View>
          </View>

          {usedPct !== null ? (
            <View style={styles.barSection}>
              <View
                testID="profile-admin-storage-progress"
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(usedPct) }}
                style={styles.barTrack}
              >
                <View
                  style={[
                    usedPct >= 90 ? styles.barDanger : styles.barAccent,
                    { flex: usedPct },
                  ]}
                />
                {usedPct < 100 ? <View style={{ flex: 100 - usedPct }} /> : null}
              </View>
              <AppText variant="caption" color="muted">
                {strings.admin.storageSection.diskUsageSummary(
                  formatAdminBytes(data.disk_used),
                  formatAdminBytes(data.disk_total),
                  formatAdminBytes(data.disk_free),
                )}
              </AppText>
            </View>
          ) : null}

          <ActionButton
            testID="profile-admin-storage-cleanup"
            variant="secondary"
            icon="broom"
            label={strings.admin.storageSection.cleanupAction}
            disabled={cleaning}
            fullWidth
            onPress={onOpenCleanup}
          />
        </View>
      ) : null}

      <BottomSheet
        testID="profile-admin-storage-cleanup-sheet"
        visible={confirmingCleanup}
        onClose={() => {
          if (!cleaning) onCloseCleanup();
        }}
        closeLabel={strings.common.cancel}
        title={strings.admin.storageSection.cleanupTitle}
        contentStyle={styles.sheet}
      >
        <AppText color="secondary">{strings.admin.storageSection.cleanupWarning}</AppText>
        {cleanupError !== null ? (
          <AppText
            testID="profile-admin-storage-sheet-error"
            variant="callout"
            color="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {cleanupError}
          </AppText>
        ) : null}
        <ActionButton
          testID="profile-admin-storage-cleanup-confirm"
          variant="danger"
          icon="broom"
          label={
            cleaning
              ? strings.admin.storageSection.cleaning
              : strings.admin.storageSection.cleanupConfirm
          }
          busy={cleaning}
          disabled={cleaning}
          fullWidth
          onPress={onConfirmCleanup}
        />
        <ActionButton
          testID="profile-admin-storage-cleanup-cancel"
          variant="secondary"
          label={strings.common.cancel}
          disabled={cleaning}
          fullWidth
          onPress={onCloseCleanup}
        />
      </BottomSheet>
    </View>
  );
}

export interface AdminStorageSectionProps {
  scope: string;
}

export function AdminStorageSection({ scope }: AdminStorageSectionProps) {
  const queryClient = useQueryClient();
  const storageQuery = useQuery(musicQueries.adminStorage(scope));
  const cleanupMutation = useMutation(musicMutations.cleanupAdminStorage(scope));
  const [confirmingCleanup, setConfirmingCleanup] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  const handleConfirmCleanup = () => {
    setCleanupError(null);
    setFeedback(null);
    cleanupMutation.mutate(undefined, {
      onSuccess: (result) => {
        setConfirmingCleanup(false);
        setFeedback(
          result.removed > 0
            ? strings.admin.storageSection.cleanupDone(
                result.removed,
                formatAdminBytes(result.freed_bytes),
              )
            : strings.admin.storageSection.cleanupNothing,
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.admin.root(scope) });
      },
      onError: (error) => {
        setCleanupError(strings.admin.storageSection.cleanupFailed(formatAdminErrorDetail(error)));
      },
    });
  };

  return (
    <AdminStorageSectionView
      data={storageQuery.data}
      pending={storageQuery.isPending}
      fetching={storageQuery.isFetching}
      fetchStatus={storageQuery.fetchStatus}
      stale={storageQuery.isStale}
      error={storageQuery.error}
      confirmingCleanup={confirmingCleanup}
      cleaning={cleanupMutation.isPending}
      feedback={feedback}
      cleanupError={cleanupError}
      onRefresh={() => void storageQuery.refetch()}
      onOpenCleanup={() => {
        setCleanupError(null);
        setConfirmingCleanup(true);
      }}
      onCloseCleanup={() => {
        setCleanupError(null);
        setConfirmingCleanup(false);
      }}
      onConfirmCleanup={handleConfirmCleanup}
    />
  );
}

const styles = StyleSheet.create({
  root: { gap: layout.stackGap },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flexCopy: { flex: 1, minWidth: 0 },
  skeleton: { gap: spacing.sm },
  tileSkeleton: { flex: 1 },
  flatError: { padding: 0, borderWidth: 0, backgroundColor: 'transparent' },
  content: { gap: layout.stackGap },
  grid: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs / 2,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  barSection: { gap: spacing.xxs },
  barTrack: {
    height: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: colors.fill,
  },
  barAccent: { backgroundColor: colors.accent },
  barDanger: { backgroundColor: colors.danger },
  sheet: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.xxs },
});
