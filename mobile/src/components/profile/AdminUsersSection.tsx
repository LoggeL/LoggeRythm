import React, { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminInvite, AdminUser } from '../../api/types';
import { resolveServerUrl } from '../../api/url';
import { musicMutations, musicQueries, queryKeys } from '../../data';
import { resolveRemoteVisualState, type RemoteFetchStatus } from '../../data/remoteState';
import { strings } from '../../localization';
import { profileInitials } from '../../screens/profileModel';
import { colors, layout, radii, spacing } from '../../theme';
import { RemoteNoticeView } from '../RemoteNoticeView';
import {
  ActionButton,
  AppText,
  Artwork,
  BottomSheet,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
} from '../ui';
import {
  adminInviteShareUrl,
  adminUserLabel,
  formatAdminErrorDetail,
  formatAdminShortDate,
} from './adminFormat';

export interface AdminUsersSectionViewProps {
  apiBase: string;
  currentUserId: number;
  users: AdminUser[] | undefined;
  usersPending: boolean;
  usersFetching: boolean;
  usersFetchStatus: RemoteFetchStatus;
  usersStale: boolean;
  usersError: unknown;
  invites: AdminInvite[] | undefined;
  invitesPending: boolean;
  invitesFetching: boolean;
  invitesFetchStatus: RemoteFetchStatus;
  invitesStale: boolean;
  invitesError: unknown;
  approvingUserId: number | null;
  deletingUser: AdminUser | null;
  deleteBusy: boolean;
  creatingInvite: boolean;
  feedback: string | null;
  actionError: string | null;
  onRefresh: () => void;
  onApproveUser: (user: AdminUser) => void;
  onRequestDeleteUser: (user: AdminUser) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onCreateInvite: () => void;
  onShareInvite: (invite: AdminInvite) => void;
}

export function AdminUsersSectionView({
  apiBase,
  currentUserId,
  users,
  usersPending,
  usersFetching,
  usersFetchStatus,
  usersStale,
  usersError,
  invites,
  invitesPending,
  invitesFetching,
  invitesFetchStatus,
  invitesStale,
  invitesError,
  approvingUserId,
  deletingUser,
  deleteBusy,
  creatingInvite,
  feedback,
  actionError,
  onRefresh,
  onApproveUser,
  onRequestDeleteUser,
  onCancelDelete,
  onConfirmDelete,
  onCreateInvite,
  onShareInvite,
}: AdminUsersSectionViewProps) {
  const usersVisual = resolveRemoteVisualState({
    hasData: users !== undefined,
    empty: users !== undefined && users.length === 0,
    pending: usersPending,
    fetching: usersFetching,
    stale: usersStale,
    fetchStatus: usersFetchStatus,
    error: usersError,
  });
  const usersFailure =
    usersVisual.body === 'offline' ? 'offline' : usersVisual.body === 'hard-error' ? 'error' : null;

  const invitesVisual = resolveRemoteVisualState({
    hasData: invites !== undefined,
    empty: invites !== undefined && invites.length === 0,
    pending: invitesPending,
    fetching: invitesFetching,
    stale: invitesStale,
    fetchStatus: invitesFetchStatus,
    error: invitesError,
  });
  const invitesFailure =
    invitesVisual.body === 'offline'
      ? 'offline'
      : invitesVisual.body === 'hard-error'
        ? 'error'
        : null;

  const pendingCount = users ? users.filter((entry) => !entry.is_approved).length : 0;

  return (
    <View testID="profile-admin-users" style={styles.root}>
      {actionError !== null ? (
        <AppText
          testID="profile-admin-users-action-error"
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {actionError}
        </AppText>
      ) : null}
      {feedback !== null ? (
        <AppText
          testID="profile-admin-users-feedback"
          variant="callout"
          color="success"
          accessibilityLiveRegion="polite"
        >
          {feedback}
        </AppText>
      ) : null}

      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleGroup}>
          <AppText variant="overline" color="muted" accessibilityRole="header">
            {strings.admin.usersSection.usersTitle}
          </AppText>
          {pendingCount > 0 ? (
            <View testID="profile-admin-users-pending-badge" style={[styles.pill, styles.pillWarning]}>
              <AppText variant="micro" color="warning">
                {strings.admin.usersSection.pendingBadge(pendingCount)}
              </AppText>
            </View>
          ) : null}
        </View>
        <IconButton
          testID="profile-admin-users-refresh"
          icon="refresh"
          size="sm"
          variant="tonal"
          busy={usersFetching || invitesFetching}
          accessibilityLabel={strings.admin.refresh}
          onPress={onRefresh}
        />
      </View>

      {usersVisual.body === 'loading' ? (
        <View
          testID="profile-admin-users-loading"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.admin.loading}
          style={styles.skeleton}
        >
          <Skeleton height={64} radius="card" />
          <Skeleton height={64} radius="card" />
        </View>
      ) : null}

      {usersFailure !== null ? (
        <ErrorState
          testID={`profile-admin-users-${usersFailure}`}
          retryTestID="profile-admin-users-retry"
          kind={usersFailure}
          message={
            usersFailure === 'offline'
              ? strings.admin.offline
              : strings.admin.loadFailed(formatAdminErrorDetail(usersError))
          }
          onRetry={onRefresh}
          retryBusy={usersFetching}
          retryAccessibilityLabel={strings.admin.refresh}
          style={styles.flatError}
        />
      ) : null}

      <RemoteNoticeView
        notice={usersVisual.notice}
        testIDPrefix="profile-admin-users"
        retryTestID={() => 'profile-admin-users-notice-retry'}
        copy={{
          cachedOffline: strings.admin.cachedOffline,
          cachedRefreshFailed: strings.admin.cachedRefreshFailed,
          refreshing: strings.admin.refreshing,
          stale: strings.admin.stale,
        }}
        retryAccessibilityLabel={strings.admin.refresh}
        busy={usersFetching}
        onRetry={onRefresh}
      />

      {usersVisual.body === 'empty' ? (
        <EmptyState
          testID="profile-admin-users-empty"
          icon="account-group-outline"
          title={strings.admin.usersSection.usersEmpty}
        />
      ) : null}

      {usersVisual.body === 'content' && users ? (
        <View style={styles.list}>
          {users.map((entry) => {
            const name = adminUserLabel(entry);
            const avatarUri = entry.avatar_url ? resolveServerUrl(entry.avatar_url, apiBase) : null;
            const approvingThis = approvingUserId === entry.id;
            const canDelete = !entry.is_admin && entry.id !== currentUserId;
            return (
              <View key={entry.id} testID={`profile-admin-user-row-${entry.id}`} style={styles.card}>
                <View style={styles.userRow}>
                  {avatarUri ? (
                    <Artwork
                      uri={avatarUri}
                      size={layout.artwork.xs}
                      shape="round"
                      icon="account"
                      accessibilityLabel={name}
                    />
                  ) : (
                    <View accessible={false} style={styles.initials}>
                      <AppText variant="label" color="accent">
                        {profileInitials(entry.display_name, entry.email)}
                      </AppText>
                    </View>
                  )}
                  <View style={styles.copy}>
                    <View style={styles.titleRow}>
                      <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
                        {name}
                      </AppText>
                      {entry.is_admin ? (
                        <View style={[styles.pill, styles.pillAccent]}>
                          <AppText variant="micro" color="accent">
                            {strings.admin.usage.roleAdmin}
                          </AppText>
                        </View>
                      ) : null}
                      <View
                        style={[
                          styles.pill,
                          entry.is_approved ? styles.pillSuccess : styles.pillWarning,
                        ]}
                      >
                        <AppText
                          variant="micro"
                          color={entry.is_approved ? 'success' : 'warning'}
                        >
                          {entry.is_approved
                            ? strings.admin.usage.statusApproved
                            : strings.admin.usage.statusPending}
                        </AppText>
                      </View>
                    </View>
                    <AppText variant="caption" color="secondary" numberOfLines={1}>
                      {entry.email}
                    </AppText>
                  </View>
                </View>

                {!entry.is_approved || canDelete ? (
                  <View style={styles.actions}>
                    {!entry.is_approved ? (
                      <ActionButton
                        testID={`profile-admin-user-approve-${entry.id}`}
                        variant="primary"
                        icon="check"
                        label={
                          approvingThis
                            ? strings.admin.usersSection.approving
                            : strings.admin.usersSection.approve
                        }
                        busy={approvingThis}
                        disabled={approvingUserId !== null || deleteBusy}
                        onPress={() => onApproveUser(entry)}
                      />
                    ) : null}
                    {canDelete ? (
                      <ActionButton
                        testID={`profile-admin-user-delete-${entry.id}`}
                        variant="danger"
                        icon="delete-outline"
                        label={strings.admin.usersSection.remove}
                        disabled={approvingUserId !== null || deleteBusy}
                        onPress={() => onRequestDeleteUser(entry)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.divider} />

      <View style={styles.sectionHeader}>
        <AppText variant="overline" color="muted" accessibilityRole="header">
          {strings.admin.usersSection.invitesTitle}
        </AppText>
        <ActionButton
          testID="profile-admin-invite-create"
          variant="primary"
          icon="plus"
          label={
            creatingInvite
              ? strings.admin.usersSection.creatingInvite
              : strings.admin.usersSection.createInvite
          }
          busy={creatingInvite}
          disabled={creatingInvite}
          onPress={onCreateInvite}
        />
      </View>

      {invitesVisual.body === 'loading' ? (
        <View testID="profile-admin-invites-loading" style={styles.skeleton}>
          <Skeleton height={52} radius="card" />
        </View>
      ) : null}

      {invitesFailure !== null ? (
        <ErrorState
          testID={`profile-admin-invites-${invitesFailure}`}
          retryTestID="profile-admin-invites-retry"
          kind={invitesFailure}
          message={
            invitesFailure === 'offline'
              ? strings.admin.offline
              : strings.admin.loadFailed(formatAdminErrorDetail(invitesError))
          }
          onRetry={onRefresh}
          retryBusy={invitesFetching}
          retryAccessibilityLabel={strings.admin.refresh}
          style={styles.flatError}
        />
      ) : null}

      {invitesVisual.body === 'empty' ? (
        <EmptyState
          testID="profile-admin-invites-empty"
          icon="link-variant"
          title={strings.admin.usersSection.invitesEmpty}
        />
      ) : null}

      {invitesVisual.body === 'content' && invites ? (
        <View style={styles.list}>
          {invites.map((invite) => (
            <View
              key={invite.code}
              testID={`profile-admin-invite-${invite.code}`}
              style={styles.inviteRow}
            >
              <View style={styles.copy}>
                <AppText variant="label" numberOfLines={1}>{invite.code}</AppText>
                <View style={styles.titleRow}>
                  <View
                    style={[
                      styles.pill,
                      invite.used_by_name ? styles.pillNeutral : styles.pillSuccess,
                    ]}
                  >
                    <AppText
                      variant="micro"
                      color={invite.used_by_name ? 'secondary' : 'success'}
                    >
                      {invite.used_by_name
                        ? strings.admin.usersSection.inviteUsedBy(invite.used_by_name)
                        : strings.admin.usersSection.inviteFree}
                    </AppText>
                  </View>
                  <AppText variant="caption" color="muted">
                    {formatAdminShortDate(invite.created_at)}
                  </AppText>
                </View>
              </View>
              <IconButton
                testID={`profile-admin-invite-share-${invite.code}`}
                icon="share-variant-outline"
                size="sm"
                variant="tonal"
                accessibilityLabel={strings.admin.usersSection.shareInvite}
                onPress={() => onShareInvite(invite)}
              />
            </View>
          ))}
        </View>
      ) : null}

      <BottomSheet
        testID="profile-admin-user-delete-sheet"
        visible={deletingUser !== null}
        onClose={() => {
          if (!deleteBusy) onCancelDelete();
        }}
        closeLabel={strings.common.cancel}
        title={strings.admin.usersSection.deleteTitle}
        contentStyle={styles.sheet}
      >
        {deletingUser ? (
          <AppText color="secondary">
            {strings.admin.usersSection.deleteWarning(
              adminUserLabel(deletingUser),
              deletingUser.email,
            )}
          </AppText>
        ) : null}
        {actionError !== null && deletingUser !== null ? (
          <AppText
            testID="profile-admin-user-delete-error"
            variant="callout"
            color="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {actionError}
          </AppText>
        ) : null}
        <ActionButton
          testID="profile-admin-user-delete-confirm"
          variant="danger"
          icon="delete-outline"
          label={
            deleteBusy
              ? strings.admin.usersSection.deleting
              : strings.admin.usersSection.deleteConfirm
          }
          busy={deleteBusy}
          disabled={deleteBusy}
          fullWidth
          onPress={onConfirmDelete}
        />
        <ActionButton
          testID="profile-admin-user-delete-cancel"
          variant="secondary"
          label={strings.common.cancel}
          disabled={deleteBusy}
          fullWidth
          onPress={onCancelDelete}
        />
      </BottomSheet>
    </View>
  );
}

export interface AdminUsersSectionProps {
  scope: string;
  apiBase: string;
  currentUserId: number;
}

export function AdminUsersSection({ scope, apiBase, currentUserId }: AdminUsersSectionProps) {
  const queryClient = useQueryClient();
  const usersQuery = useQuery(musicQueries.adminUsers(scope));
  const invitesQuery = useQuery(musicQueries.adminInvites(scope));
  const [approvingUserId, setApprovingUserId] = useState<number | null>(null);
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const approveMutation = useMutation(musicMutations.approveAdminUser(scope));
  const deleteMutation = useMutation(musicMutations.deleteAdminUser(scope));
  const inviteMutation = useMutation(musicMutations.createAdminInvite(scope));

  const invalidateAdmin = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.root(scope) });

  const handleApprove = (target: AdminUser) => {
    setActionError(null);
    setFeedback(null);
    setApprovingUserId(target.id);
    approveMutation.mutate(target.id, {
      onSuccess: () => {
        setFeedback(strings.admin.usersSection.approvedFeedback(adminUserLabel(target)));
        void invalidateAdmin();
      },
      onError: (error) => {
        setActionError(strings.admin.usersSection.approveFailed(formatAdminErrorDetail(error)));
      },
      onSettled: () => {
        setApprovingUserId(null);
      },
    });
  };

  const handleConfirmDelete = () => {
    if (deletingUser === null) {
      throw new Error('Admin user deletion confirmed without a selected user');
    }
    const target = deletingUser;
    setActionError(null);
    setFeedback(null);
    deleteMutation.mutate(target.id, {
      onSuccess: () => {
        setDeletingUser(null);
        setFeedback(strings.admin.usersSection.removedFeedback(adminUserLabel(target)));
        void invalidateAdmin();
      },
      onError: (error) => {
        setActionError(strings.admin.usersSection.removeFailed(formatAdminErrorDetail(error)));
      },
    });
  };

  const handleCreateInvite = () => {
    setActionError(null);
    setFeedback(null);
    inviteMutation.mutate(undefined, {
      onSuccess: () => {
        setFeedback(strings.admin.usersSection.inviteCreated);
        void invalidateAdmin();
      },
      onError: (error) => {
        setActionError(
          strings.admin.usersSection.inviteCreateFailed(formatAdminErrorDetail(error)),
        );
      },
    });
  };

  const handleShareInvite = (invite: AdminInvite) => {
    setActionError(null);
    const url = adminInviteShareUrl(apiBase, invite.code);
    void Share.share({
      message: strings.admin.usersSection.shareInviteMessage(url),
      url,
    }).catch((error: unknown) => {
      setActionError(strings.admin.usersSection.shareInviteFailed(formatAdminErrorDetail(error)));
    });
  };

  return (
    <AdminUsersSectionView
      apiBase={apiBase}
      currentUserId={currentUserId}
      users={usersQuery.data}
      usersPending={usersQuery.isPending}
      usersFetching={usersQuery.isFetching}
      usersFetchStatus={usersQuery.fetchStatus}
      usersStale={usersQuery.isStale}
      usersError={usersQuery.error}
      invites={invitesQuery.data}
      invitesPending={invitesQuery.isPending}
      invitesFetching={invitesQuery.isFetching}
      invitesFetchStatus={invitesQuery.fetchStatus}
      invitesStale={invitesQuery.isStale}
      invitesError={invitesQuery.error}
      approvingUserId={approvingUserId}
      deletingUser={deletingUser}
      deleteBusy={deleteMutation.isPending}
      creatingInvite={inviteMutation.isPending}
      feedback={feedback}
      actionError={actionError}
      onRefresh={() => {
        void usersQuery.refetch();
        void invitesQuery.refetch();
      }}
      onApproveUser={handleApprove}
      onRequestDeleteUser={(target) => {
        setActionError(null);
        setDeletingUser(target);
      }}
      onCancelDelete={() => {
        setActionError(null);
        setDeletingUser(null);
      }}
      onConfirmDelete={handleConfirmDelete}
      onCreateInvite={handleCreateInvite}
      onShareInvite={handleShareInvite}
    />
  );
}

const styles = StyleSheet.create({
  root: { gap: layout.stackGap },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  skeleton: { gap: spacing.sm },
  flatError: { padding: 0, borderWidth: 0, backgroundColor: 'transparent' },
  list: { gap: spacing.sm },
  card: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  initials: {
    width: layout.artwork.xs,
    height: layout.artwork.xs,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, flexWrap: 'wrap' },
  name: { flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: { paddingVertical: 2, paddingHorizontal: spacing.xs, borderRadius: radii.pill },
  pillAccent: { backgroundColor: colors.accentSubtle },
  pillSuccess: { backgroundColor: colors.successSubtle },
  pillWarning: { backgroundColor: colors.warningSubtle },
  pillNeutral: { backgroundColor: colors.fillStrong },
  divider: { height: 1, backgroundColor: colors.hairline },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  sheet: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.xxs },
});
