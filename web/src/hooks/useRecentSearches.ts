"use client";

import { useLocalJson } from "@/hooks/useLocalJson";
import { rememberSearch } from "@/app/search/history";
import { SEARCH_MIN_LENGTH } from "@/lib/catalogQueries";

const EMPTY: string[] = [];
export function useRecentSearches() {
  const [recent, setRecent] = useLocalJson<string[]>("sf_recent_searches", EMPTY);
  if (!Array.isArray(recent) || recent.some((term) => typeof term !== "string" || !term.trim()))
    throw new Error('Suchverlauf "sf_recent_searches" enthält ungültige Suchbegriffe.');
  return {
    recent,
    remember: (value: string) => {
      if (value.trim().length >= SEARCH_MIN_LENGTH)
        setRecent((current) => rememberSearch(current, value));
    },
    remove: (value: string) => setRecent((current) => current.filter((term) => term !== value)),
    clear: () => setRecent([]),
  };
}
