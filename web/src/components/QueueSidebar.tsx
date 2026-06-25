"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { PlayIcon, PauseIcon } from "@/components/icons";

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
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const cur = usePlayerStore(currentTrack);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const toggle = usePlayerStore((s) => s.toggle);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
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

  if (!open) return null;

  const upcoming = queue
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => i > index);

  return (
    <aside className="hidden md:flex flex-col w-80 flex-shrink-0 bg-black/40 border-l border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-4 flex-shrink-0">
        <h2 className="text-lg font-bold">Warteschlange</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={startParty}
            disabled={startingParty}
            className="px-3 py-1 rounded-full bg-accent text-white text-xs font-semibold hover:bg-accent-hover disabled:opacity-40 press"
          >
            Party starten
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Warteschlange schließen"
            className="text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-area px-3 pb-4 animate-in">
        {!cur && upcoming.length === 0 && (
          <p className="text-sm text-muted px-2 py-4">
            Die Warteschlange ist leer.
          </p>
        )}

        {cur && (
          <>
            <p className="text-xs uppercase tracking-wide text-muted px-2 mb-1">
              Wird gespielt
            </p>
            <div className="flex items-center gap-3 px-2 py-2 rounded-md bg-white/5 mb-4">
              {cur.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cur.cover}
                  alt=""
                  className="w-10 h-10 rounded object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-panel-hover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-accent font-medium">
                  {cur.title}
                </div>
                <div className="truncate text-xs text-muted">{cur.artist}</div>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label={isPlaying ? "Pause" : "Abspielen"}
                className="text-foreground"
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
            </div>
          </>
        )}

        {upcoming.length > 0 && (
          <p className="text-xs uppercase tracking-wide text-muted px-2 mb-1">
            Als Nächstes
          </p>
        )}
        <ul className="flex flex-col">
          {upcoming.map(({ t, i }) => {
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
                className={`group flex items-center gap-2 px-2 py-2 rounded-md transition hover:bg-panel-hover ${
                  isOver ? "bg-panel-hover ring-1 ring-accent" : ""
                } ${isDragging ? "opacity-50" : ""}`}
              >
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
                      className="w-10 h-10 rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-panel-hover flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm">{t.title}</div>
                    <div className="truncate text-xs text-muted">{t.artist}</div>
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
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
