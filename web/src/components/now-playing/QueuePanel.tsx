"use client";

import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import EqualizerBars from "@/components/EqualizerBars";
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

  const upcoming = queue.map((t, i) => ({ t, i })).filter(({ i }) => i > index);
  const userUpcoming = upcoming.filter(({ i }) => origins[i] === "user");
  const contextUpcoming = upcoming.filter(({ i }) => origins[i] !== "user");

  const renderItem = ({ t, i }: { t: Track; i: number }) => (
    <li
      key={`${t.id}-${i}`}
      className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/5"
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
        <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50 opacity-0 transition group-hover/cover:opacity-100">
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
      <div className="mb-4 flex flex-shrink-0 items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Warteschlange
        </span>
        {upcoming.length > 0 && (
          <button
            type="button"
            onClick={clearQueue}
            className="press rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-muted transition hover:bg-white/10 hover:text-foreground"
          >
            Leeren
          </button>
        )}
      </div>
      <div
        data-np-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-area pr-1"
      >
        {cur && (
          <>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-accent">
              Aktueller Titel
            </p>
            <div className="mb-5 flex items-center gap-3 rounded-2xl bg-accent/10 px-3 py-3 ring-1 ring-accent/25">
              {cur.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cur.cover}
                  alt=""
                  className="h-11 w-11 rounded-lg object-cover shadow"
                />
              ) : (
                <CoverPlaceholder className="h-11 w-11 rounded-lg" />
              )}
              <div className="min-w-0 flex-1">
                <TrackTitle
                  track={cur}
                  onNavigate={onClose}
                  className="block truncate text-sm font-semibold text-accent hover:underline"
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

        {userUpcoming.length > 0 && (
          <>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-muted">
              Als Nächstes in der Warteschlange
            </p>
            <ul className="mb-5 flex flex-col">{userUpcoming.map(renderItem)}</ul>
          </>
        )}

        {contextUpcoming.length > 0 && (
          <>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-muted">
              {queueContext ? `Als Nächstes: ${queueContext}` : "Als Nächstes"}
            </p>
            <ul className="flex flex-col">{contextUpcoming.map(renderItem)}</ul>
          </>
        )}

        {!cur && upcoming.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">
            Die Warteschlange ist leer.
          </p>
        )}
      </div>
    </div>
  );
}
