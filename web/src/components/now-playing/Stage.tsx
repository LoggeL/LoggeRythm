"use client";

import { useRef, type ReactNode } from "react";
import { usePlayerStore } from "@/store/player";
import type { CoverPalette } from "@/hooks/useCoverColors";
import { hiResCover } from "@/lib/cover";
import { VISUALIZER_MODES, type VisualizerPreferences } from "@/lib/visualizerScene";
import type { Track } from "@/types";
import FullscreenVisualizer, { type VisualizerStatus } from "@/components/FullscreenVisualizer";
import BassReactiveArtwork from "@/components/BassReactiveArtwork";
import Cover from "@/components/ui/Cover";
import { VisualizerIcon } from "@/components/icons";

/**
 * The artwork stage: the cover fills whatever room its column has (it is
 * sized against the stage, not the viewport), with the optional real-audio
 * visualizer scene drawn around it.
 */
export default function Stage({
  track,
  palette,
  preferences,
  onStatusChange,
  footer,
}: {
  track: Track;
  palette: CoverPalette | null;
  preferences: VisualizerPreferences;
  onStatusChange: (status: VisualizerStatus) => void;
  /** Controls shown centred under the artwork (narrow layouts). */
  footer?: ReactNode;
}) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const albumRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={stageRef} data-np-scroll className="relative flex min-h-0 flex-1 flex-col">
      {/* The scene bleeds past the stage and fades out, so it never shows an edge. */}
      {preferences.enabled && (
        <div aria-hidden className="pointer-events-none absolute -inset-x-10 -inset-y-8 z-[1] [mask-image:radial-gradient(ellipse_closest-side,black_62%,transparent)]">
          <FullscreenVisualizer
            isPlaying={isPlaying}
            anchorRef={albumRef}
            surfaceRef={stageRef}
            className="block h-full w-full"
            colors={palette?.gradient}
            glow={palette?.primary}
            rgb={palette?.rgb}
            mode={preferences.mode}
            onStatusChange={onStatusChange}
          />
        </div>
      )}
      <div className="relative z-10 grid min-h-40 flex-1 place-items-center [container-type:size]">
        <div
          ref={albumRef}
          className={`aspect-square max-w-[44rem] rounded-[var(--radius-card)] transition-[width] duration-300 motion-reduce:transition-none ${
            preferences.enabled ? "w-[min(80cqw,80cqh)] lg:w-[min(66cqw,66cqh)]" : "w-[min(100cqw,100cqh)]"
          }`}
        >
          <BassReactiveArtwork className="cover-shadow">
            <Cover src={track.cover ? hiResCover(track.cover) : null} alt={track.album} className="relative h-full w-full" eager />
          </BassReactiveArtwork>
        </div>
      </div>
      {footer && <div className="relative z-10 flex flex-shrink-0 justify-center pt-2">{footer}</div>}
    </div>
  );
}

/** Visualizer on/off and scene choice. */
export function VisualizerControls({
  preferences,
  signalStatus,
  onChange,
}: {
  preferences: VisualizerPreferences;
  signalStatus: VisualizerStatus;
  onChange: (next: VisualizerPreferences) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onChange({ ...preferences, enabled: !preferences.enabled })}
        aria-pressed={preferences.enabled}
        aria-label={preferences.enabled ? "Visualisierung ausblenden" : "Visualisierung einblenden"}
        title="Visualisierung"
        data-audio-signal={signalStatus}
        className="action-icon h-11 w-11"
      >
        <VisualizerIcon width={20} height={20} />
      </button>
      {preferences.enabled && (
        <div role="group" aria-label="Visualisierungsmodus" className="flex gap-0.5">
          {VISUALIZER_MODES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={preferences.mode === id}
              onClick={() => onChange({ ...preferences, mode: id })}
              className="label-mono min-h-9 rounded-[var(--radius-control)] px-2.5 transition-colors hover:text-foreground aria-pressed:bg-foreground/10 aria-pressed:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
