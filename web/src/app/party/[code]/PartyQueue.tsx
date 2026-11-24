import Avatar from "@/components/Avatar";
import CacheMarker from "@/components/CacheMarker";
import EqualizerBars from "@/components/EqualizerBars";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import {
  ChevronDownIcon,
  CloseIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
} from "@/components/icons";
import { formatTime } from "@/lib/format";
import { trackArtistLabel } from "@/lib/trackArtists";
import type { PartyTrack } from "@/types";
import PartyLoadBadge from "./PartyLoadBadge";
import PartyTrackRow from "./PartyTrackRow";

const controlClass = "action-icon h-11 min-h-11 w-11 sm:h-9 sm:min-h-9 sm:w-9";

function isTrackStored(track: PartyTrack, extraStoredIds?: ReadonlySet<string>): boolean {
  return Boolean(track.is_stored || track.load_state === "ready" || extraStoredIds?.has(String(track.deezer_id)));
}

/**
 * Spotify Jam-aligned shared queue:
 * - "Jetzt läuft" hero card with contributor info + live controls (host or authorized participants)
 * - "Als Nächstes in der Jam" collaborative upcoming list with normal CacheMarker icons
 * - Optional "Zuletzt gespielt" history below
 */
export default function PartyQueue({
  tracks,
  currentIndex,
  isHost,
  guestsCanControl = false,
  isPlaying = false,
  viewerKey,
  hostName,
  isGuest = false,
  guestCachedIds,
  cacheError = null,
  onRetryCache,
  bufferingCurrent = false,
  pending,
  locked,
  error,
  onPlay,
  onTogglePlayback,
  onNext,
  onPrev,
  onMove,
  onRemove,
}: {
  tracks: PartyTrack[];
  currentIndex: number;
  isHost: boolean;
  guestsCanControl?: boolean;
  isPlaying?: boolean;
  /** `PartyState.viewer_key`: marks the viewer's own additions. */
  viewerKey: string;
  hostName?: string;
  isGuest?: boolean;
  guestCachedIds?: ReadonlySet<string>;
  cacheError?: string | null;
  onRetryCache?: () => void | Promise<void>;
  /** The viewer's own player is buffering the playing track. */
  bufferingCurrent?: boolean;
  /** A queue change is being saved. */
  pending: boolean;
  /** Controls are unavailable (a change is being saved or the party is being left). */
  locked: boolean;
  error: string | null;
  onPlay?: (index: number, title: string) => void;
  onTogglePlayback?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onMove?: (from: number, to: number, title: string) => void;
  onRemove: (itemId: number, title: string) => void;
}) {
  const canControl = isHost || guestsCanControl;
  const currentTrack =
    currentIndex >= 0 && currentIndex < tracks.length ? tracks[currentIndex] : null;
  const upcomingEntries = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ index }) => index > currentIndex);
  const previousEntries = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ index }) => currentIndex >= 0 && index < currentIndex);

  const renderRow = (track: PartyTrack, index: number, played: boolean) => {
    const own = !!viewerKey && track.added_by_member === viewerKey;
    const canRemove = isHost || (guestsCanControl && index !== currentIndex) || (own && index !== currentIndex);
    const minMoveIndex = played ? 0 : Math.max(0, currentIndex + 1);
    const maxMoveIndex = played ? Math.max(0, currentIndex - 1) : tracks.length - 1;
    const stored = isTrackStored(track, guestCachedIds);

    return (
      <PartyTrackRow
        key={track.id}
        trackId={track.deezer_id}
        cover={track.cover}
        title={track.title}
        subtitle={`${trackArtistLabel(track)} · von ${own ? "dir" : track.added_by}`}
        serverStored={stored}
        isGuest={isGuest}
        cacheError={cacheError}
        onRetryCache={onRetryCache}
        position={index + 1}
        played={played}
        onActivate={canControl && onPlay ? () => onPlay(index, track.title) : undefined}
        activateLabel={`"${track.title}" jetzt abspielen`}
        activateDisabled={locked}
      >
        <div className={`flex shrink-0 items-center gap-1 ${canRemove ? "max-sm:w-full max-sm:justify-end" : ""}`}>
          <span
            className={`flex items-center gap-2 px-1 ${
              canRemove ? "max-sm:mr-auto max-sm:pl-14" : ""
            }`}
          >
            <PartyLoadBadge state={track.load_state} error={track.load_error} />
            <span className="font-mono text-xs tabular-nums text-muted">{formatTime(track.duration_sec)}</span>
          </span>
          {canControl && onMove && !played && (
            <>
              <button
                type="button"
                onClick={() => onMove(index, index - 1, track.title)}
                disabled={index <= minMoveIndex || locked}
                aria-label={`"${track.title}" nach oben verschieben`}
                className={controlClass}
              >
                <ChevronDownIcon width={18} height={18} className="rotate-180" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onMove(index, index + 1, track.title)}
                disabled={index >= maxMoveIndex || locked}
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
              aria-label={`"${track.title}" aus der Jam entfernen`}
              className={`${controlClass} hover:text-danger`}
            >
              <CloseIcon width={18} height={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </PartyTrackRow>
    );
  };

  return (
    <section aria-labelledby="party-queue-title" aria-busy={pending} className="min-w-0 space-y-8">
      {error && (
        <p role="alert" className="error-panel">
          {error}
        </p>
      )}

      {tracks.length === 0 ? (
        <div>
          <div className="section-heading">
            <h2 id="party-queue-title">Jam-Warteschlange</h2>
            <p className="label-mono shrink-0 pb-1 tabular-nums">
              {pending ? <span role="status">Wird aktualisiert…</span> : "0 Titel"}
            </p>
          </div>
          <EmptyState
            icon={<QueueIcon width={22} height={22} />}
            title="Noch keine Songs in dieser Jam"
            action={
              <a href="#party-search" className="action-secondary">
                Titel suchen
              </a>
            }
          >
            Such oben nach einem Titel und füge ihn hinzu – er erscheint sofort für alle in der Jam.
          </EmptyState>
        </div>
      ) : (
        <>
          {currentTrack && (
            <div aria-label="Jetzt läuft in der Jam">
              <div className="section-heading">
                <h2 className="flex items-center gap-2.5">
                  <EqualizerBars height={16} isPlaying={isPlaying && !bufferingCurrent} />
                  <span>Jetzt läuft</span>
                </h2>
                <p className="label-mono shrink-0 pb-1">
                  {canControl ? "Live-Steuerung aktiv" : hostName ? `${hostName} steuert` : "Host steuert"}
                </p>
              </div>
              <div className="surface-card flex flex-wrap items-center gap-4 border-accent/25 bg-[linear-gradient(110deg,color-mix(in_srgb,var(--accent)_13%,var(--panel)),var(--panel)_62%)] p-3.5 sm:p-4">
                <Cover src={currentTrack.cover} className="h-16 w-16 shrink-0 rounded-art shadow-[0_8px_22px_rgb(0_0_0/0.45)] sm:h-20 sm:w-20" />
                <div className="min-w-0 flex-1">
                  <p className="font-display truncate text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
                    {currentTrack.title}
                  </p>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted">
                    <CacheMarker
                      trackId={currentTrack.deezer_id}
                      serverStored={isTrackStored(currentTrack, guestCachedIds)}
                      skipStoreFetch={isGuest}
                      externalError={cacheError}
                      onRetryExternal={onRetryCache}
                    />
                    <span className="truncate">{trackArtistLabel(currentTrack)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-background/60 py-0.5 pl-1 pr-2.5">
                      <Avatar src={currentTrack.added_by_avatar_url} name={currentTrack.added_by} size={18} />
                      <span>
                        Hinzugefügt von{" "}
                        <strong className="font-semibold text-foreground">
                          {viewerKey && currentTrack.added_by_member === viewerKey ? "dir" : currentTrack.added_by}
                        </strong>
                      </span>
                    </span>
                    <PartyLoadBadge
                      state={currentTrack.load_state}
                      error={currentTrack.load_error}
                      buffering={bufferingCurrent}
                    />
                    <span className="font-mono tabular-nums text-subtle">{formatTime(currentTrack.duration_sec)}</span>
                  </div>
                </div>

                {canControl && onTogglePlayback && (
                  <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full max-sm:justify-end">
                    <button
                      type="button"
                      onClick={onPrev}
                      disabled={locked || currentIndex <= 0}
                      aria-label="Vorheriger Titel in der Jam"
                      className="action-icon h-10 w-10 text-foreground"
                    >
                      <PrevIcon width={20} height={20} />
                    </button>
                    <button
                      type="button"
                      onClick={onTogglePlayback}
                      disabled={locked}
                      aria-label={isPlaying ? "Jam pausieren" : "Jam abspielen"}
                      className="play-fab h-11 w-11"
                    >
                      {isPlaying ? <PauseIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
                    </button>
                    <button
                      type="button"
                      onClick={onNext}
                      disabled={locked || currentIndex >= tracks.length - 1}
                      aria-label="Nächster Titel in der Jam"
                      className="action-icon h-10 w-10 text-foreground"
                    >
                      <NextIcon width={20} height={20} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="section-heading">
              <h2 id="party-queue-title">Als Nächstes in der Jam</h2>
              <p className="label-mono shrink-0 pb-1 tabular-nums">
                {pending ? (
                  <span role="status">Wird aktualisiert…</span>
                ) : (
                  `${upcomingEntries.length} ${upcomingEntries.length === 1 ? "Titel" : "Titel"}`
                )}
              </p>
            </div>
            {upcomingEntries.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted">
                Keine weiteren Titel in der Warteschlange – such oben nach dem nächsten Song für alle.
              </p>
            ) : (
              <ol className="-mx-2 flex flex-col gap-0.5 sm:-mx-3">
                {upcomingEntries.map(({ track, index }) => renderRow(track, index, false))}
              </ol>
            )}
          </div>

          {previousEntries.length > 0 && (
            <details className="group">
              <summary className="label-mono flex cursor-pointer list-none items-center justify-between gap-2 border-t border-hairline py-3 text-muted hover:text-foreground">
                <span>Bereits gespielt ({previousEntries.length})</span>
                <ChevronDownIcon width={16} height={16} className="transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ol className="-mx-2 mt-1 flex flex-col gap-0.5 sm:-mx-3">
                {previousEntries.map(({ track, index }) => renderRow(track, index, true))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}
