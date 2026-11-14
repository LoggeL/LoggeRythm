"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePlaylists, useDeletePlaylist } from "@/hooks/useLibrary";
import { HeartIcon, DownloadedIcon, PlusIcon, LibraryIcon, ClockIcon } from "@/components/icons";
import Logo, { Wordmark } from "@/components/Logo";
import ContextMenu from "@/components/ContextMenu";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import EqualizerBars from "@/components/EqualizerBars";
import CreatePlaylistDialog from "@/app/library/CreatePlaylistDialog";
import { NAV_ITEMS, isNavItemActive } from "@/components/shell/navigation";
import { usePlayerStore } from "@/store/player";
import { playlistPath } from "@/lib/slugs";
import type { PlaylistSummary } from "@/types";

const FILTER_THRESHOLD = 8;

const rowClass = (active: boolean) =>
  `flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors ${active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`;

function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hauptnavigation" className="app-panel flex flex-col gap-0.5 p-2">
      <Link href="/" className="mb-1 flex items-center gap-2.5 px-3 pb-2 pt-3 transition-opacity hover:opacity-80">
        <Logo size={28} />
        <Wordmark />
      </Link>
      {NAV_ITEMS.filter((item) => !item.mobileOnly).map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3.5 rounded-xl px-3 text-[15px] font-semibold transition-colors ${active ? "bg-white/[0.08] text-foreground" : "text-muted hover:text-foreground"}`}
          >
            <Icon width={22} height={22} className={active ? "text-accent-soft" : ""} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Shortcut({ href, label, hint, tile, active }: { href: string; label: string; hint: string; tile: React.ReactNode; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={rowClass(active)}>
      {tile}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="block truncate text-xs text-muted">{hint}</span>
      </span>
    </Link>
  );
}

function PlaylistRow({ playlist, active, playing, onMenu }: { playlist: PlaylistSummary; active: boolean; playing: boolean; onMenu: (event: React.MouseEvent, path: string) => void }) {
  const path = playlistPath(playlist);
  return (
    <li onContextMenu={(event) => onMenu(event, path)}>
      <Link href={path} aria-current={active ? "page" : undefined} className={rowClass(active)}>
        {playlist.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={playlist.cover_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        ) : (
          <CoverPlaceholder className="h-11 w-11 shrink-0 rounded-lg" />
        )}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${playing ? "text-accent-soft" : ""}`}>{playlist.name}</span>
          <span className="block truncate text-xs text-muted">
            Playlist · {playlist.track_count} Titel
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
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; path: string } | null>(null);

  const playlists = playlistQuery.data ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = needle ? playlists.filter((playlist) => playlist.name.toLowerCase().includes(needle)) : playlists;

  return (
    <section aria-label="Bibliothek" className="app-panel flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <Link href="/library" className={`flex min-h-10 items-center gap-3 rounded-xl px-2 text-[15px] font-semibold transition-colors ${pathname === "/library" ? "text-foreground" : "text-muted hover:text-foreground"}`}>
          <LibraryIcon width={22} height={22} />
          Bibliothek
        </Link>
        <button type="button" onClick={() => setCreating(true)} aria-label="Playlist erstellen" title="Playlist erstellen" className="action-icon h-9 min-h-0 w-9">
          <PlusIcon />
        </button>
      </div>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <Shortcut
          href="/library?tab=liked"
          label="Lieblingssongs"
          hint="Deine Favoriten"
          active={false}
          tile={<span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent-solid to-[#3b2a8c] text-white"><HeartIcon width={18} height={18} fill="currentColor" /></span>}
        />
        <Shortcut
          href="/library?tab=recent"
          label="Zuletzt gehört"
          hint="Dein Verlauf"
          active={false}
          tile={<span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-muted"><ClockIcon width={18} height={18} /></span>}
        />
        <Shortcut
          href="/library?tab=downloads"
          label="Downloads"
          hint="Offline verfügbar"
          active={false}
          tile={<span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-success"><DownloadedIcon width={18} height={18} /></span>}
        />

        <div className="mx-2 my-2 border-t border-hairline" />

        {playlists.length > FILTER_THRESHOLD && (
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Playlists filtern"
            aria-label="Playlists filtern"
            className="field-input mb-2 min-h-9 rounded-lg px-3 py-1.5 text-sm"
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
                <div className="skeleton h-11 w-11 rounded-lg" />
                <div className="skeleton h-3 flex-1 rounded" />
              </div>
            ))}
          </div>
        )}
        {playlistQuery.isSuccess && playlists.length === 0 && (
          <div className="mx-1 rounded-xl bg-white/[0.04] p-4">
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
                setMenu({ x: event.clientX, y: event.clientY, id: String(playlist.id), path });
              }}
            />
          ))}
        </ul>
      </div>

      <CreatePlaylistDialog open={creating} onClose={() => setCreating(false)} />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Öffnen", onClick: () => router.push(menu.path) },
            { label: "Löschen", danger: true, onClick: () => deletePlaylist.mutate(menu.id) },
          ]}
        />
      )}
    </section>
  );
}

/** Desktop sidebar: primary navigation above the user's library. */
export default function Sidebar() {
  return (
    <aside aria-label="Navigation und Bibliothek" className="hidden w-[280px] shrink-0 flex-col gap-2 lg:flex">
      <PrimaryNav />
      <LibrarySection />
    </aside>
  );
}
