"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import AlbumCard from "@/components/AlbumCard";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import ShelfCard from "@/components/ShelfCard";
import { CardGridSkeleton } from "@/components/Skeleton";
import { CompassIcon } from "@/components/icons";
import type { AlbumSummary, Genre, HomeShelf, PlaylistSummary } from "@/types";

function SectionError({ title, error, hasData, isFetching, onRetry }: {
  title: string;
  error: Error | null;
  hasData: boolean;
  isFetching: boolean;
  onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <div role="alert" className="error-panel mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{title} konnten nicht geladen werden.</p>
        <p className="mt-1 text-sm break-words">
          {error.message}
          {hasData && " Der zuletzt geladene Stand bleibt sichtbar."}
        </p>
      </div>
      <button type="button" disabled={isFetching} onClick={onRetry} className="action-secondary shrink-0">
        {isFetching ? "Wird geladen…" : "Erneut versuchen"}
      </button>
    </div>
  );
}

export default function DiscoverPage() {
  const collections = useQuery<HomeShelf[]>({ queryKey: ["home-collections"], queryFn: () => api.homeChartsCollections() });
  const genres = useQuery<Genre[]>({ queryKey: ["genres"], queryFn: () => api.genres() });
  const releases = useQuery<AlbumSummary[]>({ queryKey: ["new-releases"], queryFn: () => api.newReleases() });
  const community = useQuery<PlaylistSummary[]>({ queryKey: ["public-playlists"], queryFn: () => api.publicPlaylists() });

  return (
    <div className="flex flex-col gap-9 animate-in">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Dein nächster Lieblingssong</p>
          <h1 className="page-title">Entdecken</h1>
          <p className="page-description">Neue Alben, aktuelle Charts und Musik abseits deiner täglichen Rotation.</p>
        </div>
        <span aria-hidden="true" className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-accent-soft sm:flex">
          <CompassIcon width={24} height={24} />
        </span>
      </header>

      <nav aria-label="Bereiche auf dieser Seite" className="flex flex-wrap gap-2">
        <a href="#charts" className="filter-chip">Charts</a>
        <a href="#new-releases" className="filter-chip">Neue Alben</a>
        <a href="#genres" className="filter-chip">Genres</a>
        <a href="#community" className="filter-chip">Community</a>
      </nav>

      <section id="charts" aria-labelledby="charts-title" aria-busy={collections.isLoading} className="scroll-mt-8">
        <div className="section-heading">
          <div>
            <h2 id="charts-title">Charts</h2>
            <p className="mt-1 text-sm text-muted">Was gerade gehört wird. Ein Klick startet die Wiedergabe.</p>
          </div>
        </div>
        <SectionError title="Charts" error={collections.error} hasData={collections.data !== undefined} isFetching={collections.isFetching} onRetry={() => { void collections.refetch(); }} />
        {collections.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="skeleton aspect-[4/3] rounded-xl" />)}
          </div>
        ) : collections.data?.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
            {collections.data.map((shelf, index) => <ShelfCard key={shelf.key} shelf={shelf} index={index} variant="collection" />)}
          </div>
        ) : !collections.error ? (
          <div className="empty-panel">Zurzeit sind keine Charts verfügbar.</div>
        ) : null}
      </section>

      <section id="new-releases" aria-labelledby="releases-title" aria-busy={releases.isLoading} className="scroll-mt-8">
        <div className="section-heading">
          <div>
            <h2 id="releases-title">Neue Veröffentlichungen</h2>
            <p className="mt-1 text-sm text-muted">Frische Alben für deine Bibliothek.</p>
          </div>
        </div>
        <SectionError title="Neue Veröffentlichungen" error={releases.error} hasData={releases.data !== undefined} isFetching={releases.isFetching} onRetry={() => { void releases.refetch(); }} />
        {releases.isLoading ? (
          <CardGridSkeleton count={10} />
        ) : releases.data?.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {releases.data.map((album) => <AlbumCard key={String(album.id)} album={album} />)}
          </div>
        ) : !releases.error ? (
          <div className="empty-panel">Zurzeit sind keine neuen Veröffentlichungen verfügbar.</div>
        ) : null}
      </section>

      <section id="genres" aria-labelledby="genres-title" aria-busy={genres.isLoading} className="scroll-mt-8">
        <div className="section-heading">
          <div>
            <h2 id="genres-title">Nach Genre stöbern</h2>
            <p className="mt-1 text-sm text-muted">Finde deinen Sound oder probiere etwas Neues.</p>
          </div>
        </div>
        <SectionError title="Genres" error={genres.error} hasData={genres.data !== undefined} isFetching={genres.isFetching} onRetry={() => { void genres.refetch(); }} />
        {genres.isLoading ? (
          <CardGridSkeleton count={12} />
        ) : genres.data?.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {genres.data.map((genre) => (
              <Link key={String(genre.id)} href={`/genre/${genre.id}`} className="music-card group flex min-w-0 items-center gap-3 p-3">
                {genre.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={genre.picture} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted"><CompassIcon width={20} height={20} /></span>
                )}
                <span className="truncate text-sm font-semibold group-hover:text-accent-soft">{genre.name}</span>
              </Link>
            ))}
          </div>
        ) : !genres.error ? (
          <div className="empty-panel">Zurzeit sind keine Genres verfügbar.</div>
        ) : null}
      </section>

      <section id="community" aria-labelledby="community-title" aria-busy={community.isLoading} className="scroll-mt-8">
        <div className="section-heading">
          <div>
            <h2 id="community-title">Playlists der Community</h2>
            <p className="mt-1 text-sm text-muted">Musik, die andere für dich zusammengestellt haben.</p>
          </div>
        </div>
        <SectionError title="Community-Playlists" error={community.error} hasData={community.data !== undefined} isFetching={community.isFetching} onRetry={() => { void community.refetch(); }} />
        {community.isLoading ? (
          <CardGridSkeleton count={5} />
        ) : community.data?.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {community.data.map((playlist) => (
              <Link key={String(playlist.id)} href={playlistPath(playlist)} className="music-card block min-w-0 p-3">
                {playlist.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={playlist.cover_url} alt="" className="mb-3 aspect-square w-full rounded-lg object-cover" />
                ) : (
                  <CoverPlaceholder className="mb-3 aspect-square w-full rounded-lg" />
                )}
                <div className="truncate text-sm font-semibold">{playlist.name}</div>
                <div className="mt-1 truncate text-xs text-muted">{playlist.owner_name ? `von ${playlist.owner_name}` : "Playlist"} · {playlist.track_count} Titel</div>
              </Link>
            ))}
          </div>
        ) : !community.error ? (
          <div className="empty-panel">Es wurden noch keine öffentlichen Playlists geteilt.</div>
        ) : null}
      </section>
    </div>
  );
}
