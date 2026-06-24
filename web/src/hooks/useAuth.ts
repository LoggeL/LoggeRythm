"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { User } from "@/types";

export function useMe() {
  return useQuery<User | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    qc.setQueryData(["me"], null);
    qc.invalidateQueries({ queryKey: ["likes"] });
    qc.invalidateQueries({ queryKey: ["playlists"] });
    router.push("/");
  };
}
