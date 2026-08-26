"use client";

import type { CoverPalette } from "@/hooks/useCoverColors";
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
  palette,
  onClose,
}: {
  track: Track;
  palette: CoverPalette | null;
  onClose: () => void;
}) {
  const coverGlow = palette
    ? `0 24px 80px rgba(${palette.rgb[0]}, ${palette.rgb[1]}, ${palette.rgb[2]}, 0.28)`
    : undefined;

  return (
    <div className="like-celebration-surface hidden min-h-0 flex-col lg:flex">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
        <div
          className="aspect-square w-full max-w-md rounded-[1.75rem] xl:max-w-lg"
          style={{ boxShadow: coverGlow }}
        >
          {track.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hiResCover(track.cover)}
              alt={track.album}
              className="h-full w-full rounded-[1.75rem] object-cover shadow-2xl"
            />
          ) : (
            <CoverPlaceholder className="h-full w-full rounded-[1.75rem]" />
          )}
        </div>

        <div className="w-full max-w-md text-center">
          <div className="flex items-center justify-center gap-3">
            <TrackTitle
              track={track}
              onNavigate={onClose}
              className="min-w-0 truncate text-3xl font-extrabold hover:underline"
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

      <div className="mx-auto mt-8 w-full max-w-md">
        <SeekBar />
        <TransportRow />
        <VolumeRow />
      </div>
    </div>
  );
}
