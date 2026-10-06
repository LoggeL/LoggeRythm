"use client";

import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PlaylistSearchResult } from "@/types";
import {
  SEARCH_MIN_LENGTH,
  searchTracksOptions,
  searchAlbumsOptions,
  searchArtistsOptions,
  searchPlaylistsOptions,
} from "@/lib/catalogQueries";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import { useSearchNavigation } from "@/hooks/useSearchNavigation";
import { useRecentSearches } from "@/hooks/useRecentSearches";
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
import { sortSearchTracks, type SearchSort, type SearchTab } from "./results";

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
  const { input, query, tab, sort, preparing, setTab, setSort, openResults } =
    useSearchNavigation();
  const { recent, remember, remove, clear: clearRecent } = useRecentSearches();
  const [importing, setImporting] = useState(false);
  const playQueue = usePlayerStore((state) => state.playQueue);

  const enabled = query.length >= SEARCH_MIN_LENGTH && !importing && !preparing;

  function rememberResult(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as Element;
    const activation = target.closest("a[href], button.track-row-play, button[role=menuitem]");
    if (
      activation &&
      (event.button === 0 || (event.button === 1 && activation.tagName === "A"))
    ) {
      remember(query);
    }
  }

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
  const loadedCount = activeQueries.reduce(
    (count, { result }) => result.isSuccess ? count + result.data.length : count,
    0,
  );

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
      <h1 className="sr-only">Suche</h1>
      <div className="flex flex-wrap items-center gap-3">
        {!importing && (
          <nav
            aria-label="Suchbereiche"
            className="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-1"
          >
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-pressed={tab === item.key}
                data-active={tab === item.key}
                className="filter-chip min-h-11! sm:min-h-9! flex-shrink-0"
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          {!importing && enabled && wantTracks && (
            <label className="block w-36 sm:w-40">
              <select
                aria-label="Titel sortieren"
                value={sort}
                onChange={(event) => setSort(event.target.value as SearchSort)}
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
          <button
            type="button"
            className="action-secondary min-h-11!"
            onClick={() => setImporting((current) => !current)}
            aria-expanded={importing}
            aria-controls="search-import"
          >
            <ImportIcon width={17} height={17} />
            {importing ? "Import schließen" : "Spotify-Import"}
          </button>
        </div>
      </div>

      {importing && (
        <section id="search-import" className="surface-card p-5 sm:p-6">
          <ImportPanel />
        </section>
      )}

      {!importing && !preparing && query.length < SEARCH_MIN_LENGTH && (
        <div className="flex flex-col gap-6">
          {input.trim().length > 0 && (
            <p role="status" className="text-sm text-muted">
              Mindestens {SEARCH_MIN_LENGTH} Zeichen eingeben.
            </p>
          )}
          {recent.length > 0 && (
            <section aria-labelledby="search-history-heading">
              <div className="section-heading">
                <h2 id="search-history-heading">Zuletzt gesucht</h2>
                <button
                  type="button"
                  onClick={clearRecent}
                  className="text-sm text-muted hover:text-foreground"
                >
                  Verlauf löschen
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((term) => (
                  <div
                    key={term}
                    className="flex max-w-full items-center overflow-hidden rounded-xl border border-white/10"
                  >
                    <button
                      type="button"
                      className="inline-flex min-w-0 items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-panel-hover hover:text-foreground"
                      onClick={() => openResults(term)}
                    >
                      <SearchIcon width={14} height={14} className="flex-shrink-0 text-muted" />
                      <span className="truncate">{term}</span>
                    </button>
                    <button
                      type="button"
                      className="action-icon flex-shrink-0"
                      aria-label={`Aus Suchverlauf entfernen: ${term}`}
                      onClick={() => remove(term)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <nav aria-label="Musik entdecken" className="flex flex-wrap gap-3">
            <Link href="/genre" className="action-secondary">
              <CompassIcon width={18} height={18} />
              Entdecken
            </Link>
            <Link href="/radio" className="action-secondary">
              <RadioIcon width={18} height={18} />
              Radio
            </Link>
          </nav>
        </div>
      )}

      {!importing && preparing && (
        <div aria-busy="true" role="status">
          <span className="sr-only">Suche wird geladen…</span>
          {wantTracks ? <RowListSkeleton /> : <CardGridSkeleton count={5} />}
        </div>
      )}

      {enabled && (
        <div className="flex flex-col gap-8" aria-busy={fetching}>
          <p role="status" aria-live="polite" className="sr-only">
            {fetching
              ? "Suche wird geladen…"
              : activeQueries.every(({ result }) => result.isSuccess)
                ? `${loadedCount} ${loadedCount === 1 ? "Ergebnis" : "Ergebnisse"} geladen.`
                : ""}
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
            </div>
          )}

          {wantTracks && (tracksQ.isLoading || tracks.length > 0) && (
            <section aria-label="Titel">
              {tab === "all" && (
                <div className="section-heading">
                  <h2 id="search-tracks-heading">Titel</h2>
                  {showAll("track")}
                </div>
              )}
              {tracksQ.isLoading ? (
                <RowListSkeleton />
              ) : (
                <div className="flex flex-col">
                  {shownTracks.map((track, index) => (
                    <div
                      key={track.id}
                      onClickCapture={rememberResult}
                      onAuxClickCapture={rememberResult}
                    >
                      <TrackRow
                        track={track}
                        index={index}
                        showPopularity
                        plays={trackPlays[String(track.id)]}
                        onPlay={() => playQueue(tracks, index, `Suche: ${query}`)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {wantArtists && (artistsQ.isLoading || artists.length > 0) && (
            <section aria-label="Künstler">
              {tab === "all" && (
                <div className="section-heading">
                  <h2 id="search-artists-heading">Künstler</h2>
                  {showAll("artist")}
                </div>
              )}
              {artistsQ.isLoading ? (
                <CardGridSkeleton count={5} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {artists
                    .slice(0, tab === "artist" ? artists.length : 5)
                    .map((artist) => (
                      <div
                        key={String(artist.id)}
                        onClickCapture={rememberResult}
                        onAuxClickCapture={rememberResult}
                      >
                        <ArtistCard artist={artist} />
                      </div>
                    ))}
                </div>
              )}
            </section>
          )}

          {wantAlbums && (albumsQ.isLoading || albums.length > 0) && (
            <section aria-label="Alben">
              {tab === "all" && (
                <div className="section-heading">
                  <h2 id="search-albums-heading">Alben</h2>
                  {showAll("album")}
                </div>
              )}
              {albumsQ.isLoading ? (
                <CardGridSkeleton count={5} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {albums
                    .slice(0, tab === "album" ? albums.length : 5)
                    .map((album) => (
                      <div
                        key={String(album.album_id || album.id)}
                        onClickCapture={rememberResult}
                        onAuxClickCapture={rememberResult}
                      >
                        <AlbumCard
                          album={{
                            id: album.album_id || album.id,
                            title: album.album || album.title,
                            artist: album.artist,
                            cover: album.cover,
                          }}
                        />
                      </div>
                    ))}
                </div>
              )}
            </section>
          )}

          {wantPlaylists && (playlistsQ.isLoading || playlists.length > 0) && (
            <section aria-label="Playlists">
              {tab === "all" && (
                <div className="section-heading">
                  <h2 id="search-playlists-heading">Playlists</h2>
                  {showAll("playlist")}
                </div>
              )}
              {playlistsQ.isLoading ? (
                <CardGridSkeleton count={5} />
              ) : (
                <PlaylistSearchResults
                  key={JSON.stringify([input, query, tab, sort])}
                  query={query}
                  playlists={playlists.slice(0, tab === "playlist" ? playlists.length : 5)}
                />
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** A changed search or route removes the owner of any pending playlist start. */
export function PlaylistSearchResults({
  query,
  playlists,
}: {
  query: string;
  playlists: PlaylistSearchResult[];
}) {
  const [startingPlaylist, setStartingPlaylist] = useState<string | null>(null);
  const playlistRequest = useRef<symbol | null>(null);
  const mounted = useRef(true);
  const playQueue = usePlayerStore((state) => state.playQueue);
  const { remember } = useRecentSearches();

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      playlistRequest.current = null;
    };
  }, []);

  async function startPlaylist(id: string, title: string) {
    if (!mounted.current || playlistRequest.current !== null) return;
    const token = Symbol("search-playlist");
    playlistRequest.current = token;
    setStartingPlaylist(id);
    usePlayerStore.getState().setRadioActive(false);
    const playbackSession = usePlayerStore.getState().radioSession;
    const currentRequest = () =>
      mounted.current && playlistRequest.current === token;
    let applyingPlaylist = false;
    try {
      const playlist = await api.deezerPlaylist(id);
      if (!currentRequest() || usePlayerStore.getState().radioSession !== playbackSession) return;
      applyingPlaylist = true;
      if (!Array.isArray(playlist.tracks) || playlist.tracks.length === 0)
        throw new Error("Diese Playlist enthält keine abspielbaren Titel.");
      playQueue(playlist.tracks, 0, title);
      remember(query);
    } catch (error) {
      if (
        currentRequest() &&
        (applyingPlaylist || usePlayerStore.getState().radioSession === playbackSession)
      ) {
        toast.error(
          `Playlist konnte nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      if (playlistRequest.current === token) {
        playlistRequest.current = null;
        if (mounted.current) setStartingPlaylist(null);
      }
    }
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {playlists.map((playlist) => (
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
          className="music-card group p-2.5 sm:p-3 text-left disabled:opacity-60 disabled:cursor-wait"
        >
          <div className="relative mb-3 overflow-hidden rounded-xl">
            {playlist.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={playlist.cover}
                alt=""
                className="w-full aspect-square object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <CoverPlaceholder className="w-full aspect-square" />
            )}
            <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition">
              <PlayIcon width={17} height={17} />
            </span>
          </div>
          <div className="truncate text-sm font-semibold">
            {playlist.title}
          </div>
          <div className="mt-1 truncate text-xs text-muted">
            {startingPlaylist === String(playlist.id)
              ? "Wird geladen…"
              : `${playlist.track_count} Titel`}
          </div>
        </button>
      ))}
    </div>
  );
}
