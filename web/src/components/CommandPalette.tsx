"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  normalizeCatalogQuery,
  SEARCH_DEBOUNCE_MS,
  searchArtistsOptions,
  searchTracksOptions,
} from "@/lib/catalogQueries";
import { trackArtistLabel } from "@/lib/trackArtists";
import { usePlayerStore } from "@/store/player";
import { SearchIcon, PlayIcon, CloseIcon } from "@/components/icons";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import type { Track, ArtistSummary } from "@/types";
import { useDialogFocus } from "@/hooks/useDialogFocus";

type Row =
  | { kind: "track"; track: Track }
  | { kind: "artist"; artist: ArtistSummary };

function rowKey(row: Row) {
  return row.kind === "track" ? `track-${row.track.id}` : `artist-${row.artist.id}`;
}

/**
 * Global ⌘K / Ctrl+K command palette: a search overlay reachable from any
 * route. Arrow keys move the selection, Enter activates (play track / open
 * artist), Esc closes. Uses the existing search API (debounced).
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        setOpen(false);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);

  return open ? <PaletteDialog onClose={() => setOpen(false)} /> : null;
}

// Unmount the observers when closed. A shared route query continues; a request
// used only by this dialog is cancelled by React Query through its signal.
function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDialogFocus(true, panelRef, onClose);
  const router = useRouter();
  const playQueue = usePlayerStore((s) => s.playQueue);

  // Debounce the query.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(normalizeCatalogQuery(q)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q]);

  const tracks = useQuery({
    ...searchTracksOptions(debounced),
    enabled: debounced.length > 1,
  });
  const artists = useQuery({
    ...searchArtistsOptions(debounced),
    enabled: debounced.length > 1,
  });

  const term = normalizeCatalogQuery(q);
  const preparing = term !== debounced;
  const rows: Row[] = preparing || debounced.length <= 1 ? [] : [
    ...(artists.isError ? [] : artists.data ?? []).slice(0, 3).map((artist) => ({
      kind: "artist" as const,
      artist,
    })),
    ...(tracks.isError ? [] : tracks.data ?? []).slice(0, 8).map((track) => ({
      kind: "track" as const,
      track,
    })),
  ];
  // A slower artist response can prepend rows. Keep the chosen track selected.
  const selected = Math.max(rows.findIndex((row) => rowKey(row) === selectedKey), 0);
  useEffect(() => {
    panelRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, rows.length]);

  function activate(row: Row) {
    if (row.kind === "track") {
      const list = tracks.data;
      if (!list || tracks.isError) throw new Error("Schnellsuche: Die ausgewählten Titel sind nicht verfügbar.");
      const idx = list.findIndex((t) => String(t.id) === String(row.track.id));
      if (idx < 0) throw new Error("Schnellsuche: Der ausgewählte Titel fehlt in den aktuellen Ergebnissen.");
      playQueue(list, idx);
    } else {
      router.push(`/artist/${row.artist.id}`);
    }
    onClose();
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = rows[Math.min(selected + 1, Math.max(rows.length - 1, 0))];
      if (next) setSelectedKey(rowKey(next));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[Math.max(selected - 1, 0)];
      if (next) setSelectedKey(rowKey(next));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[selected]) activate(rows[selected]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[10dvh] bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Schnellsuche"
        tabIndex={-1}
        className="surface-card w-full max-w-xl shadow-2xl overflow-hidden pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <SearchIcon width={18} height={18} className="text-muted" />
          <input
            role="combobox"
            aria-label="Künstler und Songs suchen"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={rows.length > 0}
            aria-activedescendant={rows.length > 0 ? `${listId}-${selected}` : undefined}
            data-dialog-autofocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelectedKey(null);
            }}
            onKeyDown={onInputKey}
            placeholder="Künstler und Songs suchen…"
            className="min-w-0 flex-1 bg-transparent outline-none text-foreground placeholder:text-muted"
          />
          <kbd className="hidden sm:block text-[10px] text-muted border border-white/15 rounded px-1.5 py-0.5">
            Esc
          </kbd>
          <button type="button" aria-label="Schnellsuche schließen" onClick={onClose} className="action-secondary p-2">
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className="max-h-[50dvh] overflow-y-auto scroll-area py-2">
          {term.length <= 1 && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium">Deine Musik, direkt erreichbar</p>
              <p className="mt-2 text-sm text-muted">Suche mit mindestens zwei Zeichen nach Titeln oder Künstlern.</p>
            </div>
          )}
          {term.length > 1 && (preparing || (!tracks.isError && !artists.isError && rows.length === 0)) && (
            <p role="status" className="px-5 py-8 text-sm text-muted text-center">
              {preparing || tracks.isLoading || artists.isLoading
                ? "Sucht…"
                : "Keine Treffer."}
            </p>
          )}
          {!preparing && debounced.length > 1 && [
            { label: "Titel", result: tracks },
            { label: "Künstler", result: artists },
          ].filter(({ result }) => result.isError).map(({ label, result }) => (
            <div key={label} role="alert" className="mx-3 my-2 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {label} konnten nicht geladen werden: {result.error?.message}
              <button type="button" className="action-secondary mt-3 block px-3 py-1.5 text-xs" disabled={result.isFetching} onClick={() => void result.refetch()}>Erneut versuchen</button>
            </div>
          ))}
          <div id={listId} role="listbox" aria-label="Suchergebnisse" aria-busy={preparing || tracks.isFetching || artists.isFetching}>
          {rows.map((row, i) => {
            const active = i === selected;
            const key = rowKey(row);
            return (
              <button
                key={key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={active}
                tabIndex={-1}
                type="button"
                onMouseEnter={() => setSelectedKey(key)}
                onClick={() => activate(row)}
                className={`flex items-center gap-3 w-full px-5 py-3 text-left transition ${
                  active ? "bg-white/8" : "hover:bg-white/5"
                }`}
              >
                {row.kind === "track" ? (
                  <>
                    {row.track.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.track.cover}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <CoverPlaceholder className="w-10 h-10 rounded-lg flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {row.track.title}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {trackArtistLabel(row.track)}
                      </div>
                    </div>
                    {active && (
                      <PlayIcon width={16} height={16} className="text-accent" />
                    )}
                  </>
                ) : (
                  <>
                    {row.artist.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.artist.picture}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <CoverPlaceholder className="w-9 h-9 rounded-full flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {row.artist.name}
                      </div>
                      <div className="truncate text-xs text-muted">Künstler</div>
                    </div>
                  </>
                )}
              </button>
            );
          })}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-xs text-muted">
          <span>↑ ↓ auswählen</span>
          <span>Enter öffnen oder abspielen</span>
        </div>
      </div>
    </div>
  );
}
