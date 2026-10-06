"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { PlayIcon, PauseIcon, CloseIcon, MoreIcon, ChevronDownIcon } from "@/components/icons";
import TrackContext from "@/components/TrackContext";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import CacheMarker from "@/components/CacheMarker";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import EqualizerBars from "@/components/EqualizerBars";
import { useDialogFocus } from "@/hooks/useDialogFocus";

const DOCK_QUERY = "(min-width: 1536px)";
function subscribeDock(listener: () => void) {
  const media = window.matchMedia(DOCK_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
function dockSnapshot() { return window.matchMedia(DOCK_QUERY).matches; }
function serverDockSnapshot() { return false; }

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
  const queueContext = usePlayerStore((s) => s.queueContext);
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
  const [actionsIndex, setActionsIndex] = useState<number | null>(null);
  const docked = useSyncExternalStore(subscribeDock, dockSnapshot, serverDockSnapshot);
  const panelRef = useRef<HTMLElement>(null);
  const closeQueue = useCallback(() => setOpen(false), [setOpen]);
  useDialogFocus(open && !docked, panelRef, closeQueue);
  // Keep the first paint still, then animate user-initiated changes.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimate(true), 350);
    return () => window.clearTimeout(t);
  }, []);

  const startParty = async () => {
    setStartingParty(true);
    try {
      const party = await api.createParty();
      router.push(`/party/${party.code}`);
    } catch (error) {
      toast.error(`Party konnte nicht gestartet werden: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStartingParty(false);
    }
  };

  const upcoming = queue
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => i > index);
  const manualUpcoming = upcoming.filter(({ i }) => origins[i] === "manual");
  const contextUpcoming = upcoming.filter(({ i }) => origins[i] !== "manual");

  const renderItem = ({ t, i }: { t: (typeof upcoming)[number]["t"]; i: number }) => {
    const isDragging = dragIndex === i;
    const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
    return (
      <li
        key={`${t.id}-${i}`}
        data-queue-index={i}
        tabIndex={0}
        aria-label={`${t.title}, ${t.artist}. Mit Alt und Pfeiltasten verschieben.`}
        onKeyDown={(event) => {
          if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
          event.preventDefault();
          event.stopPropagation();
          const target = i + (event.key === "ArrowUp" ? -1 : 1);
          if (target > index && target < queue.length && origins[target] === origins[i]) {
            reorderQueue(i, target);
            window.requestAnimationFrame(() => {
              panelRef.current?.querySelector<HTMLElement>(`[data-queue-index="${target}"]`)?.focus();
            });
          }
        }}
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
            // The manual (primary) and context (secondary) sections are
            // separate lists — a cross-section drop is not a valid reorder.
            if (origins[dragIndex] !== origins[i]) {
              toast.error(
                "Titel können nicht zwischen Warteschlange und Playlist-Reihenfolge verschoben werden.",
              );
            } else {
              reorderQueue(dragIndex, i);
            }
          }
          setDragIndex(null);
          setOverIndex(null);
        }}
        onDragEnd={() => {
          setDragIndex(null);
          setOverIndex(null);
        }}
        className={`group flex flex-wrap items-center gap-2 rounded-xl p-2 transition hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-accent ${
          isOver ? "bg-panel-hover ring-1 ring-accent" : ""
        } ${isDragging ? "opacity-50" : ""}`}
      >
        <TrackContext track={t} onRemove={() => removeFromQueue(i)} removeLabel="Aus Warteschlange entfernen" className="contents">
          <span
            aria-hidden="true"
            className="-ml-1 flex-shrink-0 cursor-grab text-muted/50 transition active:cursor-grabbing group-hover:text-muted"
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
              className="block truncate text-sm font-medium hover:underline"
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
          <button
            type="button"
            onClick={() => setActionsIndex(actionsIndex === i ? null : i)}
            aria-label={`Aktionen für ${t.title}`}
            aria-expanded={actionsIndex === i}
            className="action-icon h-10 w-8 shrink-0 text-muted"
          >
            <MoreIcon width={18} height={18} />
          </button>
        </TrackContext>
        {actionsIndex === i && (
          <div className="flex w-full items-center justify-end gap-1 border-t border-white/8 pt-2">
            <span className="mr-auto text-xs tabular-nums text-muted">{formatTime(t.duration_sec)}</span>
            <button type="button" onClick={() => { reorderQueue(i, i - 1); setActionsIndex(null); }} disabled={i - 1 <= index || origins[i - 1] !== origins[i]} aria-label={`${t.title} nach oben verschieben`} className="action-icon h-10 w-10 disabled:opacity-30">
              <ChevronDownIcon className="rotate-180" width={18} height={18} />
            </button>
            <button type="button" onClick={() => { reorderQueue(i, i + 1); setActionsIndex(null); }} disabled={i + 1 >= queue.length || origins[i + 1] !== origins[i]} aria-label={`${t.title} nach unten verschieben`} className="action-icon h-10 w-10 disabled:opacity-30">
              <ChevronDownIcon width={18} height={18} />
            </button>
            <button type="button" onClick={() => { removeFromQueue(i); setActionsIndex(null); }} aria-label={`${t.title} aus Warteschlange entfernen`} className="action-icon h-10 w-10 text-muted hover:text-red-400">
              <CloseIcon width={18} height={18} />
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={closeQueue}
          className="fixed inset-0 z-[65] bg-black/55 backdrop-blur-sm 2xl:hidden"
        />
      )}
      <aside
        ref={panelRef}
        role={docked ? "complementary" : "dialog"}
        aria-modal={!docked && open ? true : undefined}
        aria-label="Warteschlange"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-y-0 right-0 z-[70] flex w-full max-w-sm flex-col overflow-hidden border-l border-white/8 bg-panel sm:max-w-[320px] 2xl:static 2xl:z-auto 2xl:max-w-none ${
          animate ? "transition-[width,transform,opacity] duration-200 ease-out motion-reduce:transition-none" : ""
        } ${
          open
            ? "translate-x-0 opacity-100 2xl:w-[320px] 2xl:flex-shrink-0"
            : "pointer-events-none translate-x-full opacity-0 2xl:w-0 2xl:translate-x-0 2xl:border-l-0"
        }`}
      >
        <div className="flex h-full w-full flex-shrink-0 flex-col 2xl:w-[320px]">
          <div className="flex flex-shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-[calc(1rem+env(safe-area-inset-top))] 2xl:pt-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Warteschlange</h2>
              <p className="mt-0.5 text-xs text-muted">{upcoming.length} Titel als Nächstes</p>
            </div>
            <button
              data-dialog-autofocus
              type="button"
              onClick={closeQueue}
              aria-label="Warteschlange schließen"
              className="action-icon"
            >
              <CloseIcon width={20} height={20} />
            </button>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 px-4 pb-4">
            <button type="button" onClick={startParty} disabled={startingParty} className="action-secondary flex-1">
              {startingParty ? "Wird gestartet…" : "Party starten"}
            </button>
            {upcoming.length > 0 && (
              <button type="button" onClick={clearQueue} className="action-secondary">Leeren</button>
            )}
          </div>

          {cur && (
            <div className="mx-4 mb-4 flex-shrink-0 rounded-xl border border-white/8 bg-background p-3">
              <p className="mb-2 text-[11px] font-medium text-muted">Jetzt läuft</p>
              <div className="flex items-center gap-3">
                {cur.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cur.cover} alt="" className="h-11 w-11 rounded-lg object-cover" />
                ) : (
                  <CoverPlaceholder className="h-11 w-11 rounded-lg" />
                )}
                <div className="min-w-0 flex-1">
                  <TrackTitle track={cur} className="block truncate text-sm font-medium hover:underline" />
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <EqualizerBars height={12} isPlaying={isPlaying} />
                    <CacheMarker trackId={cur.id} />
                    <ArtistLinks track={cur} className="truncate text-xs text-muted" linkClassName="hover:underline hover:text-foreground" />
                  </div>
                </div>
                <button type="button" onClick={toggle} aria-label={isPlaying ? "Pause" : "Abspielen"} className="action-icon">
                  {isPlaying ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
                </button>
              </div>
            </div>
          )}

          <div className="scroll-area min-h-0 flex-1 overflow-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] [scrollbar-gutter:stable]">
            {!cur && upcoming.length === 0 && (
              <div className="mx-2 rounded-xl border border-white/8 bg-background px-4 py-5 text-sm text-muted">
                <p className="font-medium text-foreground">Bereit für Musik</p>
                <p className="mt-1">Wähle einen Titel. Hier siehst du, was danach läuft.</p>
              </div>
            )}
            {cur && upcoming.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted">Füge weitere Titel über das Titelmenü hinzu.</p>
            )}
            {manualUpcoming.length > 0 && (
              <>
                <p className="mb-2 px-3 text-xs font-medium text-muted">Deine nächsten Titel</p>
                <ul className="mb-5 flex flex-col">{manualUpcoming.map(renderItem)}</ul>
              </>
            )}
            {contextUpcoming.length > 0 && (
              <>
                <p className="mb-2 px-3 text-xs font-medium text-muted">{queueContext ? `Aus ${queueContext}` : "Weitere Titel"}</p>
                <ul className="flex flex-col">{contextUpcoming.map(renderItem)}</ul>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
