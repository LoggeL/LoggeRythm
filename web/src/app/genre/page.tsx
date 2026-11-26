"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import { usePlaylists } from "@/hooks/useLibrary";
import AlbumCard from "@/components/AlbumCard";
import ShelfCard from "@/components/ShelfCard";
import Shelf, { ShelfSkeleton } from "@/components/browse/Shelf";
import BrowseTile from "@/components/browse/BrowseTile";
import QueryState from "@/components/browse/QueryState";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";
import { CompassIcon } from "@/components/icons";
import type { AlbumSummary, Genre, HomeShelf, PlaylistSummary } from "@/types";
import { discoverPlaylistsQuery } from "./discoverPlaylists";

const GENRE_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-6";

function GenreGridSkeleton() {
  return (
    <div aria-hidden="true" className={GENRE_GRID}>
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="skeleton h-24 rounded-[var(--radius-card)] sm:h-32" />
      ))}
    </div>
  );
}

export default function DiscoverPage() {
  const collections = useQuery<HomeShelf[]>({ queryKey: ["home-collections"], queryFn: () => api.homeChartsCollections() });
  const genres = useQuery<Genre[]>({ queryKey: ["genres"], queryFn: () => api.genres() });
  const releases = useQuery<AlbumSummary[]>({ queryKey: ["new-releases"], queryFn: () => api.newReleases() });
  const community = useQuery<PlaylistSummary[]>({ queryKey: ["public-playlists"], queryFn: () => api.publicPlaylists() });
  // Own and community playlists share one row, so the row needs both lists.
  const playlists = discoverPlaylistsQuery(usePlaylists(), community);

  return (
    <div className="flex flex-col gap-9 md:gap-11">
      <header>
        <h1 className="page-title">Entdecken</h1>
        <nav aria-label="Bereiche auf dieser Seite" className="no-scrollbar -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <a href="#genres" className="filter-chip shrink-0 max-sm:min-h-11">Genres</a>
          <a href="#charts" className="filter-chip shrink-0 max-sm:min-h-11">Charts</a>
          <a href="#new-releases" className="filter-chip shrink-0 max-sm:min-h-11">Neue Alben</a>
          <a href="#playlists" className="filter-chip shrink-0 max-sm:min-h-11">Playlists</a>
        </nav>
      </header>

      <section id="genres" aria-labelledby="genres-title" aria-busy={genres.isLoading} className="scroll-mt-20">
        <SectionHeader id="genres-title" title="Nach Genre stöbern" />
        <QueryState
          query={genres}
          label="Genres"
          skeleton={<GenreGridSkeleton />}
          empty={
            <EmptyState icon={<CompassIcon width={24} height={24} />} title="Zurzeit sind keine Genres verfügbar." action={<Link href="/search" className="action-secondary">Musik suchen</Link>}>
              Über die Suche findest du trotzdem jeden Titel.
            </EmptyState>
          }
        >
          {(items) => (
            <ul className={GENRE_GRID}>
              {items.map((genre, index) => (
                <li key={String(genre.id)}>
                  <BrowseTile href={`/genre/${genre.id}`} title={genre.name} image={genre.picture} icon={<CompassIcon width={64} height={64} />} tone={index} />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </section>

      <section id="charts" aria-labelledby="charts-title" aria-busy={collections.isLoading} className="scroll-mt-20">
        <SectionHeader id="charts-title" title="Charts" />
        <QueryState
          query={collections}
          label="Charts"
          skeleton={<ShelfSkeleton />}
          empty={
            <EmptyState title="Zurzeit sind keine Charts verfügbar." action={<Link href="/radio" className="action-secondary">Radio starten</Link>}>
              Ein Radio spielt dir in der Zwischenzeit passende Musik.
            </EmptyState>
          }
        >
          {(shelves) => (
            <Shelf label="Charts">
              {shelves.map((shelf, index) => (
                <ShelfCard key={shelf.key} shelf={shelf} index={index} variant="collection" />
              ))}
            </Shelf>
          )}
        </QueryState>
      </section>

      <section id="new-releases" aria-labelledby="releases-title" aria-busy={releases.isLoading} className="scroll-mt-20">
        <SectionHeader id="releases-title" title="Neue Veröffentlichungen" />
        <QueryState
          query={releases}
          label="Neue Veröffentlichungen"
          skeleton={<ShelfSkeleton />}
          empty={
            <EmptyState title="Zurzeit sind keine neuen Veröffentlichungen verfügbar." action={<Link href="/radar" className="action-secondary">Release Radar öffnen</Link>}>
              Neue Titel deiner Künstler findest du im Release Radar.
            </EmptyState>
          }
        >
          {(albums) => (
            <Shelf label="Neue Veröffentlichungen">
              {albums.map((album) => (
                <AlbumCard key={String(album.id)} album={album} />
              ))}
            </Shelf>
          )}
        </QueryState>
      </section>

      <section id="playlists" aria-labelledby="playlists-title" aria-busy={playlists.isLoading} className="scroll-mt-20">
        <SectionHeader id="playlists-title" title="Playlists" />
        <QueryState
          query={playlists}
          label="Playlists"
          skeleton={<ShelfSkeleton />}
          empty={
            <EmptyState title="Hier gibt es noch keine Playlists." action={<Link href="/library" className="action-secondary">Playlist erstellen</Link>}>
              Lege in deiner Bibliothek eine Playlist an, dann erscheint sie hier.
            </EmptyState>
          }
        >
          {(entries) => (
            <Shelf label="Playlists">
              {entries.map(({ playlist, own }) => (
                <Link key={String(playlist.id)} href={playlistPath(playlist)} className="music-card group block min-w-0 p-1.5 sm:p-2">
                  <div className="mb-3 aspect-square overflow-hidden rounded-art bg-panel shadow-[0_10px_26px_rgb(0_0_0/0.4),0_0_0_1px_rgb(244_240_230/0.05)] transition-transform duration-[250ms] ease-out group-hover:-translate-y-1 group-focus-visible:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-focus-visible:translate-y-0">
                    <Cover src={playlist.cover_url} className="h-full w-full" />
                  </div>
                  <div className="truncate text-[0.9375rem] font-[650] leading-[1.35] tracking-[-0.01em]">{playlist.name}</div>
                  <div className="mt-[0.2rem] truncate text-[0.8125rem] leading-[1.35] text-muted">
                    {own
                      ? playlist.is_collaborative
                        ? "Gemeinsam · Von dir"
                        : "Von dir"
                      : playlist.is_collaborative
                        ? playlist.owner_name
                          ? `Gemeinsam · von ${playlist.owner_name}`
                          : "Gemeinsam"
                        : playlist.owner_name
                          ? `von ${playlist.owner_name}`
                          : "Playlist"}{" "}
                    · {playlist.track_count} Titel
                  </div>
                </Link>
              ))}
            </Shelf>
          )}
        </QueryState>
      </section>
    </div>
  );
}
