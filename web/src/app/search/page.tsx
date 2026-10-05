"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  SEARCH_DEBOUNCE_MS,
  searchTracksOptions,
  searchAlbumsOptions,
  searchArtistsOptions,
  searchPlaylistsOptions,
} from "@/lib/catalogQueries";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import { useLocalJson } from "@/hooks/useLocalJson";
import { useTrackPlays } from "@/hooks/usePlays";
import TrackRow from "@/components/TrackRow";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import { CardGridSkeleton, RowListSkeleton } from "@/components/Skeleton";
import ImportPanel from "@/components/ImportPanel";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import {
  SearchIcon,
  ImportIcon,
  PlayIcon,
  CompassIcon,
  RadioIcon,
} from "@/components/icons";
import { rememberSearch } from "./history";
import { sortSearchTracks, type SearchSort, type SearchTab } from "./results";

const EMPTY_STRINGS: string[] = [];
const TABS: { key: SearchTab; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "track", label: "Titel" },
  { key: "album", label: "Alben" },
  { key: "artist", label: "Künstler" },
  { key: "playlist", label: "Playlists" },
];
const SORTS: { key: SearchSort; label: string }[] = [
  { key: "relevance", label: "Relevanz" },
  { key: "title", label: "Titel A bis Z" },
  { key: "dur-asc", label: "Kürzeste zuerst" },
  { key: "dur-desc", label: "Längste zuerst" },
];

export default function SearchPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [importing, setImporting] = useState(false);
  const [startingPlaylist, setStartingPlaylist] = useState<string | null>(null);
  const playlistRequest = useRef<string | null>(null);
  const [recent, setRecent] = useLocalJson<string[]>(
    "sf_recent_searches",
    EMPTY_STRINGS,
  );
  const playQueue = usePlayerStore((state) => state.playQueue);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  function commitRecent(value: string) {
    setRecent((current) => rememberSearch(current, value));
  }

  const enabled = query.length > 0 && !importing;
  const wantTracks = tab === "all" || tab === "track";
  const wantAlbums = tab === "all" || tab === "album";
  const wantArtists = tab === "all" || tab === "artist";
  const wantPlaylists = tab === "all" || tab === "playlist";
  const tracksQ = useQuery({
    ...searchTracksOptions(query),
    enabled: enabled && wantTracks,
  });
  const albumsQ = useQuery({
    ...searchAlbumsOptions(query),
    enabled: enabled && wantAlbums,
  });
  const artistsQ = useQuery({
    ...searchArtistsOptions(query),
    enabled: enabled && wantArtists,
  });
  const playlistsQ = useQuery({
    ...searchPlaylistsOptions(query),
    enabled: enabled && wantPlaylists,
  });

  const tracks = useMemo(
    () => sortSearchTracks(tracksQ.data ?? [], sort),
    [tracksQ.data, sort],
  );
  const shownTracks = useMemo(
    () =>
      enabled && wantTracks
        ? tracks.slice(0, tab === "track" ? tracks.length : 6)
        : [],
    [tracks, tab, enabled, wantTracks],
  );
  const trackPlays = useTrackPlays(shownTracks);
  const albums = albumsQ.data ?? [];
  const artists = artistsQ.data ?? [];
  const playlists = playlistsQ.data ?? [];
  const activeQueries = [
    ...(wantTracks ? [{ label: "Titel", result: tracksQ }] : []),
    ...(wantAlbums ? [{ label: "Alben", result: albumsQ }] : []),
    ...(wantArtists ? [{ label: "Künstler", result: artistsQ }] : []),
    ...(wantPlaylists ? [{ label: "Playlists", result: playlistsQ }] : []),
  ];
  const failedQueries = activeQueries.filter(({ result }) => result.isError);
  const nothing =
    enabled &&
    activeQueries.every(
      ({ result }) => result.isSuccess && result.data.length === 0,
    );
  const fetching = activeQueries.some(({ result }) => result.isFetching);

  async function startPlaylist(id: string, title: string) {
    if (playlistRequest.current !== null) return;
    playlistRequest.current = id;
    setStartingPlaylist(id);
    usePlayerStore.getState().setRadioActive(false);
    const playbackSession = usePlayerStore.getState().radioSession;
    try {
      const playlist = await api.deezerPlaylist(id);
      if (!Array.isArray(playlist.tracks) || playlist.tracks.length === 0)
        throw new Error("Diese Playlist enthält keine abspielbaren Titel.");
      if (usePlayerStore.getState().radioSession !== playbackSession) return;
      playQueue(playlist.tracks, 0, title);
    } catch (error) {
      toast.error(
        `Playlist konnte nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      playlistRequest.current = null;
      setStartingPlaylist(null);
    }
  }

  function showAll(next: SearchTab) {
    return tab === "all" ? (
      <button
        type="button"
        className="text-sm text-muted hover:text-foreground"
        onClick={() => setTab(next)}
      >
        Alle anzeigen
      </button>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8 animate-in">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Finde deinen nächsten Titel</p>
          <h1 className="page-title">Suche</h1>
          <p className="page-description">
            Titel, Künstler, Alben und Playlists.
          </p>
        </div>
        <button
          type="button"
          className="action-secondary"
          onClick={() => setImporting((current) => !current)}
          aria-expanded={importing}
          aria-controls="search-import"
        >
          <ImportIcon width={17} height={17} />
          {importing ? "Import schließen" : "Spotify-Import"}
        </button>
      </header>

      <div className="flex flex-col gap-4">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(input.trim());
            commitRecent(input);
          }}
          className="surface-card flex items-center gap-3 px-4 sm:px-5 py-4 focus-within:border-accent/70"
        >
          <SearchIcon
            className="text-muted flex-shrink-0"
            width={22}
            height={22}
          />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onBlur={() => commitRecent(input)}
            type="search"
            aria-label="Nach Titeln, Künstlern, Alben oder Playlists suchen"
            placeholder="Was möchtest du hören?"
            className="w-full min-w-0 bg-transparent outline-none text-base sm:text-lg placeholder:text-muted"
            autoFocus
          />
          {input && (
            <button
              type="button"
              className="action-icon flex-shrink-0"
              aria-label="Suche leeren"
              onClick={() => {
                setInput("");
                setQuery("");
              }}
            >
              ✕
            </button>
          )}
          <kbd className="hidden sm:block rounded-md border border-white/10 px-2 py-1 text-[11px] text-muted flex-shrink-0">
            ⌘ K
          </kbd>
        </form>
        {!importing && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav
              aria-label="Suchbereiche"
              className="flex max-w-full gap-2 overflow-x-auto pb-1"
            >
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  aria-pressed={tab === item.key}
                  data-active={tab === item.key}
                  className="filter-chip flex-shrink-0"
                >
                  {item.label}
                </button>
              ))}
            </nav>
            {enabled && wantTracks && (
              <label className="flex items-center gap-2 text-xs text-muted">
                Titel sortieren
                <select
                  aria-label="Titel sortieren"
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as SearchSort)
                  }
                  className="field-input py-2 text-xs"
                >
                  {SORTS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      {importing && (
        <section id="search-import" className="surface-card p-5 sm:p-6">
          <div className="section-heading">
            <div>
              <h2>Deine Playlists mitnehmen</h2>
              <p className="text-sm text-muted mt-1">
                Füge einen Spotify-Link ein, um Musik zu importieren.
              </p>
            </div>
          </div>
          <ImportPanel />
        </section>
      )}

      {!importing && query.length === 0 && (
        <div className="flex flex-col gap-8">
          {recent.length > 0 && (
            <section aria-labelledby="search-history-heading">
              <div className="section-heading">
                <h2 id="search-history-heading">Zuletzt gesucht</h2>
                <button
                  type="button"
                  onClick={() => setRecent([])}
                  className="text-sm text-muted hover:text-foreground"
                >
                  Verlauf löschen
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((term) => (
                  <button
                    key={term}
                    type="button"
                    className="filter-chip"
                    onClick={() => {
                      setInput(term);
                      setQuery(term);
                      commitRecent(term);
                    }}
                  >
                    <SearchIcon width={14} height={14} className="text-muted" />
                    {term}
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <Link
              href="/genre"
              className="surface-card flex items-start gap-4 p-6 hover:bg-panel-hover transition"
            >
              <CompassIcon
                width={24}
                height={24}
                className="text-muted mt-1 flex-shrink-0"
              />
              <div>
                <h2 className="font-medium">Noch keine Idee?</h2>
                <p className="text-sm text-muted mt-2">
                  Stöbere in Charts, Genres und neuen Veröffentlichungen.
                </p>
                <span className="inline-block mt-4 text-sm text-accent-soft">
                  Entdecken →
                </span>
              </div>
            </Link>
            <Link
              href="/radio"
              className="surface-card flex items-start gap-4 p-6 hover:bg-panel-hover transition"
            >
              <RadioIcon
                width={24}
                height={24}
                className="text-muted mt-1 flex-shrink-0"
              />
              <div>
                <h2 className="font-medium">Musik für deinen Moment</h2>
                <p className="text-sm text-muted mt-2">
                  Starte ein persönliches Radio oder wähle eine Stimmung.
                </p>
                <span className="inline-block mt-4 text-sm text-accent-soft">
                  Radio öffnen →
                </span>
              </div>
            </Link>
          </div>
        </div>
      )}

      {enabled && (
        <div className="flex flex-col gap-8" aria-busy={fetching}>
          <p className="text-sm text-muted" aria-live="polite">
            {input.trim() !== query
              ? "Suche wird aktualisiert…"
              : `Ergebnisse für "${query}"`}
          </p>
          {failedQueries.map(({ label, result }) => (
            <div key={label} role="alert" className="error-panel">
              <p>
                {label} konnten nicht geladen werden: {result.error?.message}
              </p>
              <button
                type="button"
                className="action-secondary mt-3"
                disabled={result.isFetching}
                onClick={() => void result.refetch()}
              >
                {result.isFetching ? "Wird geladen…" : "Erneut versuchen"}
              </button>
            </div>
          ))}
          {nothing && (
            <div className="empty-panel">
              <p>Keine Ergebnisse für &quot;{query}&quot;.</p>
              <p className="text-sm text-muted mt-2">
                Versuche einen anderen Namen oder einen kürzeren Suchbegriff.
              </p>
            </div>
          )}

          {wantTracks && (tracksQ.isLoading || tracks.length > 0) && (
            <section aria-labelledby="search-tracks-heading">
              <div className="section-heading">
                <h2 id="search-tracks-heading">Titel</h2>
                {showAll("track")}
              </div>
              {tracksQ.isLoading ? (
                <RowListSkeleton />
              ) : (
                <div className="flex flex-col">
                  {shownTracks.map((track, index) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      index={index}
                      showPopularity
                      plays={trackPlays[String(track.id)]}
                      onPlay={() => playQueue(tracks, index, `Suche: ${query}`)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {wantArtists && (artistsQ.isLoading || artists.length > 0) && (
            <section aria-labelledby="search-artists-heading">
              <div className="section-heading">
                <h2 id="search-artists-heading">Künstler</h2>
                {showAll("artist")}
              </div>
              {artistsQ.isLoading ? (
                <CardGridSkeleton count={5} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {artists
                    .slice(0, tab === "artist" ? artists.length : 5)
                    .map((artist) => (
                      <ArtistCard key={String(artist.id)} artist={artist} />
                    ))}
                </div>
              )}
            </section>
          )}

          {wantAlbums && (albumsQ.isLoading || albums.length > 0) && (
            <section aria-labelledby="search-albums-heading">
              <div className="section-heading">
                <h2 id="search-albums-heading">Alben</h2>
                {showAll("album")}
              </div>
              {albumsQ.isLoading ? (
                <CardGridSkeleton count={5} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {albums
                    .slice(0, tab === "album" ? albums.length : 5)
                    .map((album) => (
                      <AlbumCard
                        key={String(album.album_id || album.id)}
                        album={{
                          id: album.album_id || album.id,
                          title: album.album || album.title,
                          artist: album.artist,
                          cover: album.cover,
                        }}
                      />
                    ))}
                </div>
              )}
            </section>
          )}

          {wantPlaylists && (playlistsQ.isLoading || playlists.length > 0) && (
            <section aria-labelledby="search-playlists-heading">
              <div className="section-heading">
                <h2 id="search-playlists-heading">Playlists</h2>
                {showAll("playlist")}
              </div>
              {playlistsQ.isLoading ? (
                <CardGridSkeleton count={5} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {playlists
                    .slice(0, tab === "playlist" ? playlists.length : 5)
                    .map((playlist) => (
                      <button
                        key={String(playlist.id)}
                        type="button"
                        disabled={startingPlaylist !== null}
                        onClick={() =>
                          void startPlaylist(
                            String(playlist.id),
                            playlist.title,
                          )
                        }
                        className="music-card group p-3 text-left disabled:opacity-60 disabled:cursor-wait"
                      >
                        <div className="relative">
                          {playlist.cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={playlist.cover}
                              alt=""
                              className="w-full aspect-square object-cover rounded-lg mb-3"
                              loading="lazy"
                            />
                          ) : (
                            <CoverPlaceholder className="w-full aspect-square rounded-lg mb-3" />
                          )}
                          <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition">
                            <PlayIcon width={17} height={17} />
                          </span>
                        </div>
                        <div className="truncate font-medium">
                          {playlist.title}
                        </div>
                        <div className="truncate text-sm text-muted mt-1">
                          {startingPlaylist === String(playlist.id)
                            ? "Wird geladen…"
                            : `${playlist.track_count} Titel`}
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
