"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { shouldRemoveQueryForUserChange } from "@/lib/queryPersistence";
import type { User } from "@/types";

export function useMe() {
  return useQuery<User | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
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
    await api.logout();
    qc.removeQueries({
      predicate: (query) =>
        shouldRemoveQueryForUserChange(query.queryKey),
    });
    qc.setQueryData(["me"], null);
    router.push("/");
  };
}
