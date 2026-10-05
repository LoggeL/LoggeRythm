"use client";

import { useRef, useState } from "react";
import { usePlayerStore } from "@/store/player";
import type { CoverPalette } from "@/hooks/useCoverColors";
import { hiResCover } from "@/lib/cover";
import type { Track } from "@/types";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import FullscreenVisualizer from "@/components/FullscreenVisualizer";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { VisualizerIcon } from "@/components/icons";
import { SeekBar, TransportRow, VolumeRow } from "./Controls";

/**
 * Art-first player with full transport controls and an optional spectrum.
 * The content scrolls when the viewport is too short, including landscape.
 */
export default function PlayingPanel({
  track,
  palette,
  onClose,
}: {
  track: Track;
  palette: CoverPalette | null;
  onClose: () => void;
}) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const [showVisualizer, setShowVisualizer] = useState(false);
  const albumRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:mt-0">
      <div className="mb-3 flex flex-shrink-0 items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted">Jetzt läuft</span>
        <button
          type="button"
          onClick={() => setShowVisualizer((visible) => !visible)}
          aria-pressed={showVisualizer}
          className="filter-chip"
        >
          <VisualizerIcon width={16} height={16} />
          Visualisierung
        </button>
      </div>
      <div
        ref={panelRef}
        className="like-celebration-surface relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-panel/70"
      >
        {showVisualizer && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] overflow-hidden opacity-70">
          <FullscreenVisualizer
            isPlaying={isPlaying}
            anchorRef={albumRef}
            surfaceRef={panelRef}
            className="block h-full w-full"
            colors={palette?.gradient}
            glow={palette?.primary}
            rgb={palette?.rgb}
          />
        </div>
        )}
        {/* Keep timestamps and transport controls crisp over the visualizer. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-44 bg-gradient-to-t from-panel via-panel/70 to-transparent"
        />

        <div
          data-np-scroll
          className="relative z-10 flex h-full min-h-0 flex-col items-center gap-5 overflow-y-auto overscroll-contain scroll-area p-4 sm:p-6 lg:p-8"
        >
          <div className="relative grid w-full min-h-40 flex-1 place-items-center">
            <div
              ref={albumRef}
              className="relative aspect-square w-[min(100%,32vh)] max-w-80 overflow-hidden rounded-xl border border-white/10 sm:w-[min(100%,36vh)] lg:max-w-96"
            >
              {track.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hiResCover(track.cover)}
                  alt={track.album}
                  className="relative h-full w-full object-cover"
                />
              ) : (
                <CoverPlaceholder className="relative h-full w-full" />
              )}
            </div>
          </div>

          <div className="w-full max-w-lg flex-shrink-0">
            <div className="mb-4 text-center">
              <div className="flex items-center justify-center gap-3">
                <TrackTitle
                  track={track}
                  onNavigate={onClose}
                  className="min-w-0 truncate text-xl font-semibold tracking-tight hover:underline md:text-2xl"
                />
                <LikeButton key={track.id} track={track} />
              </div>
              <ArtistLinks
                track={track}
                onNavigate={onClose}
                className="mt-1 block truncate text-sm text-muted md:text-base"
                linkClassName="hover:text-foreground hover:underline"
              />
            </div>

            <SeekBar />
            <TransportRow />
            <VolumeRow />
          </div>
        </div>
      </div>
    </div>
  );
}
