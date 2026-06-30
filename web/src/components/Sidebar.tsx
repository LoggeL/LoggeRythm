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
  DownloadIcon,
  PlusIcon,
} from "@/components/icons";
import Logo, { Wordmark } from "@/components/Logo";
import ContextMenu from "@/components/ContextMenu";
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
      className={`relative flex items-center gap-4 px-4 py-3 rounded-lg text-[17px] font-medium transition ${
        active
          ? "text-accent"
          : "text-muted hover:text-foreground hover:bg-white/5"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-accent" />
      )}
      <span className="flex-shrink-0">{icon}</span>
      {label}
    </Link>
  );
}

export default function Sidebar() {
  const { data: me } = useMe();
  const router = useRouter();
  const { data: playlists } = usePlaylists(!!me);
  const createPlaylist = useCreatePlaylist();
  const deletePlaylist = useDeletePlaylist();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id: string;
    path: string;
  } | null>(null);

  async function handleCreate() {
    const name = window.prompt("Name der neuen Playlist?");
    if (!name) return;
    await createPlaylist.mutateAsync({ name });
  }

  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-64 flex-shrink-0 bg-black/40 text-foreground border-r border-white/10">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <Link
          href="/"
          className="flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <Logo size={42} className="drop-glow" />
          <Wordmark />
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="px-3 flex flex-col gap-1">
        <NavLink href="/" icon={<HomeIcon width={23} height={23} />} label="Start" />
        <NavLink href="/search" icon={<SearchIcon width={23} height={23} />} label="Suchen" />
        <NavLink href="/genre" icon={<CompassIcon width={23} height={23} />} label="Entdecken" />
        <NavLink href="/library" icon={<NotesIcon width={23} height={23} />} label="Bibliothek" />
        <NavLink href="/radio" icon={<RadioIcon width={23} height={23} />} label="Radio" />
      </nav>

      {/* Library / playlists */}
      <div className="mt-5 px-3 flex-1 min-h-0 flex flex-col">
        <div className="mx-2 mb-2 border-t border-white/10" />
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted">
            Playlists
          </span>
          <button
            type="button"
            onClick={handleCreate}
            aria-label="Playlist erstellen"
            title="Playlist erstellen"
            className="text-muted hover:text-foreground p-1 rounded-full hover:bg-panel-hover"
          >
            <PlusIcon />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto scroll-area px-1 mt-1">
          {me ? (
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
            ) : (
              <p className="px-2 py-2 text-sm text-muted">
                Noch keine Playlists.
              </p>
            )
          ) : (
            <p className="px-2 py-2 text-sm text-muted">
              Melde dich an, um Playlists zu sehen.
            </p>
          )}
        </div>
      </div>

      {/* Downloads footer */}
      <div className="px-3 pb-4">
        <div className="mx-2 mb-2 border-t border-white/10" />
        {me ? (
          <Link
            href="/library"
            className="flex items-center gap-4 px-4 py-3 rounded-lg text-[17px] font-medium text-muted hover:text-foreground hover:bg-white/5 transition"
          >
            <DownloadIcon width={23} height={23} />
            Downloads
          </Link>
        ) : (
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
        )}
      </div>

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
