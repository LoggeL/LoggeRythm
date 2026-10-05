"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import {
  usePlaylists,
  useCreatePlaylist,
  useDeletePlaylist,
} from "@/hooks/useLibrary";
import {
  HomeIcon,
  SearchIcon,
  CompassIcon,
  NotesIcon,
  RadioIcon,
  PlusIcon,
} from "@/components/icons";
import Logo, { Wordmark } from "@/components/Logo";
import ContextMenu from "@/components/ContextMenu";
import Modal from "@/components/Modal";
import { playlistPath } from "@/lib/slugs";

function NavLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
        active
          ? "text-foreground bg-panel-hover"
          : "text-muted hover:text-foreground hover:bg-white/5"
      }`}
    >
      <span className={`flex-shrink-0 ${active ? "text-accent-soft" : ""}`}>{icon}</span>
      {label}
    </Link>
  );
}

export default function Sidebar() {
  const { data: me } = useMe();
  const router = useRouter();
  const playlistQuery = usePlaylists(!!me);
  const { data: playlists } = playlistQuery;
  const createPlaylist = useCreatePlaylist();
  const deletePlaylist = useDeletePlaylist();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id: string;
    path: string;
  } | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || createPlaylist.isPending) return;
    createPlaylist.mutate({
      name,
      description: newDescription.trim() || undefined,
    }, {
      onSuccess: () => {
        setCreating(false);
        setNewName("");
        setNewDescription("");
      },
    });
  }

  const pathname = usePathname();

  return (
    <aside aria-label="Sammlung" className="hidden lg:flex flex-col w-[232px] flex-shrink-0 bg-background-elevated text-foreground border-r border-border">
      {/* Logo */}
      <div className="px-5 pt-7 pb-8">
        <Link
          href="/"
          className="flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <Logo size={32} />
          <Wordmark />
        </Link>
      </div>

      {/* Primary nav */}
      <nav aria-label="Hauptnavigation" className="px-3 flex flex-col gap-1">
        <NavLink href="/" icon={<HomeIcon width={23} height={23} />} label="Start" />
        <NavLink href="/search" icon={<SearchIcon width={23} height={23} />} label="Suchen" />
        <NavLink href="/genre" icon={<CompassIcon width={23} height={23} />} label="Entdecken" />
        <NavLink href="/library" icon={<NotesIcon width={23} height={23} />} label="Bibliothek" />
      </nav>

      {/* Library / playlists */}
      <div className="mt-7 px-3 flex-1 min-h-0 flex flex-col">
        <div className="mx-2 mb-4 border-t border-border" />
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted">
            Playlists
          </span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="Playlist erstellen"
            title="Playlist erstellen"
            className="text-muted hover:text-foreground p-1 rounded-full hover:bg-panel-hover"
          >
            <PlusIcon />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto scroll-area px-1 mt-1">
          {playlistQuery.isError && (
            <div role="alert" className="px-2 py-3 text-xs text-red-300">{playlistQuery.error.message}<button type="button" disabled={playlistQuery.isFetching} onClick={() => void playlistQuery.refetch()} className="mt-2 block underline">Erneut versuchen</button></div>
          )}
          {playlistQuery.isPending && <p role="status" className="px-2 py-3 text-xs text-muted">Playlists werden geladen…</p>}
          {me && !playlistQuery.isPending ? (
            playlists && playlists.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {playlists.map((p) => {
                  const path = playlistPath(p);
                  const active = pathname === path;
                  return (
                    <li
                      key={String(p.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({
                          x: e.clientX,
                          y: e.clientY,
                          id: String(p.id),
                          path,
                        });
                      }}
                    >
                      <Link
                        href={path}
                        className={`flex items-center gap-3 p-2 rounded-xl transition ${
                          active
                            ? "bg-white/[0.06] ring-1 ring-white/10"
                            : "hover:bg-white/5"
                        }`}
                      >
                        {p.cover_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.cover_url}
                            alt=""
                            className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-panel-hover flex items-center justify-center text-muted flex-shrink-0">
                            ♪
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {p.name}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {p.track_count} Titel
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : playlistQuery.isError ? null : (
              <p className="px-2 py-2 text-sm text-muted">
                Noch keine Playlists.
              </p>
            )
          ) : !me ? (
            <p className="px-2 py-2 text-sm text-muted">
              Melde dich an, um Playlists zu sehen.
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border px-3 py-3">
        <NavLink href="/radio" icon={<RadioIcon width={20} height={20} />} label="Radio entdecken" />
        <Link href="/library?tab=downloads" className="block px-3 py-2 text-xs text-muted hover:text-foreground">Offline-Sammlung</Link>
      </div>

      {!me && (
        <div className="px-3 pb-4">
          <div className="mx-2 mb-2 border-t border-white/10" />
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/login"
              className="flex-1 text-center px-3 py-1.5 rounded-full border border-white/20 hover:border-white/60"
            >
              Anmelden
            </Link>
            <Link
              href="/register"
              className="flex-1 text-center px-3 py-1.5 rounded-full bg-accent text-white hover:bg-accent-hover"
            >
              Registrieren
            </Link>
          </div>
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Neue Playlist"
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          {createPlaylist.isError && <p role="alert" className="error-panel">{createPlaylist.error.message}</p>}
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              data-dialog-autofocus
              placeholder="Meine Playlist"
              className="field-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Beschreibung (optional)
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              className="field-input resize-none"
            />
          </label>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="action-secondary"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={createPlaylist.isPending || !newName.trim()}
              className="action-primary"
            >
              {createPlaylist.isPending ? "Wird erstellt…" : "Erstellen"}
            </button>
          </div>
        </form>
      </Modal>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Öffnen",
              onClick: () => router.push(menu.path),
            },
            {
              label: "Löschen",
              danger: true,
              onClick: () => deletePlaylist.mutate(menu.id),
            },
          ]}
        />
      )}
    </aside>
  );
}
