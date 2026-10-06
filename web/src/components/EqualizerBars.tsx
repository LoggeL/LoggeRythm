"use client";

import { useEffect, useRef } from "react";
import { subscribeAudioSpectrum } from "@/lib/audioSpectrum";

/** A small live spectrum, using the same measured audio as the fullscreen scene. */
export default function EqualizerBars({
  bars = 5,
  className = "",
  barClassName = "bg-accent",
  height = 16,
  isPlaying = true,
}: {
  bars?: number;
  className?: string;
  barClassName?: string;
  height?: number;
  isPlaying?: boolean;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  if (!Number.isInteger(bars) || bars < 1 || bars > 16) throw new RangeError("Equalizer requires between 1 and 16 bars.");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) throw new Error("Current-song equalizer did not mount.");
    const elements = [...root.querySelectorAll<HTMLElement>("[data-equalizer-bar]")];
    const settle = () => {
      root.dataset.signal = "idle";
      elements.forEach((element, index) => {
        element.style.transform = `scaleY(${0.16 + (index % 3) * 0.06})`;
      });
    };
    settle();
    if (!isPlaying) return;
    let unsubscribe: (() => void) | null = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !unsubscribe) {
        unsubscribe = subscribeAudioSpectrum((frame) => {
          root.dataset.signal = frame.active ? "live" : "idle";
          for (let index = 0; index < elements.length; index++) {
            const start = Math.floor(index * frame.bands.length / elements.length);
            const end = Math.max(start + 1, Math.floor((index + 1) * frame.bands.length / elements.length));
            let level = 0;
            for (let band = start; band < end; band++) level += frame.bands[band];
            level /= end - start;
            elements[index].style.transform = `scaleY(${Math.min(1, 0.14 + level * 1.2)})`;
          }
        });
      } else if (!entry.isIntersecting && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
        settle();
      }
    });
    observer.observe(root);
    return () => { observer.disconnect(); unsubscribe?.(); };
  }, [bars, isPlaying]);

  return (
    <span ref={rootRef} className={`equalizer-bars ${className}`} style={{ height }} aria-hidden="true" data-playing={isPlaying}>
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} data-equalizer-bar className={barClassName} style={{ transform: `scaleY(${0.16 + (index % 3) * 0.06})` }} />
      ))}
    </span>
  );
}
