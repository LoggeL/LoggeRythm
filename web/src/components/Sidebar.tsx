"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe, useLogout } from "@/hooks/useAuth";
import { usePlaylists, useCreatePlaylist } from "@/hooks/useLibrary";
import {
  HomeIcon,
  SearchIcon,
  LibraryIcon,
  PlusIcon,
  ImportIcon,
} from "@/components/icons";

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
      className={`flex items-center gap-4 px-3 py-2 rounded-md font-semibold transition ${
        active
          ? "text-foreground bg-white/5"
          : "text-muted hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

export default function Sidebar() {
  const { data: me } = useMe();
  const logout = useLogout();
  const { data: playlists } = usePlaylists(!!me);
  const createPlaylist = useCreatePlaylist();

  async function handleCreate() {
    const name = window.prompt("Name der neuen Playlist?");
    if (!name) return;
    await createPlaylist.mutateAsync({ name });
  }

  return (
    <aside className="hidden md:flex flex-col w-64 flex-shrink-0 bg-black text-foreground gap-2 p-2">
      {/* Logo */}
      <div className="px-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block w-7 h-7 rounded-full bg-accent" />
          <span className="text-xl font-extrabold tracking-tight">
            Spotifrei
          </span>
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="bg-panel rounded-lg p-2 flex flex-col gap-1">
        <NavLink href="/" icon={<HomeIcon />} label="Home" />
        <NavLink href="/search" icon={<SearchIcon />} label="Suche" />
        <NavLink
          href="/library"
          icon={<LibraryIcon />}
          label="Deine Bibliothek"
        />
        <NavLink
          href="/import"
          icon={<ImportIcon />}
          label="Importieren"
        />
      </nav>

      {/* Library / playlists */}
      <div className="bg-panel rounded-lg p-2 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-2 py-2">
          <span className="text-sm font-semibold text-muted">
            Deine Playlists
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

        <button
          type="button"
          onClick={handleCreate}
          className="mb-2 mx-1 flex items-center gap-2 text-sm text-accent hover:text-accent-hover px-2 py-1"
        >
          <PlusIcon /> Playlist erstellen
        </button>

        <div className="flex-1 min-h-0 overflow-auto scroll-area px-1">
          {me ? (
            playlists && playlists.length > 0 ? (
              <ul className="flex flex-col">
                {playlists.map((p) => (
                  <li key={String(p.id)}>
                    <Link
                      href={`/playlist/${p.id}`}
                      className="block px-2 py-2 rounded hover:bg-panel-hover text-sm truncate"
                    >
                      <span className="block truncate font-medium">
                        {p.name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        Playlist · {p.track_count} Titel
                      </span>
                    </Link>
                  </li>
                ))}
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

      {/* Auth footer */}
      <div className="bg-panel rounded-lg p-3">
        {me ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">
              {me.display_name}
            </span>
            <button
              type="button"
              onClick={logout}
              className="text-xs text-muted hover:text-foreground whitespace-nowrap"
            >
              Logout
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/login"
              className="flex-1 text-center px-3 py-1.5 rounded-full border border-white/20 hover:border-white/60"
            >
              Login
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
    </aside>
  );
}
