import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/error';
import type { Playlist, PlaylistCollaborator, PlaylistInvite } from '../../api/types';
import { resolveServerUrl } from '../../api/url';
import { isValidEmail, normalizeEmail } from '../../auth/email';
import {
  invalidatePlaylistCaches,
  musicMutations,
  musicQueries,
  queryKeys,
} from '../../data';
import { strings } from '../../localization';
import { playlistInviteUrl } from '../../navigationLinks';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, metrics, opacity, radii, spacing, typography } from '../../theme';
import { ActionButton, AppText, Artwork, BottomSheet, ErrorState, IconButton, ListSeparator } from '../ui';
import { InlineNotice } from './InlineNotice';
import { SheetActionRow } from './SheetActionRow';
import { useKeyboardInset } from './useKeyboardInset';

export function directInviteErrorMessage(error: unknown, isCollaborative: boolean): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return libraryStrings.playlist.directInviteNotFound;
    if (error.status === 400) return libraryStrings.playlist.directInviteSelf;
    if (error.status === 409) {
      return isCollaborative
        ? libraryStrings.playlist.directInviteAlreadyMember
        : libraryStrings.playlist.directInviteDisabled;
    }
  }
  return libraryStrings.playlist.directInviteFailed;
}

export function validateDirectInviteEmail(value: string): string | null {
  const normalized = normalizeEmail(value);
  if (normalized.length === 0) return libraryStrings.playlist.directInviteEmailRequired;
  if (!isValidEmail(normalized)) return libraryStrings.playlist.directInviteEmailInvalid;
  return null;
}

export interface PlaylistCollaboratorsSheetContentProps {
  visible: boolean;
  onClose: () => void;
  apiBase: string;
  playlist: Playlist;
  /** Owner mutation (toggle collaborative, etc.) is running. */
  busy: boolean;
  invite: {
    loading: boolean;
    error: unknown;
    data: PlaylistInvite | null | undefined;
    busy: boolean;
    mutationError: string | null;
    shareError: string | null;
    onRetry: () => void;
    onShare: (invite: PlaylistInvite) => void;
    onCreateOrRotate: (hasExisting: boolean) => void;
    onRevoke: () => void;
  } | null;
  directInvite: {
    email: string;
    busy: boolean;
    error: string | null;
    success: string | null;
    onEmailChange: (value: string) => void;
    onSubmit: () => void;
  } | null;
  removingUserId: number | null;
  removeError: string | null;
  onToggleCollaborative?: (enabled: boolean) => void;
  onRemoveCollaborator?: (collaborator: PlaylistCollaborator) => void;
  onOpenUser?: (params: { userId: number; name?: string }) => void;
  onLeave?: () => void;
  keyboardInset?: number;
}

/**
 * Pure presentational view of the collaborators & invite sheet so every role
 * and state (owner, collaborator, frozen, invite loading/error/active) is
 * directly testable without mocking hooks.
 */
export function PlaylistCollaboratorsSheetContent({
  visible,
  onClose,
  apiBase,
  playlist,
  busy,
  invite,
  directInvite,
  removingUserId,
  removeError,
  onToggleCollaborative,
  onRemoveCollaborator,
  onOpenUser,
  onLeave,
  keyboardInset = 0,
}: PlaylistCollaboratorsSheetContentProps) {
  const ownerName = playlist.owner_name?.trim() || libraryStrings.playlist.unknownUser;
  const ownerAvatar =
    playlist.owner_avatar_url === null
      ? null
      : resolveServerUrl(playlist.owner_avatar_url, apiBase);
  const activeInvite = invite?.data ?? null;
  const activeInviteUrl =
    activeInvite !== null ? playlistInviteUrl(apiBase, activeInvite.token) : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel={libraryStrings.playlist.closeCollaborators}
      testID="playlist-collaborators-sheet"
      contentStyle={styles.sheet}
    >
      <View style={styles.header}>
        <AppText accessibilityRole="header" variant="section" numberOfLines={1} style={styles.title}>
          {libraryStrings.playlist.collaboratorsTitle}
        </AppText>
        <IconButton
          testID="playlist-collaborators-close"
          icon="close"
          variant="tonal"
          accessibilityLabel={libraryStrings.playlist.closeCollaborators}
          onPress={onClose}
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {playlist.is_owner && onToggleCollaborative !== undefined ? (
          <View style={styles.section}>
            <SheetActionRow
              icon="account-multiple-outline"
              label={libraryStrings.playlist.collaborative}
              description={
                playlist.is_collaborative
                  ? libraryStrings.playlist.collaborativeHint
                  : libraryStrings.playlist.collaborativeOffHint
              }
              trailing={
                <Switch
                  testID="playlist-collaborative-switch"
                  accessibilityLabel={
                    playlist.is_collaborative
                      ? libraryStrings.playlist.disableCollaborative
                      : libraryStrings.playlist.makeCollaborative
                  }
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  value={playlist.is_collaborative}
                  onValueChange={onToggleCollaborative}
                  trackColor={{ false: colors.border, true: colors.accentSolid }}
                  thumbColor={playlist.is_collaborative ? colors.accentSoft : colors.textSecondary}
                />
              }
            />
          </View>
        ) : null}

        {!playlist.is_owner && playlist.is_collaborator && !playlist.is_collaborative ? (
          <View style={styles.paddedSection}>
            <InlineNotice
              testID="playlist-collaborators-frozen"
              message={libraryStrings.playlist.frozenNotice}
            />
          </View>
        ) : null}

        {playlist.is_owner && !playlist.is_collaborative ? (
          <View style={styles.paddedSection}>
            <AppText
              testID="playlist-invite-disabled-hint"
              variant="callout"
              color="secondary"
            >
              {libraryStrings.playlist.inviteLinkDisabledHint}
            </AppText>
          </View>
        ) : null}

        {playlist.is_owner && playlist.is_collaborative && invite !== null ? (
          <>
            <ListSeparator style={styles.separator} />
            <View testID="playlist-invite-section" style={styles.paddedSection}>
              <AppText variant="overline" color="muted">
                {libraryStrings.playlist.inviteSectionTitle}
              </AppText>
              <AppText variant="callout" color="secondary">
                {libraryStrings.playlist.inviteLinkHint}
              </AppText>

              {invite.loading ? (
                <View testID="playlist-invite-status-loading" style={styles.loadingRow}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <AppText variant="callout" color="secondary">
                    {libraryStrings.playlist.inviteLoading}
                  </AppText>
                </View>
              ) : invite.error !== null && invite.data === undefined ? (
                <ErrorState
                  layout="inline"
                  testID="playlist-invite-status-error"
                  retryTestID="playlist-invite-status-retry"
                  message={libraryStrings.playlist.inviteLoadFailed}
                  onRetry={invite.onRetry}
                  retryBusy={invite.loading}
                />
              ) : activeInvite !== null && activeInviteUrl !== null ? (
                <View style={styles.inviteActiveBox}>
                  <View style={styles.inviteUrlBox}>
                    <AppText
                      testID="playlist-invite-url"
                      variant="caption"
                      color="secondary"
                      selectable
                      numberOfLines={2}
                    >
                      {activeInviteUrl}
                    </AppText>
                  </View>
                  <ActionButton
                    testID="playlist-invite-share"
                    label={libraryStrings.playlist.shareInvite}
                    icon="share-variant"
                    variant="primary"
                    disabled={busy || invite.busy}
                    fullWidth
                    onPress={() => invite.onShare(activeInvite)}
                  />
                  <View style={styles.inviteSecondaryActions}>
                    <ActionButton
                      testID="playlist-invite-rotate"
                      label={libraryStrings.playlist.rotateInvite}
                      icon="refresh"
                      variant="secondary"
                      disabled={busy || invite.busy}
                      busy={invite.busy}
                      onPress={() => invite.onCreateOrRotate(true)}
                      style={styles.flexAction}
                    />
                    <ActionButton
                      testID="playlist-invite-revoke"
                      label={libraryStrings.playlist.revokeInvite}
                      icon="link-off"
                      variant="danger"
                      disabled={busy || invite.busy}
                      onPress={invite.onRevoke}
                      style={styles.flexAction}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.inviteEmptyBox}>
                  <AppText testID="playlist-invite-empty" variant="callout" color="muted">
                    {libraryStrings.playlist.inviteLinkEmpty}
                  </AppText>
                  <ActionButton
                    testID="playlist-invite-create"
                    label={
                      invite.busy
                        ? libraryStrings.playlist.creatingInvite
                        : libraryStrings.playlist.createInvite
                    }
                    icon="link-plus"
                    variant="secondary"
                    busy={invite.busy}
                    disabled={busy || invite.busy}
                    fullWidth
                    onPress={() => invite.onCreateOrRotate(false)}
                  />
                </View>
              )}

              {invite.mutationError !== null ? (
                <InlineNotice
                  testID="playlist-invite-mutation-error"
                  tone="danger"
                  live="assertive"
                  message={invite.mutationError}
                />
              ) : null}
              {invite.shareError !== null ? (
                <InlineNotice
                  testID="playlist-invite-share-error"
                  tone="danger"
                  live="assertive"
                  message={invite.shareError}
                />
              ) : null}
            </View>
          </>
        ) : null}

        {playlist.is_owner && playlist.is_collaborative && directInvite !== null ? (
          <>
            <ListSeparator style={styles.separator} />
            <View testID="playlist-direct-invite-section" style={styles.paddedSection}>
              <AppText variant="overline" color="muted">
                {libraryStrings.playlist.directInviteTitle}
              </AppText>
              <View style={styles.directInviteRow}>
                <TextInput
                  testID="playlist-collaborator-email-input"
                  accessibilityLabel={libraryStrings.playlist.directInviteLabel}
                  placeholder={libraryStrings.playlist.directInvitePlaceholder}
                  placeholderTextColor={colors.textMuted}
                  selectionColor={colors.accent}
                  value={directInvite.email}
                  onChangeText={directInvite.onEmailChange}
                  editable={!busy && !directInvite.busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="send"
                  maxLength={254}
                  onSubmitEditing={directInvite.onSubmit}
                  style={styles.emailInput}
                />
                <ActionButton
                  testID="playlist-collaborator-add-submit"
                  label={
                    directInvite.busy
                      ? libraryStrings.playlist.directInviteSending
                      : libraryStrings.playlist.directInviteSubmit
                  }
                  icon="account-plus-outline"
                  variant="secondary"
                  busy={directInvite.busy}
                  disabled={busy || directInvite.busy}
                  onPress={directInvite.onSubmit}
                />
              </View>
              {directInvite.error !== null ? (
                <InlineNotice
                  testID="playlist-collaborator-add-error"
                  tone="danger"
                  live="assertive"
                  message={directInvite.error}
                />
              ) : null}
              {directInvite.success !== null ? (
                <AppText
                  testID="playlist-collaborator-add-success"
                  accessibilityLiveRegion="polite"
                  variant="callout"
                  color="success"
                >
                  {directInvite.success}
                </AppText>
              ) : null}
            </View>
          </>
        ) : null}

        <ListSeparator style={styles.separator} />
        <View testID="playlist-members-section" style={styles.paddedSection}>
          <AppText variant="overline" color="muted">
            {libraryStrings.playlist.collaborators}
          </AppText>

          {onOpenUser !== undefined && playlist.owner_id !== null ? (
            <Pressable
              testID="playlist-member-owner"
              accessibilityRole="button"
              accessibilityLabel={strings.profile.openUserProfile(ownerName)}
              onPress={() => {
                onClose();
                onOpenUser({ userId: playlist.owner_id!, name: ownerName });
              }}
              style={({ pressed }) => [styles.memberRow, pressed ? styles.pressed : null]}
            >
              <Artwork uri={ownerAvatar} size={layout.artwork.xs} shape="round" icon="account" />
              <View style={styles.memberCopy}>
                <AppText variant="bodyStrong" numberOfLines={1}>{ownerName}</AppText>
              </View>
              <View style={styles.roleBadge}>
                <AppText variant="micro" color="accent">
                  {libraryStrings.playlist.ownerBadge}
                </AppText>
              </View>
            </Pressable>
          ) : (
            <View testID="playlist-member-owner" style={styles.memberRow}>
              <Artwork uri={ownerAvatar} size={layout.artwork.xs} shape="round" icon="account" />
              <View style={styles.memberCopy}>
                <AppText variant="bodyStrong" numberOfLines={1}>{ownerName}</AppText>
              </View>
              <View style={styles.roleBadge}>
                <AppText variant="micro" color="accent">
                  {libraryStrings.playlist.ownerBadge}
                </AppText>
              </View>
            </View>
          )}

          {playlist.collaborators.length === 0 ? (
            <View testID="playlist-members-empty" style={styles.emptyMembers}>
              <AppText variant="callout" color="secondary">
                {libraryStrings.playlist.noCollaborators}
              </AppText>
              {playlist.is_owner ? (
                <AppText variant="caption" color="muted">
                  {libraryStrings.playlist.noCollaboratorsHint}
                </AppText>
              ) : null}
            </View>
          ) : (
            playlist.collaborators.map((member) => {
              const name = member.display_name?.trim() || libraryStrings.playlist.unknownUser;
              const avatarUrl =
                member.avatar_url === null ? null : resolveServerUrl(member.avatar_url, apiBase);
              const removingThis = removingUserId === member.user_id;
              return (
                <View
                  key={member.user_id}
                  testID={`playlist-member-${member.user_id}`}
                  style={styles.memberRow}
                >
                  {onOpenUser !== undefined ? (
                    <Pressable
                      testID={`playlist-member-open-${member.user_id}`}
                      accessibilityRole="button"
                      accessibilityLabel={strings.profile.openUserProfile(name)}
                      onPress={() => {
                        onClose();
                        onOpenUser({ userId: member.user_id, name });
                      }}
                      style={({ pressed }) => [styles.memberPress, pressed ? styles.pressed : null]}
                    >
                      <Artwork uri={avatarUrl} size={layout.artwork.xs} shape="round" icon="account" />
                      <View style={styles.memberCopy}>
                        <AppText variant="body" numberOfLines={1}>{name}</AppText>
                      </View>
                    </Pressable>
                  ) : (
                    <>
                      <Artwork uri={avatarUrl} size={layout.artwork.xs} shape="round" icon="account" />
                      <View style={styles.memberCopy}>
                        <AppText variant="body" numberOfLines={1}>{name}</AppText>
                      </View>
                    </>
                  )}
                  <View style={styles.roleBadge}>
                    <AppText variant="micro" color="secondary">
                      {libraryStrings.playlist.editorBadge}
                    </AppText>
                  </View>
                  {playlist.is_owner && onRemoveCollaborator !== undefined ? (
                    <IconButton
                      testID={`playlist-member-remove-${member.user_id}`}
                      icon="account-remove-outline"
                      size="sm"
                      color={colors.danger}
                      busy={removingThis}
                      disabled={busy || removingUserId !== null}
                      accessibilityLabel={libraryStrings.playlist.removeCollaborator(name)}
                      onPress={() => onRemoveCollaborator(member)}
                    />
                  ) : null}
                </View>
              );
            })
          )}

          {removeError !== null ? (
            <InlineNotice
              testID="playlist-member-remove-error"
              tone="danger"
              live="assertive"
              message={removeError}
            />
          ) : null}
        </View>

        {!playlist.is_owner && playlist.is_collaborator && onLeave !== undefined ? (
          <>
            <ListSeparator style={styles.separator} />
            <View style={styles.paddedSection}>
              <ActionButton
                testID="playlist-collaborators-leave"
                label={libraryStrings.playlist.leave}
                icon="logout"
                variant="danger"
                disabled={busy}
                fullWidth
                onPress={onLeave}
              />
            </View>
          </>
        ) : null}

        <View style={{ height: keyboardInset }} />
      </ScrollView>
    </BottomSheet>
  );
}

export interface PlaylistCollaboratorsSheetProps {
  visible: boolean;
  onClose: () => void;
  scope: string;
  apiBase: string;
  playlist: Playlist;
  busy: boolean;
  onToggleCollaborative: (enabled: boolean) => void;
  onOpenUser?: (params: { userId: number; name?: string }) => void;
  onLeave: () => void;
}

/**
 * Interactive Collaborators & Invite management bottom sheet.
 * Invite queries and mutations live here so PlaylistScreen stays lean and
 * only fetches owner invite tokens while the sheet is actually open.
 */
export function PlaylistCollaboratorsSheet({
  visible,
  onClose,
  scope,
  apiBase,
  playlist,
  busy,
  onToggleCollaborative,
  onOpenUser,
  onLeave,
}: PlaylistCollaboratorsSheetProps) {
  const queryClient = useQueryClient();
  const keyboardInset = useKeyboardInset();
  const [email, setEmail] = useState('');
  const [emailValidation, setEmailValidation] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);

  const inviteQuery = useQuery({
    ...musicQueries.playlistInvite(scope, playlist.id),
    enabled: visible && playlist.is_owner && playlist.is_collaborative,
  });

  const createInviteMutation = useMutation({
    ...musicMutations.createPlaylistInvite(scope),
    onSuccess: (created) => {
      queryClient.setQueryData(queryKeys.playlists.invite(scope, playlist.id), {
        invite: created,
      });
    },
  });

  const revokeInviteMutation = useMutation({
    ...musicMutations.revokePlaylistInvite(scope),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.playlists.invite(scope, playlist.id), {
        invite: null,
      });
    },
  });

  const addCollaboratorMutation = useMutation({
    ...musicMutations.addPlaylistCollaborator(scope),
    onSuccess: async (added) => {
      setEmail('');
      setEmailValidation(null);
      setAddSuccess(
        libraryStrings.playlist.directInviteSuccess(
          added.display_name?.trim() || libraryStrings.playlist.unknownUser,
        ),
      );
      await invalidatePlaylistCaches(queryClient, scope, playlist.id);
    },
  });

  const removeCollaboratorMutation = useMutation({
    ...musicMutations.removePlaylistCollaborator(scope),
    onSuccess: async () => {
      await invalidatePlaylistCaches(queryClient, scope, playlist.id);
    },
    onSettled: () => {
      setRemovingUserId(null);
    },
  });

  const handleShare = (invite: PlaylistInvite) => {
    setShareError(null);
    void (async () => {
      const url = playlistInviteUrl(apiBase, invite.token);
      await Share.share({
        message: libraryStrings.playlist.shareInviteMessage(playlist.name, url),
      });
    })().catch(() => {
      setShareError(libraryStrings.playlist.inviteShareFailed);
    });
  };

  const handleCreateOrRotate = (hasExisting: boolean) => {
    createInviteMutation.reset();
    revokeInviteMutation.reset();
    setShareError(null);
    if (!hasExisting) {
      createInviteMutation.mutate(playlist.id);
      return;
    }
    Alert.alert(
      libraryStrings.playlist.rotateInviteTitle,
      libraryStrings.playlist.rotateInviteMessage,
      [
        { text: libraryStrings.common.cancel, style: 'cancel' },
        {
          text: libraryStrings.playlist.rotateInviteConfirm,
          style: 'destructive',
          onPress: () => createInviteMutation.mutate(playlist.id),
        },
      ],
    );
  };

  const handleRevoke = () => {
    createInviteMutation.reset();
    revokeInviteMutation.reset();
    setShareError(null);
    Alert.alert(
      libraryStrings.playlist.revokeInviteTitle,
      libraryStrings.playlist.revokeInviteMessage,
      [
        { text: libraryStrings.common.cancel, style: 'cancel' },
        {
          text: libraryStrings.playlist.revokeInviteConfirm,
          style: 'destructive',
          onPress: () => revokeInviteMutation.mutate(playlist.id),
        },
      ],
    );
  };

  const handleDirectInviteSubmit = () => {
    setAddSuccess(null);
    const invalid = validateDirectInviteEmail(email);
    setEmailValidation(invalid);
    if (invalid !== null) return;
    addCollaboratorMutation.reset();
    addCollaboratorMutation.mutate({ id: playlist.id, email: normalizeEmail(email) });
  };

  const handleRemoveCollaborator = (member: PlaylistCollaborator) => {
    const name = member.display_name?.trim() || libraryStrings.playlist.unknownUser;
    Alert.alert(
      libraryStrings.playlist.removeCollaboratorTitle,
      libraryStrings.playlist.removeCollaboratorMessage(name),
      [
        { text: libraryStrings.common.cancel, style: 'cancel' },
        {
          text: libraryStrings.playlist.removeCollaboratorConfirm,
          style: 'destructive',
          onPress: () => {
            removeCollaboratorMutation.reset();
            setRemovingUserId(member.user_id);
            removeCollaboratorMutation.mutate({ id: playlist.id, userId: member.user_id });
          },
        },
      ],
    );
  };

  const inviteMutationError =
    createInviteMutation.error !== null || revokeInviteMutation.error !== null
      ? libraryStrings.playlist.inviteMutationFailed
      : null;

  return (
    <PlaylistCollaboratorsSheetContent
      visible={visible}
      onClose={onClose}
      apiBase={apiBase}
      playlist={playlist}
      busy={busy}
      invite={
        playlist.is_owner
          ? {
              loading: inviteQuery.isPending && inviteQuery.fetchStatus === 'fetching',
              error: inviteQuery.error,
              data: inviteQuery.data?.invite,
              busy: createInviteMutation.isPending || revokeInviteMutation.isPending,
              mutationError: inviteMutationError,
              shareError,
              onRetry: () => void inviteQuery.refetch(),
              onShare: handleShare,
              onCreateOrRotate: handleCreateOrRotate,
              onRevoke: handleRevoke,
            }
          : null
      }
      directInvite={
        playlist.is_owner
          ? {
              email,
              busy: addCollaboratorMutation.isPending,
              error:
                emailValidation
                ?? (addCollaboratorMutation.error !== null
                  ? directInviteErrorMessage(
                      addCollaboratorMutation.error,
                      playlist.is_collaborative,
                    )
                  : null),
              success: addSuccess,
              onEmailChange: (value) => {
                setEmail(value);
                if (emailValidation !== null) setEmailValidation(null);
                if (addSuccess !== null) setAddSuccess(null);
              },
              onSubmit: handleDirectInviteSubmit,
            }
          : null
      }
      removingUserId={removingUserId}
      removeError={
        removeCollaboratorMutation.error !== null
          ? libraryStrings.playlist.removeCollaboratorFailed
          : null
      }
      onToggleCollaborative={playlist.is_owner ? onToggleCollaborative : undefined}
      onRemoveCollaborator={playlist.is_owner ? handleRemoveCollaborator : undefined}
      onOpenUser={onOpenUser}
      onLeave={!playlist.is_owner && playlist.is_collaborator ? onLeave : undefined}
      keyboardInset={keyboardInset}
    />
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.xs,
  },
  title: { flex: 1 },
  content: { gap: spacing.xs, paddingBottom: spacing.sm },
  section: { gap: spacing.xs },
  paddedSection: { gap: spacing.sm, paddingHorizontal: spacing.sm },
  separator: { marginVertical: spacing.xs },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inviteActiveBox: { gap: spacing.sm },
  inviteEmptyBox: { gap: spacing.sm },
  inviteUrlBox: {
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceElevated,
  },
  inviteSecondaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  flexAction: { flexGrow: 1, flexBasis: 120 },
  directInviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  emailInput: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  memberRow: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  memberPress: {
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: { opacity: opacity.pressed },
  memberCopy: { flex: 1, minWidth: 0 },
  roleBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs / 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  emptyMembers: { gap: spacing.xxs, paddingVertical: spacing.xs },
});
