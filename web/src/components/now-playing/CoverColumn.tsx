"use client";

import { hiResCover } from "@/lib/cover";
import type { Track } from "@/types";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { SeekBar, TransportRow, VolumeRow } from "./Controls";

/**
 * Desktop-only left grid column shown on the lyrics/similar tabs: cover,
 * title/artist/like, and the full transport stack.
 */
export default function CoverColumn({
  track,
  onClose,
}: {
  track: Track;
  onClose: () => void;
}) {
  return (
    <div className="like-celebration-surface hidden min-h-0 flex-col overflow-y-auto rounded-2xl border border-border bg-panel/70 p-5 lg:flex">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5">
        <div
          className="aspect-square w-full max-w-[min(100%,34vh)] overflow-hidden rounded-xl border border-white/10"
        >
          {track.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hiResCover(track.cover)}
              alt={track.album}
              className="h-full w-full object-cover"
            />
          ) : (
            <CoverPlaceholder className="h-full w-full" />
          )}
        </div>

        <div className="w-full max-w-md text-center">
          <div className="flex items-center justify-center gap-3">
            <TrackTitle
              track={track}
              onNavigate={onClose}
              className="min-w-0 truncate text-xl font-semibold tracking-tight hover:underline xl:text-2xl"
            />
            <LikeButton key={track.id} track={track} />
          </div>
          <ArtistLinks
            track={track}
            onNavigate={onClose}
            className="mt-1 block text-muted"
            linkClassName="hover:text-foreground hover:underline"
          />
        </div>
      </div>

      <div className="mx-auto mt-5 w-full max-w-md">
        <SeekBar />
        <TransportRow />
        <VolumeRow />
      </div>
    </div>
  );
}
