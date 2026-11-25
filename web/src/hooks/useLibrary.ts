"use client";

import {
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
  PlaylistInvite,
  PlaylistInvitePreview,
  PlaylistInviteStatus,
  PlaylistCollaborator,
  PlaylistJoinResult,
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
      qc.removeQueries({ queryKey: ["playlist-invite", id] });
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
      if (!isCollaborative) {
        qc.setQueryData<PlaylistInviteStatus>(["playlist-invite", id], {
          invite: null,
        });
      }
      qc.invalidateQueries({ queryKey: ["playlist", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist-invite", id] });
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

export function usePlaylistInvite(id: string, enabled = true) {
  return useQuery<PlaylistInviteStatus>({
    queryKey: ["playlist-invite", id],
    queryFn: () => api.playlistInvite(id),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

export function useCreatePlaylistInvite(id: string) {
  const qc = useQueryClient();
  return useMutation<PlaylistInvite, Error, void>({
    mutationFn: () => api.createPlaylistInvite(id),
    onSuccess: (invite) => {
      qc.setQueryData<PlaylistInviteStatus>(["playlist-invite", id], { invite });
      qc.invalidateQueries({ queryKey: ["playlist", id] });
    },
    onError: (err) =>
      toast.error(
        `Einladungslink konnte nicht erstellt werden: ${errorMessage(err)}`,
      ),
  });
}

export function useRevokePlaylistInvite(id: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => api.revokePlaylistInvite(id),
    onSuccess: () => {
      qc.setQueryData<PlaylistInviteStatus>(["playlist-invite", id], {
        invite: null,
      });
      toast.success("Einladungslink widerrufen.");
    },
    onError: (err) =>
      toast.error(
        `Einladungslink konnte nicht widerrufen werden: ${errorMessage(err)}`,
      ),
  });
}

export function useAddPlaylistCollaborator(id: string) {
  const qc = useQueryClient();
  return useMutation<PlaylistCollaborator, Error, string>({
    mutationFn: (email) => api.addPlaylistCollaborator(id, email),
    onSuccess: (collaborator) => {
      qc.invalidateQueries({ queryKey: ["playlist", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      toast.success(
        `${collaborator.display_name || "Person"} wurde als Mitwirkende:r hinzugefügt.`,
      );
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
      qc.removeQueries({ queryKey: ["playlist-invite", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["public-playlists"] });
      toast.success("Playlist verlassen.");
    },
    onError: (err) =>
      toast.error(`Playlist konnte nicht verlassen werden: ${errorMessage(err)}`),
  });
}

export function usePlaylistInvitePreview(token: string, enabled = true) {
  return useQuery<PlaylistInvitePreview>({
    queryKey: ["playlist-invite-preview", token],
    queryFn: () => api.previewPlaylistInvite(token),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

export function useAcceptPlaylistInvite(token: string) {
  const qc = useQueryClient();
  return useMutation<PlaylistJoinResult, Error, void>({
    mutationFn: () => api.acceptPlaylistInvite(token),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({
        queryKey: ["playlist", String(result.playlist_id)],
      });
      qc.invalidateQueries({ queryKey: ["playlist-invite-preview", token] });
      qc.invalidateQueries({ queryKey: ["public-playlists"] });
    },
  });
}
