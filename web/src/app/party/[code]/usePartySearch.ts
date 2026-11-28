"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeCatalogQuery, searchTracksOptions } from "@/lib/catalogQueries";
import { isRateLimitError } from "@/lib/rateLimit";
import { partyFailureMessage } from "../requests";

/**
 * Explicit-submit track search for the party, backed by the shared catalog
 * query cache for instant cache reuse and in-flight deduplication across
 * surfaces. Editing or clearing the field detaches the query observer
 * immediately, aborting unshared in-flight requests and hiding stale results.
 */
export function usePartySearch() {
  const [query, setQuery] = useState("");
  const [submittedTerm, setSubmittedTerm] = useState<string | null>(null);

  const searchQuery = useQuery({
    ...searchTracksOptions(submittedTerm ?? ""),
    enabled: submittedTerm !== null,
  });

  const change = (value: string) => {
    setQuery(value);
    setSubmittedTerm(null);
  };

  const run = () => {
    const term = normalizeCatalogQuery(query);
    if (!term) return;
    if (submittedTerm === term) {
      void searchQuery.refetch();
    } else {
      setSubmittedTerm(term);
    }
  };

  const active = submittedTerm !== null;
  const searching = active && searchQuery.isFetching;
  const rateLimitError =
    active && searchQuery.isError && isRateLimitError(searchQuery.error)
      ? searchQuery.error
      : null;
  const error =
    active && searchQuery.isError && !rateLimitError
      ? partyFailureMessage(
          `Suche nach "${submittedTerm}" fehlgeschlagen`,
          searchQuery.error,
        )
      : null;
  const results = active && searchQuery.isSuccess && !searching ? searchQuery.data : [];
  const searchedTerm = active && searchQuery.isSuccess && !searching ? submittedTerm : null;

  return {
    query,
    results,
    searching,
    searchedTerm,
    error,
    rateLimitError,
    canSubmit: !searching && normalizeCatalogQuery(query).length > 0,
    change,
    clear: () => change(""),
    run,
  };
}

export type PartySearch = ReturnType<typeof usePartySearch>;
