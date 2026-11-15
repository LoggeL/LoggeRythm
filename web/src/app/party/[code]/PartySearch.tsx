import SearchField from "@/components/SearchField";
import EmptyState from "@/components/ui/EmptyState";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { trackArtistLabel } from "@/lib/trackArtists";
import type { Track } from "@/types";
import PartyTrackRow, { PartyTrackRowsSkeleton } from "./PartyTrackRow";
import type { PartySearch as PartySearchState } from "./usePartySearch";

/** Search the catalogue and add hits to the shared queue. */
export default function PartySearch({
  search,
  disabled,
  onAdd,
}: {
  search: PartySearchState;
  /** Blocks adding while another queue change is still being saved. */
  disabled: boolean;
  onAdd: (track: Track) => void | Promise<void>;
}) {
  const { query, results, searching, searchedTerm, error } = search;
  return (
    <section id="party-search" aria-labelledby="party-search-title" className="min-w-0 scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="party-search-title" className="font-display text-[1.625rem] font-bold leading-tight tracking-tight">
          Songs hinzufügen
        </h2>
        <p className="text-sm text-muted">Jeder in der Party kann Titel zur gemeinsamen Warteschlange beisteuern.</p>
      </div>
      <SearchField
        value={query}
        onValueChange={search.change}
        onSubmit={search.run}
        onClear={search.clear}
        label="Nach Titeln für die Party suchen"
        placeholder="Nach Titeln suchen…"
        className="min-h-14! pr-2!"
        inputProps={{ "aria-busy": searching, enterKeyHint: "search" }}
        trailing={
          <button type="submit" disabled={!search.canSubmit} className="action-primary min-h-10 shrink-0 px-4">
            {searching ? "Sucht…" : "Suchen"}
          </button>
        }
      />

      <div className="mt-4 empty:hidden">
        {searching && <PartyTrackRowsSkeleton label="Titel werden gesucht…" />}
        {error && (
          <div className="error-panel flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="min-w-0">
              {error}
            </p>
            <button type="button" onClick={search.run} className="action-secondary min-h-9 px-4 text-xs">
              Erneut versuchen
            </button>
          </div>
        )}
        {results.length === 0 && searchedTerm && !searching && (
          <EmptyState icon={<SearchIcon width={22} height={22} />} title={`Keine Treffer für „${searchedTerm}“`}>
            Prüfe die Schreibweise oder suche nach dem Interpreten statt nach dem Titel.
          </EmptyState>
        )}
        {results.length > 0 && (
          <>
            <p className="label-mono mb-2 tabular-nums">
              {results.length} Treffer
              {searchedTerm && <span className="normal-case tracking-normal"> für „{searchedTerm}“</span>}
            </p>
            <ul aria-label="Suchergebnisse" className="-mx-2 flex flex-col gap-0.5 sm:-mx-3">
              {results.map((track) => (
                <PartyTrackRow key={track.id} cover={track.cover} title={track.title} subtitle={trackArtistLabel(track)}>
                  <button
                    type="button"
                    onClick={() => onAdd(track)}
                    disabled={disabled}
                    aria-label={`"${track.title}" zur Party hinzufügen`}
                    className="action-secondary min-h-11 min-w-11 shrink-0 px-3 sm:min-h-9 sm:px-4 sm:text-xs"
                  >
                    <PlusIcon width={16} height={16} aria-hidden="true" />
                    <span className="hidden sm:inline">Hinzufügen</span>
                  </button>
                </PartyTrackRow>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
