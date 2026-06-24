"use client";

import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import { PlayIcon, PauseIcon } from "@/components/icons";

export default function QueuePanel({ onClose }: { onClose: () => void }) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const cur = usePlayerStore(currentTrack);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const toggle = usePlayerStore((s) => s.toggle);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);

  const upcoming = queue
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => i > index);

  return (
    <div className="absolute right-2 bottom-full mb-2 z-50 w-80 max-h-[60vh] overflow-auto scroll-area rounded-lg bg-[#181818] border border-white/10 shadow-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-sm">Warteschlange</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="text-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {cur && (
        <>
          <p className="text-xs uppercase tracking-wide text-muted mb-1">
            Wird gespielt
          </p>
          <div className="flex items-center gap-2 px-2 py-2 rounded bg-white/5 mb-3">
            {cur.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cur.cover} alt="" className="w-9 h-9 rounded object-cover" />
            ) : (
              <div className="w-9 h-9 rounded bg-panel-hover" />
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

      <p className="text-xs uppercase tracking-wide text-muted mb-1">Als Nächstes</p>
      {upcoming.length === 0 ? (
        <p className="text-sm text-muted px-2 py-2">Keine weiteren Titel.</p>
      ) : (
        <ul className="flex flex-col">
          {upcoming.map(({ t, i }) => (
            <li
              key={`${t.id}-${i}`}
              className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-panel-hover"
            >
              <button
                type="button"
                onClick={() => jumpTo(i)}
                className="flex items-center gap-2 min-w-0 flex-1 text-left"
              >
                {t.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.cover}
                    alt=""
                    className="w-9 h-9 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded bg-panel-hover flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm">{t.title}</div>
                  <div className="truncate text-xs text-muted">{t.artist}</div>
                </div>
              </button>
              <span className="text-xs text-muted tabular-nums">
                {formatTime(t.duration_sec)}
              </span>
              <div className="flex flex-col opacity-0 group-hover:opacity-100 transition">
                <button
                  type="button"
                  onClick={() => reorderQueue(i, i - 1)}
                  disabled={i <= index + 1}
                  aria-label="Nach oben"
                  className="text-muted hover:text-foreground disabled:opacity-30 leading-none text-xs"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => reorderQueue(i, i + 1)}
                  disabled={i >= queue.length - 1}
                  aria-label="Nach unten"
                  className="text-muted hover:text-foreground disabled:opacity-30 leading-none text-xs"
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeFromQueue(i)}
                aria-label="Entfernen"
                className="text-muted hover:text-foreground opacity-0 group-hover:opacity-100 transition px-1"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
