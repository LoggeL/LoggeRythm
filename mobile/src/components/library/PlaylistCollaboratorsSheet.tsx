import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/error';
import type {
  Playlist,
  PlaylistCollaborator,
  PlaylistCollaboratorUser,
  PlaylistInviteCandidate,
  PlaylistOutgoingInvitation,
} from '../../api/types';
import { resolveServerUrl } from '../../api/url';
import {
  invalidatePlaylistCaches,
  musicMutations,
  musicQueries,
  queryKeys,
  type QueryScope,
} from '../../data';
import { strings } from '../../localization';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, metrics, opacity, radii, spacing, typography } from '../../theme';
import { ActionButton, AppText, Artwork, BottomSheet, ErrorState, IconButton, ListSeparator } from '../ui';
import { InlineNotice } from './InlineNotice';
import { SheetActionRow } from './SheetActionRow';
import { useKeyboardInset } from './useKeyboardInset';

export const INVITE_SEARCH_DEBOUNCE_MS = 300;

/** The "Eingeladen" button is permanently disabled; it only shows the status. */
const ALREADY_INVITED_PRESS = () => undefined;

/** Maps invite failures to German copy; the backend owns which account is invitable. */
export function inviteErrorMessage(error: unknown, isCollaborative: boolean): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return libraryStrings.playlist.inviteNotFound;
    if (error.status === 400) return libraryStrings.playlist.inviteSelf;
    if (error.status === 409) {
      return isCollaborative
        ? libraryStrings.playlist.inviteAlreadyMember
        : libraryStrings.playlist.inviteCollaborationDisabled;
    }
  }
  return libraryStrings.playlist.inviteFailed;
}

function userName(user: PlaylistCollaboratorUser): string {
  return user.display_name?.trim() || libraryStrings.playlist.unknownUser;
}

export interface InviteSearchState {
  /** Raw text field value. */
  input: string;
  onInputChange: (value: string) => void;
  /** Debounced, trimmed query that was searched; empty while no search is active. */
  query: string;
  loading: boolean;
  error: unknown;
  candidates: PlaylistInviteCandidate[] | undefined;
  onRetry: () => void;
  invitingUserId: number | null;
  inviteError: string | null;
  inviteSuccess: string | null;
  onInvite: (candidate: PlaylistInviteCandidate) => void;
}

export interface PendingInvitationsState {
  loading: boolean;
  error: unknown;
  data: PlaylistOutgoingInvitation[] | undefined;
  onRetry: () => void;
  withdrawingUserId: number | null;
  withdrawError: string | null;
  onWithdraw: (invitation: PlaylistOutgoingInvitation) => void;
}

export interface PlaylistCollaboratorsSheetContentProps {
  visible: boolean;
  onClose: () => void;
  apiBase: string;
  playlist: Playlist;
  /** Owner mutation (toggle collaborative, etc.) is running. */
  busy: boolean;
  /** Owner-only account search; null for collaborators. */
  inviteSearch: InviteSearchState | null;
  /** Owner-only pending invitations; null for collaborators. */
  pendingInvitations: PendingInvitationsState | null;
  removingUserId: number | null;
  removeError: string | null;
  onToggleCollaborative?: (enabled: boolean) => void;
  onRemoveCollaborator?: (collaborator: PlaylistCollaborator) => void;
  onOpenUser?: (params: { userId: number; name?: string }) => void;
  onLeave?: () => void;
  keyboardInset?: number;
}

function avatarUri(user: PlaylistCollaboratorUser, apiBase: string): string | null {
  return user.avatar_url === null ? null : resolveServerUrl(user.avatar_url, apiBase);
}

function InviteCandidateTrailing({
  candidate,
  busy,
  invitingUserId,
  onInvite,
}: {
  candidate: PlaylistInviteCandidate;
  busy: boolean;
  invitingUserId: number | null;
  onInvite: (candidate: PlaylistInviteCandidate) => void;
}) {
  const id = candidate.user.id;
  switch (candidate.status) {
    case 'available':
      return (
        <ActionButton
          testID={`playlist-invite-candidate-invite-${id}`}
          label={libraryStrings.playlist.inviteAction}
          accessibilityLabel={libraryStrings.playlist.inviteActionLabel(userName(candidate.user))}
          icon="account-plus-outline"
          variant="secondary"
          busy={invitingUserId === id}
          disabled={busy || invitingUserId !== null}
          onPress={() => onInvite(candidate)}
        />
      );
    case 'invited':
      return (
        <ActionButton
          testID={`playlist-invite-candidate-invited-${id}`}
          label={libraryStrings.playlist.invitedStatus}
          icon="check"
          variant="ghost"
          disabled
          onPress={ALREADY_INVITED_PRESS}
        />
      );
    case 'collaborator':
      return (
        <View testID={`playlist-invite-candidate-collaborator-${id}`} style={styles.roleBadge}>
          <AppText variant="micro" color="secondary">
            {libraryStrings.playlist.collaboratorStatus}
          </AppText>
        </View>
      );
  }
}

function InviteSearchResults({
  search,
  apiBase,
  busy,
}: {
  search: InviteSearchState;
  apiBase: string;
  busy: boolean;
}) {
  if (search.query.length === 0) return null;
  if (search.candidates === undefined) {
    if (search.loading) {
      return (
        <View testID="playlist-invite-search-loading" style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} size="small" />
          <AppText variant="callout" color="secondary">
            {libraryStrings.playlist.inviteSearchLoading}
          </AppText>
        </View>
      );
    }
    if (search.error !== null) {
      return (
        <ErrorState
          layout="inline"
          testID="playlist-invite-search-error"
          retryTestID="playlist-invite-search-retry"
          message={libraryStrings.playlist.inviteSearchFailed}
          onRetry={search.onRetry}
        />
      );
    }
    return null;
  }
  if (search.candidates.length === 0) {
    return (
      <AppText testID="playlist-invite-search-empty" variant="callout" color="muted">
        {libraryStrings.playlist.inviteSearchEmpty(search.query)}
      </AppText>
    );
  }
  return (
    <View testID="playlist-invite-candidates" style={styles.list}>
      {search.candidates.map((candidate) => (
        <View
          key={candidate.user.id}
          testID={`playlist-invite-candidate-${candidate.user.id}`}
          style={styles.memberRow}
        >
          <Artwork
            uri={avatarUri(candidate.user, apiBase)}
            size={layout.artwork.xs}
            shape="round"
            icon="account"
          />
          <View style={styles.memberCopy}>
            <AppText variant="body" numberOfLines={1}>{userName(candidate.user)}</AppText>
          </View>
          <InviteCandidateTrailing
            candidate={candidate}
            busy={busy}
            invitingUserId={search.invitingUserId}
            onInvite={search.onInvite}
          />
        </View>
      ))}
    </View>
  );
}

function PendingInvitationsSection({
  pending,
  apiBase,
  busy,
}: {
  pending: PendingInvitationsState;
  apiBase: string;
  busy: boolean;
}) {
  // Nothing pending: the section disappears instead of showing an empty list.
  if (pending.data !== undefined && pending.data.length === 0 && pending.withdrawError === null) {
    return null;
  }
  let body: React.ReactNode;
  if (pending.data === undefined) {
    body = pending.loading ? (
      <View testID="playlist-pending-invitations-loading" style={styles.loadingRow}>
        <ActivityIndicator color={colors.accent} size="small" />
        <AppText variant="callout" color="secondary">
          {libraryStrings.playlist.pendingInvitationsLoading}
        </AppText>
      </View>
    ) : pending.error !== null ? (
      <ErrorState
        layout="inline"
        testID="playlist-pending-invitations-error"
        retryTestID="playlist-pending-invitations-retry"
        message={libraryStrings.playlist.pendingInvitationsLoadFailed}
        onRetry={pending.onRetry}
      />
    ) : null;
    if (body === null) return null;
  } else {
    body = pending.data.map((invitation) => {
      const id = invitation.invitee.id;
      const name = userName(invitation.invitee);
      return (
        <View
          key={id}
          testID={`playlist-pending-invitation-${id}`}
          style={styles.memberRow}
        >
          <Artwork
            uri={avatarUri(invitation.invitee, apiBase)}
            size={layout.artwork.xs}
            shape="round"
            icon="account"
          />
          <View style={styles.memberCopy}>
            <AppText variant="body" numberOfLines={1}>{name}</AppText>
          </View>
          <ActionButton
            testID={`playlist-pending-invitation-withdraw-${id}`}
            label={libraryStrings.playlist.withdrawInvitation}
            accessibilityLabel={libraryStrings.playlist.withdrawInvitationLabel(name)}
            icon="close"
            variant="secondary"
            busy={pending.withdrawingUserId === id}
            disabled={busy || pending.withdrawingUserId !== null}
            onPress={() => pending.onWithdraw(invitation)}
          />
        </View>
      );
    });
  }
  return (
    <>
      <ListSeparator style={styles.separator} />
      <View testID="playlist-pending-invitations-section" style={styles.paddedSection}>
        <AppText variant="overline" color="muted">
          {libraryStrings.playlist.pendingInvitationsTitle}
        </AppText>
        {body}
        {pending.withdrawError !== null ? (
          <InlineNotice
            testID="playlist-pending-invitation-withdraw-error"
            tone="danger"
            live="assertive"
            message={pending.withdrawError}
          />
        ) : null}
      </View>
    </>
  );
}

/**
 * Pure presentational view of the collaborators sheet so every role and
 * state (owner, collaborator, frozen, search/pending loading/error/data) is
 * directly testable without mocking hooks.
 */
export function PlaylistCollaboratorsSheetContent({
  visible,
  onClose,
  apiBase,
  playlist,
  busy,
  inviteSearch,
  pendingInvitations,
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
              {libraryStrings.playlist.inviteDisabledHint}
            </AppText>
          </View>
        ) : null}

        {playlist.is_owner && playlist.is_collaborative && inviteSearch !== null ? (
          <>
            <ListSeparator style={styles.separator} />
            <View testID="playlist-invite-search-section" style={styles.paddedSection}>
              <AppText variant="overline" color="muted">
                {libraryStrings.playlist.inviteSearchTitle}
              </AppText>
              <TextInput
                testID="playlist-invite-search-input"
                accessibilityLabel={libraryStrings.playlist.inviteSearchLabel}
                placeholder={libraryStrings.playlist.inviteSearchPlaceholder}
                placeholderTextColor={colors.textMuted}
                selectionColor={colors.accent}
                value={inviteSearch.input}
                onChangeText={inviteSearch.onInputChange}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                maxLength={120}
                style={styles.searchInput}
              />
              <InviteSearchResults search={inviteSearch} apiBase={apiBase} busy={busy} />
              {inviteSearch.inviteError !== null ? (
                <InlineNotice
                  testID="playlist-invite-error"
                  tone="danger"
                  live="assertive"
                  message={inviteSearch.inviteError}
                />
              ) : null}
              {inviteSearch.inviteSuccess !== null ? (
                <AppText
                  testID="playlist-invite-success"
                  accessibilityLiveRegion="polite"
                  variant="callout"
                  color="success"
                >
                  {inviteSearch.inviteSuccess}
                </AppText>
              ) : null}
            </View>
          </>
        ) : null}

        {playlist.is_owner && playlist.is_collaborative && pendingInvitations !== null ? (
          <PendingInvitationsSection pending={pendingInvitations} apiBase={apiBase} busy={busy} />
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
              {playlist.is_owner && playlist.is_collaborative ? (
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
  scope: QueryScope;
  apiBase: string;
  playlist: Playlist;
  busy: boolean;
  onToggleCollaborative: (enabled: boolean) => void;
  onOpenUser?: (params: { userId: number; name?: string }) => void;
  onLeave: () => void;
}

function setCandidateStatus(
  client: QueryClient,
  scope: QueryScope,
  playlistId: number,
  userId: number,
  status: PlaylistInviteCandidate['status'],
): void {
  client.setQueriesData<PlaylistInviteCandidate[]>(
    { queryKey: queryKeys.playlists.inviteCandidatesRoot(scope, playlistId) },
    (current) =>
      current?.map((candidate) =>
        candidate.user.id === userId ? { ...candidate, status } : candidate,
      ),
  );
}

async function refreshInvitationQueries(
  client: QueryClient,
  scope: QueryScope,
  playlistId: number,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({
      queryKey: queryKeys.playlists.outgoingInvitations(scope, playlistId),
      exact: true,
    }),
    client.invalidateQueries({
      queryKey: queryKeys.playlists.inviteCandidatesRoot(scope, playlistId),
    }),
  ]);
}

/**
 * Interactive collaborators bottom sheet. Owners find existing accounts by
 * display name and invite them; the invitee accepts or declines from their
 * Library. Queries only run while the sheet is open for an owner.
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
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [invitingUserId, setInvitingUserId] = useState<number | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [withdrawingUserId, setWithdrawingUserId] = useState<number | null>(null);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), INVITE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const canManageInvites = visible && playlist.is_owner && playlist.is_collaborative;

  const candidatesQuery = useQuery({
    ...musicQueries.playlistInviteCandidates(scope, playlist.id, searchQuery),
    enabled: canManageInvites && searchQuery.length > 0,
  });

  const invitationsQuery = useQuery({
    ...musicQueries.playlistOutgoingInvitations(scope, playlist.id),
    enabled: canManageInvites,
  });

  const inviteMutation = useMutation({
    ...musicMutations.invitePlaylistCollaborator(scope),
    onSuccess: async (created) => {
      setInviteSuccess(libraryStrings.playlist.inviteSent(userName(created.invitee)));
      // The server confirmed the invitation; reflect it before the refetch lands
      // so the candidate cannot be invited twice.
      setCandidateStatus(queryClient, scope, playlist.id, created.invitee.id, 'invited');
      queryClient.setQueryData<PlaylistOutgoingInvitation[]>(
        queryKeys.playlists.outgoingInvitations(scope, playlist.id),
        (current) =>
          current === undefined
            ? undefined
            : [...current.filter((item) => item.invitee.id !== created.invitee.id), created],
      );
      await refreshInvitationQueries(queryClient, scope, playlist.id);
    },
    onError: async (error) => {
      // A conflict means our candidate statuses are out of date.
      if (error instanceof ApiError && error.status === 409) {
        await refreshInvitationQueries(queryClient, scope, playlist.id);
      }
    },
    onSettled: () => {
      setInvitingUserId(null);
    },
  });

  const withdrawMutation = useMutation({
    ...musicMutations.withdrawPlaylistInvitation(scope),
    onSuccess: async (_result, variables) => {
      queryClient.setQueryData<PlaylistOutgoingInvitation[]>(
        queryKeys.playlists.outgoingInvitations(scope, playlist.id),
        (current) => current?.filter((item) => item.invitee.id !== variables.userId),
      );
      setCandidateStatus(queryClient, scope, playlist.id, variables.userId, 'available');
      await refreshInvitationQueries(queryClient, scope, playlist.id);
    },
    onSettled: () => {
      setWithdrawingUserId(null);
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

  const handleClose = () => {
    setSearchInput('');
    setSearchQuery('');
    setInviteSuccess(null);
    inviteMutation.reset();
    withdrawMutation.reset();
    onClose();
  };

  const handleInvite = (candidate: PlaylistInviteCandidate) => {
    if (candidate.status !== 'available') {
      throw new Error(
        `Invite candidate ${candidate.user.id} has status ${candidate.status}, not available`,
      );
    }
    setInviteSuccess(null);
    inviteMutation.reset();
    setInvitingUserId(candidate.user.id);
    inviteMutation.mutate({ id: playlist.id, userId: candidate.user.id });
  };

  const handleWithdraw = (invitation: PlaylistOutgoingInvitation) => {
    setInviteSuccess(null);
    withdrawMutation.reset();
    setWithdrawingUserId(invitation.invitee.id);
    withdrawMutation.mutate({ id: playlist.id, userId: invitation.invitee.id });
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

  return (
    <PlaylistCollaboratorsSheetContent
      visible={visible}
      onClose={handleClose}
      apiBase={apiBase}
      playlist={playlist}
      busy={busy}
      inviteSearch={
        playlist.is_owner
          ? {
              input: searchInput,
              onInputChange: (value) => {
                setSearchInput(value);
                if (inviteSuccess !== null) setInviteSuccess(null);
              },
              query: searchQuery,
              loading: candidatesQuery.isPending && candidatesQuery.fetchStatus === 'fetching',
              error: candidatesQuery.error,
              candidates: candidatesQuery.data,
              onRetry: () => void candidatesQuery.refetch(),
              invitingUserId,
              inviteError:
                inviteMutation.error !== null
                  ? inviteErrorMessage(inviteMutation.error, playlist.is_collaborative)
                  : null,
              inviteSuccess,
              onInvite: handleInvite,
            }
          : null
      }
      pendingInvitations={
        playlist.is_owner
          ? {
              loading: invitationsQuery.isPending && invitationsQuery.fetchStatus === 'fetching',
              error: invitationsQuery.error,
              data: invitationsQuery.data,
              onRetry: () => void invitationsQuery.refetch(),
              withdrawingUserId,
              withdrawError:
                withdrawMutation.error !== null
                  ? libraryStrings.playlist.withdrawInvitationFailed
                  : null,
              onWithdraw: handleWithdraw,
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
  list: { gap: spacing.xxs },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchInput: {
    ...typography.body,
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
