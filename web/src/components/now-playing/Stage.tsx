"use client";

import type { ReactNode, RefObject } from "react";
import { hiResCover } from "@/lib/cover";
import { SCENE_KEYS, SCENE_LABELS, type ScenePreference, type VisualizerPreferences } from "@/lib/visualizerScenes";
import type { VisualizerSceneChoice } from "@/hooks/useVisualizerScene";
import type { Track } from "@/types";
import type { VisualizerStatus } from "@/components/FullscreenVisualizer";
import BassReactiveArtwork from "@/components/BassReactiveArtwork";
import Cover from "@/components/ui/Cover";
import { VisualizerIcon } from "@/components/icons";

/**
 * The artwork stage: the cover fills whatever room its column has (it is
 * sized against the stage, not the viewport). The visualizer itself spans the
 * whole player (see NowPlaying) and is composed around `albumRef`.
 */
export default function Stage({
  track,
  albumRef,
  preferences,
  footer,
}: {
  track: Track;
  albumRef: RefObject<HTMLDivElement | null>;
  preferences: VisualizerPreferences;
  /** Controls shown centred under the artwork (narrow layouts). */
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative z-10 grid min-h-40 flex-1 place-items-center [container-type:size]">
        <div
          ref={albumRef}
          className={`aspect-square max-w-[44rem] rounded-[var(--radius-card)] transition-[width] duration-300 motion-reduce:transition-none ${
            preferences.enabled ? "w-[min(78cqw,78cqh)] lg:w-[min(66cqw,66cqh)]" : "w-[min(100cqw,100cqh)]"
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

/**
 * A small, quiet switch for the visualizer plus its scene: "Automatisch"
 * picks one per song (Deezer genre, then listening). Both are remembered.
 */
export function VisualizerControls({
  preferences,
  choice,
  signalStatus,
  onChange,
}: {
  preferences: VisualizerPreferences;
  choice: VisualizerSceneChoice;
  signalStatus: VisualizerStatus;
  onChange: (next: VisualizerPreferences) => void;
}) {
  const label = preferences.enabled ? "Visualizer ausschalten" : "Visualizer einschalten";
  const auto = choice.decision;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onChange({ ...preferences, enabled: !preferences.enabled })}
        aria-pressed={preferences.enabled}
        aria-label={label}
        title={label}
        data-audio-signal={signalStatus}
        className="action-icon h-9 w-9 flex-shrink-0 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      >
        <VisualizerIcon width={18} height={18} />
      </button>
      {preferences.enabled && (
        <select
          id="visualizer-scene"
          aria-label="Visualizer-Szene"
          title={choice.manual ? `Automatisch wäre: ${SCENE_LABELS[auto.scene]}. ${auto.detail}` : auto.detail}
          value={preferences.scene}
          onChange={(event) => onChange({ ...preferences, scene: event.target.value as ScenePreference })}
          data-scene-source={auto.source}
          className="label-mono h-8 min-w-0 max-w-60 cursor-pointer truncate rounded-full border border-white/15 bg-black/25 px-3 text-[11px] text-foreground/80 backdrop-blur transition-colors hover:border-white/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--accent-soft)]"
        >
          <option value="auto">Auto · {SCENE_LABELS[auto.scene]}</option>
          {SCENE_KEYS.map((key) => (
            <option key={key} value={key}>{SCENE_LABELS[key]}</option>
          ))}
        </select>
      )}
    </div>
  );
}
