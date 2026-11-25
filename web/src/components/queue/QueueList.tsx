"use client";

import type { Track } from "@/types";
import { usePlayerStore, currentTrack } from "@/store/player";
import { PlayIcon, PauseIcon, QueueIcon, ChevronDownIcon } from "@/components/icons";
import CacheMarker from "@/components/CacheMarker";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import EqualizerBars from "@/components/EqualizerBars";
import Cover from "@/components/ui/Cover";
import QueueItem from "./QueueItem";
import { useQueueReorder } from "./useQueueReorder";

interface Entry {
  track: Track;
  index: number;
}

/** Upcoming tracks split into the listener's own picks and the play context, plus played session history. */
export function useUpcomingQueue() {
  const queue = usePlayerStore((s) => s.queue);
  const origins = usePlayerStore((s) => s.origins);
  const index = usePlayerStore((s) => s.index);
  const previous: Entry[] = queue.map((track, i) => ({ track, index: i })).filter((entry) => index > 0 && entry.index < index);
  const upcoming: Entry[] = queue.map((track, i) => ({ track, index: i })).filter((entry) => entry.index > index);
  return {
    previous,
    upcoming,
    manual: upcoming.filter((entry) => origins[entry.index] === "manual"),
    context: upcoming.filter((entry) => origins[entry.index] !== "manual"),
  };
}

function NowPlayingCard({ track, onNavigate }: { track: Track; onNavigate?: () => void }) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);
  return (
    <section aria-label="Jetzt läuft" className="mb-5 px-2">
      <h3 className="mb-2 px-1 text-xs font-semibold text-muted">Jetzt läuft</h3>
      <div
        className="flex items-center gap-3 rounded-xl border border-white/12 bg-[#0f0e11]/62 p-2.5 backdrop-blur-sm"
        style={{ backgroundImage: "linear-gradient(100deg, rgb(var(--ambient) / 0.26), rgb(var(--ambient) / 0.07))" }}
      >
        <Cover src={track.cover} className="h-12 w-12 rounded-lg" />
        <div className="min-w-0 flex-1">
          <TrackTitle track={track} onNavigate={onNavigate} className="block truncate text-sm font-semibold hover:underline" />
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <EqualizerBars height={12} isPlaying={isPlaying} />
            <CacheMarker trackId={track.id} />
            <ArtistLinks track={track} onNavigate={onNavigate} className="truncate text-xs text-muted" linkClassName="hover:text-foreground hover:underline" />
          </div>
        </div>
        <button type="button" onClick={toggle} aria-label={isPlaying ? "Pause" : "Abspielen"} className="action-icon">
          {isPlaying ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
        </button>
      </div>
    </section>
  );
}

/**
 * The queue's content: the playing track, the listener's own next picks and
 * the rest of the play context. Shared by the docked queue panel and the
 * fullscreen player.
 */
export default function QueueList({ onNavigate }: { onNavigate?: () => void }) {
  const cur = usePlayerStore(currentTrack);
  const queueContext = usePlayerStore((s) => s.queueContext);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const { previous, upcoming, manual, context } = useUpcomingQueue();
  const reorder = useQueueReorder();

  const renderSection = (title: string, entries: Entry[]) =>
    entries.length > 0 && (
      <section aria-label={title} className="mb-5 px-0.5">
        <h3 className="mb-1.5 flex items-baseline justify-between gap-3 px-3 text-xs font-semibold text-muted">
          <span className="truncate">{title}</span>
          <span className="shrink-0 font-normal tabular-nums text-subtle">{entries.length}</span>
        </h3>
        <ul className="flex flex-col">
          {entries.map(({ track, index }) => (
            <QueueItem
              key={`${track.id}-${index}`}
              track={track}
              index={index}
              dragging={reorder.dragIndex === index}
              dropEdge={reorder.dropEdge(index)}
              dragProps={reorder.rowProps(index)}
              canMoveUp={reorder.canMove(index, index - 1)}
              canMoveDown={reorder.canMove(index, index + 1)}
              onMove={(delta) => reorder.moveBy(index, delta)}
              onPlay={() => jumpTo(index)}
              onRemove={() => removeFromQueue(index)}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <div data-queue-list>
      {cur && <NowPlayingCard track={cur} onNavigate={onNavigate} />}
      {renderSection("Deine nächsten Titel", manual)}
      {renderSection(queueContext ? `Aus ${queueContext}` : "Weitere Titel", context)}
      {upcoming.length === 0 && (
        <div className="mx-2 flex flex-col items-center rounded-xl border border-dashed border-border px-5 py-8 text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-white/[0.06] text-muted">
            <QueueIcon width={22} height={22} />
          </span>
          <p className="text-sm font-semibold">{cur ? "Danach ist Stille" : "Bereit für Musik"}</p>
          <p className="mt-1 max-w-[16rem] text-sm leading-relaxed text-muted">
            {cur
              ? "Füge Titel über das Titelmenü („Zur Warteschlange hinzufügen“) hinzu oder starte ein Album oder eine Playlist."
              : "Wähle einen Titel – hier siehst du dann, was als Nächstes läuft."}
          </p>
        </div>
      )}
      {previous.length > 0 && (
        <details className="group mt-4 px-0.5">
          <summary className="label-mono flex cursor-pointer list-none items-center justify-between gap-2 border-t border-hairline px-3 py-3 text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span>Bereits gespielt ({previous.length})</span>
            <ChevronDownIcon width={16} height={16} className="transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="mt-1 flex flex-col opacity-80">
            {[...previous].reverse().map(({ track, index }) => (
              <QueueItem
                key={`prev-${track.id}-${index}`}
                track={track}
                index={index}
                dragging={false}
                dropEdge={null}
                dragProps={reorder.rowProps(index)}
                canMoveUp={false}
                canMoveDown={false}
                onMove={() => {}}
                onPlay={() => jumpTo(index)}
                onRemove={() => removeFromQueue(index)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
