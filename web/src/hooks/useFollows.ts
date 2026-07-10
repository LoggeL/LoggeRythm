"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import type { ArtistSummary } from "@/types";

export function useFollowing(enabled = true) {
  return useQuery<ArtistSummary[]>({
    queryKey: ["following"],
    queryFn: () => api.following(),
    enabled,
    retry: false,
  });
}

export function useFollowedIds(enabled = true) {
  const { data } = useFollowing(enabled);
  return new Set((data ?? []).map((a) => String(a.id)));
}

export function useToggleFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      artist,
      following,
    }: {
      artist: ArtistSummary;
      following: boolean;
    }) => {
      if (following) await api.unfollow(String(artist.id));
      else await api.follow(artist);
      return { artist, following };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["following"] });
      qc.invalidateQueries({ queryKey: ["release-radar"] });
      qc.invalidateQueries({ queryKey: ["home-mixes"] });
      qc.invalidateQueries({ queryKey: ["because-you-listened"] });
      toast.success(vars.following ? "Nicht mehr gefolgt." : "Künstler gefolgt.");
    },
    onError: () => toast.error("Aktion fehlgeschlagen."),
  });
}
