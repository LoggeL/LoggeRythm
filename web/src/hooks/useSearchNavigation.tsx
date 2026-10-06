"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSearchInput } from "@/hooks/useSearchInput";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { readSearchLocation, searchHref, type SearchLocation } from "@/lib/searchState";
import type { SearchSort, SearchTab } from "@/app/search/results";

type SearchNavigation = {
  input: string;
  query: string;
  tab: SearchTab;
  sort: SearchSort;
  preparing: boolean;
  setInput: (value: string) => void;
  setComposing: (value: boolean) => void;
  submit: (value?: string) => void;
  clear: () => void;
  setTab: (value: SearchTab) => void;
  setSort: (value: SearchSort) => void;
  openResults: (value: string) => void;
};
const Context = createContext<SearchNavigation | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const location = readSearchLocation(new URLSearchParams(params.toString()));
  const searching = pathname === "/search";
  const control = useSearchInput(searching ? location.query : "", pathname);
  const { submit: commitInput, clear: clearInput } = control;
  const { remember } = useRecentSearches();
  const pendingHref = useRef<string | null>(null);
  const currentHref = `${pathname}${params.size ? `?${params}` : ""}`;

  useEffect(() => {
    pendingHref.current = null;
  }, [pathname]);

  useEffect(() => {
    function restoreHistoryEntry() {
      pendingHref.current = null;
      if (window.location.pathname === "/search")
        commitInput(readSearchLocation(new URLSearchParams(window.location.search)).query);
      else clearInput();
    }
    window.addEventListener("popstate", restoreHistoryEntry);
    return () => window.removeEventListener("popstate", restoreHistoryEntry);
  }, [commitInput, clearInput]);

  function navigate(next: SearchLocation, push: boolean) {
    const href = searchHref(next);
    if (href === currentHref) return;
    if (!searching) {
      if (pendingHref.current === href) return;
      pendingHref.current = href;
      router.push(href, { scroll: false });
    } else {
      pendingHref.current = null;
      window.history[push ? "pushState" : "replaceState"](null, "", href);
    }
  }

  useEffect(() => {
    if (control.query === (searching ? location.query : "")) return;
    const next = {
      query: control.query,
      tab: control.query ? location.tab : "all" as const,
      sort: control.query ? location.sort : "relevance" as const,
    };
    const href = searchHref(next);
    if (searching) window.history.replaceState(null, "", href);
    else if (control.query && pendingHref.current !== href) {
      pendingHref.current = href;
      router.push(href, { scroll: false });
    }
  }, [control.query, searching, location.query, location.tab, location.sort, router]);

  function submit(value = control.input) {
    control.submit(value);
    remember(value);
    navigate({ query: value, tab: location.tab, sort: location.sort }, false);
  }

  return <Context.Provider value={{
    ...control,
    tab: location.tab,
    sort: location.sort,
    submit,
    clear: () => {
      control.clear();
      if (searching) navigate({ query: "", tab: "all", sort: "relevance" }, false);
    },
    setTab: (tab) => {
      control.submit();
      navigate({ query: control.input, tab, sort: location.sort }, true);
    },
    setSort: (sort) => {
      control.submit();
      navigate({ query: control.input, tab: location.tab, sort }, true);
    },
    openResults: (value) => {
      control.submit(value);
      remember(value);
      navigate({ query: value, tab: "all", sort: "relevance" }, false);
    },
  }}>{children}</Context.Provider>;
}

export function useSearchNavigation(): SearchNavigation {
  const context = useContext(Context);
  if (!context) throw new Error("Suchnavigation benötigt den SearchProvider.");
  return context;
}
