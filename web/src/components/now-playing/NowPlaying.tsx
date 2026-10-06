"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useCoverColors } from "@/hooks/useCoverColors";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { hiResCover } from "@/lib/cover";
import { fullscreenTheme } from "@/lib/fullscreenTheme";
import { ChevronDownIcon } from "@/components/icons";
import CoverColumn from "./CoverColumn";
import PlayingPanel from "./PlayingPanel";
import QueuePanel from "./QueuePanel";
import SimilarPanel from "./SimilarPanel";
import LyricsPanel from "./LyricsPanel";
import CompactLyrics from "./CompactLyrics";
import { SeekBar, TransportRow } from "./Controls";
import { useSwipeToClose } from "./useSwipeToClose";
import styles from "./fullscreen.module.css";

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
 * and a 2–3 column grid on lg+ (cover | content | queue). The view
 * uses a subtle cover-art backdrop; on touch devices it
 * closes with a swipe-down, on desktop with Escape or the chevron.
 */
export default function NowPlaying({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<NowPlayingTab>("playing");
  const track = usePlayerStore(currentTrack);
  const error = usePlayerStore((s) => s.error);
  const palette = useCoverColors(track?.cover);

  const rootRef = useRef<HTMLDivElement>(null);
  const swipeHandlers = useSwipeToClose(rootRef, onClose);
  useDialogFocus(!!track, rootRef, onClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // The queue tab is mobile-only (desktop shows the queue column); if the
  // viewport grows to lg while it's active, fall back to the playing tab.
  useEffect(() => {
    if (tab !== "queue") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => e.matches && setTab("playing");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [tab]);

  const moveTab = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const visibleTabs = TABS.filter(([, , mobileOnly]) =>
      !mobileOnly || !window.matchMedia("(min-width: 1024px)").matches,
    );
    const current = visibleTabs.findIndex(([key]) => key === tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? visibleTabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
    const key = visibleTabs[next][0];
    setTab(key);
    rootRef.current?.querySelector<HTMLButtonElement>(`#now-playing-tab-${key}`)?.focus();
  };

  if (!track) return null;
  const isPlayingView = tab === "playing";

  const [br, bg, bb] = palette?.rgb ?? [124, 92, 255];
  const backdropBg = `radial-gradient(100% 80% at 40% 0%, rgba(${br}, ${bg}, ${bb}, 0.1), transparent 60%), linear-gradient(to bottom, rgba(11,12,16,0.84), rgba(11,12,16,0.98))`;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Vollbildplayer"
      {...swipeHandlers}
      style={fullscreenTheme(palette) as CSSProperties}
      className={`${styles.scope} animate-in fixed inset-0 z-[80] flex h-dvh flex-col overflow-hidden bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.5rem+env(safe-area-inset-top))] md:p-6 lg:p-8`}
    >
      {/* Ambient backdrop from the cover art */}
      {track.cover && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hiResCover(track.cover)}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-15 blur-3xl"
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
          data-dialog-autofocus
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="action-icon h-11 w-11"
        >
          <ChevronDownIcon width={24} height={24} />
        </button>
        <span className="w-11" />
      </div>

      {/* Tab pills — scrollable on narrow screens instead of clipping */}
      <div
        data-np-scroll
        role="tablist"
        aria-label="Playeransicht"
        className="relative mx-auto mb-4 flex max-w-full flex-shrink-0 overflow-x-auto rounded-xl border border-border bg-panel p-1 no-scrollbar md:mb-6"
      >
        {TABS.map(([key, label, mobileOnly]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`now-playing-tab-${key}`}
              aria-controls="now-playing-panel"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={moveTab}
              className={`${mobileOnly ? "lg:hidden " : ""}min-h-10 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-4 sm:text-sm ${
                active
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:bg-white/5 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="error-panel relative mb-4 max-h-28 flex-shrink-0 overflow-y-auto">
          {error}
        </p>
      )}

      <div
        role="tabpanel"
        id="now-playing-panel"
        aria-labelledby={`now-playing-tab-${tab}`}
        className={`relative flex min-h-0 flex-1 flex-col lg:grid lg:gap-6 xl:gap-8 ${
          isPlayingView
            ? "lg:grid-cols-[minmax(0,2.2fr)_0.9fr]"
            : "lg:grid-cols-[1.05fr_1.2fr_0.9fr]"
        }`}
      >
        {/* Left grid column (desktop, lyrics/similar tabs) — the playing tab
            uses the full-width PlayingPanel instead. */}
        {!isPlayingView && (
          <CoverColumn track={track} onClose={onClose} />
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
            <CompactLyrics track={track} onNavigate={onClose} />
            <LyricsPanel track={track} />
          </>
        )}

        {/* Right: queue (desktop only — third column) */}
        <QueuePanel onClose={onClose} />
      </div>
      {(tab === "queue" || tab === "similar") && (
        <div className="relative mt-3 flex-shrink-0 border-t border-border pt-3 lg:hidden">
          <SeekBar />
          <TransportRow />
        </div>
      )}
    </div>
  );
}
