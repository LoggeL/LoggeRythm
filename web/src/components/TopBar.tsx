"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import Avatar from "@/components/Avatar";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/components/icons";

/**
 * Sticky top chrome inside the main column: back/forward navigation, a search
 * pill that opens the command palette, and the mobile user avatar.
 */
export default function TopBar() {
  const router = useRouter();
  const { data: me } = useMe();

  function openSearch() {
    window.dispatchEvent(new Event("open-command-palette"));
  }

  return (
    <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background/70 backdrop-blur-xl flex items-center gap-3">
      <div className="hidden sm:flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Zurück"
          className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-foreground flex items-center justify-center transition"
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          onClick={() => router.forward()}
          aria-label="Vor"
          className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-foreground flex items-center justify-center transition"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <button
        type="button"
        onClick={openSearch}
        className="group flex items-center gap-3 flex-1 min-w-0 bg-panel/80 hover:bg-panel-hover border border-white/10 rounded-full px-4 py-2.5 text-left transition"
      >
        <SearchIcon
          className="text-muted group-hover:text-foreground"
          width={18}
          height={18}
        />
        <span className="flex-1 text-sm text-muted truncate">
          Künstler, Songs, Alben oder Playlists
        </span>
        <kbd className="hidden sm:block text-[10px] text-muted border border-white/15 rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
      </button>

      <Link
        href="/account"
        aria-label="Konto"
        className="md:hidden flex-shrink-0 rounded-full ring-2 ring-white/10 hover:ring-accent transition"
      >
        <Avatar src={me?.avatar_url} name={me?.display_name} size={34} />
      </Link>
    </div>
  );
}
