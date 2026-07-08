"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { PlayIcon, PauseIcon, CloseIcon } from "@/components/icons";
import TrackContext from "@/components/TrackContext";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import Visualizer from "@/components/Visualizer";
import CacheMarker from "@/components/CacheMarker";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import { useBassGlow } from "@/hooks/useBassGlow";

function GripIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="4" cy="3" r="1.4" />
      <circle cx="4" cy="7" r="1.4" />
      <circle cx="4" cy="11" r="1.4" />
      <circle cx="10" cy="3" r="1.4" />
      <circle cx="10" cy="7" r="1.4" />
      <circle cx="10" cy="11" r="1.4" />
    </svg>
  );
}

export default function QueueSidebar() {
  const open = usePlayerStore((s) => s.queueOpen);
  const setOpen = usePlayerStore((s) => s.setQueueOpen);
  const queue = usePlayerStore((s) => s.queue);
  const origins = usePlayerStore((s) => s.origins);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const cur = usePlayerStore(currentTrack);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const toggle = usePlayerStore((s) => s.toggle);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);

  const router = useRouter();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [startingParty, setStartingParty] = useState(false);
  // Enable the open/close transition only after the first paint, so the
  // default-open state on desktop snaps in instead of sliding on every load.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimate(true), 350);
    return () => window.clearTimeout(t);
  }, []);
  // Bass-reactive glow + pulse on the now-playing card.
  const glowRef = useBassGlow<HTMLDivElement>(isPlaying);

  const startParty = async () => {
    setStartingParty(true);
    try {
      const party = await api.createParty();
      router.push(`/party/${party.code}`);
    } catch {
      toast.error("Party konnte nicht gestartet werden.");
      setStartingParty(false);
    }
  };

  const upcoming = queue
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => i > index);
  const userUpcoming = upcoming.filter(({ i }) => origins[i] === "user");
  const contextUpcoming = upcoming.filter(({ i }) => origins[i] !== "user");

  const renderItem = ({ t, i }: { t: (typeof upcoming)[number]["t"]; i: number }) => {
    const isDragging = dragIndex === i;
    const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
    return (
      <li
        key={`${t.id}-${i}`}
        draggable
        onDragStart={(e) => {
          setDragIndex(i);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(i));
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (overIndex !== i) setOverIndex(i);
        }}
        onDragLeave={() => {
          if (overIndex === i) setOverIndex(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragIndex !== null && dragIndex !== i) {
            reorderQueue(dragIndex, i);
          }
          setDragIndex(null);
          setOverIndex(null);
        }}
        onDragEnd={() => {
          setDragIndex(null);
          setOverIndex(null);
        }}
        className={`group flex items-center gap-2 px-2 py-1.5 rounded-xl transition hover:bg-white/[0.06] ${
          isOver ? "bg-panel-hover ring-1 ring-accent" : ""
        } ${isDragging ? "opacity-50" : ""}`}
      >
        <TrackContext track={t} className="contents">
          <span
            aria-hidden="true"
            className="text-muted cursor-grab active:cursor-grabbing flex-shrink-0 opacity-0 group-hover:opacity-100 transition -ml-1"
          >
            <GripIcon />
          </span>
          <button
            type="button"
            onClick={() => jumpTo(i)}
            aria-label={`${t.title} abspielen`}
            className="relative flex-shrink-0 group/cover"
          >
            {t.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.cover}
                alt=""
                className="w-11 h-11 rounded-lg object-cover"
              />
            ) : (
              <CoverPlaceholder className="w-11 h-11 rounded-lg" />
            )}
            <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50 opacity-0 group-hover/cover:opacity-100 transition">
              <PlayIcon width={16} height={16} className="text-white" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <TrackTitle
              track={t}
              className="block truncate text-[15px] hover:underline"
            />
            <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
              <CacheMarker trackId={t.id} />
              <ArtistLinks
                track={t}
                className="truncate text-xs text-muted"
                linkClassName="hover:underline hover:text-foreground"
              />
            </div>
          </div>
          <span className="text-xs text-muted tabular-nums flex-shrink-0">
            {formatTime(t.duration_sec)}
          </span>
          <button
            type="button"
            onClick={() => removeFromQueue(i)}
            aria-label="Entfernen"
            title="Aus Warteschlange entfernen"
            className="text-muted hover:text-foreground transition flex-shrink-0 p-1 opacity-0 group-hover:opacity-100"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </TrackContext>
      </li>
    );
  };

  return (
    <aside
      aria-hidden={!open}
      className={`flex flex-col overflow-hidden bg-background md:bg-black/40 border-white/10 fixed inset-0 z-[70] md:static md:z-auto ${
        animate
          ? "transition-[width,transform,opacity] duration-300 ease-out motion-reduce:transition-none"
          : ""
      } ${
        open
          ? "translate-x-0 opacity-100 md:w-[22rem] md:flex-shrink-0 border-l md:translate-x-0"
          : "translate-x-full opacity-0 pointer-events-none md:opacity-100 md:translate-x-0 md:w-0 md:border-l-0"
      }`}
    >
      {/* Fixed-width inner shell so content doesn't reflow while the panel
          animates its width open/closed. */}
      <div className="flex flex-col h-full w-full md:w-[22rem] flex-shrink-0">
      <div className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0">
        <h2 className="text-[26px] font-semibold tracking-tight">Warteschlange</h2>
        <div className="flex items-center gap-2">
          {upcoming.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              className="px-3.5 py-1.5 rounded-full bg-white/5 text-muted hover:text-foreground hover:bg-white/10 text-xs font-semibold press"
            >
              Leeren
            </button>
          )}
          <button
            type="button"
            onClick={startParty}
            disabled={startingParty}
            className="px-4 py-1.5 rounded-full bg-accent text-white text-xs font-semibold hover:bg-accent-hover disabled:opacity-40 press"
          >
            Party
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Warteschlange schließen"
            className="md:hidden text-muted hover:text-foreground p-2 -m-2"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Now-playing card is pinned (outside the scrolling list) so its
          bass-reactive glow isn't clipped by the scroll container. */}
      {cur && (
        <div
          ref={glowRef}
          className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 mx-4 mt-1 mb-3 flex-shrink-0 will-change-transform"
        >
            <p className="text-xs uppercase tracking-widest text-accent font-semibold mb-3">
              Wird gespielt
            </p>
            <div className="flex items-center gap-3">
              {cur.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cur.cover}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover shadow"
                />
              ) : (
                <CoverPlaceholder className="w-12 h-12 rounded-lg" />
              )}
              <div className="min-w-0 flex-1">
                <TrackTitle
                  track={cur}
                  className="block truncate text-[15px] uppercase tracking-wide text-accent font-bold hover:underline"
                />
                <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                  <CacheMarker trackId={cur.id} />
                  <ArtistLinks
                    track={cur}
                    className="truncate text-xs text-muted"
                    linkClassName="hover:underline hover:text-foreground"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label={isPlaying ? "Pause" : "Abspielen"}
                className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-accent text-white shadow-md hover:bg-accent-hover transition press"
              >
                {isPlaying ? (
                  <PauseIcon width={20} height={20} />
                ) : (
                  <PlayIcon width={20} height={20} />
                )}
              </button>
            </div>
          {/* Full-bleed visualizer flush to the card's bottom + side borders. */}
          <div className="mt-3 -mx-4 -mb-4 overflow-hidden rounded-b-2xl">
            <Visualizer isPlaying={isPlaying} className="block h-10 w-full" />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto scroll-area ml-3 mr-1 pl-1 pr-4 pt-2 pb-5 animate-in [scrollbar-gutter:stable]">
        {!cur && upcoming.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-5 text-sm text-muted">
            <p className="font-semibold text-foreground">Bereit für Musik</p>
            <p className="mt-1">Starte einen Titel, dann bleibt deine Warteschlange hier sichtbar.</p>
          </div>
        )}

        {userUpcoming.length > 0 && (
          <>
            <p className="text-xs uppercase tracking-widest text-muted px-2 mb-2">
              Als Nächstes in der Warteschlange
            </p>
            <ul className="flex flex-col mb-5">{userUpcoming.map(renderItem)}</ul>
          </>
        )}

        {contextUpcoming.length > 0 && (
          <>
            <p className="text-xs uppercase tracking-widest text-muted px-2 mb-2">
              Als Nächstes
            </p>
            <ul className="flex flex-col">{contextUpcoming.map(renderItem)}</ul>
          </>
        )}
      </div>
      </div>
    </aside>
  );
}
