import EmptyState from "@/components/ui/EmptyState";
import { ChevronDownIcon, CloseIcon, QueueIcon } from "@/components/icons";
import { formatTime } from "@/lib/format";
import { trackArtistLabel } from "@/lib/trackArtists";
import type { PartyTrack } from "@/types";
import PartyLoadBadge from "./PartyLoadBadge";
import PartyTrackRow from "./PartyTrackRow";

const controlClass = "action-icon h-11 min-h-11 w-11 sm:h-9 sm:min-h-9 sm:w-9";

/**
 * The shared queue. Everyone sees it and each track's load state; the host
 * plays, reorders and removes, everyone else can remove their own upcoming
 * additions.
 */
export default function PartyQueue({
  tracks,
  currentIndex,
  isHost,
  viewerKey,
  bufferingCurrent = false,
  pending,
  locked,
  error,
  onPlay,
  onMove,
  onRemove,
}: {
  tracks: PartyTrack[];
  currentIndex: number;
  isHost: boolean;
  /** `PartyState.viewer_key`: marks the viewer's own additions. */
  viewerKey: string;
  /** The viewer's own player is buffering the playing track. */
  bufferingCurrent?: boolean;
  /** A queue change is being saved. */
  pending: boolean;
  /** Controls are unavailable (a change is being saved or the party is being left). */
  locked: boolean;
  error: string | null;
  onPlay?: (index: number, title: string) => void;
  onMove?: (from: number, to: number, title: string) => void;
  onRemove: (itemId: number, title: string) => void;
}) {
  return (
    <section aria-labelledby="party-queue-title" aria-busy={pending} className="min-w-0">
      <div className="section-heading">
        <h2 id="party-queue-title">Warteschlange</h2>
        <p className="label-mono shrink-0 pb-1 tabular-nums">
          {pending ? <span role="status">Wird aktualisiert…</span> : `${tracks.length} Titel`}
        </p>
      </div>
      {error && (
        <p role="alert" className="error-panel mb-3">
          {error}
        </p>
      )}
      {tracks.length === 0 ? (
        <EmptyState
          icon={<QueueIcon width={22} height={22} />}
          title="Noch keine Songs in der Party"
          action={
            <a href="#party-search" className="action-secondary">
              Titel suchen
            </a>
          }
        >
          Such oben nach einem Titel und füge ihn hinzu – er erscheint hier für alle.
        </EmptyState>
      ) : (
        <ol className="-mx-2 flex flex-col gap-0.5 sm:-mx-3">
          {tracks.map((track, index) => {
            const current = index === currentIndex;
            const own = !!viewerKey && track.added_by_member === viewerKey;
            const canRemove = isHost || (own && !current);
            return (
              <PartyTrackRow
                key={track.id}
                cover={track.cover}
                title={track.title}
                subtitle={`${trackArtistLabel(track)} · von ${own ? "dir" : track.added_by}`}
                current={current}
                position={index + 1}
                played={index < currentIndex}
                onActivate={isHost && onPlay ? () => onPlay(index, track.title) : undefined}
                activateLabel={`"${track.title}" jetzt abspielen`}
                activateDisabled={locked}
              >
                <div className={`flex shrink-0 items-center gap-1 ${canRemove ? "max-sm:w-full max-sm:justify-end" : ""}`}>
                  <span className={`flex items-center gap-2 px-1 ${
                      canRemove ? `max-sm:mr-auto ${current ? "max-sm:pl-[4.25rem]" : "max-sm:pl-14"}` : ""
                    }`}>
                    <PartyLoadBadge state={track.load_state} error={track.load_error} buffering={current && bufferingCurrent} />
                    <span className="font-mono text-xs tabular-nums text-muted">{formatTime(track.duration_sec)}</span>
                  </span>
                  {isHost && onMove && (
                    <>
                      <button
                        type="button"
                        onClick={() => onMove(index, index - 1, track.title)}
                        disabled={index === 0 || locked}
                        aria-label={`"${track.title}" nach oben verschieben`}
                        className={controlClass}
                      >
                        <ChevronDownIcon width={18} height={18} className="rotate-180" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(index, index + 1, track.title)}
                        disabled={index === tracks.length - 1 || locked}
                        aria-label={`"${track.title}" nach unten verschieben`}
                        className={controlClass}
                      >
                        <ChevronDownIcon width={18} height={18} aria-hidden="true" />
                      </button>
                    </>
                  )}
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(track.id, track.title)}
                      disabled={locked}
                      aria-label={`"${track.title}" aus der Party entfernen`}
                      className={`${controlClass} hover:text-danger`}
                    >
                      <CloseIcon width={18} height={18} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </PartyTrackRow>
            );
          })}
        </ol>
      )}
    </section>
  );
}
