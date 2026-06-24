"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useLocalJson } from "@/hooks/useLocalJson";
import TrackRow from "@/components/TrackRow";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import { RowListSkeleton } from "@/components/Skeleton";
import { SearchIcon } from "@/components/icons";
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

export default function SearchPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
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

  const tracks = tracksQ.data ?? [];
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
      <h1 className="text-4xl font-black tracking-tight text-gradient mb-4">Suche</h1>

      <div className="mb-5 max-w-xl">
        <div className="flex items-center gap-2 bg-panel rounded-full px-4 py-2 focus-within:ring-2 focus-within:ring-accent">
          <SearchIcon className="text-muted" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Titel, Künstler, Alben, Playlists…"
            className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted"
            autoFocus
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              aria-label="Leeren"
              className="text-muted hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {enabled && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${
                tab === t.key
                  ? "neon-border text-foreground neon-text"
                  : "bg-panel text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

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
                <div key={String(p.id)} className="bg-panel rounded-lg p-4">
                  {p.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.cover}
                      alt={p.title}
                      className="w-full aspect-square object-cover rounded-md shadow-lg mb-3"
                    />
                  ) : (
                    <div className="w-full aspect-square rounded-md bg-[#333] mb-3" />
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
    </div>
  );
}
