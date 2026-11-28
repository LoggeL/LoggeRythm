import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  AdminUsageOverviewResponse,
  AdminUsageRange,
  AdminUserUsageSummary,
} from '../../api/types';
import { resolveServerUrl } from '../../api/url';
import { musicQueries } from '../../data';
import { resolveRemoteVisualState, type RemoteFetchStatus } from '../../data/remoteState';
import { strings } from '../../localization';
import { profileInitials } from '../../screens/profileModel';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { RemoteNoticeView } from '../RemoteNoticeView';
import { AppText, Artwork, EmptyState, ErrorState, FilterChip, IconButton, Skeleton } from '../ui';
import {
  ADMIN_USAGE_RANGES,
  ADMIN_USAGE_SORT_KEYS,
  adminUserLabel,
  computeAdminOverviewStorageShares,
  computeAdminUserStorageShares,
  formatAdminBytes,
  formatAdminDuration,
  formatAdminErrorDetail,
  formatAdminRelativeTimestamp,
  formatAdminShortDate,
  sortAdminUsageUsers,
  type AdminUsageSortKey,
} from './adminFormat';
import { AdminUserUsageSheet } from './AdminUserUsageSheet';

export interface AdminUsageSectionViewProps {
  apiBase: string;
  range: AdminUsageRange;
  sortKey: AdminUsageSortKey;
  data: AdminUsageOverviewResponse | undefined;
  pending: boolean;
  fetching: boolean;
  fetchStatus: RemoteFetchStatus;
  stale: boolean;
  error: unknown;
  onRangeChange: (next: AdminUsageRange) => void;
  onSortChange: (next: AdminUsageSortKey) => void;
  onRefresh: () => void;
  onSelectUser: (user: AdminUserUsageSummary) => void;
}

function userAvatarUri(avatarUrl: string | null, apiBase: string): string | null {
  if (!avatarUrl) return null;
  return resolveServerUrl(avatarUrl, apiBase);
}

function UsageSkeleton() {
  return (
    <View
      testID="profile-admin-usage-loading"
      accessibilityRole="progressbar"
      accessibilityLabel={strings.admin.loading}
      accessibilityLiveRegion="polite"
      style={styles.skeleton}
    >
      <View style={styles.kpiGrid}>
        <Skeleton height={84} radius="card" style={styles.kpiSkeleton} />
        <Skeleton height={84} radius="card" style={styles.kpiSkeleton} />
      </View>
      <View style={styles.kpiGrid}>
        <Skeleton height={84} radius="card" style={styles.kpiSkeleton} />
        <Skeleton height={84} radius="card" style={styles.kpiSkeleton} />
      </View>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} height={76} radius="card" />
      ))}
    </View>
  );
}

function KpiCard({
  testID,
  label,
  value,
  sublabel,
}: {
  testID: string;
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <View testID={testID} style={styles.kpiCard}>
      <AppText variant="caption" color="muted" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="title" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" color="secondary" numberOfLines={2}>
        {sublabel}
      </AppText>
    </View>
  );
}

function UserUsageRow({
  user,
  apiBase,
  totalAudioBytes,
  onPress,
}: {
  user: AdminUserUsageSummary;
  apiBase: string;
  totalAudioBytes: number;
  onPress: () => void;
}) {
  const name = adminUserLabel(user);
  const avatarUri = userAvatarUri(user.avatar_url, apiBase);
  const shares = computeAdminUserStorageShares(user.storage, totalAudioBytes);
  const liveLabel = user.is_playing_now
    ? strings.admin.usage.livePlaying(user.active_device_name)
    : user.online_devices > 0
      ? strings.admin.usage.liveOnline(user.online_devices)
      : null;

  return (
    <Pressable
      testID={`profile-admin-usage-user-${user.id}`}
      accessibilityRole="button"
      accessibilityLabel={strings.admin.usage.openUserDetail(name)}
      onPress={onPress}
      style={({ pressed }) => [styles.userRow, pressed ? styles.pressed : null]}
    >
      <View style={styles.userHeader}>
        {avatarUri ? (
          <Artwork
            uri={avatarUri}
            size={layout.artwork.xs}
            shape="round"
            icon="account"
            accessibilityLabel={name}
          />
        ) : (
          <View accessible={false} style={styles.avatarInitials}>
            <AppText variant="label" color="accent">
              {profileInitials(user.display_name, user.email)}
            </AppText>
          </View>
        )}
        <View style={styles.userCopy}>
          <View style={styles.userTitleRow}>
            <AppText variant="bodyStrong" numberOfLines={1} style={styles.userName}>
              {name}
            </AppText>
            {user.is_admin ? (
              <View style={[styles.pill, styles.pillAccent]}>
                <AppText variant="micro" color="accent">{strings.admin.usage.roleAdmin}</AppText>
              </View>
            ) : null}
            {!user.is_approved ? (
              <View style={[styles.pill, styles.pillWarning]}>
                <AppText variant="micro" color="warning">
                  {strings.admin.usage.statusPending}
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText variant="caption" color="secondary" numberOfLines={1}>
            {user.email}
          </AppText>
        </View>
        <AppIcon name="chevron-right" size={20} color={colors.textMuted} />
      </View>

      {liveLabel !== null ? (
        <View
          testID={`profile-admin-usage-user-live-${user.id}`}
          style={[styles.liveRow, user.is_playing_now ? styles.liveRowPlaying : null]}
        >
          <AppIcon
            name={user.is_playing_now ? 'play-circle-outline' : 'radiobox-marked'}
            size={14}
            color={user.is_playing_now ? colors.brand : colors.success}
          />
          <AppText
            variant="micro"
            color={user.is_playing_now ? 'accent' : 'success'}
            numberOfLines={1}
          >
            {liveLabel}
          </AppText>
        </View>
      ) : null}

      <View style={styles.userMetrics}>
        <AppText variant="caption" color="primary">
          {strings.admin.usage.playsShort(user.plays, formatAdminDuration(user.listening_sec))}
        </AppText>
        <AppText variant="caption" color="secondary">
          {strings.admin.usage.requestsShort(user.tracks_requested, user.tracks_materialized)}
        </AppText>
        <AppText variant="caption" color="secondary">
          {strings.admin.usage.storageShort(
            formatAdminBytes(user.storage.exclusive_bytes),
            formatAdminBytes(user.storage.shared_bytes),
          )}
        </AppText>
        <AppText variant="caption" color="muted">
          {strings.admin.usage.lastActive(formatAdminRelativeTimestamp(user.last_active_at))}
        </AppText>
      </View>

      {totalAudioBytes > 0 ? (
        <View style={styles.miniBarTrack}>
          {shares.exclusivePct > 0 ? (
            <View style={[styles.barExclusive, { flex: shares.exclusivePct }]} />
          ) : null}
          {shares.sharedPct > 0 ? (
            <View style={[styles.barShared, { flex: shares.sharedPct }]} />
          ) : null}
          {shares.exclusivePct + shares.sharedPct < 100 ? (
            <View style={{ flex: Math.max(0, 100 - shares.exclusivePct - shares.sharedPct) }} />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function AdminUsageSectionView({
  apiBase,
  range,
  sortKey,
  data,
  pending,
  fetching,
  fetchStatus,
  stale,
  error,
  onRangeChange,
  onSortChange,
  onRefresh,
  onSelectUser,
}: AdminUsageSectionViewProps) {
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
  const sortedUsers = data ? sortAdminUsageUsers(data.users, sortKey) : [];
  const storageShares = data ? computeAdminOverviewStorageShares(data.overview.storage) : null;

  return (
    <View testID="profile-admin-usage" style={styles.root}>
      <View style={styles.toolbar}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={strings.admin.usage.rangeLabel}
          style={styles.rangeChips}
        >
          {ADMIN_USAGE_RANGES.map((candidate) => (
            <FilterChip
              key={candidate}
              testID={`profile-admin-usage-range-${candidate}`}
              label={strings.admin.usage.ranges[candidate]}
              selected={range === candidate}
              accessibilityRole="radio"
              onPress={() => onRangeChange(candidate)}
            />
          ))}
        </View>
        <IconButton
          testID="profile-admin-usage-refresh"
          icon="refresh"
          size="sm"
          variant="tonal"
          busy={fetching}
          accessibilityLabel={strings.admin.refresh}
          onPress={onRefresh}
        />
      </View>

      {visual.body === 'loading' ? <UsageSkeleton /> : null}
      {failure !== null ? (
        <ErrorState
          testID={`profile-admin-usage-${failure}`}
          retryTestID="profile-admin-usage-retry"
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
        testIDPrefix="profile-admin-usage"
        retryTestID={() => 'profile-admin-usage-notice-retry'}
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

      {visual.body === 'content' && data && storageShares ? (
        <View testID="profile-admin-usage-content" style={styles.content}>
          <View style={styles.kpiGrid}>
            <KpiCard
              testID="profile-admin-kpi-users"
              label={strings.admin.usage.kpiUsers}
              value={String(data.overview.total_users)}
              sublabel={strings.admin.usage.kpiUsersSub(
                data.overview.active_users,
                data.overview.pending_users,
              )}
            />
            <KpiCard
              testID="profile-admin-kpi-plays"
              label={strings.admin.usage.kpiPlays}
              value={String(data.overview.total_plays)}
              sublabel={`${formatAdminDuration(data.overview.total_listening_sec)} · ${strings.admin.usage.kpiUniqueTracks(data.overview.unique_tracks_played)}`}
            />
          </View>

          <View style={styles.kpiGrid}>
            <KpiCard
              testID="profile-admin-kpi-requests"
              label={strings.admin.usage.kpiRequested}
              value={String(data.overview.tracks_requested)}
              sublabel={strings.admin.usage.kpiMaterialized(
                data.overview.tracks_materialized,
                formatAdminBytes(data.overview.materialized_bytes),
              )}
            />
            <KpiCard
              testID="profile-admin-kpi-cache"
              label={strings.admin.usage.kpiCache}
              value={formatAdminBytes(data.overview.storage.total_audio_bytes)}
              sublabel={strings.admin.usage.kpiDiskFree(
                formatAdminBytes(data.overview.storage.disk_free),
                data.overview.storage.cached_tracks,
              )}
            />
          </View>

          <View testID="profile-admin-kpi-live" style={styles.liveSummaryCard}>
            <View style={styles.liveSummaryHeader}>
              <AppText variant="caption" color="muted">{strings.admin.usage.kpiLive}</AppText>
              <AppText variant="bodyStrong">
                {`${data.overview.online_connect_devices} · ${strings.admin.usage.kpiLiveSub(data.overview.online_connect_users, data.overview.active_parties)}`}
              </AppText>
            </View>
            {data.overview.storage.total_audio_bytes > 0 ? (
              <View style={styles.storageLegendWrap}>
                <View style={styles.barTrack}>
                  {storageShares.exclusivePct > 0 ? (
                    <View style={[styles.barExclusive, { flex: storageShares.exclusivePct }]} />
                  ) : null}
                  {storageShares.sharedPct > 0 ? (
                    <View style={[styles.barShared, { flex: storageShares.sharedPct }]} />
                  ) : null}
                  {storageShares.unattributedPct > 0 ? (
                    <View
                      style={[styles.barUnattributed, { flex: storageShares.unattributedPct }]}
                    />
                  ) : null}
                </View>
                <AppText variant="caption" color="muted">
                  {`${strings.admin.usage.storageExclusive}: ${formatAdminBytes(data.overview.storage.exclusive_audio_bytes)} · ${strings.admin.usage.storageShared}: ${formatAdminBytes(data.overview.storage.shared_audio_bytes)} · ${strings.admin.usage.storageUnattributed}: ${formatAdminBytes(data.overview.storage.unattributed_audio_bytes)}`}
                </AppText>
              </View>
            ) : null}
            <AppText testID="profile-admin-tracking-since" variant="caption" color="muted">
              {data.request_tracking_since !== null
                ? strings.admin.usage.trackingSince(formatAdminShortDate(data.request_tracking_since))
                : strings.admin.usage.noTrackingYet}
            </AppText>
          </View>

          <View style={styles.usersSection}>
            <AppText variant="overline" color="muted" accessibilityRole="header">
              {strings.admin.usage.usersTitle(sortedUsers.length)}
            </AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              accessibilityRole="radiogroup"
              accessibilityLabel={strings.admin.usage.sortLabel}
              contentContainerStyle={styles.sortChips}
            >
              {ADMIN_USAGE_SORT_KEYS.map((candidate) => (
                <FilterChip
                  key={candidate}
                  testID={`profile-admin-usage-sort-${candidate}`}
                  label={strings.admin.usage.sorts[candidate]}
                  selected={sortKey === candidate}
                  accessibilityRole="radio"
                  onPress={() => onSortChange(candidate)}
                />
              ))}
            </ScrollView>

            {sortedUsers.length === 0 ? (
              <EmptyState
                testID="profile-admin-usage-empty"
                icon="account-group-outline"
                title={strings.admin.usage.usersEmpty}
              />
            ) : (
              <View style={styles.userList}>
                {sortedUsers.map((entry) => (
                  <UserUsageRow
                    key={entry.id}
                    user={entry}
                    apiBase={apiBase}
                    totalAudioBytes={data.overview.storage.total_audio_bytes}
                    onPress={() => onSelectUser(entry)}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export interface AdminUsageSectionProps {
  scope: string;
  apiBase: string;
}

export function AdminUsageSection({ scope, apiBase }: AdminUsageSectionProps) {
  const [range, setRange] = useState<AdminUsageRange>('all');
  const [sortKey, setSortKey] = useState<AdminUsageSortKey>('plays');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const query = useQuery(musicQueries.adminUsage(scope, range));
  const selectedUser =
    selectedUserId === null
      ? null
      : (query.data?.users.find((entry) => entry.id === selectedUserId) ?? null);

  return (
    <>
      <AdminUsageSectionView
        apiBase={apiBase}
        range={range}
        sortKey={sortKey}
        data={query.data}
        pending={query.isPending}
        fetching={query.isFetching}
        fetchStatus={query.fetchStatus}
        stale={query.isStale}
        error={query.error}
        onRangeChange={setRange}
        onSortChange={setSortKey}
        onRefresh={() => void query.refetch()}
        onSelectUser={(entry) => setSelectedUserId(entry.id)}
      />
      <AdminUserUsageSheet
        scope={scope}
        user={selectedUser}
        range={range}
        onClose={() => setSelectedUserId(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { gap: layout.stackGap },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  rangeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, flex: 1 },
  skeleton: { gap: spacing.sm },
  kpiSkeleton: { flex: 1 },
  flatError: { padding: 0, borderWidth: 0, backgroundColor: 'transparent' },
  content: { gap: layout.stackGap },
  kpiGrid: { flexDirection: 'row', gap: spacing.sm },
  kpiCard: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs / 2,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  liveSummaryCard: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  liveSummaryHeader: { gap: 2 },
  storageLegendWrap: { gap: spacing.xxs },
  barTrack: {
    height: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: colors.fill,
  },
  miniBarTrack: {
    height: 5,
    borderRadius: radii.pill,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: colors.fill,
  },
  barExclusive: { backgroundColor: colors.accent },
  barShared: { backgroundColor: colors.brand },
  barUnattributed: { backgroundColor: colors.fillStrong },
  usersSection: { gap: spacing.xs },
  sortChips: { flexDirection: 'row', gap: spacing.xs },
  userList: { gap: spacing.sm },
  userRow: {
    minHeight: metrics.minimumTouchTarget,
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  pressed: { opacity: opacity.pressed },
  userHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarInitials: {
    width: layout.artwork.xs,
    height: layout.artwork.xs,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  userCopy: { flex: 1, minWidth: 0, gap: 2 },
  userTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, flexWrap: 'wrap' },
  userName: { flexShrink: 1 },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
  },
  pillAccent: { backgroundColor: colors.accentSubtle },
  pillWarning: { backgroundColor: colors.warningSubtle },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.successSubtle,
  },
  liveRowPlaying: { backgroundColor: colors.accentSubtle },
  userMetrics: { gap: 2 },
});
