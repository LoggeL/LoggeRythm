"use client";

import { useQuery } from "@tanstack/react-query";
import { usePlayerStore } from "@/store/player";
import { api } from "@/lib/api";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import { PlayIcon, PlusIcon } from "@/components/icons";

/** "Ähnliche Titel" tab: song radio seeded by the current track. */
export default function SimilarPanel({
  seedId,
  onClose,
}: {
  seedId: string | number;
  onClose: () => void;
}) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["similar-tracks", seedId],
    queryFn: () => api.radio(String(seedId)),
    enabled: !!seedId,
    staleTime: 15 * 60_000,
  });

  const tracks = data ?? [];

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col md:mt-6 lg:mt-0">
      <span className="mb-4 flex-shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted">
        Ähnliche Titel
      </span>
      <div
        data-np-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-area rounded-3xl border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-5"
      >
        {isLoading && (
          <p className="px-2 py-4 text-sm text-muted">
            Ähnliche Titel werden geladen…
          </p>
        )}
        {isError && (
          <p className="px-2 py-4 text-sm text-muted">
            Ähnliche Titel konnten nicht geladen werden.
          </p>
        )}
        {!isLoading && !isError && tracks.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">
            Für diesen Titel wurden keine ähnlichen Songs gefunden.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {tracks.map((t, i) => (
            <li
              key={`${t.id}-${i}`}
              className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition hover:bg-white/5"
            >
              <button
                type="button"
                onClick={() => {
                  playQueue(tracks, i);
                  onClose();
                }}
                aria-label={`${t.title} abspielen`}
                className="relative flex-shrink-0 group/cover"
              >
                {t.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.cover}
                    alt=""
                    className="h-12 w-12 rounded-xl object-cover shadow"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-xl gradient-violet opacity-80" />
                )}
                <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/50 opacity-0 transition group-hover/cover:opacity-100">
                  <PlayIcon width={18} height={18} className="text-white" />
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <TrackTitle
                  track={t}
                  onNavigate={onClose}
                  className="block truncate text-sm font-semibold hover:underline"
                />
                <ArtistLinks
                  track={t}
                  onNavigate={onClose}
                  className="block truncate text-xs text-muted"
                  linkClassName="hover:text-foreground hover:underline"
                />
              </div>
              <button
                type="button"
                onClick={() => addToQueue(t)}
                aria-label="Zur Warteschlange hinzufügen"
                title="Zur Warteschlange hinzufügen"
                className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-muted opacity-0 transition hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
              >
                <PlusIcon width={18} height={18} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
