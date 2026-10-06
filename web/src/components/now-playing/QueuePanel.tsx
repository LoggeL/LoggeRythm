"use client";

import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import EqualizerBars from "@/components/EqualizerBars";
import BassReactiveArtwork from "@/components/BassReactiveArtwork";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { PlayIcon } from "@/components/icons";
import type { Track } from "@/types";

/**
 * Queue list for the fullscreen player — the persistent right column on
 * desktop, or the "Warteschlange" tab content on mobile (pass a `className`
 * to override the desktop-only default).
 */
export default function QueuePanel({
  className = "hidden lg:flex flex-col min-h-0",
  onClose,
}: {
  className?: string;
  onClose: () => void;
}) {
  const queue = usePlayerStore((s) => s.queue);
  const origins = usePlayerStore((s) => s.origins);
  const queueContext = usePlayerStore((s) => s.queueContext);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const cur = usePlayerStore(currentTrack);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);

  const upcoming = queue.map((t, i) => ({ t, i })).filter(({ i }) => i > index);
  const manualUpcoming = upcoming.filter(({ i }) => origins[i] === "manual");
  const contextUpcoming = upcoming.filter(({ i }) => origins[i] !== "manual");

  const renderItem = ({ t, i }: { t: Track; i: number }) => (
    <li
      key={`${t.id}-${i}`}
      className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-panel-hover focus-within:bg-panel-hover"
    >
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
            className="h-11 w-11 rounded-lg object-cover"
          />
        ) : (
          <CoverPlaceholder className="h-11 w-11 rounded-lg" />
        )}
        <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50 opacity-0 transition group-hover/cover:opacity-100 group-focus-within/cover:opacity-100">
          <PlayIcon width={16} height={16} className="text-white" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <TrackTitle
          track={t}
          onNavigate={onClose}
          className="block truncate text-sm hover:underline"
        />
        <ArtistLinks
          track={t}
          onNavigate={onClose}
          className="block truncate text-xs text-muted"
          linkClassName="hover:text-foreground hover:underline"
        />
      </div>
      <span className="text-xs tabular-nums text-muted">
        {formatTime(t.duration_sec)}
      </span>
    </li>
  );

  return (
    <div className={className}>
      <div className="mb-4 flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">
          Warteschlange
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              setQueueOpen(true);
            }}
            aria-label="Warteschlange bearbeiten"
            className="action-secondary px-3 py-1.5 text-xs"
          >
            Bearbeiten
          </button>
          {upcoming.length > 0 && (
          <button
            type="button"
            onClick={clearQueue}
            className="action-secondary px-3 py-1.5 text-xs"
          >
            Leeren
          </button>
          )}
        </div>
      </div>
      <div
        data-np-scroll
        className="surface-card min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-area p-3"
      >
        {cur && (
          <>
            <p className="mb-2 text-xs font-medium text-accent-soft">
              Aktueller Titel
            </p>
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/10 px-3 py-3">
              <div className="h-11 w-11 shrink-0 rounded-lg">
                <BassReactiveArtwork>
                  {cur.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cur.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <CoverPlaceholder className="h-full w-full" />
                  )}
                </BassReactiveArtwork>
              </div>
              <div className="min-w-0 flex-1">
                <TrackTitle
                  track={cur}
                  onNavigate={onClose}
                  className="block truncate text-sm font-semibold text-foreground hover:underline"
                />
                <ArtistLinks
                  track={cur}
                  onNavigate={onClose}
                  className="block truncate text-xs text-muted"
                  linkClassName="hover:text-foreground hover:underline"
                />
              </div>
              {isPlaying && <EqualizerBars height={16} barClassName="bg-accent" />}
            </div>
          </>
        )}

        {manualUpcoming.length > 0 && (
          <>
            <p className="mb-2 text-xs font-medium text-muted">
              Als Nächstes in der Warteschlange
            </p>
            <ul className="mb-5 flex flex-col">{manualUpcoming.map(renderItem)}</ul>
          </>
        )}

        {contextUpcoming.length > 0 && (
          <>
            <p className="mb-2 text-xs font-medium text-muted">
              {queueContext ? `Als Nächstes: ${queueContext}` : "Als Nächstes"}
            </p>
            <ul className="flex flex-col">{contextUpcoming.map(renderItem)}</ul>
          </>
        )}

        {upcoming.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">
            {cur ? "Keine weiteren Titel in der Warteschlange." : "Die Warteschlange ist leer."}
          </p>
        )}
      </div>
    </div>
  );
}
