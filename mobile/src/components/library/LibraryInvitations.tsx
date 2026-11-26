import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/error';
import type { PlaylistIncomingInvitation } from '../../api/types';
import { resolveServerUrl } from '../../api/url';
import {
  invalidatePlaylistCaches,
  musicMutations,
  musicQueries,
  queryKeys,
  type QueryScope,
} from '../../data';
import type { OwnedPlaylistRouteParams } from '../../screens/libraryModel';
import { libraryStrings } from '../../screens/libraryStrings';
import { layout, spacing } from '../../theme';
import { ActionButton, AppText, Artwork, ErrorState, SectionHeader, Surface } from '../ui';
import { refreshAutoBrowse } from './autoBrowse';
import { InlineNotice } from './InlineNotice';

export type InvitationResponse = 'accept' | 'decline';

export function invitationResponseErrorMessage(
  error: unknown,
  response: InvitationResponse,
): string {
  if (error instanceof ApiError && error.status === 404) {
    return libraryStrings.library.invitationGone;
  }
  return response === 'accept'
    ? libraryStrings.library.invitationAcceptFailed
    : libraryStrings.library.invitationDeclineFailed;
}

export interface LibraryInvitationsContentProps {
  apiBase: string;
  /** undefined until the first successful load. */
  invitations: PlaylistIncomingInvitation[] | undefined;
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
  /** Invitation whose accept/decline request is in flight. */
  responding: { id: number; response: InvitationResponse } | null;
  responseError: string | null;
  onAccept: (invitation: PlaylistIncomingInvitation) => void;
  onDecline: (invitation: PlaylistIncomingInvitation) => void;
}

function personName(user: { display_name: string | null }): string {
  return user.display_name?.trim() || libraryStrings.playlist.unknownUser;
}

function InvitationCard({
  invitation,
  apiBase,
  responding,
  onAccept,
  onDecline,
}: {
  invitation: PlaylistIncomingInvitation;
  apiBase: string;
  responding: LibraryInvitationsContentProps['responding'];
  onAccept: (invitation: PlaylistIncomingInvitation) => void;
  onDecline: (invitation: PlaylistIncomingInvitation) => void;
}) {
  const { playlist } = invitation;
  const id = invitation.id;
  const busyHere = responding !== null && responding.id === id;
  const anyBusy = responding !== null;
  return (
    <Surface testID={`library-invitation-${id}`} level="card" padded style={styles.card}>
      <View style={styles.identity}>
        <Artwork
          uri={playlist.cover_url === null ? null : resolveServerUrl(playlist.cover_url, apiBase)}
          size={layout.artwork.md}
          icon="playlist-music"
        />
        <View style={styles.copy}>
          <AppText testID={`library-invitation-${id}-name`} variant="bodyStrong" numberOfLines={1}>
            {playlist.name}
          </AppText>
          <AppText
            testID={`library-invitation-${id}-owner`}
            variant="callout"
            color="secondary"
            numberOfLines={1}
          >
            {libraryStrings.library.invitationOwnerSummary(
              personName(playlist.owner),
              playlist.track_count,
            )}
          </AppText>
          {invitation.invited_by !== null ? (
            <AppText
              testID={`library-invitation-${id}-inviter`}
              variant="caption"
              color="muted"
              numberOfLines={1}
            >
              {libraryStrings.library.invitationInvitedBy(personName(invitation.invited_by))}
            </AppText>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <ActionButton
          testID={`library-invitation-${id}-accept`}
          label={libraryStrings.library.acceptInvitation}
          accessibilityLabel={libraryStrings.library.acceptInvitationLabel(playlist.name)}
          icon="check"
          variant="primary"
          busy={busyHere && responding.response === 'accept'}
          disabled={anyBusy}
          onPress={() => onAccept(invitation)}
          style={styles.action}
        />
        <ActionButton
          testID={`library-invitation-${id}-decline`}
          label={libraryStrings.library.declineInvitation}
          accessibilityLabel={libraryStrings.library.declineInvitationLabel(playlist.name)}
          icon="close"
          variant="secondary"
          busy={busyHere && responding.response === 'decline'}
          disabled={anyBusy}
          onPress={() => onDecline(invitation)}
          style={styles.action}
        />
      </View>
    </Surface>
  );
}

/**
 * The Library's "Einladungen" section: pending playlist invitations addressed
 * to the current account. Hidden while nothing is pending; a failed load is
 * shown with Retry instead of silently hiding the section.
 */
export function LibraryInvitationsContent({
  apiBase,
  invitations,
  error,
  retrying,
  onRetry,
  responding,
  responseError,
  onAccept,
  onDecline,
}: LibraryInvitationsContentProps) {
  if (invitations === undefined && error === null) return null;
  if (invitations !== undefined && invitations.length === 0 && responseError === null) {
    return null;
  }
  return (
    <View testID="library-invitations" style={styles.section}>
      <SectionHeader title={libraryStrings.library.invitationsTitle} padded={false} />
      {invitations === undefined ? (
        <ErrorState
          layout="inline"
          testID="library-invitations-error"
          retryTestID="library-invitations-retry"
          message={libraryStrings.library.invitationsLoadFailed}
          onRetry={onRetry}
          retryBusy={retrying}
        />
      ) : (
        invitations.map((invitation) => (
          <InvitationCard
            key={invitation.id}
            invitation={invitation}
            apiBase={apiBase}
            responding={responding}
            onAccept={onAccept}
            onDecline={onDecline}
          />
        ))
      )}
      {responseError !== null ? (
        <InlineNotice
          testID="library-invitation-response-error"
          tone="danger"
          live="assertive"
          message={responseError}
        />
      ) : null}
    </View>
  );
}

export interface LibraryInvitationsProps {
  scope: QueryScope;
  apiBase: string;
  onOpenPlaylist: (params: OwnedPlaylistRouteParams) => void;
}

/**
 * Loads and answers the current account's pending playlist invitations.
 * Refetches whenever the Library regains focus so invitations sent while
 * the user was elsewhere appear without a manual refresh.
 */
export function LibraryInvitations({ scope, apiBase, onOpenPlaylist }: LibraryInvitationsProps) {
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const invitations = useQuery(musicQueries.incomingPlaylistInvitations(scope));
  const { refetch } = invitations;
  const [responding, setResponding] = useState<LibraryInvitationsContentProps['responding']>(null);
  const invitationsKey = queryKeys.playlists.incomingInvitations(scope);

  useEffect(() => {
    // cancelRefetch: false joins an in-flight load instead of restarting it.
    if (isFocused) void refetch({ cancelRefetch: false });
  }, [isFocused, refetch]);

  const dropInvitation = (invitationId: number) => {
    queryClient.setQueryData<PlaylistIncomingInvitation[]>(invitationsKey, (current) =>
      current?.filter((item) => item.id !== invitationId),
    );
  };

  const refreshInvitations = () =>
    queryClient.invalidateQueries({ queryKey: invitationsKey, exact: true });

  const acceptMutation = useMutation({
    ...musicMutations.acceptPlaylistInvitation(scope),
    onSuccess: async (result, invitationId) => {
      dropInvitation(invitationId);
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, result.playlist_id),
        refreshInvitations(),
        refreshAutoBrowse(),
      ]);
      onOpenPlaylist({
        kind: 'playlist',
        playlistId: result.playlist_id,
        name: result.playlist_name,
      });
    },
    onError: async (error) => {
      // 404: withdrawn or answered elsewhere; reload so the stale card disappears.
      if (error instanceof ApiError && error.status === 404) await refreshInvitations();
    },
    onSettled: () => setResponding(null),
  });

  const declineMutation = useMutation({
    ...musicMutations.declinePlaylistInvitation(scope),
    onSuccess: async (_result, invitationId) => {
      dropInvitation(invitationId);
      await refreshInvitations();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 404) await refreshInvitations();
    },
    onSettled: () => setResponding(null),
  });

  const responseError =
    acceptMutation.error !== null
      ? invitationResponseErrorMessage(acceptMutation.error, 'accept')
      : declineMutation.error !== null
        ? invitationResponseErrorMessage(declineMutation.error, 'decline')
        : null;

  return (
    <LibraryInvitationsContent
      apiBase={apiBase}
      invitations={invitations.data}
      error={invitations.error}
      retrying={invitations.fetchStatus === 'fetching'}
      onRetry={() => void refetch()}
      responding={responding}
      responseError={responseError}
      onAccept={(invitation) => {
        acceptMutation.reset();
        declineMutation.reset();
        setResponding({ id: invitation.id, response: 'accept' });
        acceptMutation.mutate(invitation.id);
      }}
      onDecline={(invitation) => {
        acceptMutation.reset();
        declineMutation.reset();
        setResponding({ id: invitation.id, response: 'decline' });
        declineMutation.mutate(invitation.id);
      }}
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginHorizontal: layout.pagePadding },
  card: { gap: spacing.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  action: { flexGrow: 1, flexBasis: 120 },
});
