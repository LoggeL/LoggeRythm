"use client";

import { useRouter } from "next/navigation";
import {
  useAcceptPlaylistInvitation,
  useDeclinePlaylistInvitation,
  useMyPlaylistInvitations,
} from "@/hooks/useLibrary";
import { invitationUserName } from "@/lib/playlistPermissions";
import { playlistPath } from "@/lib/slugs";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import Cover from "@/components/ui/Cover";
import QueryError from "@/components/ui/QueryError";
import { SpinnerIcon } from "@/components/icons";
import type { PlaylistIncomingInvitation } from "@/types";
import TabHeader from "./TabHeader";

function InvitationCard({
  invitation,
  accepting,
  declining,
  busy,
  onAccept,
  onDecline,
}: {
  invitation: PlaylistIncomingInvitation;
  accepting: boolean;
  declining: boolean;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { playlist } = invitation;
  const ownerName = invitationUserName(playlist.owner);
  const inviter = invitation.invited_by ?? null;
  const inviterName = inviter ? invitationUserName(inviter) : null;
  const headingId = `playlist-invitation-${invitation.id}`;

  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-hairline bg-foreground/[0.03] p-3.5 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <Cover
          src={playlist.cover_url ?? undefined}
          className="h-16 w-16 shrink-0 rounded-xl sm:h-[4.5rem] sm:w-[4.5rem]"
        />
        <div className="min-w-0 flex-1">
          <p id={headingId} className="truncate text-sm font-semibold text-foreground">
            {playlist.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            von {ownerName} · {playlist.track_count} Titel
          </p>
          {inviterName && (
            <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <Avatar src={inviter?.avatar_url} name={inviterName} size={18} />
              <span className="truncate">
                Eingeladen von <strong className="font-semibold text-foreground">{inviterName}</strong>
              </span>
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          aria-busy={accepting || undefined}
          aria-label={`Einladung zu „${playlist.name}“ annehmen`}
          className="action-primary min-h-10 flex-1 px-4 text-sm sm:flex-none"
        >
          {accepting && (
            <SpinnerIcon width={16} height={16} className="animate-spin" aria-hidden="true" />
          )}
          {accepting ? "Wird angenommen…" : "Annehmen"}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy}
          aria-busy={declining || undefined}
          aria-label={`Einladung zu „${playlist.name}“ ablehnen`}
          className="action-secondary min-h-10 flex-1 px-4 text-sm sm:flex-none"
        >
          {declining ? "Wird abgelehnt…" : "Ablehnen"}
        </button>
      </div>
    </li>
  );
}

/**
 * Playlist invitations addressed to the current account, shown above the
 * user's playlists. Renders nothing while there are none.
 */
export default function PlaylistInvitations() {
  const router = useRouter();
  const invitations = useMyPlaylistInvitations();
  const accept = useAcceptPlaylistInvitation();
  const decline = useDeclinePlaylistInvitation();
  const list = invitations.data;

  if (invitations.isError) {
    return <QueryError label="Deine Playlist-Einladungen" query={invitations} />;
  }
  if (!list || list.length === 0) return null;

  const busy = accept.isPending || decline.isPending;

  function handleAccept(invitation: PlaylistIncomingInvitation) {
    accept.mutate(invitation.id, {
      onSuccess: (result) => {
        toast.success(
          result.already_member
            ? `Du bist bereits in „${result.playlist_name}“.`
            : `Du arbeitest jetzt an „${result.playlist_name}“ mit.`,
        );
        router.push(playlistPath({ id: result.playlist_id, name: result.playlist_name }));
      },
    });
  }

  return (
    <section aria-labelledby="playlist-invitations-heading" className="flex flex-col">
      <TabHeader
        id="playlist-invitations-heading"
        title="Einladungen"
        meta={
          list.length === 1
            ? "Eine gemeinsame Playlist wartet auf deine Antwort."
            : `${list.length} gemeinsame Playlists warten auf deine Antwort.`
        }
      />
      <ul className="flex flex-col gap-2.5">
        {list.map((invitation) => (
          <InvitationCard
            key={invitation.id}
            invitation={invitation}
            accepting={accept.isPending && accept.variables === invitation.id}
            declining={
              decline.isPending && decline.variables?.invitationId === invitation.id
            }
            busy={busy}
            onAccept={() => handleAccept(invitation)}
            onDecline={() =>
              decline.mutate({
                invitationId: invitation.id,
                playlistName: invitation.playlist.name,
              })
            }
          />
        ))}
      </ul>
      {accept.isError && (
        <p role="alert" className="error-panel mt-3">
          Einladung konnte nicht angenommen werden: {accept.error.message}
        </p>
      )}
      {decline.isError && (
        <p role="alert" className="error-panel mt-3">
          Einladung zu „{decline.variables?.playlistName}“ konnte nicht abgelehnt werden:{" "}
          {decline.error.message}
        </p>
      )}
    </section>
  );
}
