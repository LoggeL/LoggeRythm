"use client";

import Link from "next/link";
import { NAV_LATERAL } from "@/lib/morph";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import Avatar from "@/components/Avatar";
import Logo from "@/components/Logo";
import { ChevronLeftIcon, ChevronRightIcon, VisualizerIcon } from "@/components/icons";
import SearchField from "@/components/SearchField";
import { useSearchNavigation } from "@/hooks/useSearchNavigation";

/** Sticky header: history, global search, quick search and the account. */
export default function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me } = useMe();
  const search = useSearchNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchPage = pathname === "/search";
  useEffect(() => {
    if (searchPage) inputRef.current?.focus({ preventScroll: true });
  }, [searchPage]);

  return (
    <header className="vt-topbar sticky top-0 z-30 flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-10">
      {/* Blurred backing fades in over scrolled content without a hard edge. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-background/80 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" />
      <Link href="/" transitionTypes={NAV_LATERAL} className="shrink-0 lg:hidden" aria-label="Start">
        <Logo size={30} />
      </Link>
      <div className="hidden items-center gap-1.5 lg:flex">
        <button type="button" onClick={() => router.back()} aria-label="Zurück" className="action-icon h-9 min-h-0 w-9 border-hairline">
          <ChevronLeftIcon width={18} height={18} />
        </button>
        <button type="button" onClick={() => router.forward()} aria-label="Vor" className="action-icon h-9 min-h-0 w-9 border-hairline">
          <ChevronRightIcon width={18} height={18} />
        </button>
      </div>
      <div className="flex min-w-0 flex-1 items-center">
        <SearchField
          value={search.input}
          onValueChange={search.setInput}
          onSubmit={() => search.submit()}
          onClear={search.clear}
          inputRef={inputRef}
          placeholder="Was möchtest du hören?"
          className="w-full max-w-xl"
          inputProps={{
            "data-global-search-input": "",
            onCompositionStart: () => search.setComposing(true),
            onCompositionEnd: () => search.setComposing(false),
          } as React.InputHTMLAttributes<HTMLInputElement>}
          trailing={
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
              title="Schnellsuche (⌘ K / Strg K)"
              aria-label="Schnellsuche öffnen"
              className="hidden shrink-0 rounded-[5px] border border-border px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-subtle transition-colors hover:text-foreground sm:block"
            >
              ⌘K
            </button>
          }
        />
      </div>
      {me?.is_admin && (
        <Link
          href="/admin/usage"
          transitionTypes={NAV_LATERAL}
          aria-label="Nutzungs-Dashboard"
          title="Nutzungs-Dashboard"
          aria-current={pathname.startsWith("/admin/usage") ? "page" : undefined}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition lg:hidden ${
            pathname.startsWith("/admin/usage")
              ? "border-accent/50 bg-accent/12 text-accent-soft"
              : "border-hairline text-muted hover:border-foreground/25 hover:text-foreground"
          }`}
        >
          <VisualizerIcon width={18} height={18} />
        </Link>
      )}
      <Link
        href="/account"
        aria-label="Konto"
        title={me?.display_name}
        className={`${me?.is_admin ? "" : "ml-auto "}flex shrink-0 items-center gap-2.5 rounded-full border border-hairline p-1 transition hover:border-foreground/25 lg:ml-auto lg:pr-3.5`}
      >
        <Avatar src={me?.avatar_url} name={me?.display_name} size={32} />
        <span className="hidden max-w-28 truncate text-[13px] font-semibold lg:inline">{me?.display_name}</span>
      </Link>
    </header>
  );
}
