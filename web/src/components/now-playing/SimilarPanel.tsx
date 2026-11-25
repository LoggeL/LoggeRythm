"use client";

import { useQuery } from "@tanstack/react-query";
import { usePlayerStore } from "@/store/player";
import { api } from "@/lib/api";
import { startTrackListRadio } from "@/lib/radio";
import { formatTime } from "@/lib/format";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import { PlayIcon, PlusIcon, RadioIcon } from "@/components/icons";
import Cover from "@/components/ui/Cover";
import QueryError from "@/components/ui/QueryError";

/** "Ähnliche Titel" tab: song radio seeded by the current track. */
export default function SimilarPanel({ seedId, onClose }: { seedId: string | number; onClose: () => void }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const setRadioActive = usePlayerStore((s) => s.setRadioActive);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const query = useQuery({
    queryKey: ["similar-tracks", seedId],
    queryFn: () => api.radio(String(seedId)),
    enabled: !!seedId,
    staleTime: 15 * 60_000,
  });
  const tracks = query.data;

  function playSimilarRadio(startIndex = 0) {
    if (!tracks || tracks.length === 0) return;
    if (startIndex === 0) {
      startTrackListRadio(tracks, "Ähnliche Titel");
      return;
    }
    playQueue(tracks, startIndex, "Ähnliche Titel");
    setRadioActive(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 flex-shrink-0 items-center justify-between gap-3 pb-2">
        <h2 className="label-mono">Radio zu diesem Titel</h2>
        {tracks && tracks.length > 0 && (
          <button type="button" onClick={() => playSimilarRadio(0)} className="action-secondary min-h-9 px-4 text-xs">
            <PlayIcon width={14} height={14} />
            Alle abspielen
          </button>
        )}
      </div>
      <div data-np-scroll className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {query.isLoading && (
          <ul role="status" aria-label="Ähnliche Titel werden geladen" className="flex flex-col gap-1">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-2 py-2">
                <span className="skeleton h-12 w-12 shrink-0 rounded-lg" />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="skeleton h-3.5 w-3/5 rounded" />
                  <span className="skeleton h-3 w-2/5 rounded" />
                </span>
              </li>
            ))}
          </ul>
        )}
        <QueryError label="Ähnliche Titel" query={query} />
        {tracks && tracks.length === 0 && (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-white/[0.07] text-muted">
              <RadioIcon width={24} height={24} />
            </span>
            <p className="text-base font-semibold">Nichts Ähnliches gefunden</p>
            <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">Zu diesem Titel gibt es noch keine Empfehlungen. Probier es mit dem nächsten Song.</p>
          </div>
        )}
        {tracks && tracks.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {tracks.map((t, i) => (
              <li key={`${t.id}-${i}`} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.06] focus-within:bg-white/[0.06]">
                <button
                  type="button"
                  onClick={() => playSimilarRadio(i)}
                  aria-label={`${t.title} abspielen`}
                  className="group/cover relative shrink-0"
                >
                  <Cover src={t.cover} className="h-12 w-12 rounded-lg" />
                  <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/55 opacity-0 transition-opacity group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100">
                    <PlayIcon width={18} height={18} className="text-white" />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <TrackTitle track={t} onNavigate={onClose} className="block truncate text-sm font-semibold hover:underline" />
                  <ArtistLinks track={t} onNavigate={onClose} className="block truncate text-xs text-muted" linkClassName="hover:text-foreground hover:underline" />
                </div>
                <span className="text-xs tabular-nums text-subtle max-sm:hidden">{formatTime(t.duration_sec)}</span>
                <button
                  type="button"
                  onClick={() => addToQueue(t)}
                  aria-label={`${t.title} zur Warteschlange hinzufügen`}
                  title="Zur Warteschlange hinzufügen"
                  className="action-icon h-11 w-11"
                >
                  <PlusIcon width={18} height={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
