import type {
  Playlist,
  PlaylistCollaboratorUser,
  PlaylistInviteCandidateStatus,
  PlaylistSummary,
} from "@/types";

type PermissionShape = Pick<
  Playlist | PlaylistSummary,
  "is_owner" | "is_collaborator" | "is_collaborative" | "can_edit_tracks"
>;

/**
 * Whether the current user may add, remove, or reorder tracks in this playlist.
 * Prefers the server-computed `can_edit_tracks` flag when provided.
 */
export function canEditPlaylistTracks(playlist: PermissionShape): boolean {
  if (typeof playlist.can_edit_tracks === "boolean") {
    return playlist.can_edit_tracks;
  }
  return (
    Boolean(playlist.is_owner) ||
    (Boolean(playlist.is_collaborator) && Boolean(playlist.is_collaborative))
  );
}

/**
 * Whether a playlist returned by `GET /playlists` is owned by the current user
 * (as opposed to shared with them as a collaborator).
 */
export function isOwnedLibraryPlaylist(
  playlist: Pick<PlaylistSummary, "is_owner" | "is_collaborator">,
): boolean {
  if (typeof playlist.is_owner === "boolean") return playlist.is_owner;
  return !playlist.is_collaborator;
}

/** Hero eyebrow text reflecting collaborative & visibility state. */
export function playlistHeroEyebrow(
  playlist: Pick<
    Playlist,
    "is_owner" | "is_public" | "is_collaborative" | "is_collaborator"
  >,
): string {
  if (playlist.is_collaborative) {
    if (playlist.is_owner && playlist.is_public) {
      return "Öffentliche gemeinsame Playlist";
    }
    return "Gemeinsame Playlist";
  }
  if (playlist.is_collaborator) {
    return "Geteilte Playlist · Schreibgeschützt";
  }
  if (!playlist.is_owner) return "Playlist";
  return playlist.is_public ? "Öffentliche Playlist" : "Private Playlist";
}

/**
 * Sidebar subtitle line. Always ends with `<N> Titel` so both users and
 * automated parsers see the track count consistently.
 */
export function sidebarPlaylistMeta(playlist: PlaylistSummary): string {
  const count = `${playlist.track_count} Titel`;
  if (!isOwnedLibraryPlaylist(playlist)) {
    const owner = playlist.owner_name ? `von ${playlist.owner_name}` : "Geteilt";
    return `${owner} · ${count}`;
  }
  if (playlist.is_collaborative) {
    return `Gemeinsam · ${count}`;
  }
  return count;
}

/** Library tile subtitle line distinguishing owned, collaborative, and shared playlists. */
export function libraryPlaylistSubtitle(playlist: PlaylistSummary): string {
  const count = `${playlist.track_count} Titel`;
  if (!isOwnedLibraryPlaylist(playlist)) {
    const status = playlist.is_collaborative ? "Gemeinsam" : "Geteilt";
    return playlist.owner_name
      ? `${status} · von ${playlist.owner_name} · ${count}`
      : `${status} · ${count}`;
  }
  if (playlist.is_collaborative) {
    return `Gemeinsam · ${count}`;
  }
  return `Playlist · ${count}`;
}

/** Total member count (owner + collaborators) for display in headers/dialogs. */
export function playlistMemberCount(
  playlist: Pick<Playlist, "collaborators" | "collaborator_count">,
): number {
  const collabCount =
    typeof playlist.collaborator_count === "number"
      ? playlist.collaborator_count
      : (playlist.collaborators?.length ?? 0);
  return 1 + collabCount;
}

/**
 * Only the owner of a playlist with collaboration switched on may invite
 * accounts; the server answers 409 for a playlist with collaboration off.
 */
export function canInviteToPlaylist(
  playlist: Pick<Playlist, "is_owner" | "is_collaborative">,
): boolean {
  return Boolean(playlist.is_owner) && Boolean(playlist.is_collaborative);
}

/**
 * Text sent to the account search, or `null` while there is nothing to search
 * for. The server rejects a query that is empty after trimming.
 */
export function inviteSearchQuery(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Button state of one account search result in the invite dialog. */
export function inviteCandidateAction(status: PlaylistInviteCandidateStatus): {
  label: string;
  canInvite: boolean;
} {
  switch (status) {
    case "available":
      return { label: "Einladen", canInvite: true };
    case "invited":
      return { label: "Eingeladen", canInvite: false };
    case "collaborator":
      return { label: "Mitwirkend", canInvite: false };
    default: {
      const unknown: never = status;
      throw new Error(`Unbekannter Einladungsstatus vom Server: ${String(unknown)}`);
    }
  }
}

/**
 * Name shown for an account in invitation lists. The account search only finds
 * accounts with a display name, but a name can be removed later.
 */
export function invitationUserName(user: PlaylistCollaboratorUser): string {
  return user.display_name || `Nutzer #${user.id}`;
}

const invitationDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "Eingeladen am 20. Nov. 2026"; a malformed server timestamp is an error. */
export function invitationDateLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Ungültiger Einladungszeitpunkt vom Server: ${createdAt}`);
  }
  return `Eingeladen am ${invitationDateFormatter.format(date)}`;
}
