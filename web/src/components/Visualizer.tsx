"use client";

import { useEffect, useRef } from "react";
import { getAnalyser } from "@/lib/audioAnalyser";

/**
 * Audio-reactive frequency-bar visualizer for the fullscreen now-playing view.
 *
 * Reads the shared AnalyserNode (set up in PlayerBar) once per animation frame
 * and paints a row of bars rising from the baseline, tinted with the brand
 * violet→pink gradient. When no analyser is available yet, or playback is
 * paused, it eases into a calm idle wave so the area never looks dead.
 *
 * Honors prefers-reduced-motion by rendering a single static baseline.
 */
export default function Visualizer({
  isPlaying,
  className = "",
}: {
  isPlaying: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest isPlaying without re-subscribing the RAF loop on every toggle.
  const playingRef = useRef(isPlaying);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    // Non-null bindings so TS keeps the narrowing inside the nested closures.
    const cv = canvas;
    const ctx = ctx2d;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const BARS = 64;
    // Smoothed bar heights (0..1) so transitions stay fluid frame to frame.
    const heights = new Float32Array(BARS);
    let freq: Uint8Array<ArrayBuffer> | null = null;

    let width = 0;
    let height = 0;
    let dpr = 1;

    function resize() {
      const rect = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      cv.width = width * dpr;
      cv.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    let raf = 0;
    let t = 0;

    function frame() {
      raf = requestAnimationFrame(frame);
      t += 1;

      const analyser = getAnalyser();
      const playing = playingRef.current;

      // Pull live spectrum when playing; otherwise decay toward an idle wave.
      if (analyser && playing) {
        if (!freq || freq.length !== analyser.frequencyBinCount) {
          freq = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freq);
      }

      for (let i = 0; i < BARS; i++) {
        let target: number;
        if (analyser && playing && freq) {
          // Use the lower ~80% of bins (music has little energy way up top),
          // mapped logarithmically so bass doesn't dominate the whole row.
          const frac = i / BARS;
          const bin = Math.floor(Math.pow(frac, 1.35) * freq.length * 0.8);
          target = freq[bin] / 255;
        } else if (reduced) {
          target = 0.06;
        } else {
          // Gentle idle breathing wave.
          const phase = t * 0.04 + i * 0.35;
          target = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(phase));
        }
        // Fast attack, slower release for a lively but smooth feel.
        const h = heights[i];
        heights[i] = target > h ? target * 0.55 + h * 0.45 : target * 0.2 + h * 0.8;
      }

      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      const gap = Math.max(1, width / BARS * 0.28);
      const barW = (width - gap * (BARS - 1)) / BARS;
      const radius = Math.min(barW / 2, 4);

      const grad = ctx.createLinearGradient(0, height, 0, 0);
      grad.addColorStop(0, "#4d3bd6");
      grad.addColorStop(0.55, "#8b5cff");
      grad.addColorStop(1, "#ff6ec7");
      ctx.fillStyle = grad;
      ctx.shadowColor = "rgba(124, 92, 255, 0.55)";
      ctx.shadowBlur = 12;

      const minH = 2;
      for (let i = 0; i < BARS; i++) {
        const h = Math.max(minH, heights[i] * height);
        const x = i * (barW + gap);
        const y = height - h;
        roundedTopRect(ctx, x, y, barW, h, radius);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    if (reduced) {
      // No animation loop — paint one static baseline frame.
      for (let i = 0; i < BARS; i++) heights[i] = 0.06;
      draw();
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      role="presentation"
    />
  );
}

/** Rounded rectangle with rounded top corners only (flat base on the floor). */
function roundedTopRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}
