import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  AdminConnectDevice,
  AdminRecentPlay,
  AdminRecentTrackRequest,
  AdminRequestSourceStat,
  AdminStatEntry,
  AdminUsageRange,
  AdminUserUsageDetailResponse,
  AdminUserUsageSummary,
} from '../../api/types';
import { musicQueries } from '../../data';
import { resolveRemoteVisualState, type RemoteFetchStatus } from '../../data/remoteState';
import { strings } from '../../localization';
import { colors, layout, radii, spacing } from '../../theme';
import { RemoteNoticeView } from '../RemoteNoticeView';
import { AppText, Artwork, BottomSheet, ErrorState, IconButton, Skeleton } from '../ui';
import {
  adminUserLabel,
  computeAdminUserStorageShares,
  formatAdminBytes,
  formatAdminDuration,
  formatAdminErrorDetail,
  formatAdminRelativeTimestamp,
  formatAdminShortDate,
} from './adminFormat';

export interface AdminUserUsageDetailViewProps {
  summary: AdminUserUsageSummary;
  range: AdminUsageRange;
  data: AdminUserUsageDetailResponse | undefined;
  pending: boolean;
  fetching: boolean;
  fetchStatus: RemoteFetchStatus;
  stale: boolean;
  error: unknown;
  onRefresh: () => void;
}

function DetailBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning';
}) {
  return (
    <View style={[styles.badge, styles[`badge_${tone}`]]}>
      <AppText
        variant="micro"
        color={
          tone === 'accent'
            ? 'accent'
            : tone === 'success'
              ? 'success'
              : tone === 'warning'
                ? 'warning'
                : 'secondary'
        }
      >
        {label}
      </AppText>
    </View>
  );
}

function SectionBlock({
  testID,
  title,
  children,
}: {
  testID: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View testID={testID} style={styles.section}>
      <AppText variant="overline" color="muted" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View
      testID="profile-admin-detail-loading"
      accessibilityRole="progressbar"
      accessibilityLabel={strings.admin.loading}
      accessibilityLiveRegion="polite"
      style={styles.skeleton}
    >
      <Skeleton height={56} radius="card" />
      <Skeleton height={92} radius="card" />
      <Skeleton height={72} radius="card" />
    </View>
  );
}

function ActiveDevicesList({ devices }: { devices: readonly AdminConnectDevice[] }) {
  if (devices.length === 0) {
    return (
      <AppText variant="callout" color="secondary">
        {strings.admin.detail.activeDevicesEmpty}
      </AppText>
    );
  }
  return (
    <View style={styles.list}>
      {devices.map((device) => (
        <View key={device.device_id} style={styles.cardRow}>
          <View style={styles.flexCopy}>
            <AppText variant="bodyStrong" numberOfLines={1}>{device.name}</AppText>
            <AppText variant="caption" color="secondary" numberOfLines={1}>
              {strings.connect.deviceTypes[device.device_type]}
              {device.party_code ? ` · ${strings.admin.detail.deviceParty(device.party_code)}` : ''}
            </AppText>
          </View>
          {device.is_active ? (
            <DetailBadge label={strings.admin.detail.deviceActive} tone="success" />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function RequestSourcesList({ sources }: { sources: readonly AdminRequestSourceStat[] }) {
  if (sources.length === 0) {
    return (
      <AppText variant="callout" color="secondary">
        {strings.admin.detail.sourcesEmpty}
      </AppText>
    );
  }
  return (
    <View style={styles.list}>
      {sources.map((entry) => (
        <View key={entry.source} style={styles.metricLine}>
          <AppText variant="callout" color="primary" style={styles.flexCopy}>
            {strings.admin.detail.sources[entry.source]}
          </AppText>
          <AppText variant="caption" color="secondary">
            {strings.admin.detail.sourceRow(
              entry.requests,
              entry.materialized,
              formatAdminBytes(entry.materialized_bytes),
            )}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function RankedStatList({
  id,
  entries,
  round,
}: {
  id: string;
  entries: readonly AdminStatEntry[];
  round: boolean;
}) {
  if (entries.length === 0) {
    return (
      <AppText variant="callout" color="secondary">
        {strings.admin.detail.emptySection}
      </AppText>
    );
  }
  return (
    <View style={styles.list}>
      {entries.slice(0, 5).map((entry, index) => (
        <View
          key={`${id}:${entry.key}:${entry.label}:${index}`}
          testID={`profile-admin-detail-${id}-${index}`}
          style={styles.trackRow}
        >
          <AppText variant="label" color="muted" align="center" style={styles.rank}>
            {index + 1}
          </AppText>
          <Artwork
            uri={entry.cover || null}
            size={layout.artwork.xs}
            shape={round ? 'round' : 'square'}
            icon={round ? 'account-music' : 'music-note'}
          />
          <View style={styles.flexCopy}>
            <AppText variant="bodyStrong" numberOfLines={1}>{entry.label}</AppText>
            {entry.sublabel.length > 0 ? (
              <AppText variant="caption" color="secondary" numberOfLines={1}>
                {entry.sublabel}
              </AppText>
            ) : null}
          </View>
          <AppText variant="label" color="secondary">{entry.count}</AppText>
        </View>
      ))}
    </View>
  );
}

function RecentPlaysList({ plays }: { plays: readonly AdminRecentPlay[] }) {
  if (plays.length === 0) {
    return (
      <AppText variant="callout" color="secondary">
        {strings.admin.detail.emptySection}
      </AppText>
    );
  }
  return (
    <View style={styles.list}>
      {plays.slice(0, 8).map((play, index) => (
        <View key={`${play.id}:${play.played_at}:${index}`} style={styles.trackRow}>
          <Artwork
            uri={play.cover || null}
            size={layout.artwork.xs}
            shape="square"
            icon="music-note"
          />
          <View style={styles.flexCopy}>
            <AppText variant="bodyStrong" numberOfLines={1}>{play.title}</AppText>
            <AppText variant="caption" color="secondary" numberOfLines={1}>
              {play.artist}
            </AppText>
          </View>
          <AppText variant="caption" color="muted">
            {formatAdminRelativeTimestamp(play.played_at)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function RecentRequestsList({ requests }: { requests: readonly AdminRecentTrackRequest[] }) {
  if (requests.length === 0) {
    return (
      <AppText variant="callout" color="secondary">
        {strings.admin.detail.emptySection}
      </AppText>
    );
  }
  return (
    <View style={styles.list}>
      {requests.slice(0, 8).map((req, index) => (
        <View key={`${req.deezer_id}:${req.requested_at}:${index}`} style={styles.trackRow}>
          <Artwork
            uri={req.cover || null}
            size={layout.artwork.xs}
            shape="square"
            icon="music-note"
          />
          <View style={styles.flexCopy}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {req.title || req.deezer_id}
            </AppText>
            <AppText variant="caption" color="secondary" numberOfLines={1}>
              {strings.admin.detail.sources[req.source]}
              {' · '}
              {req.materialized
                ? strings.admin.detail.requestCached
                : strings.admin.detail.requestHit}
              {req.size_bytes > 0 ? ` · ${formatAdminBytes(req.size_bytes)}` : ''}
              {' · '}
              {req.is_currently_stored
                ? strings.admin.detail.requestStored
                : strings.admin.detail.requestEvicted}
            </AppText>
          </View>
          <AppText variant="caption" color="muted">
            {formatAdminRelativeTimestamp(req.requested_at)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export function AdminUserUsageDetailView({
  summary,
  range,
  data,
  pending,
  fetching,
  fetchStatus,
  stale,
  error,
  onRefresh,
}: AdminUserUsageDetailViewProps) {
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
  const user = data?.user ?? summary;
  const storageShares = data
    ? computeAdminUserStorageShares(data.storage_breakdown, data.storage_breakdown.total_cache_bytes)
    : null;

  return (
    <ScrollView
      testID="profile-admin-detail-scroll"
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerMeta}>
        <View style={styles.flexCopy}>
          <AppText variant="callout" color="secondary" numberOfLines={1}>
            {user.email}
          </AppText>
          <View style={styles.badges}>
            {user.is_admin ? (
              <DetailBadge label={strings.admin.usage.roleAdmin} tone="accent" />
            ) : null}
            <DetailBadge
              label={
                user.is_approved
                  ? strings.admin.usage.statusApproved
                  : strings.admin.usage.statusPending
              }
              tone={user.is_approved ? 'success' : 'warning'}
            />
            <DetailBadge label={strings.admin.usage.ranges[range]} tone="neutral" />
          </View>
          {user.created_at !== null ? (
            <AppText testID="profile-admin-detail-member-since" variant="caption" color="muted">
              {strings.admin.detail.memberSince(formatAdminShortDate(user.created_at))}
            </AppText>
          ) : null}
          <AppText variant="caption" color="muted">
            {strings.admin.usage.lastActive(formatAdminRelativeTimestamp(user.last_active_at))}
          </AppText>
        </View>
        <IconButton
          testID="profile-admin-detail-refresh"
          icon="refresh"
          size="sm"
          variant="tonal"
          busy={fetching}
          accessibilityLabel={strings.admin.refresh}
          onPress={onRefresh}
        />
      </View>

      {visual.body === 'loading' ? <DetailSkeleton /> : null}
      {failure !== null ? (
        <ErrorState
          testID={`profile-admin-detail-${failure}`}
          retryTestID="profile-admin-detail-retry"
          kind={failure}
          message={
            failure === 'offline'
              ? strings.admin.offline
              : strings.admin.loadFailed(formatAdminErrorDetail(error))
          }
          onRetry={onRefresh}
          retryBusy={fetching}
          retryAccessibilityLabel={strings.admin.refresh}
        />
      ) : null}
      <RemoteNoticeView
        notice={visual.notice}
        testIDPrefix="profile-admin-detail"
        retryTestID={() => 'profile-admin-detail-notice-retry'}
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
        <View testID="profile-admin-detail-content" style={styles.sections}>
          <View style={styles.kpiRow}>
            <View style={styles.kpiTile}>
              <AppText variant="caption" color="muted">{strings.admin.usage.kpiPlays}</AppText>
              <AppText variant="section">{data.user.plays}</AppText>
              <AppText variant="caption" color="secondary" numberOfLines={1}>
                {formatAdminDuration(data.user.listening_sec)}
              </AppText>
            </View>
            <View style={styles.kpiTile}>
              <AppText variant="caption" color="muted">{strings.admin.usage.kpiRequested}</AppText>
              <AppText variant="section">{data.user.tracks_requested}</AppText>
              <AppText variant="caption" color="secondary" numberOfLines={1}>
                {strings.admin.usage.kpiMaterialized(
                  data.user.tracks_materialized,
                  formatAdminBytes(data.user.materialized_bytes),
                )}
              </AppText>
            </View>
          </View>

          <SectionBlock testID="profile-admin-detail-devices" title={strings.admin.detail.activeDevicesTitle}>
            <ActiveDevicesList devices={data.active_devices} />
          </SectionBlock>

          <SectionBlock testID="profile-admin-detail-storage" title={strings.admin.detail.storageTitle}>
            <View style={styles.barTrack}>
              {storageShares.exclusivePct > 0 ? (
                <View style={[styles.barExclusive, { flex: storageShares.exclusivePct }]} />
              ) : null}
              {storageShares.sharedPct > 0 ? (
                <View style={[styles.barShared, { flex: storageShares.sharedPct }]} />
              ) : null}
              {storageShares.exclusivePct + storageShares.sharedPct < 100 ? (
                <View
                  style={{ flex: Math.max(0, 100 - storageShares.exclusivePct - storageShares.sharedPct) }}
                />
              ) : null}
            </View>
            <View style={styles.list}>
              <AppText variant="callout" color="primary">
                {strings.admin.detail.storageExclusiveRow(
                  formatAdminBytes(data.storage_breakdown.exclusive_bytes),
                  data.storage_breakdown.exclusive_tracks,
                )}
              </AppText>
              <AppText variant="callout" color="secondary">
                {strings.admin.detail.storageSharedRow(
                  formatAdminBytes(data.storage_breakdown.shared_bytes),
                  data.storage_breakdown.shared_tracks,
                )}
              </AppText>
              <AppText variant="callout" color="secondary">
                {strings.admin.detail.storagePinnedRow(
                  formatAdminBytes(data.storage_breakdown.pinned_bytes),
                  data.storage_breakdown.pinned_tracks,
                )}
              </AppText>
              <AppText variant="callout" color="secondary">
                {strings.admin.detail.storageMaterializedRow(
                  formatAdminBytes(data.storage_breakdown.materialized_bytes),
                  data.storage_breakdown.materialized_tracks,
                )}
              </AppText>
              <AppText variant="caption" color="muted">
                {`${strings.admin.detail.storageUploadsRow}: ${formatAdminBytes(data.storage_breakdown.upload_bytes)}`}
              </AppText>
              <AppText variant="caption" color="muted">
                {strings.admin.detail.storageTotalCache(
                  formatAdminBytes(data.storage_breakdown.total_cache_bytes),
                )}
              </AppText>
            </View>
          </SectionBlock>

          <SectionBlock testID="profile-admin-detail-library" title={strings.admin.detail.libraryTitle}>
            <View style={styles.libraryGrid}>
              {[
                { label: strings.admin.detail.libLikes, value: String(data.user.library.likes) },
                {
                  label: strings.admin.detail.libPlaylists,
                  value: `${data.user.library.playlists} (${data.user.library.playlist_tracks})`,
                },
                { label: strings.admin.detail.libFollows, value: String(data.user.library.follows) },
                {
                  label: strings.admin.detail.libParty,
                  value: String(data.user.library.party_tracks_added),
                },
                {
                  label: strings.admin.detail.libImports,
                  value: `${data.user.library.import_jobs} (${data.user.library.import_tracks_matched})`,
                },
              ].map((item) => (
                <View key={item.label} style={styles.libraryChip}>
                  <AppText variant="micro" color="muted">{item.label}</AppText>
                  <AppText variant="label">{item.value}</AppText>
                </View>
              ))}
            </View>
          </SectionBlock>

          <SectionBlock testID="profile-admin-detail-sources" title={strings.admin.detail.sourcesTitle}>
            <RequestSourcesList sources={data.requests_by_source} />
          </SectionBlock>

          <SectionBlock testID="profile-admin-detail-top-tracks" title={strings.admin.detail.topTracksTitle}>
            <RankedStatList id="top-tracks" entries={data.top_tracks} round={false} />
          </SectionBlock>

          <SectionBlock testID="profile-admin-detail-top-artists" title={strings.admin.detail.topArtistsTitle}>
            <RankedStatList id="top-artists" entries={data.top_artists} round />
          </SectionBlock>

          <SectionBlock testID="profile-admin-detail-recent-plays" title={strings.admin.detail.recentPlaysTitle}>
            <RecentPlaysList plays={data.recent_plays} />
          </SectionBlock>

          <SectionBlock
            testID="profile-admin-detail-recent-requests"
            title={strings.admin.detail.recentRequestsTitle}
          >
            <RecentRequestsList requests={data.recent_requests} />
          </SectionBlock>
        </View>
      ) : null}
    </ScrollView>
  );
}

function AdminUserUsageSheetBody({
  scope,
  summary,
  range,
}: {
  scope: string;
  summary: AdminUserUsageSummary;
  range: AdminUsageRange;
}) {
  const detail = useQuery(musicQueries.adminUserUsage(scope, summary.id, range));
  return (
    <AdminUserUsageDetailView
      summary={summary}
      range={range}
      data={detail.data}
      pending={detail.isPending}
      fetching={detail.isFetching}
      fetchStatus={detail.fetchStatus}
      stale={detail.isStale}
      error={detail.error}
      onRefresh={() => void detail.refetch()}
    />
  );
}

export interface AdminUserUsageSheetProps {
  scope: string;
  user: AdminUserUsageSummary | null;
  range: AdminUsageRange;
  onClose: () => void;
}

export function AdminUserUsageSheet({
  scope,
  user,
  range,
  onClose,
}: AdminUserUsageSheetProps) {
  return (
    <BottomSheet
      testID="profile-admin-user-sheet"
      visible={user !== null}
      onClose={onClose}
      closeLabel={strings.admin.detail.closeLabel}
      title={user ? adminUserLabel(user) : undefined}
      contentStyle={styles.sheetContent}
    >
      {user ? <AdminUserUsageSheetBody scope={scope} summary={user} range={range} /> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetContent: { paddingHorizontal: spacing.md },
  scrollContent: { gap: layout.stackGap, paddingBottom: spacing.lg },
  headerMeta: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flexCopy: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs, marginTop: spacing.xxs },
  badge: {
    paddingVertical: spacing.xxs / 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
  },
  badge_neutral: { backgroundColor: colors.fillStrong },
  badge_accent: { backgroundColor: colors.accentSubtle },
  badge_success: { backgroundColor: colors.successSubtle },
  badge_warning: { backgroundColor: colors.warningSubtle },
  skeleton: { gap: spacing.sm },
  sections: { gap: layout.stackGap },
  section: { gap: spacing.xs },
  kpiRow: { flexDirection: 'row', gap: spacing.sm },
  kpiTile: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs / 2,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  barTrack: {
    height: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: colors.fill,
  },
  barExclusive: { backgroundColor: colors.accent },
  barShared: { backgroundColor: colors.brand },
  list: { gap: spacing.xs },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.backgroundElevated,
  },
  metricLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  libraryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  libraryChip: {
    minWidth: '30%',
    flexGrow: 1,
    gap: 2,
    padding: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.backgroundElevated,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rank: { width: spacing.lg },
});
