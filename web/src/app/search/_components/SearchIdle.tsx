"use client";

import BrowseTile from "@/components/browse/BrowseTile";
import { BellIcon, CloseIcon, CompassIcon, HeartIcon, ImportIcon, RadioIcon, SearchIcon } from "@/components/icons";

/** What the search page offers before a query: history, browsing, import. */
export default function SearchIdle({
  minLength,
  showMinLengthHint,
  recent,
  onOpen,
  onRemove,
  onClear,
  onImport,
}: {
  minLength: number;
  showMinLengthHint: boolean;
  recent: string[];
  onOpen: (term: string) => void;
  onRemove: (term: string) => void;
  onClear: () => void;
  onImport: () => void;
}) {
  return (
    <div className="flex flex-col gap-9">
      {showMinLengthHint && (
        <p role="status" className="text-sm text-muted">
          Mindestens {minLength} Zeichen eingeben.
        </p>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="search-history-heading">
          <div className="section-heading">
            <h2 id="search-history-heading">Zuletzt gesucht</h2>
            <button type="button" onClick={onClear} className="section-link max-sm:min-h-11">
              Verlauf löschen
            </button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {recent.map((term) => (
              <li key={term} className="flex max-w-full items-center rounded-full bg-white/[0.07] transition-colors focus-within:bg-white/[0.12] hover:bg-white/[0.12]">
                <button type="button" className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-l-full py-2 pl-4 pr-1 text-sm font-semibold sm:min-h-9" onClick={() => onOpen(term)}>
                  <SearchIcon width={14} height={14} className="shrink-0 text-muted" />
                  <span className="truncate">{term}</span>
                </button>
                <button
                  type="button"
                  className="grid h-11 w-10 shrink-0 place-items-center rounded-r-full text-muted hover:text-foreground sm:h-9 sm:w-9"
                  aria-label={`Aus Suchverlauf entfernen: ${term}`}
                  onClick={() => onRemove(term)}
                >
                  <CloseIcon width={14} height={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="search-browse-heading">
        <div className="section-heading">
          <h2 id="search-browse-heading">Stöbern</h2>
        </div>
        <nav aria-label="Musik entdecken" className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
          <BrowseTile href="/genre" title="Entdecken" hint="Genres und Charts" icon={<CompassIcon width={72} height={72} />} tone={3} />
          <BrowseTile href="/radio" title="Radio" hint="Einfach laufen lassen" icon={<RadioIcon width={72} height={72} />} tone={4} />
          <BrowseTile href="/radar" title="Release Radar" hint="Neues von deinen Künstlern" icon={<BellIcon width={72} height={72} />} tone={1} />
          <BrowseTile href="/library?tab=liked" title="Lieblingssongs" hint="Deine gelikten Titel" icon={<HeartIcon width={72} height={72} />} tone={0} />
          <button type="button" onClick={onImport} className="group hover-lift gradient-green relative block h-24 overflow-hidden rounded-xl p-3.5 text-left sm:h-28 sm:p-4">
            <span className="font-display relative z-10 block max-w-[75%] text-[15px] font-bold leading-tight tracking-tight sm:text-lg">Spotify-Import</span>
            <span className="relative z-10 mt-1 block max-w-[70%] text-xs leading-snug text-foreground/75">Playlist per Link übernehmen</span>
            <span aria-hidden="true" className="absolute -bottom-1 -right-1 text-foreground/30 transition-transform duration-300 group-hover:scale-110">
              <ImportIcon width={72} height={72} />
            </span>
          </button>
        </nav>
      </section>
    </div>
  );
}
