"use client";

import Link from "next/link";
import type { Track } from "@/types";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime, formatCompact } from "@/lib/format";
import { toast } from "@/store/toast";
import { useTrackPlays } from "@/hooks/usePlays";
import { PlayIcon, PauseIcon, PlusIcon, ClockIcon } from "@/components/icons";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import CacheMarker from "@/components/CacheMarker";

const GRID =
  "grid grid-cols-[2.5rem_minmax(0,1fr)_auto] md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,0.8fr)_auto] items-center gap-4";

export default function PopularTrackTable({
  tracks,
  context,
  showPlays = false,
}: {
  tracks: Track[];
  context: string;
  /** Fetch + show Last.fm play counts per row. */
  showPlays?: boolean;
}) {
  const cur = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const plays = useTrackPlays(showPlays ? tracks : []);

  return (
    <div>
      {/* Column header */}
      <div
        className={`${GRID} px-4 pb-2 mb-1 border-b border-white/10 text-xs uppercase tracking-wider text-muted`}
      >
        <span className="text-center">#</span>
        <span>Titel</span>
        <span className="hidden md:block">Album</span>
        <span className="justify-self-end pr-1">
          <ClockIcon width={16} height={16} />
        </span>
      </div>

      {tracks.map((track, i) => {
        const isCurrent = cur?.id === track.id;
        const playingThis = isCurrent && isPlaying;

        function handlePlay() {
          if (isCurrent) toggle();
          else playQueue(tracks, i, context);
        }

        return (
          <div
            key={track.id}
            className={`group ${GRID} px-4 py-2 rounded-lg transition ${
              isCurrent
                ? "bg-accent/[0.12] ring-1 ring-inset ring-accent/10"
                : "hover:bg-white/5"
            }`}
          >
            {/* index / play */}
            <div className="flex items-center justify-center">
              {isCurrent ? (
                <button
                  type="button"
                  onClick={handlePlay}
                  aria-label={playingThis ? "Pause" : "Abspielen"}
                  className="grid h-8 w-8 place-items-center rounded-full bg-accent/20 text-accent transition hover:bg-accent/30"
                >
                  {playingThis ? (
                    <PauseIcon width={15} height={15} />
                  ) : (
                    <PlayIcon width={15} height={15} />
                  )}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handlePlay}
                    aria-label="Abspielen"
                    className="hidden group-hover:grid h-8 w-8 place-items-center text-foreground"
                  >
                    <PlayIcon width={16} height={16} />
                  </button>
                  <span className="group-hover:hidden text-base text-muted tabular-nums">
                    {i + 1}
                  </span>
                </>
              )}
            </div>

            {/* title + artist */}
            <div className="flex items-center gap-3 min-w-0">
              {track.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.cover}
                  alt=""
                  className="h-11 w-11 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="h-11 w-11 rounded-lg bg-panel-hover flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium text-foreground">
                  {track.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted min-w-0">
                  <CacheMarker trackId={track.id} />
                  <ArtistLinks track={track} className="truncate" />
                </div>
              </div>
            </div>

            {/* album */}
            <div className="hidden md:block min-w-0 text-sm text-muted truncate">
              {track.album_id ? (
                <Link
                  href={`/album/${track.album_id}`}
                  className="hover:underline hover:text-foreground"
                >
                  {track.album}
                </Link>
              ) : (
                track.album
              )}
            </div>

            {/* actions */}
            <div className="flex items-center gap-3 justify-end">
              {plays[String(track.id)]?.plays ? (
                <span
                  className="hidden lg:flex items-center gap-1.5 mr-1 text-xs text-muted tabular-nums"
                  title={`${plays[String(track.id)].plays.toLocaleString("de-DE")} Wiedergaben · ${plays[String(track.id)].listeners.toLocaleString("de-DE")} Hörer (Last.fm)`}
                >
                  <PlayIcon width={10} height={10} className="opacity-70" />
                  {formatCompact(plays[String(track.id)].plays)}
                </span>
              ) : null}
              <LikeButton track={track} />
              <button
                type="button"
                onClick={() => {
                  addToQueue(track);
                  toast.info("Zur Warteschlange hinzugefügt.");
                }}
                aria-label="Zur Warteschlange hinzufügen"
                title="Zur Warteschlange hinzufügen"
                className="text-muted hover:text-foreground p-1 rounded-full hover:bg-panel-hover transition press"
              >
                <PlusIcon />
              </button>
              <span className="w-10 text-right text-sm text-muted tabular-nums">
                {formatTime(track.duration_sec)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
