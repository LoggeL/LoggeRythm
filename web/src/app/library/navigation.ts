export const LIBRARY_TABS = [
  "playlists",
  "liked",
  "recent",
  "downloads",
  "following",
] as const;

export type LibraryTab = (typeof LIBRARY_TABS)[number];

export function libraryTabFromParam(value: string | null): LibraryTab {
  return LIBRARY_TABS.includes(value as LibraryTab)
    ? (value as LibraryTab)
    : "playlists";
}

export function libraryTabHref(query: string, tab: LibraryTab): string {
  const params = new URLSearchParams(query);
  params.set("tab", tab);
  return `/library?${params.toString()}`;
}
