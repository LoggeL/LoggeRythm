"use client";

import { useState } from "react";
import Link from "next/link";
import QueryState, { type StatefulQuery } from "@/components/browse/QueryState";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import { CardGridSkeleton } from "@/components/Skeleton";
import { Morph, useMorphSource } from "@/components/motion/Morph";
import { HeartIcon, LibraryIcon, PlusIcon, UsersIcon } from "@/components/icons";
import {
  isOwnedLibraryPlaylist,
  libraryPlaylistSubtitle,
} from "@/lib/playlistPermissions";
import { playlistPath } from "@/lib/slugs";
import type { PlaylistSummary } from "@/types";
import ListFilter, { NoFilterMatch } from "./ListFilter";
import TabHeader from "./TabHeader";
import { FILTER_THRESHOLD, matchesFilter } from "./filter";

const GRID = "grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
const CARD = "music-card group block w-full min-w-0 p-2.5 text-left sm:p-3";

type SortKey = "recent" | "name";
type ScopeKey = "all" | "owned" | "shared";

/** One playlist; its cover and name travel into the header of the playlist page. */
function PlaylistTile({ playlist }: { playlist: PlaylistSummary }) {
  const href = playlistPath(playlist);
  const subtitle = libraryPlaylistSubtitle(playlist);
  const morph = useMorphSource(href, { title: playlist.name, cover: playlist.cover_url, subtitle });
  const sharedOrCollaborative = Boolean(
    playlist.is_collaborative || playlist.is_collaborator,
  );
  return (
    <Link href={href} onClick={morph.arm} transitionTypes={morph.types} className={CARD}>
      <span className="relative mb-3 block">
        <Morph name={morph.art} part="art">
          <Cover src={playlist.cover_url} className="aspect-square w-full rounded-xl" />
        </Morph>
        {sharedOrCollaborative && (
          <span
            title={
              playlist.is_collaborative
                ? "Gemeinsame Playlist"
                : "Geteilte Playlist"
            }
            className="pointer-events-none absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-backdrop/85 text-foreground backdrop-blur-sm"
          >
            <UsersIcon
              width={14}
              height={14}
              aria-hidden="true"
              className={playlist.is_collaborative ? "text-accent" : "text-muted"}
            />
          </span>
        )}
      </span>
      <Morph name={morph.title} part="title">
        <span className="block truncate text-sm font-semibold">{playlist.name}</span>
      </Morph>
      <Morph name={morph.meta} part="meta">
        <span className="mt-1 block truncate text-xs text-muted">{subtitle}</span>
      </Morph>
    </Link>
  );
}

export default function PlaylistsTab({ query, likedHref, onCreate }: { query: StatefulQuery<PlaylistSummary[]>; likedHref: string; onCreate: () => void }) {
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [scope, setScope] = useState<ScopeKey>("all");
  const count = query.data?.length;

  return (
    <section aria-labelledby="playlist-heading">
      <TabHeader id="playlist-heading" title="Deine Playlists" meta={count === undefined ? undefined : `${count} ${count === 1 ? "Playlist" : "Playlists"}`} />
      <QueryState
        query={query}
        label="Deine Playlists"
        skeleton={<CardGridSkeleton count={5} />}
        empty={
          <EmptyState
            icon={<LibraryIcon width={24} height={24} />}
            title="Hier ist Platz für deine erste Playlist."
            action={
              <button type="button" className="action-secondary" onClick={onCreate}>
                Playlist erstellen
              </button>
            }
          >
            Sammle Titel, die zusammengehören, oder importiere eine Playlist über die Suche.
          </EmptyState>
        }
      >
        {(playlists) => {
          const hasShared = playlists.some(
            (playlist) => !isOwnedLibraryPlaylist(playlist),
          );
          const scoped =
            scope === "owned"
              ? playlists.filter((playlist) => isOwnedLibraryPlaylist(playlist))
              : scope === "shared"
                ? playlists.filter(
                    (playlist) => !isOwnedLibraryPlaylist(playlist),
                  )
                : playlists;
          const filtered = scoped.filter((playlist) =>
            matchesFilter(term, playlist.name, playlist.description, playlist.owner_name ?? undefined),
          );
          const listed = sort === "name" ? [...filtered].sort((a, b) => a.name.localeCompare(b.name, "de")) : filtered;
          const filtering = term.trim().length > 0 || scope !== "all";
          return (
            <>
              {(hasShared || playlists.length > FILTER_THRESHOLD) && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {hasShared && (
                    <div role="group" aria-label="Playlist-Filter" className="flex items-center gap-1.5">
                      {(
                        [
                          ["all", "Alle"],
                          ["owned", "Eigene"],
                          ["shared", "Geteilt"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={scope === key}
                          onClick={() => setScope(key)}
                          className="filter-chip"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {playlists.length > FILTER_THRESHOLD && (
                    <>
                      <ListFilter label="Playlists filtern" value={term} onChange={setTerm} className="flex-1 sm:max-w-64" />
                      <select
                        aria-label="Playlists sortieren"
                        value={sort}
                        onChange={(event) => setSort(event.target.value as SortKey)}
                        className="field-input w-auto shrink-0 rounded-full py-2 pl-4 pr-3 text-xs font-semibold sm:min-h-10"
                      >
                        <option value="recent">Zuletzt erstellt</option>
                        <option value="name">Name A bis Z</option>
                      </select>
                    </>
                  )}
                </div>
              )}
              {listed.length === 0 ? (
                term.trim().length > 0 ? (
                  <NoFilterMatch term={term} onReset={() => setTerm("")} />
                ) : (
                  <EmptyState
                    title="Keine Playlists in dieser Ansicht"
                    action={
                      <button type="button" className="action-secondary" onClick={() => setScope("all")}>
                        Alle anzeigen
                      </button>
                    }
                  >
                    Wähle einen anderen Filter, um deine übrigen Playlists zu sehen.
                  </EmptyState>
                )
              ) : (
                <ul className={GRID}>
                  {!filtering && (
                    <li>
                      <Link href={likedHref} scroll={false} className={CARD}>
                        <span className="mb-3 grid aspect-square w-full place-items-center rounded-xl bg-gradient-to-br from-brand to-like text-on-light">
                          <HeartIcon filled width={44} height={44} />
                        </span>
                        <span className="block truncate text-sm font-semibold">Gelikte Titel</span>
                        <span className="mt-1 block truncate text-xs text-muted">Deine Lieblingstitel</span>
                      </Link>
                    </li>
                  )}
                  {listed.map((playlist) => (
                    <li key={String(playlist.id)}>
                      <PlaylistTile playlist={playlist} />
                    </li>
                  ))}
                  {!filtering && (
                    <li>
                      <button type="button" onClick={onCreate} className={CARD}>
                        <span className="mb-3 grid aspect-square w-full place-items-center rounded-xl border border-dashed border-border text-muted transition-colors group-hover:border-muted group-hover:text-foreground">
                          <PlusIcon width={36} height={36} />
                        </span>
                        <span className="block truncate text-sm font-semibold">Neue Playlist</span>
                        <span className="mt-1 block truncate text-xs text-muted">Leer starten</span>
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </>
          );
        }}
      </QueryState>
    </section>
  );
}
