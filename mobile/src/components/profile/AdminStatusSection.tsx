import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { AdminStatus } from '../../api/types';
import { musicQueries } from '../../data';
import { resolveRemoteVisualState, type RemoteFetchStatus } from '../../data/remoteState';
import { strings } from '../../localization';
import { colors, layout, radii, spacing } from '../../theme';
import { RemoteNoticeView } from '../RemoteNoticeView';
import { ActionButton, AppText, ErrorState, IconButton, Skeleton } from '../ui';
import { formatAdminBytes, formatAdminErrorDetail, type AdminHubTab } from './adminFormat';

export interface AdminStatusSectionViewProps {
  data: AdminStatus | undefined;
  pending: boolean;
  fetching: boolean;
  fetchStatus: RemoteFetchStatus;
  stale: boolean;
  error: unknown;
  onRefresh: () => void;
  onNavigateTab: (tab: AdminHubTab) => void;
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  return (
    <View style={[styles.badge, styles[`badge_${tone}`]]}>
      <AppText
        variant="micro"
        color={
          tone === 'success'
            ? 'success'
            : tone === 'warning'
              ? 'warning'
              : tone === 'danger'
                ? 'danger'
                : 'secondary'
        }
      >
        {label}
      </AppText>
    </View>
  );
}

function StatusCard({
  testID,
  title,
  children,
}: {
  testID: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View testID={testID} style={styles.card}>
      <AppText variant="overline" color="muted" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function StatusRow({
  label,
  value,
  badge,
}: {
  label: string;
  value?: string;
  badge?: { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };
}) {
  return (
    <View style={styles.row}>
      <AppText variant="callout" color="secondary" style={styles.flexCopy}>
        {label}
      </AppText>
      {value !== undefined ? <AppText variant="label">{value}</AppText> : null}
      {badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : null}
    </View>
  );
}

export function AdminStatusSectionView({
  data,
  pending,
  fetching,
  fetchStatus,
  stale,
  error,
  onRefresh,
  onNavigateTab,
}: AdminStatusSectionViewProps) {
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
  const copy = strings.admin.statusSection;

  return (
    <View testID="profile-admin-status" style={styles.root}>
      <View style={styles.header}>
        <AppText variant="overline" color="muted" accessibilityRole="header" style={styles.flexCopy}>
          {strings.admin.tabs.status}
        </AppText>
        <IconButton
          testID="profile-admin-status-refresh"
          icon="refresh"
          size="sm"
          variant="tonal"
          busy={fetching}
          accessibilityLabel={strings.admin.refresh}
          onPress={onRefresh}
        />
      </View>

      {visual.body === 'loading' ? (
        <View
          testID="profile-admin-status-loading"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.admin.loading}
          style={styles.skeleton}
        >
          <Skeleton height={84} radius="card" />
          <Skeleton height={84} radius="card" />
          <Skeleton height={84} radius="card" />
        </View>
      ) : null}

      {failure !== null ? (
        <ErrorState
          testID={`profile-admin-status-${failure}`}
          retryTestID="profile-admin-status-retry"
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
        testIDPrefix="profile-admin-status"
        retryTestID={() => 'profile-admin-status-notice-retry'}
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
        <View testID="profile-admin-status-content" style={styles.cards}>
          <StatusCard testID="profile-admin-status-deezer" title={copy.deezerTitle}>
            <StatusRow
              label={copy.deezerArl}
              badge={
                !data.deezer.arl_configured
                  ? { label: copy.missing, tone: 'danger' }
                  : data.deezer.arl_ok
                    ? { label: copy.ok, tone: 'success' }
                    : { label: copy.error, tone: 'danger' }
              }
            />
            <StatusRow label={copy.deezerQuality} value={data.deezer.quality.toUpperCase()} />
          </StatusCard>

          <StatusCard testID="profile-admin-status-users" title={copy.usersTitle}>
            <StatusRow
              label={strings.admin.usage.kpiUsers}
              value={String(data.users.total)}
            />
            <AppText variant="caption" color="secondary">
              {copy.usersSummary(data.users.approved, data.users.pending, data.users.admins)}
            </AppText>
            {data.users.pending > 0 ? (
              <ActionButton
                testID="profile-admin-status-open-users"
                variant="secondary"
                label={strings.admin.usersSection.pendingBadge(data.users.pending)}
                onPress={() => onNavigateTab('users')}
              />
            ) : null}
          </StatusCard>

          <StatusCard testID="profile-admin-status-storage" title={copy.storageTitle}>
            <StatusRow
              label={strings.admin.storageSection.audioBytesLabel}
              value={`${data.storage.track_count} · ${formatAdminBytes(data.storage.total_bytes)}`}
            />
            <AppText variant="caption" color="secondary">
              {strings.admin.storageSection.diskUsageSummary(
                formatAdminBytes(data.storage.disk_used),
                formatAdminBytes(data.storage.disk_total),
                formatAdminBytes(data.storage.disk_free),
              )}
            </AppText>
            <ActionButton
              testID="profile-admin-status-open-storage"
              variant="secondary"
              label={strings.admin.tabs.storage}
              onPress={() => onNavigateTab('storage')}
            />
          </StatusCard>

          <StatusCard testID="profile-admin-status-content-counts" title={copy.contentTitle}>
            <View style={styles.contentGrid}>
              {[
                { label: copy.contentPlaylists, value: String(data.content.playlists) },
                { label: copy.contentLikes, value: String(data.content.likes) },
                { label: copy.contentFollows, value: String(data.content.follows) },
                { label: copy.contentPlays, value: String(data.content.plays) },
                { label: copy.contentLyrics, value: String(data.content.stored_lyrics) },
                { label: copy.contentParties, value: String(data.content.parties) },
                {
                  label: copy.contentInvites,
                  value: `${data.content.invites_used}/${data.content.invites_total}`,
                },
              ].map((item) => (
                <View key={item.label} style={styles.contentChip}>
                  <AppText variant="micro" color="muted">{item.label}</AppText>
                  <AppText variant="label">{item.value}</AppText>
                </View>
              ))}
            </View>
          </StatusCard>

          <StatusCard testID="profile-admin-status-integrations" title={copy.integrationsTitle}>
            <StatusRow
              label={copy.spotify}
              badge={{
                label: data.integrations.spotify_configured ? copy.configured : copy.missing,
                tone: data.integrations.spotify_configured ? 'success' : 'neutral',
              }}
            />
            <StatusRow
              label={copy.lastfm}
              badge={{
                label: data.integrations.lastfm_configured ? copy.configured : copy.missing,
                tone: data.integrations.lastfm_configured ? 'success' : 'neutral',
              }}
            />
          </StatusCard>

          <StatusCard testID="profile-admin-status-system" title={copy.systemTitle}>
            <StatusRow label={copy.environment} value={data.system.app_env} />
            <StatusRow label={copy.database} value={data.system.database} />
            <StatusRow
              label={copy.jwtSecure}
              badge={{
                label: data.system.jwt_secure ? copy.secure : copy.insecure,
                tone: data.system.jwt_secure ? 'success' : 'warning',
              }}
            />
            <StatusRow
              label={copy.cookieSecure}
              badge={{
                label: data.system.cookie_secure ? copy.secure : copy.insecure,
                tone: data.system.cookie_secure ? 'success' : 'warning',
              }}
            />
          </StatusCard>
        </View>
      ) : null}
    </View>
  );
}

export interface AdminStatusSectionProps {
  scope: string;
  onNavigateTab: (tab: AdminHubTab) => void;
}

export function AdminStatusSection({ scope, onNavigateTab }: AdminStatusSectionProps) {
  const statusQuery = useQuery(musicQueries.adminStatus(scope));
  return (
    <AdminStatusSectionView
      data={statusQuery.data}
      pending={statusQuery.isPending}
      fetching={statusQuery.isFetching}
      fetchStatus={statusQuery.fetchStatus}
      stale={statusQuery.isStale}
      error={statusQuery.error}
      onRefresh={() => void statusQuery.refetch()}
      onNavigateTab={onNavigateTab}
    />
  );
}

const styles = StyleSheet.create({
  root: { gap: layout.stackGap },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flexCopy: { flex: 1, minWidth: 0 },
  skeleton: { gap: spacing.sm },
  flatError: { padding: 0, borderWidth: 0, backgroundColor: 'transparent' },
  cards: { gap: spacing.sm },
  card: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { paddingVertical: 2, paddingHorizontal: spacing.xs, borderRadius: radii.pill },
  badge_success: { backgroundColor: colors.successSubtle },
  badge_warning: { backgroundColor: colors.warningSubtle },
  badge_danger: { backgroundColor: colors.dangerSubtle },
  badge_neutral: { backgroundColor: colors.fillStrong },
  contentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  contentChip: {
    minWidth: '30%',
    flexGrow: 1,
    gap: 2,
    padding: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
});
