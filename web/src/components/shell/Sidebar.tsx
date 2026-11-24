"use client";

import Link from "next/link";
import { NAV_LATERAL } from "@/lib/morph";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePlaylists, useDeletePlaylist } from "@/hooks/useLibrary";
import { useMe } from "@/hooks/useAuth";
import { HeartIcon, DownloadedIcon, PlusIcon, LibraryIcon, ClockIcon, VisualizerIcon, UsersIcon, LogOutIcon, TrashIcon } from "@/components/icons";
import Logo, { Wordmark } from "@/components/Logo";
import ContextMenu from "@/components/ContextMenu";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import EqualizerBars from "@/components/EqualizerBars";
import CreatePlaylistDialog from "@/app/library/CreatePlaylistDialog";
import LeavePlaylistDialog from "@/app/playlist/_components/LeavePlaylistDialog";
import { NAV_ITEMS, isNavItemActive } from "@/components/shell/navigation";
import { usePlayerStore } from "@/store/player";
import { isOwnedLibraryPlaylist, sidebarPlaylistMeta } from "@/lib/playlistPermissions";
import { playlistPath } from "@/lib/slugs";
import type { PlaylistSummary } from "@/types";

const FILTER_THRESHOLD = 8;

const rowClass = (active: boolean) =>
  `group/row relative flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] px-2 py-1.5 transition-colors ${active ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.05]"}`;

/**
 * Signal marker on the active destination. The primary navigation's marker
 * `travels`: it slides from the old item to the new one (globals.css,
 * `.vt-nav-marker`); there is only ever one of those.
 */
function ActiveMarker({ travels = false }: { travels?: boolean }) {
  return <span aria-hidden="true" className={`absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent ${travels ? "vt-nav-marker" : ""}`} />;
}

function PrimaryNav() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const usageActive = pathname === "/admin/usage" || pathname.startsWith("/admin/usage/");
  return (
    <nav aria-label="Hauptnavigation" className="flex flex-col px-3">
      <Link href="/" transitionTypes={NAV_LATERAL} className="mb-5 flex items-center gap-2.5 px-2 pt-5 transition-opacity hover:opacity-80">
        <Logo size={30} />
        <Wordmark />
      </Link>
      {NAV_ITEMS.filter((item) => !item.mobileOnly).map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            transitionTypes={NAV_LATERAL}
            aria-current={active ? "page" : undefined}
            className={`font-display relative flex min-h-11 items-center gap-3.5 rounded-[var(--radius-control)] px-2 text-[17px] font-bold tracking-tight transition-colors ${active ? "text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {active && <ActiveMarker travels />}
            <Icon width={21} height={21} className={active ? "text-accent" : ""} />
            {item.label}
          </Link>
        );
      })}
      {me?.is_admin && (
        <Link
          href="/admin/usage"
          transitionTypes={NAV_LATERAL}
          aria-current={usageActive ? "page" : undefined}
          className={`font-display relative mt-2 flex min-h-11 items-center gap-3.5 rounded-[var(--radius-control)] border-t border-hairline px-2 pt-2 text-[17px] font-bold tracking-tight transition-colors ${usageActive ? "text-foreground" : "text-muted hover:text-foreground"}`}
        >
          {usageActive && <ActiveMarker travels />}
          <VisualizerIcon width={21} height={21} className={usageActive ? "text-accent" : ""} />
          Nutzung
        </Link>
      )}
    </nav>
  );
}

/** One of the three fixed collections, as a square key under the library label. */
function Shortcut({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      transitionTypes={NAV_LATERAL}
      title={label}
      className="flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius-control)] border border-hairline px-2.5 py-2.5 text-muted transition-colors hover:border-foreground/25 hover:text-foreground"
    >
      {icon}
      <span className="truncate text-[11.5px] font-semibold leading-none">{label}</span>
    </Link>
  );
}

function PlaylistRow({ playlist, active, playing, onMenu }: { playlist: PlaylistSummary; active: boolean; playing: boolean; onMenu: (event: React.MouseEvent, path: string) => void }) {
  const path = playlistPath(playlist);
  const sharedOrCollaborative = Boolean(
    playlist.is_collaborative || playlist.is_collaborator,
  );
  return (
    <li onContextMenu={(event) => onMenu(event, path)}>
      <Link href={path} transitionTypes={NAV_LATERAL} aria-current={active ? "page" : undefined} className={rowClass(active)}>
        {active && <ActiveMarker />}
        {playlist.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={playlist.cover_url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-[var(--radius-art)] object-cover" />
        ) : (
          <CoverPlaceholder className="h-10 w-10 shrink-0 rounded-[var(--radius-art)]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-sm font-semibold ${playing ? "text-accent" : ""}`}>{playlist.name}</span>
            {sharedOrCollaborative && (
              <UsersIcon
                width={13}
                height={13}
                aria-label={playlist.is_collaborative ? "Gemeinsame Playlist" : "Geteilte Playlist"}
                className={`shrink-0 ${playlist.is_collaborative ? "text-accent" : "text-muted"}`}
              />
            )}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle">
            {sidebarPlaylistMeta(playlist)}
          </span>
        </span>
        {playing && <EqualizerBars height={12} isPlaying />}
      </Link>
    </li>
  );
}

function LibrarySection() {
  const router = useRouter();
  const pathname = usePathname();
  const playlistQuery = usePlaylists(true);
  const deletePlaylist = useDeletePlaylist();
  const playingContext = usePlayerStore((s) => (s.isPlaying ? s.queueContext : null));
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; playlist: PlaylistSummary; path: string } | null>(null);
  const [leaving, setLeaving] = useState<{ id: string; name: string; path: string } | null>(null);

  const playlists = playlistQuery.data ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = needle ? playlists.filter((playlist) => playlist.name.toLowerCase().includes(needle)) : playlists;

  return (
    <section aria-label="Bibliothek" className="mt-6 flex min-h-0 flex-1 flex-col border-t border-hairline pt-4">
      <div className="flex items-center justify-between gap-2 pl-5 pr-3">
        <Link href="/library" transitionTypes={NAV_LATERAL} className={`label-mono flex min-h-9 items-center gap-2 transition-colors hover:text-foreground ${pathname === "/library" ? "text-foreground" : ""}`}>
          <LibraryIcon width={15} height={15} />
          Bibliothek
        </Link>
        <button type="button" onClick={() => setCreating(true)} aria-label="Playlist erstellen" title="Playlist erstellen" className="action-icon h-9 min-h-0 w-9">
          <PlusIcon />
        </button>
      </div>

      <div className="flex gap-1.5 px-3 pb-3 pt-1">
        <Shortcut href="/library?tab=liked" label="Favoriten" icon={<HeartIcon width={17} height={17} fill="currentColor" className="text-like" />} />
        <Shortcut href="/library?tab=recent" label="Verlauf" icon={<ClockIcon width={17} height={17} />} />
        <Shortcut href="/library?tab=downloads" label="Offline" icon={<DownloadedIcon width={17} height={17} className="text-success" />} />
      </div>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {playlists.length > FILTER_THRESHOLD && (
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Playlists filtern"
            aria-label="Playlists filtern"
            className="field-input mb-2 min-h-9 px-3 py-1.5 text-sm"
          />
        )}
        {playlistQuery.isError && (
          <div role="alert" className="px-2 py-3 text-xs text-danger">
            {playlistQuery.error.message}
            <button type="button" disabled={playlistQuery.isFetching} onClick={() => void playlistQuery.refetch()} className="mt-2 block underline">
              Erneut versuchen
            </button>
          </div>
        )}
        {playlistQuery.isPending && (
          <div role="status" aria-label="Playlists werden geladen" className="flex flex-col gap-2 px-2 py-1">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className="skeleton h-10 w-10 rounded-[var(--radius-art)]" />
                <div className="skeleton h-3 flex-1 rounded" />
              </div>
            ))}
          </div>
        )}
        {playlistQuery.isSuccess && playlists.length === 0 && (
          <div className="rounded-[var(--radius-control)] border border-dashed border-border p-4">
            <p className="text-sm font-semibold">Erstelle deine erste Playlist</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">Sammle Titel, die zusammengehören.</p>
            <button type="button" onClick={() => setCreating(true)} className="action-primary mt-3 min-h-9 px-4 text-xs">
              Playlist erstellen
            </button>
          </div>
        )}
        {needle && visible.length === 0 && playlists.length > 0 && (
          <p className="px-2 py-3 text-xs text-muted">Keine Playlist passt zu „{filter.trim()}“.</p>
        )}
        <ul className="flex flex-col gap-0.5">
          {visible.map((playlist) => (
            <PlaylistRow
              key={String(playlist.id)}
              playlist={playlist}
              active={pathname === playlistPath(playlist)}
              playing={playingContext === playlist.name}
              onMenu={(event, path) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, playlist, path });
              }}
            />
          ))}
        </ul>
      </div>

      <CreatePlaylistDialog open={creating} onClose={() => setCreating(false)} />
      {leaving && (
        <LeavePlaylistDialog
          id={leaving.id}
          name={leaving.name}
          onClose={() => setLeaving(null)}
          onLeft={() => {
            if (pathname === leaving.path) router.push("/library");
          }}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Öffnen", onClick: () => router.push(menu.path) },
            isOwnedLibraryPlaylist(menu.playlist)
              ? {
                  label: "Löschen",
                  icon: <TrashIcon width={16} height={16} />,
                  danger: true,
                  separated: true,
                  onClick: () => deletePlaylist.mutate(String(menu.playlist.id)),
                }
              : {
                  label: "Playlist verlassen",
                  icon: <LogOutIcon width={16} height={16} />,
                  danger: true,
                  separated: true,
                  onClick: () =>
                    setLeaving({
                      id: String(menu.playlist.id),
                      name: menu.playlist.name,
                      path: menu.path,
                    }),
                },
          ]}
        />
      )}
    </section>
  );
}

/** Desktop sidebar: primary navigation above the user's library, one flat column. */
export default function Sidebar() {
  return (
    <aside aria-label="Navigation und Bibliothek" className="hidden w-[264px] shrink-0 flex-col border-r border-hairline bg-backdrop lg:flex">
      <PrimaryNav />
      <LibrarySection />
    </aside>
  );
}
