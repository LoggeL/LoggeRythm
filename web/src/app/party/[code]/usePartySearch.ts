"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Track } from "@/types";
import { createPartySearchRequests, partyFailureMessage } from "../requests";

/**
 * Explicit-submit track search for the party. Editing or clearing the field
 * aborts the request in flight and drops its results, so only the newest
 * submitted term can ever update the list.
 */
export function usePartySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  // Term of the last completed search; drives the "keine Treffer" state.
  const [searchedTerm, setSearchedTerm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests] = useState(createPartySearchRequests);

  useEffect(() => () => requests.cancel(), [requests]);

  const change = (value: string) => {
    requests.cancel();
    setQuery(value);
    setSearching(false);
    setError(null);
    setResults([]);
    setSearchedTerm(null);
  };

  const run = async () => {
    const term = query.trim();
    if (!term) return;
    const request = requests.start();
    setSearching(true);
    setError(null);
    setResults([]);
    setSearchedTerm(null);
    try {
      const tracks = await api.search(term, "track", request.signal);
      if (!request.isCurrent()) return;
      setResults(tracks);
      setSearchedTerm(term);
    } catch (cause) {
      if (!request.isCurrent()) return;
      setError(partyFailureMessage(`Suche nach "${term}" fehlgeschlagen`, cause));
    } finally {
      if (request.isCurrent()) setSearching(false);
    }
  };

  return {
    query,
    results,
    searching,
    searchedTerm,
    error,
    canSubmit: !searching && query.trim().length > 0,
    change,
    clear: () => change(""),
    run: () => {
      void run();
    },
  };
}

export type PartySearch = ReturnType<typeof usePartySearch>;
