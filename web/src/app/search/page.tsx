"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import { useLocalJson } from "@/hooks/useLocalJson";
import TrackRow from "@/components/TrackRow";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import { RowListSkeleton } from "@/components/Skeleton";
import ImportPanel from "@/components/ImportPanel";
import { SearchIcon, ImportIcon, FilterIcon } from "@/components/icons";
import type { Track, ArtistSummary, PlaylistSearchResult } from "@/types";

const EMPTY_STRINGS: string[] = [];

type Tab = "all" | "track" | "album" | "artist" | "playlist";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "track", label: "Titel" },
  { key: "album", label: "Alben" },
  { key: "artist", label: "Künstler" },
  { key: "playlist", label: "Playlists" },
];

type Sort = "relevance" | "title" | "dur-asc" | "dur-desc";

const SORTS: { key: Sort; label: string }[] = [
  { key: "relevance", label: "Relevanz" },
  { key: "title", label: "Titel A–Z" },
  { key: "dur-asc", label: "Dauer ↑" },
  { key: "dur-desc", label: "Dauer ↓" },
];

function sortTracks(list: Track[], sort: Sort): Track[] {
  if (sort === "relevance") return list;
  const c = [...list];
  if (sort === "title") c.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "dur-asc") c.sort((a, b) => a.duration_sec - b.duration_sec);
  else if (sort === "dur-desc") c.sort((a, b) => b.duration_sec - a.duration_sec);
  return c;
}

export default function SearchPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("relevance");
  const [showFilters, setShowFilters] = useState(false);
  const [importing, setImporting] = useState(false);
  const [recent, setRecent] = useLocalJson<string[]>(
    "sf_recent_searches",
    EMPTY_STRINGS,
  );
  const playQueue = usePlayerStore((s) => s.playQueue);

  // Debounce input -> query.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 280);
    return () => clearTimeout(t);
  }, [input]);

  function commitRecent(q: string) {
    if (!q) return;
    setRecent([q, ...recent.filter((r) => r !== q)].slice(0, 8));
  }

  function clearRecent() {
    setRecent([]);
  }

  const enabled = query.length > 0;
  const wantTracks = tab === "all" || tab === "track";
  const wantAlbums = tab === "all" || tab === "album";
  const wantArtists = tab === "all" || tab === "artist";
  const wantPlaylists = tab === "all" || tab === "playlist";

  const tracksQ = useQuery<Track[]>({
    queryKey: ["search", "track", query],
    queryFn: () => api.search(query, "track"),
    enabled: enabled && wantTracks,
  });
  const albumsQ = useQuery<Track[]>({
    queryKey: ["search", "album", query],
    queryFn: () => api.search(query, "album"),
    enabled: enabled && wantAlbums,
  });
  const artistsQ = useQuery<ArtistSummary[]>({
    queryKey: ["search", "artist", query],
    queryFn: () => api.searchArtists(query),
    enabled: enabled && wantArtists,
  });
  const playlistsQ = useQuery<PlaylistSearchResult[]>({
    queryKey: ["search", "playlist", query],
    queryFn: () => api.searchPlaylists(query),
    enabled: enabled && wantPlaylists,
  });

  const tracks = useMemo(
    () => sortTracks(tracksQ.data ?? [], sort),
    [tracksQ.data, sort],
  );
  const albums = albumsQ.data ?? [];
  const artists = artistsQ.data ?? [];
  const playlists = playlistsQ.data ?? [];

  const loading =
    (wantTracks && tracksQ.isLoading) ||
    (wantArtists && artistsQ.isLoading) ||
    (wantAlbums && albumsQ.isLoading) ||
    (wantPlaylists && playlistsQ.isLoading);

  const nothing =
    enabled &&
    !loading &&
    tracks.length === 0 &&
    albums.length === 0 &&
    artists.length === 0 &&
    playlists.length === 0;

  return (
    <div onBlur={() => commitRecent(query)}>
      <h1 className="text-3xl font-extrabold mb-4">Suche</h1>

      <div className="mb-5 max-w-2xl">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-2 bg-panel rounded-full px-4 py-2 focus-within:ring-2 focus-within:ring-accent">
            <SearchIcon className="text-muted flex-shrink-0" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Titel, Künstler, Alben, Playlists…"
              className="flex-1 min-w-0 bg-transparent outline-none text-foreground placeholder:text-muted"
              autoFocus
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                aria-label="Leeren"
                className="text-muted hover:text-foreground flex-shrink-0"
              >
                ✕
              </button>
            )}
            <kbd className="hidden sm:block text-[10px] text-muted border border-white/15 rounded px-1.5 py-0.5 flex-shrink-0">
              ⌘K
            </kbd>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-label="Filter"
              aria-pressed={showFilters}
              title="Filter"
              className={`p-1 rounded-full transition flex-shrink-0 ${
                showFilters || sort !== "relevance"
                  ? "text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <FilterIcon />
            </button>
          </div>

          {/* Spotify-Import — same height, to the right of the search bar */}
          <button
            type="button"
            onClick={() => setImporting((v) => !v)}
            title={importing ? "Import schließen" : "Von Spotify importieren"}
            className={`flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition ${
              importing
                ? "bg-foreground text-background"
                : "bg-panel text-muted hover:text-foreground"
            }`}
          >
            <ImportIcon width={16} height={16} className="flex-shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">
              {importing ? "Import schließen" : "Von Spotify importieren"}
            </span>
          </button>
        </div>

        {showFilters && (
          <div className="mt-2 flex items-center gap-2 flex-wrap bg-panel/70 border border-white/5 rounded-2xl px-3 py-2">
            <span className="text-xs text-muted mr-1">Sortierung:</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  sort === s.key
                    ? "bg-accent text-white"
                    : "bg-panel-hover text-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {importing && (
        <div className="mb-8">
          <ImportPanel />
        </div>
      )}

      {!importing && enabled && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                tab === t.key
                  ? "bg-foreground text-background"
                  : "bg-panel text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!importing && (
        <>
      {!enabled && (
        <div>
          {recent.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold">Zuletzt gesucht</h2>
                <button
                  type="button"
                  onClick={clearRecent}
                  className="text-sm text-muted hover:text-foreground"
                >
                  Verlauf löschen
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setInput(r)}
                    className="px-4 py-1.5 rounded-full bg-panel text-sm hover:bg-panel-hover"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-muted">Wonach suchst du?</p>
          )}
        </div>
      )}

      {loading && <RowListSkeleton />}
      {nothing && <p className="text-muted">Keine Ergebnisse für „{query}“.</p>}

      {/* Artists */}
      {wantArtists && artists.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-3">Künstler</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {artists.slice(0, tab === "artist" ? artists.length : 5).map((a) => (
              <ArtistCard key={String(a.id)} artist={a} />
            ))}
          </div>
        </section>
      )}

      {/* Tracks */}
      {wantTracks && tracks.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-3">Titel</h2>
          <div className="flex flex-col">
            {tracks
              .slice(0, tab === "track" ? tracks.length : 6)
              .map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={i}
                  showPopularity
                  onPlay={() => playQueue(tracks, i)}
                />
              ))}
          </div>
        </section>
      )}

      {/* Albums */}
      {wantAlbums && albums.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-3">Alben</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {albums
              .slice(0, tab === "album" ? albums.length : 5)
              .map((al) => (
                <AlbumCard
                  key={String(al.album_id || al.id)}
                  album={{
                    id: al.album_id || al.id,
                    title: al.album || al.title,
                    artist: al.artist,
                    cover: al.cover,
                  }}
                />
              ))}
          </div>
        </section>
      )}

      {/* Playlists */}
      {wantPlaylists && playlists.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-3">Playlists</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {playlists
              .slice(0, tab === "playlist" ? playlists.length : 5)
              .map((p) => (
                <div
                  key={String(p.id)}
                  onClick={async () => {
                    toast.info("Playlist wird abgespielt…");
                    const pl = await api.deezerPlaylist(String(p.id));
                    usePlayerStore.getState().playQueue(pl.tracks, 0);
                  }}
                  className="bg-panel/70 border border-white/5 rounded-2xl p-4 cursor-pointer hover-lift transition"
                >
                  {p.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.cover}
                      alt={p.title}
                      className="w-full aspect-square object-cover rounded-xl shadow-lg mb-3"
                    />
                  ) : (
                    <div className="w-full aspect-square rounded-xl gradient-aurora opacity-80 mb-3" />
                  )}
                  <div className="truncate font-semibold">{p.title}</div>
                  <div className="truncate text-sm text-muted">
                    {p.track_count} Titel
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}
        </>
      )}
    </div>
  );
}
