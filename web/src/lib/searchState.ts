import type { SearchSort, SearchTab } from "../app/search/results";

export type SearchLocation = { query: string; tab: SearchTab; sort: SearchSort };
const tabs: SearchTab[] = ["all", "track", "album", "artist", "playlist"];
const sorts: SearchSort[] = ["relevance", "title", "dur-asc", "dur-desc"];

export function readSearchLocation(params: URLSearchParams): SearchLocation {
  const tab = params.get("type");
  const sort = params.get("sort");
  return {
    query: (params.get("q") ?? "").trim(),
    tab: tabs.includes(tab as SearchTab) ? tab as SearchTab : "all",
    sort: sorts.includes(sort as SearchSort) ? sort as SearchSort : "relevance",
  };
}

export function searchHref({ query, tab = "all", sort = "relevance" }: Partial<SearchLocation> & { query: string }): string {
  const params = new URLSearchParams();
  const term = query.trim();
  if (term) params.set("q", term);
  if (tab !== "all") params.set("type", tab);
  if (sort !== "relevance") params.set("sort", sort);
  return `/search${params.size ? `?${params}` : ""}`;
}
