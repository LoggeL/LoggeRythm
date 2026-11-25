"use client";

import { useEffect, useState } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { readLivePlaybackClock } from "@/lib/playbackClock";

const TICK_MS = 66; // ~15fps — smooth lyric timing without saturating React renders

/**
 * Samples the live <audio> clock when playing locally (falling back to the
 * store's `currentTime` for paused/remote Connect/Jam playback). Used by
 * karaoke lyrics views and the PiP mini-player so highlights stay tighter than
 * HTMLAudioElement's coarse ~4 Hz `timeupdate` event.
 */
export function useLivePlaybackTime(enabled = true): number {
  const storeTime = usePlayerStore((s) => s.currentTime);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const suppressLocalAudio = usePlayerStore((s) => s.suppressLocalAudio);
  const track = usePlayerStore(currentTrack);
  const trackId = track ? String(track.id) : null;
  const [sampled, setSampled] = useState<{ trackId: string; time: number } | null>(null);

  useEffect(() => {
    if (!enabled || !isPlaying || suppressLocalAudio || !trackId) return;
    const sample = () => {
      const clock = readLivePlaybackClock();
      if (clock && clock.trackId === trackId && !clock.paused && Number.isFinite(clock.currentTime)) {
        setSampled({ trackId, time: clock.currentTime });
      }
    };
    const id = window.setInterval(sample, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, isPlaying, suppressLocalAudio, trackId]);

  if (!enabled || !isPlaying || suppressLocalAudio || !trackId) return storeTime;
  return sampled && sampled.trackId === trackId ? sampled.time : storeTime;
}
