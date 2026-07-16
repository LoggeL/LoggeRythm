"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import Avatar from "@/components/Avatar";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
} from "@/components/icons";

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
    <div className="sticky top-0 z-30 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 bg-background/70 backdrop-blur-xl flex items-center gap-3">
      <div className="hidden sm:flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Zurück"
          className="w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.12] text-foreground/80 flex items-center justify-center transition"
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          onClick={() => router.forward()}
          aria-label="Vor"
          className="w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.12] text-foreground/80 flex items-center justify-center transition"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <button
        type="button"
        onClick={openSearch}
        className="group flex items-center gap-3 flex-1 min-w-0 max-w-3xl mx-auto bg-white/[0.08] hover:bg-white/[0.11] border border-white/10 rounded-full px-5 py-3.5 text-left transition backdrop-blur-md"
      >
        <SearchIcon
          className="text-muted group-hover:text-foreground"
          width={20}
          height={20}
        />
        <span className="flex-1 text-[15px] text-muted truncate">
          Künstler, Songs, Alben oder Playlists suchen
        </span>
        <kbd className="hidden sm:flex items-center gap-0.5 text-sm text-white/50">
          ⌘ K
        </kbd>
      </button>

      <div className="hidden sm:flex items-center flex-shrink-0">
        <Link
          href="/account"
          aria-label="Konto"
          className="relative flex-shrink-0 rounded-full ring-2 ring-white/10 hover:ring-accent transition"
        >
          <Avatar src={me?.avatar_url} name={me?.display_name} size={36} />
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-background" />
        </Link>
      </div>

      <Link
        href="/account"
        aria-label="Konto"
        className="sm:hidden flex-shrink-0 rounded-full ring-2 ring-white/10 hover:ring-accent transition"
      >
        <Avatar src={me?.avatar_url} name={me?.display_name} size={34} />
      </Link>
    </div>
  );
}
