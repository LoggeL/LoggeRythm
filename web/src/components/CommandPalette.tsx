"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  normalizeCatalogQuery, SEARCH_MIN_LENGTH,
  searchAlbumsOptions, searchArtistsOptions, searchPlaylistsOptions, searchTracksOptions,
} from "@/lib/catalogQueries";
import { api } from "@/lib/api";
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
  const [startingPlaylist, setStartingPlaylist] = useState<string | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const playlistRequest = useRef<symbol | null>(null);
  const mounted = useRef(false);
  const inputSnapshot = useRef(search.input);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDialogFocus(true, panelRef, closeDialog);
  const router = useRouter();
  const playQueue = usePlayerStore((state) => state.playQueue);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; playlistRequest.current = null; };
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
    playlistRequest.current = null;
    setStartingPlaylist(null);
    inputSnapshot.current = value;
    search.setInput(value);
    setSelectedKey(null);
    setPlaylistError(null);
  }
  function clearInput() {
    playlistRequest.current = null;
    setStartingPlaylist(null);
    inputSnapshot.current = "";
    search.clear();
    setSelectedKey(null);
    setPlaylistError(null);
  }
  function closeDialog() {
    playlistRequest.current = null;
    onClose();
  }
  function fullResults(value = inputSnapshot.current) {
    if (normalizeCatalogQuery(value).length < SEARCH_MIN_LENGTH) return;
    navigation.openResults(value);
    closeDialog();
  }

  async function activate(row: PaletteRow) {
    // Event handlers from a previous render must never activate an old term.
    if (!mounted.current || !enabled || normalizeCatalogQuery(inputSnapshot.current) !== search.query) return;
    if (!rows.some((current) => paletteRowKey(current) === paletteRowKey(row))) return;
    if (row.kind === "playlist") {
      if (playlistRequest.current !== null) return;
      const token = Symbol("palette-playlist");
      playlistRequest.current = token;
      const ownerQuery = search.query;
      setStartingPlaylist(String(row.playlist.id));
      setPlaylistError(null);
      usePlayerStore.getState().setRadioActive(false);
      const ownerSession = usePlayerStore.getState().radioSession;
      const currentRequest = () => mounted.current && playlistRequest.current === token && normalizeCatalogQuery(inputSnapshot.current) === ownerQuery;
      try {
        const playlist = await api.deezerPlaylist(String(row.playlist.id));
        if (!currentRequest() || usePlayerStore.getState().radioSession !== ownerSession) return;
        if (!Array.isArray(playlist.tracks) || playlist.tracks.length === 0) throw new Error("Diese Playlist enthält keine abspielbaren Titel.");
        playQueue(playlist.tracks, 0, row.playlist.title);
        history.remember(ownerQuery);
        closeDialog();
      } catch (error) {
        if (currentRequest()) setPlaylistError(`Playlist konnte nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (playlistRequest.current === token) {
          playlistRequest.current = null;
          if (mounted.current) setStartingPlaylist(null);
        }
      }
      return;
    }
    if (row.kind === "track") {
      if (!tracks.data || tracks.isError) throw new Error("Suche: Die ausgewählten Titel sind nicht verfügbar.");
      const index = tracks.data.findIndex((track) => String(track.id) === String(row.track.id));
      if (index < 0) throw new Error("Suche: Der ausgewählte Titel fehlt in den aktuellen Ergebnissen.");
      playQueue(tracks.data, index, `Suche: ${search.query}`);
    } else if (row.kind === "artist") {
      router.push(`/artist/${encodeURIComponent(String(row.artist.id))}`);
    } else {
      router.push(`/album/${encodeURIComponent(String(row.album.album_id || row.album.id))}`);
    }
    history.remember(search.query);
    closeDialog();
  }
  function submitSelection() {
    if (!search.preparing && rows[selected]) void activate(rows[selected]);
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

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-3 pt-[6dvh] sm:px-4 sm:pt-[10dvh] bg-black/70 backdrop-blur-md" onClick={closeDialog}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Suche" tabIndex={-1} className="surface-card w-full max-w-xl shadow-2xl overflow-hidden pop-in" onClick={(event) => event.stopPropagation()}>
        <SearchField value={search.input} onValueChange={changeInput} onSubmit={submitSelection} onClear={clearInput} label="Titel, Künstler, Alben und Playlists suchen" placeholder="Titel, Künstler, Alben, Playlists" className="rounded-none border-0 border-b border-white/10 px-4 sm:px-5 py-4"
          inputProps={{
            role: "combobox", "aria-autocomplete": "list", "aria-controls": listId,
            "aria-expanded": rows.length > 0,
            "aria-activedescendant": selected >= 0 ? `${listId}-${paletteRowKey(rows[selected])}` : undefined,
            autoFocus: true,
            onKeyDown: onInputKey,
            onCompositionStart: () => search.setComposing(true),
            onCompositionEnd: () => search.setComposing(false),
          }}
          trailing={<>
            <kbd className="hidden sm:block text-[10px] text-muted border border-white/15 rounded px-1.5 py-0.5">Esc</kbd>
            <button type="button" aria-label="Suche schließen" onClick={closeDialog} className="action-icon min-h-11! min-w-11! sm:min-h-9! sm:min-w-9! flex-shrink-0"><CloseIcon width={16} height={16} /></button>
          </>}
        />
        <div className="max-h-[62dvh] overflow-y-auto scroll-area py-2">
          {term.length === 0 && history.recent.length > 0 && <section aria-label="Zuletzt gesucht" className="px-3 pb-2">
            <div className="flex items-center justify-between px-2 py-2 text-xs text-muted"><span>Zuletzt gesucht</span><button type="button" onClick={history.clear} className="hover:text-foreground">Verlauf löschen</button></div>
            {history.recent.map((recent) => <div key={recent} className="flex items-center gap-1">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left text-sm hover:bg-white/5" onClick={() => fullResults(recent)}><SearchIcon width={16} height={16} className="flex-shrink-0 text-muted" /><span className="truncate">{recent}</span></button>
              <button type="button" className="action-icon" aria-label={`${recent} aus dem Suchverlauf entfernen`} onClick={() => history.remove(recent)}><CloseIcon width={14} height={14} /></button>
            </div>)}
          </section>}
          {term.length > 0 && term.length < SEARCH_MIN_LENGTH && <p role="status" className="px-5 py-6 text-sm text-muted">Mindestens zwei Zeichen.</p>}
          {term.length >= SEARCH_MIN_LENGTH && (search.preparing || (fetching && rows.length === 0)) && <p role="status" className="px-5 py-6 text-sm text-muted">Sucht…</p>}
          {empty && <p role="status" className="px-5 py-6 text-sm text-muted">Keine Treffer.</p>}
          {enabled && sources.filter(({ result }) => result.isError).map(({ label, result }) => <div key={label} role="alert" className="error-panel mx-3 my-2 px-4 py-3 text-sm">
            <p>{label} konnten nicht geladen werden: {result.error?.message}</p>
            <button type="button" className="action-secondary mt-2 px-3 py-1.5 text-xs" disabled={result.isFetching} onClick={() => void result.refetch()}>Erneut versuchen</button>
          </div>)}
          {playlistError && <div role="alert" className="error-panel mx-3 my-2 px-4 py-3 text-sm">{playlistError}</div>}
          <div id={listId} role="listbox" aria-label="Suchergebnisse" aria-busy={search.preparing || fetching}>
            {rows.map((row, index) => {
              const active = index === selected;
              const key = paletteRowKey(row);
              const image = row.kind === "artist" ? row.artist.picture : row.kind === "playlist" ? row.playlist.cover : row.kind === "album" ? row.album.cover : row.track.cover;
              const title = row.kind === "artist" ? row.artist.name : row.kind === "playlist" ? row.playlist.title : row.kind === "album" ? row.album.album || row.album.title : row.track.title;
              const detail = row.kind === "artist" ? "Künstler" : row.kind === "playlist" ? `Playlist · ${row.playlist.track_count} Titel` : row.kind === "album" ? `Album · ${row.album.artist}` : `Titel · ${trackArtistLabel(row.track)}`;
              const shape = row.kind === "artist" ? "rounded-full" : "rounded-lg";
              return <button key={key} id={`${listId}-${key}`} role="option" aria-selected={active} tabIndex={-1} type="button" disabled={row.kind === "playlist" && startingPlaylist !== null} onMouseEnter={() => setSelectedKey(key)} onClick={() => void activate(row)} className={`flex items-center gap-3 w-full px-4 sm:px-5 py-3 text-left transition disabled:opacity-60 ${active ? "bg-white/8" : "hover:bg-white/5"}`}>
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className={`w-10 h-10 ${shape} object-cover flex-shrink-0`} />
                ) : <CoverPlaceholder className={`w-10 h-10 ${shape} flex-shrink-0`} />}
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{title}</div><div className="truncate text-xs text-muted">{row.kind === "playlist" && startingPlaylist === String(row.playlist.id) ? "Wird geladen…" : detail}</div></div>
                {active && (row.kind === "track" || row.kind === "playlist") && <PlayIcon width={16} height={16} className="flex-shrink-0 text-accent" />}
              </button>;
            })}
          </div>
        </div>
        {term.length >= SEARCH_MIN_LENGTH && <div className="border-t border-white/10 p-3">
          <button type="button" onClick={() => fullResults()} className="action-secondary w-full justify-between"><span>Alle Ergebnisse</span><kbd className="hidden sm:block text-xs text-muted">⌘/Ctrl Enter</kbd></button>
        </div>}
      </div>
    </div>
  );
}
