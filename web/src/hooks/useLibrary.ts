"use client";

import {
  keepPreviousData,
  useIsMutating,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  findLikedTrack,
  getLikedTrackIndex,
  isSameRecording,
  trackLikeIdentityKey,
} from "@/lib/trackIdentity";
import { toast } from "@/store/toast";
import type {
  Track,
  PlaylistSummary,
  Playlist,
  PlaylistTrack,
  PlaylistIncomingInvitation,
  PlaylistInviteCandidate,
  PlaylistJoinResult,
  PlaylistOutgoingInvitation,
} from "@/types";

export function useLikes(enabled = true) {
  return useQuery<Track[]>({
    queryKey: ["likes"],
    queryFn: () => api.likes(),
    enabled,
    retry: false,
  });
}

export function useLikedIds(enabled = true) {
  const { data } = useLikes(enabled);
  return new Set((data ?? []).map((t) => String(t.id)));
}

/**
 * Find the user's liked row matching `track` by ID, ISRC, or fallback metadata
 * so Single / EP / Album / Deluxe releases share one heart state.
 */
export function useLikedTrack(track: Track, enabled = true): Track | undefined {
  const { data } = useLikes(enabled);
  if (!data || data.length === 0) return undefined;
  return findLikedTrack(getLikedTrackIndex(data), track);
}

function toggleLikeMutationKey(trackOrId: Track | Track["id"]) {
  return ["toggle-like", trackLikeIdentityKey(trackOrId)] as const;
}

export function useLikePending(trackOrId: Track | Track["id"]) {
  return (
    useIsMutating({
      mutationKey: toggleLikeMutationKey(trackOrId),
      exact: true,
    }) > 0
  );
}

export function useToggleLike(trackOrId: Track | Track["id"]) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: toggleLikeMutationKey(trackOrId),
    mutationFn: async ({
      track,
      liked,
      matchedLikeId,
    }: {
      track: Track;
      liked: boolean;
      matchedLikeId?: Track["id"];
    }) => {
      if (liked) await api.unlike(String(matchedLikeId ?? track.id));
      else await api.like(track);
      return { track, liked };
    },
    onMutate: async ({ track, liked }) => {
      await qc.cancelQueries({ queryKey: ["likes"] });
      const prev = qc.getQueryData<Track[]>(["likes"]);
      qc.setQueryData<Track[]>(["likes"], (old = []) =>
        liked
          ? old.filter((t) => !isSameRecording(t, track))
          : [track, ...old.filter((t) => !isSameRecording(t, track))],
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["likes"], ctx.prev);
      toast.error("Aktion fehlgeschlagen.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["likes"] });
    },
  });
}

export function usePlaylists(enabled = true) {
  return useQuery<PlaylistSummary[]>({
    queryKey: ["playlists"],
    queryFn: () => api.playlists(),
    enabled,
    retry: false,
  });
}

export function usePlaylist(id: string) {
  return useQuery<Playlist>({
    queryKey: ["playlist", id],
    queryFn: () => api.playlist(id),
    enabled: !!id,
    refetchOnWindowFocus: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      description,
      is_collaborative,
    }: {
      name: string;
      description?: string;
      is_collaborative?: boolean;
    }) => api.createPlaylist(name, description, is_collaborative),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Playlist erstellt.");
    },
    onError: (err) => toast.error(`Playlist konnte nicht erstellt werden: ${errorMessage(err)}`),
  });
}

export function useUpdatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; description?: string };
    }) => api.updatePlaylist(id, patch),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist", vars.id] });
      toast.success("Playlist aktualisiert.");
    },
    onError: (err) => toast.error(`Aktualisierung fehlgeschlagen: ${errorMessage(err)}`),
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlaylist(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ["playlist", id] });
      qc.removeQueries({ queryKey: ["playlist-invitations", id] });
      qc.removeQueries({ queryKey: ["playlist-invite-candidates", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["public-playlists"] });
      toast.success("Playlist gelöscht.");
    },
    onError: (err) => toast.error(`Löschen fehlgeschlagen: ${errorMessage(err)}`),
  });
}

export function useAddToPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, track }: { id: string; track: Track }) =>
      api.addToPlaylist(id, track),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["playlist", vars.id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
    },
    onError: (err) => toast.error(`Zur Playlist hinzufügen fehlgeschlagen: ${errorMessage(err)}`),
  });
}

export function useRemoveFromPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      deezerId,
      entryId,
    }: {
      id: string;
      deezerId: string;
      entryId?: number;
    }) =>
      entryId !== undefined
        ? api.removePlaylistEntry(id, entryId)
        : api.removeFromPlaylist(id, deezerId),
    onMutate: async ({ id, deezerId, entryId }) => {
      await qc.cancelQueries({ queryKey: ["playlist", id] });
      const prev = qc.getQueryData<Playlist>(["playlist", id]);
      qc.setQueryData<Playlist>(["playlist", id], (old) =>
        old
          ? {
              ...old,
              tracks: old.tracks.filter((t) =>
                entryId !== undefined
                  ? t.playlist_entry_id !== entryId
                  : String(t.id) !== deezerId,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["playlist", vars.id], ctx.prev);
      toast.error(`Entfernen fehlgeschlagen: ${errorMessage(err)}`);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["playlist", vars.id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
    },
  });
}

export function useReorderPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      deezerIds,
      entryIds,
    }: {
      id: string;
      deezerIds?: string[];
      entryIds?: number[];
    }) => {
      if (entryIds !== undefined) {
        return api.reorderPlaylistEntries(id, entryIds);
      }
      if (deezerIds !== undefined) {
        return api.reorderPlaylistTracks(id, deezerIds);
      }
      throw new Error("Sortierung erfordert entweder entryIds oder deezerIds.");
    },
    onMutate: async ({ id, deezerIds, entryIds }) => {
      await qc.cancelQueries({ queryKey: ["playlist", id] });
      const prev = qc.getQueryData<Playlist>(["playlist", id]);
      qc.setQueryData<Playlist>(["playlist", id], (old) => {
        if (!old) return old;
        if (entryIds !== undefined) {
          const byEntryId = new Map(
            old.tracks
              .filter((t) => t.playlist_entry_id !== undefined)
              .map((t) => [t.playlist_entry_id as number, t]),
          );
          const tracks = entryIds
            .map((entryId) => byEntryId.get(entryId))
            .filter((t): t is PlaylistTrack => !!t);
          return tracks.length === old.tracks.length ? { ...old, tracks } : old;
        }
        if (deezerIds !== undefined) {
          const byId = new Map(old.tracks.map((t) => [String(t.id), t]));
          const tracks = deezerIds
            .map((d) => byId.get(d))
            .filter((t): t is PlaylistTrack => !!t);
          return { ...old, tracks };
        }
        return old;
      });
      return { prev };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["playlist", vars.id], ctx.prev);
      toast.error(`Sortieren fehlgeschlagen: ${errorMessage(err)}`);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["playlist", vars.id] });
    },
  });
}

export function useSetPlaylistCollaborative(id: string) {
  const qc = useQueryClient();
  return useMutation<PlaylistSummary, Error, boolean>({
    mutationFn: (isCollaborative) =>
      api.setPlaylistCollaborative(id, isCollaborative),
    onSuccess: (_data, isCollaborative) => {
      qc.invalidateQueries({ queryKey: ["playlist", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      // Disabling collaboration deletes every pending invitation server-side.
      qc.invalidateQueries({ queryKey: ["playlist-invitations", id] });
      qc.invalidateQueries({ queryKey: ["playlist-invite-candidates", id] });
      qc.invalidateQueries({ queryKey: ["public-playlists"] });
      toast.success(
        isCollaborative
          ? "Gemeinsame Bearbeitung aktiviert."
          : "Gemeinsame Bearbeitung deaktiviert.",
      );
    },
    onError: (err) =>
      toast.error(
        `Gemeinsame Bearbeitung konnte nicht geändert werden: ${errorMessage(err)}`,
      ),
  });
}

/**
 * Owner-only account search for the invite dialog. `query` must already be
 * trimmed and debounced; an empty query disables the request.
 */
export function usePlaylistInviteCandidates(id: string, query: string, enabled = true) {
  return useQuery<PlaylistInviteCandidate[]>({
    queryKey: ["playlist-invite-candidates", id, query],
    queryFn: ({ signal }) => api.playlistInviteCandidates(id, query, signal),
    enabled: Boolean(id) && query.length > 0 && enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Owner-only: invitations of this playlist that are still unanswered. */
export function usePlaylistOutgoingInvitations(id: string, enabled = true) {
  return useQuery<PlaylistOutgoingInvitation[]>({
    queryKey: ["playlist-invitations", id],
    queryFn: () => api.playlistInvitations(id),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

export function useInviteToPlaylist(id: string) {
  const qc = useQueryClient();
  return useMutation<
    PlaylistOutgoingInvitation,
    Error,
    { userId: number; name: string }
  >({
    mutationFn: ({ userId }) => api.inviteToPlaylist(id, userId),
    onSuccess: (_invitation, vars) => {
      qc.invalidateQueries({ queryKey: ["playlist-invitations", id] });
      qc.invalidateQueries({ queryKey: ["playlist-invite-candidates", id] });
      toast.success(`${vars.name} wurde eingeladen.`);
    },
  });
}

export function useWithdrawPlaylistInvitation(id: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { userId: number; name: string }>({
    mutationFn: ({ userId }) => api.withdrawPlaylistInvitation(id, userId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["playlist-invitations", id] });
      qc.invalidateQueries({ queryKey: ["playlist-invite-candidates", id] });
      toast.success(`Einladung an ${vars.name} zurückgezogen.`);
    },
  });
}

export function useRemovePlaylistCollaborator(id: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { userId: number; name?: string | null }>({
    mutationFn: ({ userId }) => api.removePlaylistCollaborator(id, userId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["playlist", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist-invite-candidates", id] });
      toast.success(
        `${vars.name || "Mitwirkende:r"} wurde entfernt.`,
      );
    },
    onError: (err) =>
      toast.error(`Entfernen fehlgeschlagen: ${errorMessage(err)}`),
  });
}

export function useLeavePlaylist() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.leavePlaylist(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ["playlist", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["public-playlists"] });
      toast.success("Playlist verlassen.");
    },
    onError: (err) =>
      toast.error(`Playlist konnte nicht verlassen werden: ${errorMessage(err)}`),
  });
}

/** Pending playlist invitations addressed to the current account. */
export function useMyPlaylistInvitations(enabled = true) {
  return useQuery<PlaylistIncomingInvitation[]>({
    queryKey: ["my-playlist-invitations"],
    queryFn: () => api.myPlaylistInvitations(),
    enabled,
    retry: false,
  });
}

export function useAcceptPlaylistInvitation() {
  const qc = useQueryClient();
  return useMutation<PlaylistJoinResult, Error, number>({
    mutationFn: (invitationId) => api.acceptPlaylistInvitation(invitationId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["my-playlist-invitations"] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({
        queryKey: ["playlist", String(result.playlist_id)],
      });
      qc.invalidateQueries({ queryKey: ["public-playlists"] });
    },
  });
}

export function useDeclinePlaylistInvitation() {
  const qc = useQueryClient();
  return useMutation<void, Error, { invitationId: number; playlistName: string }>({
    mutationFn: ({ invitationId }) => api.declinePlaylistInvitation(invitationId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["my-playlist-invitations"] });
      toast.success(`Einladung zu „${vars.playlistName}“ abgelehnt.`);
    },
  });
}
