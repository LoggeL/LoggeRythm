"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useCoverColors } from "@/hooks/useCoverColors";
import { hiResCover } from "@/lib/cover";
import { ChevronDownIcon } from "@/components/icons";
import CoverColumn from "./CoverColumn";
import PlayingPanel from "./PlayingPanel";
import QueuePanel from "./QueuePanel";
import SimilarPanel from "./SimilarPanel";
import LyricsPanel from "./LyricsPanel";
import CompactLyrics from "./CompactLyrics";
import { useSwipeToClose } from "./useSwipeToClose";

type NowPlayingTab = "playing" | "lyrics" | "similar" | "queue";

const TABS: [NowPlayingTab, string, boolean?][] = [
  ["playing", "Jetzt läuft"],
  ["lyrics", "Songtext"],
  ["similar", "Ähnliche Titel"],
  // Queue has its own column on desktop, so it's a mobile-only tab.
  ["queue", "Warteschlange", true],
];

/**
 * Fullscreen now-playing view. Layout is a single column on mobile (tabbed)
 * and a 2–3 column grid on lg+ (cover | content | queue). The whole view is
 * themed from the cover art via CSS variable overrides; on touch devices it
 * closes with a swipe-down, on desktop with Escape or the chevron.
 */
export default function NowPlaying({ onClose }: { onClose: () => void }) {
  // Fullscreen opens on the lyrics tab by default.
  const [tab, setTab] = useState<NowPlayingTab>("lyrics");
  const track = usePlayerStore(currentTrack);
  const palette = useCoverColors(track?.cover);

  const rootRef = useRef<HTMLDivElement>(null);
  const swipeHandlers = useSwipeToClose(rootRef, onClose);

  // Escape closes the fullscreen (desktop parity with the swipe gesture).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The queue tab is mobile-only (desktop shows the queue column); if the
  // viewport grows to lg while it's active, fall back to the playing tab.
  useEffect(() => {
    if (tab !== "queue") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => e.matches && setTab("playing");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [tab]);

  if (!track) return null;
  const isPlayingView = tab === "playing";

  // Override the accent CSS variables from the cover palette so every
  // accent-coloured element in the fullscreen (tabs, sliders, play button,
  // queue highlights, equalizer, active lyric line…) is themed automatically.
  const accentStyle = palette
    ? ({
        "--accent": palette.primary,
        "--accent-hover": palette.secondary,
        "--accent-soft": palette.gradient[2],
      } as CSSProperties)
    : undefined;
  const [br, bg, bb] = palette?.rgb ?? [124, 92, 255];
  const backdropBg = `radial-gradient(120% 80% at 50% -10%, rgba(${br}, ${bg}, ${bb}, 0.22), transparent 55%), linear-gradient(to bottom, rgba(10,10,20,0.55), rgba(10,10,20,0.92))`;

  return (
    <div
      ref={rootRef}
      style={accentStyle}
      {...swipeHandlers}
      className="animate-in fixed inset-0 z-[80] flex h-dvh flex-col overflow-hidden bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.5rem+env(safe-area-inset-top))] md:p-8"
    >
      {/* Ambient backdrop from the cover art */}
      {track.cover && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hiResCover(track.cover)}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-40 blur-3xl saturate-150"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: backdropBg }}
          />
        </>
      )}

      {/* Drag affordance for the swipe-down gesture (touch layouts) */}
      <div
        aria-hidden
        className="relative mx-auto mb-1.5 h-1 w-9 flex-shrink-0 rounded-full bg-white/25 md:hidden"
      />

      <div className="relative mb-3 flex flex-shrink-0 items-center justify-between md:mb-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-foreground"
        >
          <ChevronDownIcon width={24} height={24} />
        </button>
        <span className="text-base font-extrabold tracking-tight">
          <span className="text-foreground">Logge</span>
          <span className="mx-0.5 text-white/35">|</span>
          <span className="text-accent">Rythm</span>
        </span>
        <span className="w-10" />
      </div>

      {/* Tab pills — scrollable on narrow screens instead of clipping */}
      <div
        data-np-scroll
        className="relative mx-auto mb-3 flex max-w-full flex-shrink-0 overflow-x-auto rounded-full bg-white/5 p-1 ring-1 ring-white/10 no-scrollbar md:mb-6"
      >
        {TABS.map(([key, label, mobileOnly]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`${mobileOnly ? "lg:hidden " : ""}whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold transition sm:min-w-28 sm:px-5 sm:text-sm ${
                active
                  ? "bg-accent text-white shadow-lg shadow-accent/30"
                  : "text-muted hover:bg-white/5 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className={`relative flex min-h-0 flex-1 flex-col lg:grid lg:gap-8 xl:gap-10 ${
          isPlayingView
            ? "lg:grid-cols-[minmax(0,2.2fr)_0.9fr]"
            : "lg:grid-cols-[1.05fr_1.2fr_0.9fr]"
        }`}
      >
        {/* Left grid column (desktop, lyrics/similar tabs) — the playing tab
            uses the full-width PlayingPanel instead. */}
        {!isPlayingView && (
          <CoverColumn track={track} palette={palette} onClose={onClose} />
        )}

        {tab === "queue" ? (
          <QueuePanel
            onClose={onClose}
            className="flex min-h-0 flex-1 flex-col lg:hidden"
          />
        ) : tab === "similar" ? (
          <SimilarPanel seedId={track.id} onClose={onClose} />
        ) : tab === "playing" ? (
          <PlayingPanel track={track} palette={palette} onClose={onClose} />
        ) : (
          <>
            <CompactLyrics track={track} palette={palette} onNavigate={onClose} />
            <LyricsPanel track={track} />
          </>
        )}

        {/* Right: queue (desktop only — third column) */}
        <QueuePanel onClose={onClose} />
      </div>
    </div>
  );
}
