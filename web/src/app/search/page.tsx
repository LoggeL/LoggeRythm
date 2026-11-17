"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  SEARCH_MIN_LENGTH,
  searchTracksOptions,
  searchAlbumsOptions,
  searchArtistsOptions,
  searchPlaylistsOptions,
} from "@/lib/catalogQueries";
import { usePlayerStore } from "@/store/player";
import { useSearchNavigation } from "@/hooks/useSearchNavigation";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { CardGridSkeleton, RowListSkeleton } from "@/components/Skeleton";
import ImportPanel from "@/components/ImportPanel";
import EmptyState from "@/components/ui/EmptyState";
import QueryError from "@/components/ui/QueryError";
import { SearchIcon, ImportIcon } from "@/components/icons";
import SearchFilters from "./_components/SearchFilters";
import SearchIdle from "./_components/SearchIdle";
import ResultSection from "./_components/ResultSection";
import ResultCards, { type ResultLayout } from "./_components/ResultCards";
import TopHit from "./_components/TopHit";
import TrackResults from "./_components/TrackResults";
import ArtistResults from "./_components/ArtistResults";
import AlbumResults from "./_components/AlbumResults";
import PlaylistResults from "./_components/PlaylistResults";
import { pickTopHit, sortSearchTracks, type SearchTab } from "./results";

/** How many results of each type the combined view previews. */
const PREVIEW_TRACKS = 4;
const PREVIEW_CARDS = 12;

export default function SearchPage() {
  const { input, query, tab, sort, preparing, setTab, setSort, openResults } = useSearchNavigation();
  const { recent, remember, remove, clear: clearRecent } = useRecentSearches();
  const [importing, setImporting] = useState(false);
  const playQueue = usePlayerStore((state) => state.playQueue);

  const enabled = query.length >= SEARCH_MIN_LENGTH && !importing && !preparing;
  const idle = !importing && !preparing && query.length < SEARCH_MIN_LENGTH;
  const combined = tab === "all";
  const layout: ResultLayout = combined ? "shelf" : "grid";

  /**
   * A search only enters the history once one of its results is used. Playback
   * reports itself (`playTrack`, `onPlayed`); this covers the remaining ways to
   * use a result: following its links and choosing an action from its menu.
   */
  function rememberResult(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as Element;
    const activation = target.closest("a[href], button[role=menuitem]");
    if (activation && (event.button === 0 || (event.button === 1 && activation.tagName === "A"))) {
      remember(query);
    }
  }

  const wantTracks = combined || tab === "track";
  const wantAlbums = combined || tab === "album";
  const wantArtists = combined || tab === "artist";
  const wantPlaylists = combined || tab === "playlist";
  const tracksQ = useQuery({ ...searchTracksOptions(query), enabled: enabled && wantTracks });
  const albumsQ = useQuery({ ...searchAlbumsOptions(query), enabled: enabled && wantAlbums });
  const artistsQ = useQuery({ ...searchArtistsOptions(query), enabled: enabled && wantArtists });
  const playlistsQ = useQuery({ ...searchPlaylistsOptions(query), enabled: enabled && wantPlaylists });

  // The combined view keeps relevance order: its first track is the top hit.
  const tracks = combined ? (tracksQ.data ?? []) : sortSearchTracks(tracksQ.data ?? [], sort);
  const albums = albumsQ.data ?? [];
  const artists = artistsQ.data ?? [];
  const playlists = playlistsQ.data ?? [];
  const activeQueries = [
    ...(wantTracks ? [{ label: "Titel", result: tracksQ }] : []),
    ...(wantAlbums ? [{ label: "Alben", result: albumsQ }] : []),
    ...(wantArtists ? [{ label: "Künstler", result: artistsQ }] : []),
    ...(wantPlaylists ? [{ label: "Playlists", result: playlistsQ }] : []),
  ];
  const nothing = enabled && activeQueries.every(({ result }) => result.isSuccess && result.data.length === 0);
  const fetching = activeQueries.some(({ result }) => result.isFetching);
  const loadedCount = activeQueries.reduce((count, { result }) => (result.isSuccess ? count + result.data.length : count), 0);

  const topHitLoading = tracksQ.isLoading || artistsQ.isLoading;
  const topHit = combined && enabled && !topHitLoading ? pickTopHit(query, tracks, artists) : null;
  // The featured artist is not repeated in the row right below it.
  const featuredArtist = topHit?.kind === "artist" ? topHit.artist : null;
  const listedArtists = combined ? artists.filter((artist) => artist !== featuredArtist).slice(0, PREVIEW_CARDS) : artists;
  const rememberQuery = () => remember(query);
  const playTrack = (index: number) => {
    playQueue(tracks, index, `Suche: ${query}`);
    rememberQuery();
  };
  const showAll = (next: SearchTab) => (combined ? () => setTab(next) : undefined);

  return (
    <div className="flex flex-col gap-7 md:gap-9">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className={idle || importing ? "page-title mr-auto" : "sr-only"}>Suche</h1>
        {!idle && !importing && (
          <SearchFilters tab={tab} sort={sort} showSort={enabled && tab === "track"} onTab={setTab} onSort={setSort} />
        )}
        <button
          type="button"
          className="action-secondary shrink-0"
          onClick={() => setImporting((current) => !current)}
          aria-expanded={importing}
          aria-controls="search-import"
        >
          <ImportIcon width={17} height={17} />
          {importing ? "Import schließen" : "Spotify-Import"}
        </button>
      </div>

      {importing && (
        <section id="search-import" aria-label="Spotify-Import">
          <ImportPanel />
        </section>
      )}

      {idle && (
        <SearchIdle
          minLength={SEARCH_MIN_LENGTH}
          showMinLengthHint={input.trim().length > 0}
          recent={recent}
          onOpen={openResults}
          onRemove={remove}
          onClear={clearRecent}
          onImport={() => setImporting(true)}
        />
      )}

      {!importing && preparing && (
        <div aria-busy="true" role="status">
          <span className="sr-only">Suche wird geladen…</span>
          {wantTracks ? <RowListSkeleton /> : <CardGridSkeleton count={10} />}
        </div>
      )}

      {enabled && (
        <div className="flex flex-col gap-9" aria-busy={fetching}>
          <p role="status" aria-live="polite" className="sr-only">
            {fetching
              ? "Suche wird geladen…"
              : activeQueries.every(({ result }) => result.isSuccess)
                ? `${loadedCount} ${loadedCount === 1 ? "Ergebnis" : "Ergebnisse"} geladen.`
                : ""}
          </p>
          {activeQueries.some(({ result }) => result.isError) && (
            <div className="flex flex-col gap-3">
              {activeQueries.map(({ label, result }) => (
                <QueryError key={label} label={label} query={result} />
              ))}
            </div>
          )}
          {nothing && (
            <EmptyState
              icon={<SearchIcon width={24} height={24} />}
              title={`Keine Ergebnisse für „${query}“.`}
              action={
                combined ? (
                  <Link href="/genre" className="action-secondary">
                    Musik entdecken
                  </Link>
                ) : (
                  <button type="button" className="action-secondary" onClick={() => setTab("all")}>
                    In allen Bereichen suchen
                  </button>
                )
              }
            >
              Prüfe die Schreibweise oder versuche es mit weniger Wörtern.
            </EmptyState>
          )}

          {combined && (topHitLoading || topHit || tracks.length > 0) && (
            <div className="grid gap-9 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
              {(topHitLoading || topHit) && (
                <ResultSection label="Top-Treffer" heading className="flex flex-col">
                  {topHit ? <TopHit hit={topHit} onPlay={playTrack} onOpen={rememberQuery} /> : <div className="skeleton h-48 rounded-xl" />}
                </ResultSection>
              )}
              {(tracksQ.isLoading || tracks.length > 0) && (
                <ResultSection label="Titel" heading onShowAll={showAll("track")}>
                  {tracksQ.isLoading ? (
                    <RowListSkeleton count={PREVIEW_TRACKS} />
                  ) : (
                    <TrackResults tracks={tracks} limit={PREVIEW_TRACKS} onPlay={playTrack} onActivate={rememberResult} />
                  )}
                </ResultSection>
              )}
            </div>
          )}

          {tab === "track" && (tracksQ.isLoading || tracks.length > 0) && (
            <ResultSection label="Titel" heading={false}>
              {tracksQ.isLoading ? <RowListSkeleton /> : <TrackResults tracks={tracks} onPlay={playTrack} onActivate={rememberResult} />}
            </ResultSection>
          )}

          {wantArtists && (artistsQ.isLoading || listedArtists.length > 0) && (
            <ResultSection label="Künstler" heading={combined} onShowAll={showAll("artist")}>
              {artistsQ.isLoading ? (
                <ResultCards label="Künstler" layout={layout} loading round />
              ) : (
                <ArtistResults artists={listedArtists} layout={layout} onActivate={rememberResult} onPlayed={rememberQuery} />
              )}
            </ResultSection>
          )}

          {wantAlbums && (albumsQ.isLoading || albums.length > 0) && (
            <ResultSection label="Alben" heading={combined} onShowAll={showAll("album")}>
              {albumsQ.isLoading ? (
                <ResultCards label="Alben" layout={layout} loading />
              ) : (
                <AlbumResults albums={combined ? albums.slice(0, PREVIEW_CARDS) : albums} layout={layout} onActivate={rememberResult} onPlayed={rememberQuery} />
              )}
            </ResultSection>
          )}

          {wantPlaylists && (playlistsQ.isLoading || playlists.length > 0) && (
            <ResultSection label="Playlists" heading={combined} onShowAll={showAll("playlist")}>
              {playlistsQ.isLoading ? (
                <ResultCards label="Playlists" layout={layout} loading />
              ) : (
                <PlaylistResults playlists={combined ? playlists.slice(0, PREVIEW_CARDS) : playlists} layout={layout} onActivate={rememberResult} onPlayed={rememberQuery} />
              )}
            </ResultSection>
          )}
        </div>
      )}
    </div>
  );
}
