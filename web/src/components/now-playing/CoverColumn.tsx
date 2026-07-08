"use client";

import { usePlayerStore } from "@/store/player";
import { useBassGlow } from "@/hooks/useBassGlow";
import type { CoverPalette } from "@/hooks/useCoverColors";
import { hiResCover } from "@/lib/cover";
import type { Track } from "@/types";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import Visualizer from "@/components/Visualizer";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { SeekBar, TransportRow, VolumeRow } from "./Controls";

/**
 * Desktop-only left grid column shown on the lyrics/similar tabs: bass-glowing
 * cover, title/artist/like, visualizer and the full transport stack.
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
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  // Bass-reactive pulse — dips below 1 between kicks and swings well past it
  // for lively movement.
  const coverRef = useBassGlow<HTMLDivElement>(isPlaying, {
    baseSpread: 24,
    peakSpread: 150,
    baseAlpha: 0.22,
    peakAlpha: 0.9,
    baseScale: 0.9,
    maxScale: 0.22,
    tintBorder: false,
    color: palette?.rgb,
  });

  return (
    <div className="hidden min-h-0 flex-col lg:flex">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
        <div
          ref={coverRef}
          className="aspect-square w-full max-w-md rounded-[1.75rem] will-change-transform xl:max-w-lg"
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
            <LikeButton track={track} />
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
        <Visualizer
          isPlaying={isPlaying}
          className="mb-5 h-16 w-full"
          colors={palette?.gradient}
          glow={palette ? palette.primary : undefined}
        />
        <SeekBar />
        <TransportRow />
        <VolumeRow />
      </div>
    </div>
  );
}
