"use client";

import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import CapacitorBackButton from "@/components/CapacitorBackButton";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import {
  createBrowserQueryPersister,
  isPersistedQueryKey,
  PERSISTED_QUERY_ROOTS,
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_MAX_AGE,
} from "@/lib/queryPersistence";

const STALE_TIME_BY_ROOT: Record<string, number> = {
  "home-mixes": 60 * 60 * 1000,
  "because-you-listened": 60 * 60 * 1000,
  "home-collections": 15 * 60 * 1000,
  "release-radar": 60 * 60 * 1000,
  "new-releases": 60 * 60 * 1000,
  genres: 24 * 60 * 60 * 1000,
  "public-playlists": 5 * 60 * 1000,
  "home-mood": 30 * 60 * 1000,
  genre: 60 * 60 * 1000,
  album: 60 * 60 * 1000,
  artist: 60 * 60 * 1000,
  "artist-about": 24 * 60 * 60 * 1000,
};

function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  for (const root of PERSISTED_QUERY_ROOTS) {
    client.setQueryDefaults([root], {
      gcTime: QUERY_CACHE_MAX_AGE,
      staleTime: STALE_TIME_BY_ROOT[root],
    });
  }
  return client;
}

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cacheError, setCacheError] = useState<Error | null>(null);
  const [client] = useState(createQueryClient);
  const [persister] = useState(() =>
    createBrowserQueryPersister(setCacheError),
  );

  if (cacheError) throw cacheError;

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: QUERY_CACHE_MAX_AGE,
        buster: QUERY_CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.data !== undefined &&
            isPersistedQueryKey(query.queryKey),
          shouldDehydrateMutation: () => false,
        },
      }}
      onError={() =>
        setCacheError(
          (current) =>
            current ??
            new Error(
              "Der persistierte UI-Cache konnte nicht wiederhergestellt werden.",
            ),
        )
      }
    >
      <CapacitorBackButton />
      <ServiceWorkerRegister />
      {children}
    </PersistQueryClientProvider>
  );
}
