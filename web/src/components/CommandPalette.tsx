"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { SearchIcon, PlayIcon } from "@/components/icons";
import type { Track, ArtistSummary } from "@/types";

type Row =
  | { kind: "track"; track: Track }
  | { kind: "artist"; artist: ArtistSummary };

/**
 * Global ⌘K / Ctrl+K command palette: a search overlay reachable from any
 * route. Arrow keys move the selection, Enter activates (play track / open
 * artist), Esc closes. Uses the existing search API (debounced).
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const playQueue = usePlayerStore((s) => s.playQueue);

  // Open on ⌘K / Ctrl+K from anywhere; close on Esc. Reset happens here (not in
  // an effect) so opening starts from a clean slate.
  useEffect(() => {
    function reset() {
      setQ("");
      setDebounced("");
      setSel(0);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) reset();
          return !v;
        });
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpenEvent() {
      reset();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);

  // Focus the input once the overlay is mounted (DOM sync, not state).
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(id);
  }, [open]);

  // Debounce the query.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(id);
  }, [q]);

  const tracks = useQuery<Track[]>({
    queryKey: ["cmdk-tracks", debounced],
    queryFn: () => api.search(debounced, "track"),
    enabled: open && debounced.length > 1,
  });
  const artists = useQuery<ArtistSummary[]>({
    queryKey: ["cmdk-artists", debounced],
    queryFn: () => api.searchArtists(debounced),
    enabled: open && debounced.length > 1,
  });

  const rows: Row[] = [
    ...(artists.data ?? []).slice(0, 3).map((artist) => ({
      kind: "artist" as const,
      artist,
    })),
    ...(tracks.data ?? []).slice(0, 8).map((track) => ({
      kind: "track" as const,
      track,
    })),
  ];

  function activate(row: Row) {
    if (row.kind === "track") {
      const list = tracks.data ?? [row.track];
      const idx = list.findIndex((t) => t.id === row.track.id);
      playQueue(list, idx < 0 ? 0 : idx);
    } else {
      router.push(`/artist/${row.artist.id}`);
    }
    setOpen(false);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[sel]) activate(rows[sel]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-background-elevated border border-white/10 rounded-2xl shadow-2xl overflow-hidden pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <SearchIcon width={18} height={18} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Künstler, Songs, Alben suchen…"
            className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted"
          />
          <kbd className="hidden sm:block text-[10px] text-muted border border-white/15 rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto scroll-area py-2">
          {debounced.length <= 1 && (
            <p className="px-4 py-6 text-sm text-muted text-center">
              Tippe, um zu suchen.
            </p>
          )}
          {debounced.length > 1 && rows.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted text-center">
              {tracks.isLoading || artists.isLoading
                ? "Sucht…"
                : "Keine Treffer."}
            </p>
          )}
          {rows.map((row, i) => {
            const active = i === sel;
            const key = row.kind === "track" ? `t-${row.track.id}` : `a-${row.artist.id}`;
            return (
              <button
                key={key}
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => activate(row)}
                className={`flex items-center gap-3 w-full px-4 py-2 text-left transition ${
                  active ? "bg-accent/15" : "hover:bg-white/5"
                }`}
              >
                {row.kind === "track" ? (
                  <>
                    {row.track.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.track.cover}
                        alt=""
                        className="w-9 h-9 rounded object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded gradient-violet opacity-80 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {row.track.title}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {row.track.artist}
                      </div>
                    </div>
                    {active && (
                      <PlayIcon width={16} height={16} className="text-accent" />
                    )}
                  </>
                ) : (
                  <>
                    {row.artist.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.artist.picture}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full gradient-violet opacity-80 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {row.artist.name}
                      </div>
                      <div className="truncate text-xs text-muted">Künstler</div>
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
