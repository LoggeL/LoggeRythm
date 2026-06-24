"use client";

import Link from "next/link";
import type { Track } from "@/types";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import { PlayIcon, PauseIcon } from "@/components/icons";
import LikeButton from "@/components/LikeButton";
import AddToPlaylistMenu from "@/components/AddToPlaylistMenu";
import TrackMenu from "@/components/TrackMenu";
import Equalizer from "@/components/Equalizer";

interface TrackRowProps {
  track: Track;
  index?: number;
  // play handler: if provided, used instead of single-track play (e.g. play whole queue)
  onPlay?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  showAlbum?: boolean;
}

export default function TrackRow({
  track,
  index,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  showAlbum = true,
}: TrackRowProps) {
  const cur = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);

  const isCurrent = cur?.id === track.id;
  const playingThis = isCurrent && isPlaying;

  function handlePlay() {
    if (isCurrent) {
      toggle();
    } else if (onPlay) {
      onPlay();
    } else {
      playTrack(track);
    }
  }

  return (
    <div className="group grid grid-cols-[2rem_1fr_auto] sm:grid-cols-[2rem_4fr_3fr_auto] items-center gap-3 px-3 py-2 rounded-md hover:bg-panel-hover transition">
      {/* index / play */}
      <div className="w-8 flex items-center justify-center text-muted text-sm">
        <button
          type="button"
          onClick={handlePlay}
          className="hidden group-hover:flex text-foreground"
          aria-label={playingThis ? "Pause" : "Abspielen"}
        >
          {playingThis ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span
          className={`group-hover:hidden ${
            isCurrent ? "text-accent" : ""
          }`}
        >
          {isCurrent ? (
            <Equalizer small playing={isPlaying} />
          ) : index !== undefined ? (
            index + 1
          ) : (
            ""
          )}
        </span>
      </div>

      {/* title + artist */}
      <div className="min-w-0 flex items-center gap-3">
        {track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt=""
            width={40}
            height={40}
            className="w-10 h-10 rounded object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-panel-hover flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div
            className={`truncate font-medium ${
              isCurrent ? "text-accent" : "text-foreground"
            }`}
          >
            {track.title}
          </div>
          <div className="truncate text-sm text-muted">
            {track.artist_id ? (
              <Link
                href={`/artist/${track.artist_id}`}
                className="hover:underline hover:text-foreground"
              >
                {track.artist}
              </Link>
            ) : (
              track.artist
            )}
          </div>
        </div>
      </div>

      {/* album (desktop) */}
      {showAlbum && (
        <div className="hidden sm:block min-w-0 text-sm text-muted truncate">
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
      )}

      {/* actions + duration */}
      <div className="flex items-center gap-2 justify-end">
        {(onMoveUp || onMoveDown) && (
          <div className="flex flex-col opacity-0 group-hover:opacity-100 transition">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!onMoveUp}
              aria-label="Nach oben"
              className="text-muted hover:text-foreground disabled:opacity-30 leading-none text-xs"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!onMoveDown}
              aria-label="Nach unten"
              className="text-muted hover:text-foreground disabled:opacity-30 leading-none text-xs"
            >
              ▼
            </button>
          </div>
        )}
        <LikeButton track={track} />
        <AddToPlaylistMenu track={track} />
        <span className="text-sm text-muted w-10 text-right tabular-nums">
          {formatTime(track.duration_sec)}
        </span>
        <TrackMenu track={track} onRemove={onRemove} />
      </div>
    </div>
  );
}
