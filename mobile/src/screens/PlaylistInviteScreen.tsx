import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/error';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { refreshAutoBrowse } from '../components/library/autoBrowse';
import { InlineNotice } from '../components/library/InlineNotice';
import { ActionButton, AppText, Artwork, ErrorState } from '../components/ui';
import { getCurrentApiBase } from '../config';
import {
  invalidatePlaylistCaches,
  musicCacheScope,
  musicMutations,
  musicQueries,
} from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { playlistInviteTokenFromRouteValue } from '../navigationLinks';
import { colors, layout, radii, spacing } from '../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
import type { OwnedPlaylistRouteParams } from './libraryModel';
import { libraryStrings } from './libraryStrings';

export interface PlaylistInviteScreenProps {
  /** Validated invite token from `/playlist/join/:token`. */
  token: string;
  onOpenPlaylist: (params: OwnedPlaylistRouteParams) => void;
  onClose: () => void;
}

export function playlistInviteErrorPresentation(
  error: unknown,
  offline: boolean,
): { message: string; retryable: boolean; kind: 'error' | 'offline' } {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return {
        message: libraryStrings.playlist.inviteJoin.notFoundMessage,
        retryable: false,
        kind: 'error',
      };
    }
    if (error.status === 410) {
      return {
        message: libraryStrings.playlist.inviteJoin.expiredOrRevokedMessage,
        retryable: false,
        kind: 'error',
      };
    }
  }
  if (offline) {
    return {
      message: libraryStrings.common.offline,
      retryable: true,
      kind: 'offline',
    };
  }
  return {
    message: libraryStrings.common.loadFailed,
    retryable: true,
    kind: 'error',
  };
}

export function playlistInviteJoinErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return libraryStrings.playlist.inviteJoin.notFoundMessage;
    if (error.status === 410) return libraryStrings.playlist.inviteJoin.expiredOrRevokedMessage;
  }
  return libraryStrings.playlist.inviteJoin.joinFailed;
}

/** Malformed playlist invite link whose token cannot be valid. */
export function InvalidPlaylistInviteLink({ onClose }: { onClose: () => void }) {
  return (
    <View testID="playlist-invite-invalid" style={styles.centered}>
      <AppText variant="title" align="center" accessibilityRole="header">
        {libraryStrings.playlist.inviteJoin.invalidLinkTitle}
      </AppText>
      <AppText color="secondary" align="center" accessibilityRole="alert">
        {libraryStrings.playlist.inviteJoin.invalidLinkBody}
      </AppText>
      <ActionButton
        testID="playlist-invite-invalid-back"
        label={libraryStrings.playlist.inviteJoin.back}
        onPress={onClose}
      />
    </View>
  );
}

/**
 * Preview and accept screen for `/playlist/join/:token` collaborative playlist invites.
 * Fails loud on invalid, expired, revoked, or unreachable invites without silent fallbacks.
 */
export default function PlaylistInviteScreen({
  token,
  onOpenPlaylist,
  onClose,
}: PlaylistInviteScreenProps) {
  const validToken = playlistInviteTokenFromRouteValue(token);
  if (validToken === null) throw new Error('PlaylistInviteScreen requires a valid invite token');
  const { user } = useAuth();
  if (user === null) throw new Error('PlaylistInviteScreen requires an authenticated user');

  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const bottomInset = useBottomInset({ hasTabBar: false });
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'playlist-invite', active: isFocused, enabled: tv.isTv });

  const previewQuery = useQuery(musicQueries.playlistInvitePreview(scope, validToken));
  const joinMutation = useMutation({
    ...musicMutations.acceptPlaylistInvite(scope),
    onSuccess: async (result) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, result.playlist_id),
        refreshAutoBrowse(),
      ]);
      onOpenPlaylist({
        kind: 'playlist',
        playlistId: result.playlist_id,
        name: result.playlist_name,
      });
    },
  });

  if (previewQuery.isPending && previewQuery.fetchStatus === 'fetching') {
    return (
      <View testID="playlist-invite-loading" style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
        <AppText color="secondary">{libraryStrings.playlist.inviteJoin.loading}</AppText>
      </View>
    );
  }

  const preview = previewQuery.data;
  if (preview === undefined) {
    const offline = previewQuery.fetchStatus === 'paused';
    const failure = playlistInviteErrorPresentation(previewQuery.error, offline);
    return (
      <View testID="playlist-invite-error-screen" style={styles.centered}>
        <ErrorState
          layout="inline"
          testID="playlist-invite-error"
          retryTestID="playlist-invite-retry"
          kind={failure.kind}
          message={failure.message}
          onRetry={failure.retryable ? () => void previewQuery.refetch() : undefined}
          retryBusy={previewQuery.fetchStatus === 'fetching'}
        />
        <ActionButton
          testID="playlist-invite-error-back"
          variant="secondary"
          label={libraryStrings.playlist.inviteJoin.back}
          onPress={onClose}
        />
      </View>
    );
  }

  const coverUrl =
    preview.cover_url === null ? null : resolveServerUrl(preview.cover_url, apiBase);
  const ownerAvatarUrl =
    preview.owner.avatar_url === null
      ? null
      : resolveServerUrl(preview.owner.avatar_url, apiBase);
  const ownerName = preview.owner.display_name?.trim() || libraryStrings.playlist.unknownUser;
  const alreadyMember = preview.is_owner || preview.already_collaborator;

  return (
    <TvFocusScope scope="playlist-invite">
      <ScrollView
        testID="playlist-invite-screen"
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <Artwork uri={coverUrl} size={layout.artwork.hero} icon="playlist-music" />
        <View style={styles.identity}>
          <AppText variant="overline" color="accent">
            {libraryStrings.playlist.collaborativeBadge}
          </AppText>
          <AppText
            testID="playlist-invite-title"
            accessibilityRole="header"
            variant="hero"
            align="center"
            numberOfLines={3}
          >
            {preview.name}
          </AppText>
          <View style={styles.ownerRow}>
            <Artwork uri={ownerAvatarUrl} size={28} shape="round" icon="account" />
            <AppText testID="playlist-invite-owner" variant="callout" color="secondary">
              {libraryStrings.playlist.inviteJoin.byOwner(ownerName)}
            </AppText>
          </View>
          <AppText testID="playlist-invite-summary" variant="callout" color="muted" align="center">
            {libraryStrings.playlist.inviteJoin.summary(
              preview.track_count,
              preview.collaborator_count,
            )}
          </AppText>
          {preview.description ? (
            <AppText
              testID="playlist-invite-description"
              variant="callout"
              color="secondary"
              align="center"
              numberOfLines={4}
            >
              {preview.description}
            </AppText>
          ) : null}
        </View>

        {joinMutation.error !== null ? (
          <InlineNotice
            testID="playlist-invite-join-error"
            tone="danger"
            live="assertive"
            message={playlistInviteJoinErrorMessage(joinMutation.error)}
          />
        ) : null}

        {alreadyMember ? (
          <View testID="playlist-invite-member-status" style={styles.statusBanner}>
            <AppText variant="callout" color="secondary" align="center">
              {preview.is_owner
                ? libraryStrings.playlist.inviteJoin.alreadyOwner
                : libraryStrings.playlist.inviteJoin.alreadyCollaborator}
            </AppText>
          </View>
        ) : null}

        <View style={styles.actions}>
          {alreadyMember ? (
            <ActionButton
              testID="playlist-invite-open"
              label={libraryStrings.playlist.inviteJoin.openPlaylist}
              icon="playlist-music"
              fullWidth
              onPress={() =>
                onOpenPlaylist({
                  kind: 'playlist',
                  playlistId: preview.playlist_id,
                  name: preview.name,
                })
              }
            />
          ) : (
            <ActionButton
              testID="playlist-invite-accept"
              label={
                joinMutation.isPending
                  ? libraryStrings.playlist.inviteJoin.joining
                  : libraryStrings.playlist.inviteJoin.joinAction
              }
              icon="account-plus-outline"
              busy={joinMutation.isPending}
              fullWidth
              onPress={() => {
                joinMutation.reset();
                joinMutation.mutate(validToken);
              }}
            />
          )}
          <ActionButton
            testID="playlist-invite-cancel"
            variant="ghost"
            label={libraryStrings.playlist.inviteJoin.back}
            disabled={joinMutation.isPending}
            fullWidth
            onPress={onClose}
          />
        </View>
      </ScrollView>
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: layout.stackGap,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xl,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  identity: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.xs,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusBanner: {
    alignSelf: 'stretch',
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.fill,
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
