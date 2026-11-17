"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  normalizeCatalogQuery, SEARCH_MIN_LENGTH,
  searchAlbumsOptions, searchArtistsOptions, searchPlaylistsOptions, searchTracksOptions,
} from "@/lib/catalogQueries";
import { deezerPlaylistPath } from "@/lib/slugs";
import { trackArtistLabel } from "@/lib/trackArtists";
import { usePlayerStore } from "@/store/player";
import { SearchIcon, PlayIcon, CloseIcon } from "@/components/icons";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import SearchField from "@/components/SearchField";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useSearchInput } from "@/hooks/useSearchInput";
import { useSearchNavigation } from "@/hooks/useSearchNavigation";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { movePaletteSelection, paletteRows, paletteRowKey, paletteSelectedIndex, type PaletteRow } from "./commandPaletteModel";

/** Keyboard search shares catalog requests and history with the search route. */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    function onOpenEvent() { setOpen(true); }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);
  return open ? <PaletteDialog onClose={() => setOpen(false)} /> : null;
}

// Closing removes these observers, cancelling requests exclusive to this dialog.
export function PaletteDialog({ onClose }: { onClose: () => void }) {
  const navigation = useSearchNavigation();
  const [initialQuery] = useState(navigation.input || navigation.query);
  const search = useSearchInput(initialQuery);
  const history = useRecentSearches();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const mounted = useRef(false);
  const inputSnapshot = useRef(search.input);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDialogFocus(true, panelRef, closeDialog);
  const router = useRouter();
  const playQueue = usePlayerStore((state) => state.playQueue);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const enabled = !search.preparing && search.query.length >= SEARCH_MIN_LENGTH;
  const tracks = useQuery({ ...searchTracksOptions(search.query), enabled });
  const artists = useQuery({ ...searchArtistsOptions(search.query), enabled });
  const albums = useQuery({ ...searchAlbumsOptions(search.query), enabled });
  const playlists = useQuery({ ...searchPlaylistsOptions(search.query), enabled });
  const sources = [
    { label: "Titel", result: tracks }, { label: "Künstler", result: artists },
    { label: "Alben", result: albums }, { label: "Playlists", result: playlists },
  ];
  const rows = enabled ? paletteRows({
    tracks: tracks.isError ? undefined : tracks.data,
    artists: artists.isError ? undefined : artists.data,
    albums: albums.isError ? undefined : albums.data,
    playlists: playlists.isError ? undefined : playlists.data,
  }) : [];
  const selected = paletteSelectedIndex(rows, selectedKey);
  const term = normalizeCatalogQuery(search.input);
  const fetching = enabled && sources.some(({ result }) => result.isFetching);
  const empty = enabled && sources.every(({ result }) => result.isSuccess && result.data.length === 0);

  useEffect(() => {
    panelRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, rows.length]);

  function changeInput(value: string) {
    inputSnapshot.current = value;
    search.setInput(value);
    setSelectedKey(null);
  }
  function clearInput() {
    inputSnapshot.current = "";
    search.clear();
    setSelectedKey(null);
  }
  function closeDialog() {
    onClose();
  }
  function fullResults(value = inputSnapshot.current) {
    if (normalizeCatalogQuery(value).length < SEARCH_MIN_LENGTH) return;
    navigation.openResults(value);
    closeDialog();
  }

  function activate(row: PaletteRow) {
    // Event handlers from a previous render must never activate an old term.
    if (!mounted.current || !enabled || normalizeCatalogQuery(inputSnapshot.current) !== search.query) return;
    if (!rows.some((current) => paletteRowKey(current) === paletteRowKey(row))) return;
    if (row.kind === "track") {
      if (!tracks.data || tracks.isError) throw new Error("Suche: Die ausgewählten Titel sind nicht verfügbar.");
      const index = tracks.data.findIndex((track) => String(track.id) === String(row.track.id));
      if (index < 0) throw new Error("Suche: Der ausgewählte Titel fehlt in den aktuellen Ergebnissen.");
      playQueue(tracks.data, index, `Suche: ${search.query}`);
    } else if (row.kind === "artist") {
      router.push(`/artist/${encodeURIComponent(String(row.artist.id))}`);
    } else if (row.kind === "playlist") {
      router.push(deezerPlaylistPath(row.playlist.id));
    } else {
      router.push(`/album/${encodeURIComponent(String(row.album.album_id || row.album.id))}`);
    }
    history.remember(search.query);
    closeDialog();
  }
  function submitSelection() {
    if (!search.preparing && rows[selected]) activate(rows[selected]);
    else fullResults();
  }
  function onInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedKey(movePaletteSelection(rows, selectedKey, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) fullResults();
      else submitSelection();
    }
  }

  const searching = term.length >= SEARCH_MIN_LENGTH && (search.preparing || (fetching && rows.length === 0));

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-backdrop/80 px-2 pt-[calc(.5rem+env(safe-area-inset-top))] sm:px-4 sm:pt-[11dvh]" onClick={closeDialog}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Suche" tabIndex={-1} className="pop-in flex max-h-[calc(100dvh-1rem-env(safe-area-inset-top))] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-panel shadow-[0_28px_70px_rgb(0_0_0/0.6)] outline-none sm:max-h-[74dvh]" onClick={(event) => event.stopPropagation()}>
        <SearchField value={search.input} onValueChange={changeInput} onSubmit={submitSelection} onClear={clearInput} label="Titel, Künstler, Alben und Playlists suchen" placeholder="Was möchtest du hören?" className="shrink-0 gap-3.5 rounded-none! border-0! border-b! border-hairline! bg-transparent! px-4 sm:px-5"
          inputProps={{
            role: "combobox", "aria-autocomplete": "list", "aria-controls": listId,
            "aria-expanded": rows.length > 0,
            "aria-activedescendant": selected >= 0 ? `${listId}-${paletteRowKey(rows[selected])}` : undefined,
            autoFocus: true,
            className: "font-display h-14! text-[19px]! font-bold tracking-[-0.02em] placeholder:font-semibold sm:h-16! sm:text-[22px]!",
            onKeyDown: onInputKey,
            onCompositionStart: () => search.setComposing(true),
            onCompositionEnd: () => search.setComposing(false),
          }}
          trailing={<>
            <kbd aria-hidden="true" className={`${KBD} max-sm:hidden`}>Esc</kbd>
            <button type="button" aria-label="Suche schließen" onClick={closeDialog} className="action-icon -mr-2 h-11 w-11 shrink-0 sm:hidden"><CloseIcon width={18} height={18} /></button>
          </>}
        />
        <div className="scroll-area min-h-0 flex-1 overflow-y-auto pb-2">
          {term.length === 0 && history.recent.length === 0 && <div className="px-5 pb-8 pt-7 sm:px-6">
            <p className="label-mono mb-3 flex items-center gap-2.5"><SearchIcon width={14} height={14} />Schnellsuche</p>
            <p className="font-display text-xl font-extrabold tracking-[-0.03em]">Suche in der ganzen Bibliothek</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">Titel, Künstler, Alben und Playlists – tippe los und spiele direkt aus der Liste ab.</p>
          </div>}
          {term.length === 0 && history.recent.length > 0 && <section aria-label="Zuletzt gesucht" className="px-2">
            <div className="flex items-center justify-between gap-3 pl-3 pr-1 pt-2"><span className="label-mono">Zuletzt gesucht</span><button type="button" onClick={history.clear} className="label-mono min-h-11 rounded-[var(--radius-control)] px-2 transition-colors hover:text-foreground">Verlauf löschen</button></div>
            {history.recent.map((recent) => <div key={recent} className="flex items-center gap-1 rounded-[var(--radius-control)] transition-colors hover:bg-foreground/[0.06] focus-within:bg-foreground/[0.06]">
              <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-[15px] font-medium" onClick={() => fullResults(recent)}><ClockGlyph /><span className="truncate">{recent}</span></button>
              <button type="button" className="action-icon h-10 min-h-10 w-10" aria-label={`${recent} aus dem Suchverlauf entfernen`} onClick={() => history.remove(recent)}><CloseIcon width={14} height={14} /></button>
            </div>)}
          </section>}
          {term.length > 0 && term.length < SEARCH_MIN_LENGTH && <p role="status" className="label-mono px-5 py-9 text-center">Gib mindestens zwei Zeichen ein.</p>}
          {searching && <div role="status" aria-label="Suche läuft" className="flex flex-col gap-1 px-2 pt-3">
            {[0, 1, 2, 3, 4].map((row) => <div key={row} className="flex items-center gap-3 px-3 py-2">
              <span className="skeleton h-10 w-10 shrink-0 rounded-art" />
              <span className="flex min-w-0 flex-1 flex-col gap-2"><span className="skeleton h-3.5 w-1/2 rounded" /><span className="skeleton h-3 w-1/3 rounded" /></span>
            </div>)}
          </div>}
          {empty && <div role="status" className="px-5 pb-8 pt-7 sm:px-6">
            <p className="label-mono mb-3">Keine Treffer</p>
            <p className="font-display text-xl font-extrabold tracking-[-0.03em] [overflow-wrap:anywhere]">Keine Treffer für „{term}“</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">Prüfe die Schreibweise oder versuche es mit weniger Wörtern.</p>
          </div>}
          {enabled && sources.filter(({ result }) => result.isError).map(({ label, result }) => <div key={label} role="alert" className="error-panel mx-3 mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 [overflow-wrap:anywhere]">{label} konnten nicht geladen werden: {result.error?.message}</p>
            <button type="button" className="action-secondary min-h-9 px-4 text-xs max-sm:min-h-11" disabled={result.isFetching} onClick={() => void result.refetch()}>Erneut versuchen</button>
          </div>)}
          <div id={listId} role="listbox" aria-label="Suchergebnisse" aria-busy={search.preparing || fetching} className="px-2">
            {rows.map((row, index) => {
              const active = index === selected;
              const key = paletteRowKey(row);
              const image = row.kind === "artist" ? row.artist.picture : row.kind === "playlist" ? row.playlist.cover : row.kind === "album" ? row.album.cover : row.track.cover;
              const title = row.kind === "artist" ? row.artist.name : row.kind === "playlist" ? row.playlist.title : row.kind === "album" ? row.album.album || row.album.title : row.track.title;
              const detail = row.kind === "artist" ? "Künstler" : row.kind === "playlist" ? `${row.playlist.track_count} Titel` : row.kind === "album" ? row.album.artist : trackArtistLabel(row.track);
              const shape = row.kind === "artist" ? "rounded-full" : "rounded-art";
              const startsGroup = index === 0 || rows[index - 1].kind !== row.kind;
              const plays = row.kind === "track";
              return <div key={key} role="presentation">
                {startsGroup && <div role="presentation" className="label-mono flex items-center gap-3 px-3 pb-1.5 pt-4"><span>{GROUP_LABELS[row.kind]}</span><span aria-hidden="true" className="h-px flex-1 bg-hairline" /></div>}
                <button id={`${listId}-${key}`} role="option" aria-selected={active} tabIndex={-1} type="button" onMouseEnter={() => setSelectedKey(key)} onClick={() => activate(row)} className={`relative flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left transition-colors ${active ? "bg-foreground/[0.06]" : ""}`}>
                  {active && <span aria-hidden="true" className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-accent" />}
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="" className={`h-10 w-10 ${shape} shrink-0 object-cover`} />
                  ) : <CoverPlaceholder className={`h-10 w-10 ${shape} shrink-0`} />}
                  <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold tracking-tight">{title}</div><div className="truncate text-[13px] text-muted">{detail}</div></div>
                  {active && <span className="label-mono flex shrink-0 items-center gap-2 text-foreground">
                    {plays ? <PlayIcon width={13} height={13} className="text-accent" /> : null}
                    <span className="max-sm:hidden">{plays ? "Abspielen" : "Öffnen"}</span>
                    <kbd className={`${KBD} max-sm:hidden`}>↵</kbd>
                  </span>}
                </button>
              </div>;
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline px-3 py-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:pb-2">
          <div className="label-mono flex items-center gap-4 max-sm:hidden">
            <span className="flex items-center gap-1.5"><kbd className={KBD}>↑</kbd><kbd className={KBD}>↓</kbd>Navigieren</span>
            <span className="flex items-center gap-1.5"><kbd className={KBD}>↵</kbd>Auswählen</span>
          </div>
          {term.length >= SEARCH_MIN_LENGTH
            ? <button type="button" onClick={() => fullResults()} className="action-secondary min-h-9 gap-2.5 px-3.5 text-xs max-sm:min-h-11 max-sm:flex-1"><span>Alle Ergebnisse anzeigen</span><kbd className={`${KBD} max-sm:hidden`}>⌘↵</kbd></button>
            : <span className="label-mono py-2.5"><span className="sm:hidden">Tippe, um zu suchen</span><span className="max-sm:hidden">Mind. zwei Zeichen</span></span>}
        </div>
      </div>
    </div>
  );
}

const KBD = "inline-grid min-h-[22px] min-w-[22px] shrink-0 place-items-center rounded-[5px] border border-border bg-foreground/[0.04] px-1.5 font-mono text-[11px] font-medium normal-case leading-none tracking-normal text-muted";
const GROUP_LABELS: Record<PaletteRow["kind"], string> = { track: "Titel", artist: "Künstler", album: "Alben", playlist: "Playlists" };

function ClockGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}
