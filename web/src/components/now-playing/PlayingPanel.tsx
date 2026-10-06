"use client";

import { useRef, useState } from "react";
import { usePlayerStore } from "@/store/player";
import { useLocalJson } from "@/hooks/useLocalJson";
import type { CoverPalette } from "@/hooks/useCoverColors";
import { hiResCover } from "@/lib/cover";
import { INITIAL_VISUALIZER_PREFERENCES, VISUALIZER_MODES, validateVisualizerPreferences, type VisualizerPreferences } from "@/lib/visualizerScene";
import type { Track } from "@/types";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import FullscreenVisualizer, { type VisualizerStatus } from "@/components/FullscreenVisualizer";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import BassReactiveArtwork from "@/components/BassReactiveArtwork";
import { VisualizerIcon } from "@/components/icons";
import { SeekBar, TransportRow, VolumeRow } from "./Controls";

/**
 * Immersive artwork with selectable real-audio scenes and full transport controls.
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
  const [storedPreferences, setPreferences] = useLocalJson<VisualizerPreferences>("player:visualizer", INITIAL_VISUALIZER_PREFERENCES);
  const preferences = validateVisualizerPreferences(storedPreferences);
  const showVisualizer = preferences.enabled;
  const [signalStatus, setSignalStatus] = useState<VisualizerStatus>(isPlaying ? "waiting" : "paused");
  const albumRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:mt-0">
      <div className="mb-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPreferences((current) => ({ ...validateVisualizerPreferences(current), enabled: !current.enabled }))}
          aria-pressed={showVisualizer}
          aria-label={showVisualizer ? "Visualisierung ausblenden" : "Visualisierung einblenden"}
          data-audio-signal={signalStatus}
          className="filter-chip min-h-11 sm:min-h-9"
        >
          <VisualizerIcon width={16} height={16} />
          Visualisierung
        </button>
        {showVisualizer && (
          <div role="group" aria-label="Visualisierungsmodus" className="flex w-full gap-1 rounded-xl border border-border bg-panel/80 p-1 sm:w-auto">
            {VISUALIZER_MODES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={preferences.mode === id}
                onClick={() => setPreferences((current) => ({ ...validateVisualizerPreferences(current), mode: id }))}
                className={`min-h-11 flex-1 rounded-lg px-3 text-xs font-medium transition sm:min-h-9 sm:flex-none ${preferences.mode === id ? "bg-accent/20 text-accent-soft" : "text-muted hover:bg-white/5 hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={panelRef}
        className="like-celebration-surface relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-background/75"
      >
        {showVisualizer && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
          <FullscreenVisualizer
            isPlaying={isPlaying}
            anchorRef={albumRef}
            surfaceRef={panelRef}
            className="block h-full w-full"
            colors={palette?.gradient}
            glow={palette?.primary}
            rgb={palette?.rgb}
            mode={preferences.mode}
            onStatusChange={setSignalStatus}
          />
        </div>
        )}
        {/* Keep timestamps and transport controls crisp over the visualizer. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-52 bg-gradient-to-t from-background via-background/85 to-transparent"
        />

        <div
          data-np-scroll
          className="relative z-10 flex h-full min-h-0 flex-col items-center gap-5 overflow-y-auto overscroll-contain scroll-area p-4 sm:p-6 lg:p-8"
        >
          <div className="relative grid w-full min-h-40 flex-1 place-items-center">
            <div
              ref={albumRef}
              className={`relative aspect-square max-w-80 rounded-xl ${showVisualizer ? "w-[min(48vw,30vh)] sm:w-[min(100%,34vh)]" : "w-[min(100%,32vh)] sm:w-[min(100%,36vh)]"} lg:max-w-96`}
            >
              <BassReactiveArtwork className="border border-white/15">
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
              </BassReactiveArtwork>
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
