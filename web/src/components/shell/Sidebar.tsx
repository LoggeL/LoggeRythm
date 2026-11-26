"use client";

import Link from "next/link";
import { NAV_LATERAL } from "@/lib/morph";
import { useState, type DragEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePlaylists, useDeletePlaylist, useAddToPlaylist } from "@/hooks/useLibrary";
import { useMe } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { parseDraggedTrack, TRACK_DRAG_MIME } from "@/lib/trackDrag";
import {
  HeartIcon,
  DownloadedIcon,
  PlusIcon,
  LibraryIcon,
  ClockIcon,
  VisualizerIcon,
  UsersIcon,
  LogOutIcon,
  TrashIcon,
  PlayIcon,
  ShuffleIcon,
  QueueIcon,
} from "@/components/icons";
import Logo, { Wordmark } from "@/components/Logo";
import ContextMenu from "@/components/ContextMenu";
import ConfirmDialog from "@/components/ConfirmDialog";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import EqualizerBars from "@/components/EqualizerBars";
import CreatePlaylistDialog from "@/app/library/CreatePlaylistDialog";
import LeavePlaylistDialog from "@/app/playlist/_components/LeavePlaylistDialog";
import { NAV_ITEMS, isNavItemActive } from "@/components/shell/navigation";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import { canEditPlaylistTracks, isOwnedLibraryPlaylist, sidebarPlaylistMeta } from "@/lib/playlistPermissions";
import { playlistPath } from "@/lib/slugs";
import type { PlaylistSummary, Track } from "@/types";

const FILTER_THRESHOLD = 8;

const rowClass = (active: boolean, dropTarget = false) =>
  `group/row relative flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] px-2 py-1.5 transition-colors ${
    dropTarget
      ? "bg-accent/18 ring-2 ring-accent"
      : active
        ? "bg-foreground/[0.08]"
        : "hover:bg-foreground/[0.05]"
  }`;

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

function PlaylistRow({
  playlist,
  active,
  playing,
  onMenu,
  onDropTrack,
}: {
  playlist: PlaylistSummary;
  active: boolean;
  playing: boolean;
  onMenu: (event: React.MouseEvent, path: string) => void;
  onDropTrack: (playlist: PlaylistSummary, track: Track) => void;
}) {
  const path = playlistPath(playlist);
  const editable = canEditPlaylistTracks(playlist);
  const [dropActive, setDropActive] = useState(false);
  const sharedOrCollaborative = Boolean(
    playlist.is_collaborative || playlist.is_collaborator,
  );

  function handleDragOver(event: DragEvent<HTMLLIElement>) {
    if (!editable || !event.dataTransfer.types.includes(TRACK_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dropActive) setDropActive(true);
  }

  function handleDragLeave() {
    if (dropActive) setDropActive(false);
  }

  function handleDrop(event: DragEvent<HTMLLIElement>) {
    setDropActive(false);
    if (!editable) return;
    const raw = event.dataTransfer.getData(TRACK_DRAG_MIME);
    if (!raw) return;
    event.preventDefault();
    try {
      const track = parseDraggedTrack(raw);
      if (track) onDropTrack(playlist, track);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <li
      onContextMenu={(event) => onMenu(event, path)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Link href={path} transitionTypes={NAV_LATERAL} aria-current={active ? "page" : undefined} className={rowClass(active, dropActive)}>
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
            {dropActive ? "Titel hier ablegen" : sidebarPlaylistMeta(playlist)}
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
  const addToPlaylist = useAddToPlaylist();
  const playingContext = usePlayerStore((s) => (s.isPlaying ? s.queueContext : null));
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; playlist: PlaylistSummary; path: string } | null>(null);
  const [leaving, setLeaving] = useState<{ id: string; name: string; path: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string; path: string } | null>(null);

  const playlists = playlistQuery.data ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = needle ? playlists.filter((playlist) => playlist.name.toLowerCase().includes(needle)) : playlists;

  async function runPlaylistAction(playlist: PlaylistSummary, mode: "play" | "shuffle" | "queue") {
    try {
      const detail = await api.playlist(String(playlist.id));
      const tracks = detail.tracks ?? [];
      if (tracks.length === 0) {
        toast.info(`„${playlist.name}“ enthält noch keine Titel.`);
        return;
      }
      const player = usePlayerStore.getState();
      if (mode === "queue") {
        player.addManyToQueue(tracks, playlist.name);
        toast.info(`${tracks.length} Titel aus „${playlist.name}“ zur Warteschlange hinzugefügt.`);
        return;
      }
      if (mode === "shuffle") {
        if (!player.shuffle) player.toggleShuffle();
        player.playQueue(tracks, Math.floor(Math.random() * tracks.length), playlist.name);
        return;
      }
      player.playQueue(tracks, 0, playlist.name);
    } catch (cause) {
      toast.error(
        `„${playlist.name}“ konnte nicht geladen werden: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  function handleDropTrack(playlist: PlaylistSummary, track: Track) {
    addToPlaylist.mutate(
      { id: String(playlist.id), track },
      {
        onSuccess: () => {
          toast.success(`„${track.title}“ zu „${playlist.name}“ hinzugefügt.`);
        },
      },
    );
  }

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
              onDropTrack={handleDropTrack}
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
      <ConfirmDialog
        open={deleting !== null}
        title="Playlist löschen?"
        confirmLabel="Löschen"
        destructive
        busy={deletePlaylist.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const target = deleting;
          deletePlaylist.mutate(target.id, {
            onSuccess: () => {
              setDeleting(null);
              if (pathname === target.path) router.push("/library");
            },
          });
        }}
      >
        „{deleting?.name}“ wird dauerhaft gelöscht. Deine gelikten Titel bleiben erhalten.
      </ConfirmDialog>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Abspielen", icon: <PlayIcon width={16} height={16} />, onClick: () => void runPlaylistAction(menu.playlist, "play") },
            { label: "Zufällig abspielen", icon: <ShuffleIcon width={16} height={16} />, onClick: () => void runPlaylistAction(menu.playlist, "shuffle") },
            { label: "Zur Warteschlange", icon: <QueueIcon width={16} height={16} />, onClick: () => void runPlaylistAction(menu.playlist, "queue") },
            { label: "Öffnen", separated: true, onClick: () => router.push(menu.path) },
            isOwnedLibraryPlaylist(menu.playlist)
              ? {
                  label: "Löschen",
                  icon: <TrashIcon width={16} height={16} />,
                  danger: true,
                  separated: true,
                  onClick: () =>
                    setDeleting({
                      id: String(menu.playlist.id),
                      name: menu.playlist.name,
                      path: menu.path,
                    }),
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
