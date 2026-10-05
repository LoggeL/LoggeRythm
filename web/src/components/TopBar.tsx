"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import Avatar from "@/components/Avatar";
import Logo from "@/components/Logo";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/components/icons";

export default function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me } = useMe();
  const searchPage = pathname === "/search";

  return (
    <header className="sticky top-0 z-30 -mx-5 sm:-mx-8 xl:-mx-10 flex min-h-[76px] items-center gap-3 border-b border-border bg-background/95 px-5 backdrop-blur-xl sm:px-8 xl:px-10">
      <Link href="/" className="lg:hidden flex-shrink-0" aria-label="Start"><Logo size={30} /></Link>
      <div className="hidden lg:flex items-center gap-1">
        <button type="button" onClick={() => router.back()} aria-label="Zurück" className="action-icon"><ChevronLeftIcon width={18} height={18} /></button>
        <button type="button" onClick={() => router.forward()} aria-label="Vor" className="action-icon"><ChevronRightIcon width={18} height={18} /></button>
      </div>
      <div className="flex min-w-0 flex-1 items-center">
        {!searchPage && (
          <Link href="/search" className="flex h-11 w-full max-w-md items-center gap-3 rounded-xl border border-border bg-panel px-4 text-sm text-muted transition hover:border-white/20 hover:text-foreground" aria-label="Musik suchen">
            <SearchIcon width={18} height={18} />
            <span className="truncate">Was möchtest du hören?</span>
          </Link>
        )}
        {searchPage && <span className="text-sm font-medium text-muted">Deine nächste Entdeckung</span>}
      </div>
      <button type="button" onClick={() => window.dispatchEvent(new Event("open-command-palette"))} title="Schnellsuche (⌘ K / Ctrl K)" aria-label="Schnellsuche öffnen" className="action-icon hidden sm:flex">
        <kbd className="text-xs">⌘ K</kbd>
      </button>
      <Link href="/account" aria-label="Konto" className="flex flex-shrink-0 items-center gap-2 rounded-full border border-border bg-panel p-1 pr-1 transition hover:border-white/20 lg:pr-3">
        <Avatar src={me?.avatar_url} name={me?.display_name} size={32} />
        <span className="hidden max-w-28 truncate text-xs font-medium lg:inline">{me?.display_name}</span>
      </Link>
    </header>
  );
}
