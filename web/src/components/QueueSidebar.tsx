"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { PlayIcon, PauseIcon } from "@/components/icons";
import TrackContext from "@/components/TrackContext";
import EqualizerBars from "@/components/EqualizerBars";
import CacheMarker from "@/components/CacheMarker";

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
        className={`group flex items-center gap-2 px-2 py-2 rounded-xl transition hover:bg-white/[0.06] ${
          isOver ? "bg-panel-hover ring-1 ring-accent" : ""
        } ${isDragging ? "opacity-50" : ""}`}
      >
        <TrackContext track={t} className="contents">
          <span
            aria-hidden="true"
            className="text-muted cursor-grab active:cursor-grabbing flex-shrink-0 opacity-0 group-hover:opacity-100 transition"
          >
            <GripIcon />
          </span>
          <button
            type="button"
            onClick={() => jumpTo(i)}
            className="flex items-center gap-3 min-w-0 flex-1 text-left"
          >
            {t.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.cover}
                alt=""
                className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg gradient-violet opacity-80 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm">{t.title}</div>
              <div className="flex items-center gap-1.5 min-w-0">
                <CacheMarker trackId={t.id} />
                <span className="truncate text-xs text-muted">{t.artist}</span>
              </div>
            </div>
          </button>
          <span className="text-xs text-muted tabular-nums">
            {formatTime(t.duration_sec)}
          </span>
          <button
            type="button"
            onClick={() => removeFromQueue(i)}
            aria-label="Entfernen"
            className="text-muted hover:text-foreground opacity-0 group-hover:opacity-100 transition px-1"
          >
            ✕
          </button>
        </TrackContext>
      </li>
    );
  };

  return (
    <aside
      className={
        open
          ? "flex flex-col fixed inset-0 z-[70] bg-background md:static md:z-auto md:w-[22rem] md:flex-shrink-0 md:bg-black/40 border-l border-white/10 overflow-hidden"
          : "hidden"
      }
    >
      <div className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0 border-b border-white/5">
        <h2 className="text-lg font-bold">Warteschlange</h2>
        <div className="flex items-center gap-2">
          {upcoming.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              className="px-3 py-1 rounded-full bg-white/5 text-muted hover:text-foreground hover:bg-white/10 text-xs font-semibold press"
            >
              Leeren
            </button>
          )}
          <button
            type="button"
            onClick={startParty}
            disabled={startingParty}
            className="px-3 py-1 rounded-full bg-accent text-white text-xs font-semibold hover:bg-accent-hover disabled:opacity-40 press"
          >
            Party
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Warteschlange schließen"
            className="text-muted hover:text-foreground p-2 -m-2"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-area ml-3 mr-1 pl-1 pr-4 pt-2 pb-5 animate-in [scrollbar-gutter:stable]">
        {!cur && upcoming.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-5 text-sm text-muted">
            <p className="font-semibold text-foreground">Bereit für Musik</p>
            <p className="mt-1">Starte einen Titel, dann bleibt deine Warteschlange hier sichtbar.</p>
          </div>
        )}

        {cur && (
          <>
            <p className="text-xs uppercase tracking-wide text-muted px-2 mb-1">
              Wird gespielt
            </p>
            <div className="flex items-center gap-3 px-3 py-3 rounded-2xl bg-accent/[0.12] ring-1 ring-accent/[0.35] shadow-lg shadow-accent/10 mb-4">
              {cur.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cur.cover}
                  alt=""
                  className="w-11 h-11 rounded-lg object-cover shadow"
                />
              ) : (
                <div className="w-11 h-11 rounded-lg gradient-violet opacity-80" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-accent font-medium">
                  {cur.title}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <CacheMarker trackId={cur.id} />
                  <span className="truncate text-xs text-muted">{cur.artist}</span>
                </div>
              </div>
              {isPlaying && (
                <EqualizerBars
                  height={16}
                  barClassName="bg-accent"
                  className="mr-1"
                />
              )}
              <button
                type="button"
                onClick={toggle}
                aria-label={isPlaying ? "Pause" : "Abspielen"}
                className="text-foreground hover:text-accent transition"
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
            </div>
          </>
        )}

        {userUpcoming.length > 0 && (
          <>
            <p className="text-xs uppercase tracking-wide text-muted px-2 mb-1">
              Als Nächstes in der Warteschlange
            </p>
            <ul className="flex flex-col mb-4">{userUpcoming.map(renderItem)}</ul>
          </>
        )}

        {contextUpcoming.length > 0 && (
          <>
            <p className="text-xs uppercase tracking-wide text-muted px-2 mb-1">
              {queueContext ? `Als Nächstes: ${queueContext}` : "Als Nächstes"}
            </p>
            <ul className="flex flex-col">{contextUpcoming.map(renderItem)}</ul>
          </>
        )}
      </div>
    </aside>
  );
}
