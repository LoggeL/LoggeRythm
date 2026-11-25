/**
 * Lightweight bridge allowing visual playhead indicators (Scrubber, ProgressLine)
 * to sample the active HTMLAudioElement's hardware media clock inside
 * requestAnimationFrame without triggering React re-renders.
 */
export interface LivePlaybackClockSample {
  trackId: string;
  currentTime: number;
  paused: boolean;
  seeking: boolean;
}

export type LivePlaybackClockReader = () => LivePlaybackClockSample | null;

let activeClockReader: LivePlaybackClockReader | null = null;

export function registerLivePlaybackClock(reader: LivePlaybackClockReader): () => void {
  activeClockReader = reader;
  return () => {
    if (activeClockReader === reader) {
      activeClockReader = null;
    }
  };
}

export function readLivePlaybackClock(): LivePlaybackClockSample | null {
  return activeClockReader ? activeClockReader() : null;
}
