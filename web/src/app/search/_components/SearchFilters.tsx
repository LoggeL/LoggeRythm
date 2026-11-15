"use client";

import type { SearchSort, SearchTab } from "../results";

const TABS: { key: SearchTab; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "track", label: "Titel" },
  { key: "artist", label: "Künstler" },
  { key: "album", label: "Alben" },
  { key: "playlist", label: "Playlists" },
];
const SORTS: { key: SearchSort; label: string }[] = [
  { key: "relevance", label: "Relevanz" },
  { key: "title", label: "Titel A bis Z" },
  { key: "dur-asc", label: "Kürzeste zuerst" },
  { key: "dur-desc", label: "Längste zuerst" },
];

/** Result type chips, plus the track sort order while only tracks are listed. */
export default function SearchFilters({
  tab,
  sort,
  showSort,
  onTab,
  onSort,
}: {
  tab: SearchTab;
  sort: SearchSort;
  showSort: boolean;
  onTab: (tab: SearchTab) => void;
  onSort: (sort: SearchSort) => void;
}) {
  return (
    <>
      <nav aria-label="Suchbereiche" className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-2 max-md:basis-full overflow-x-auto px-1 py-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onTab(item.key)}
            aria-pressed={tab === item.key}
            className="filter-chip shrink-0 max-sm:min-h-11"
          >
            {item.label}
          </button>
        ))}
      </nav>
      {showSort && (
        <select
          aria-label="Titel sortieren"
          value={sort}
          onChange={(event) => onSort(event.target.value as SearchSort)}
          className="field-input w-auto shrink-0 rounded-full py-2 pl-4 pr-3 text-xs font-semibold sm:min-h-9"
        >
          {SORTS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
