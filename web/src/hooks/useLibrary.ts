"use client";

import {
  useIsMutating,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import type { Track, PlaylistSummary, Playlist } from "@/types";

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

function toggleLikeMutationKey(trackId: Track["id"]) {
  return ["toggle-like", String(trackId)] as const;
}

export function useLikePending(trackId: Track["id"]) {
  return (
    useIsMutating({
      mutationKey: toggleLikeMutationKey(trackId),
      exact: true,
    }) > 0
  );
}

export function useToggleLike(trackId: Track["id"]) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: toggleLikeMutationKey(trackId),
    mutationFn: async ({ track, liked }: { track: Track; liked: boolean }) => {
      if (liked) await api.unlike(String(track.id));
      else await api.like(track);
      return { track, liked };
    },
    onMutate: async ({ track, liked }) => {
      await qc.cancelQueries({ queryKey: ["likes"] });
      const prev = qc.getQueryData<Track[]>(["likes"]);
      qc.setQueryData<Track[]>(["likes"], (old = []) =>
        liked
          ? old.filter((t) => String(t.id) !== String(track.id))
          : [track, ...old.filter((t) => String(t.id) !== String(track.id))],
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
  });
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      api.createPlaylist(name, description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Playlist erstellt.");
    },
    onError: () => toast.error("Playlist konnte nicht erstellt werden."),
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
    onError: () => toast.error("Aktualisierung fehlgeschlagen."),
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlaylist(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Playlist gelöscht.");
    },
    onError: () => toast.error("Löschen fehlgeschlagen."),
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
    onError: () => toast.error("Zur Playlist hinzufügen fehlgeschlagen."),
  });
}

export function useRemoveFromPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deezerId }: { id: string; deezerId: string }) =>
      api.removeFromPlaylist(id, deezerId),
    onMutate: async ({ id, deezerId }) => {
      await qc.cancelQueries({ queryKey: ["playlist", id] });
      const prev = qc.getQueryData<Playlist>(["playlist", id]);
      qc.setQueryData<Playlist>(["playlist", id], (old) =>
        old
          ? { ...old, tracks: old.tracks.filter((t) => String(t.id) !== deezerId) }
          : old,
      );
      return { prev };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["playlist", vars.id], ctx.prev);
      toast.error("Entfernen fehlgeschlagen.");
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
    mutationFn: ({ id, deezerIds }: { id: string; deezerIds: string[] }) =>
      api.reorderPlaylistTracks(id, deezerIds),
    onMutate: async ({ id, deezerIds }) => {
      await qc.cancelQueries({ queryKey: ["playlist", id] });
      const prev = qc.getQueryData<Playlist>(["playlist", id]);
      qc.setQueryData<Playlist>(["playlist", id], (old) => {
        if (!old) return old;
        const byId = new Map(old.tracks.map((t) => [String(t.id), t]));
        const tracks = deezerIds
          .map((d) => byId.get(d))
          .filter((t): t is Track => !!t);
        return { ...old, tracks };
      });
      return { prev };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["playlist", vars.id], ctx.prev);
      toast.error("Sortieren fehlgeschlagen.");
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["playlist", vars.id] });
    },
  });
}
