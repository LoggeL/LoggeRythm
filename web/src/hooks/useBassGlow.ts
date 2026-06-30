"use client";

import { useEffect, useRef } from "react";
import { getAnalyser } from "@/lib/audioAnalyser";

/**
 * Drive an element's glow + subtle pulse from the live audio's bass energy.
 *
 * Reads the shared {@link getAnalyser} spectrum each animation frame, averages
 * the low-frequency bins, and writes the result straight to the element's
 * inline style (box-shadow, border tint, scale) — bypassing React so we can run
 * at 60fps without re-rendering. Eases back to a calm resting glow when paused.
 */
export interface BassGlowOptions {
  /** Resting glow spread in px (no bass). */
  baseSpread?: number;
  /** Extra glow spread at a full kick, in px. */
  peakSpread?: number;
  /** Resting shadow alpha. */
  baseAlpha?: number;
  /** Extra shadow alpha at a full kick. */
  peakAlpha?: number;
  /** Max extra scale at a full kick (e.g. 0.016 → up to 1.016×). */
  maxScale?: number;
  /** Also tint the element's border with the glow colour. */
  tintBorder?: boolean;
}

export function useBassGlow<T extends HTMLElement>(
  isPlaying: boolean,
  opts: BassGlowOptions = {},
) {
  const {
    baseSpread = 10,
    peakSpread = 22,
    baseAlpha = 0.2,
    peakAlpha = 0.55,
    maxScale = 0.016,
    tintBorder = true,
  } = opts;
  const ref = useRef<T>(null);
  const playingRef = useRef(isPlaying);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let level = 0; // smoothed bass level 0..1
    let freq: Uint8Array<ArrayBuffer> | null = null;

    function apply(l: number) {
      const el = ref.current;
      if (!el) return;
      const spread = baseSpread + l * peakSpread;
      const glow = baseAlpha + l * peakAlpha;
      el.style.boxShadow = `0 0 ${spread.toFixed(1)}px rgba(124, 92, 255, ${glow.toFixed(3)})`;
      if (tintBorder) {
        el.style.borderColor = `rgba(150, 120, 255, ${(0.14 + l * 0.5).toFixed(3)})`;
      }
      el.style.transform = `scale(${(1 + l * maxScale).toFixed(4)})`;
    }

    if (reduced) {
      apply(0.12);
      return;
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      const analyser = getAnalyser();
      let target = 0;
      if (analyser && playingRef.current) {
        if (!freq || freq.length !== analyser.frequencyBinCount) {
          freq = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freq);
        // Average the lowest few bins (sub-bass / kick range).
        const n = 6;
        let sum = 0;
        for (let i = 0; i < n; i++) sum += freq[i];
        target = sum / n / 255;
        // Bias toward kicks: emphasise the peaks.
        target = Math.min(1, target * 1.25);
      }
      // Snappy attack on a kick, slower release for a pulsing feel.
      level = target > level ? target * 0.65 + level * 0.35 : target * 0.12 + level * 0.88;
      apply(level);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [baseSpread, peakSpread, baseAlpha, peakAlpha, maxScale, tintBorder]);

  return ref;
}
