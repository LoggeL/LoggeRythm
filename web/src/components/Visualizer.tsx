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
const DEFAULT_STOPS = ["#4d3bd6", "#8b5cff", "#ff6ec7"] as const;
const DEFAULT_GLOW = "rgba(124, 92, 255, 0.55)";

export default function Visualizer({
  isPlaying,
  className = "",
  colors,
  glow,
}: {
  isPlaying: boolean;
  className?: string;
  /** Gradient stops bottom→top (defaults to the brand violet→pink). */
  colors?: readonly string[];
  /** Bar glow colour (defaults to a translucent violet). */
  glow?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest isPlaying without re-subscribing the RAF loop on every toggle.
  const playingRef = useRef(isPlaying);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);
  // Latest colours without re-subscribing the RAF loop on palette changes.
  const stops = colors && colors.length >= 2 ? colors : DEFAULT_STOPS;
  const colorsRef = useRef<readonly string[]>(stops);
  const glowRef = useRef(glow || DEFAULT_GLOW);
  useEffect(() => {
    colorsRef.current = colors && colors.length >= 2 ? colors : DEFAULT_STOPS;
    glowRef.current = glow || DEFAULT_GLOW;
  }, [colors, glow]);

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
    // Previous frame's raw (unboosted) level per bar, so we can react to the
    // frame-to-frame *rise* in energy — a fast beat spikes the delta even when
    // the absolute level is modest, so bass hits and snappy drums pop harder.
    const prev = new Float32Array(BARS);
    // How strongly a rapid rise adds on top of the absolute level.
    const BEAT_BOOST = 0.9;
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
          const raw = freq[bin] / 255;
          // Add the positive change since last frame so fast attacks (beats)
          // punch above their absolute level; steady tones aren't inflated.
          const rise = raw - prev[i];
          prev[i] = raw;
          target = rise > 0 ? Math.min(1, raw + rise * BEAT_BOOST) : raw;
        } else if (reduced) {
          target = 0.06;
          prev[i] = target;
        } else {
          // Gentle idle breathing wave.
          const phase = t * 0.04 + i * 0.35;
          target = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(phase));
          prev[i] = target;
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
      // The canvas can be momentarily 0–1px wide before layout settles, which
      // makes barW (and thus any corner radius) negative — guard against it so
      // arcTo() never throws.
      if (barW <= 0 || height <= 0) return;
      const radius = Math.max(0, Math.min(barW / 2, 4));

      const grad = ctx.createLinearGradient(0, height, 0, 0);
      const cs = colorsRef.current;
      for (let i = 0; i < cs.length; i++) {
        grad.addColorStop(i / (cs.length - 1), cs[i]);
      }
      ctx.fillStyle = grad;
      ctx.shadowColor = glowRef.current;
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

export function RadialVisualizer({
  isPlaying,
  className = "",
}: {
  isPlaying: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(isPlaying);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const cv = canvas;
    const ctx = ctx2d;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const BARS = 112;
    const heights = new Float32Array(BARS);
    // Previous frame's raw level per bar, to emphasise the frame-to-frame rise
    // in energy so fast beats spike harder than their absolute level (see the
    // linear Visualizer for the rationale).
    const prev = new Float32Array(BARS);
    const BEAT_BOOST = 0.9;
    let freq: Uint8Array<ArrayBuffer> | null = null;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let t = 0;

    function resize() {
      const rect = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      cv.width = width * dpr;
      cv.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      t += 1;

      const analyser = getAnalyser();
      const playing = playingRef.current;
      if (analyser && playing) {
        if (!freq || freq.length !== analyser.frequencyBinCount) {
          freq = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freq);
      }

      for (let i = 0; i < BARS; i++) {
        let target: number;
        if (analyser && playing && freq) {
          const frac = i / BARS;
          const bin = Math.floor(Math.pow(frac, 1.25) * freq.length * 0.82);
          const raw = freq[bin] / 255;
          const rise = raw - prev[i];
          prev[i] = raw;
          target = rise > 0 ? Math.min(1, raw + rise * BEAT_BOOST) : raw;
        } else if (reduced) {
          target = 0.08;
          prev[i] = target;
        } else {
          const phase = t * 0.035 + i * 0.22;
          target = 0.08 + 0.055 * (0.5 + 0.5 * Math.sin(phase));
          prev[i] = target;
        }
        const h = heights[i];
        heights[i] = target > h ? target * 0.58 + h * 0.42 : target * 0.18 + h * 0.82;
      }
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      const size = Math.min(width, height);
      const cx = width / 2;
      const cy = height / 2;
      const inner = size * 0.35;
      const maxBar = size * 0.16;
      const minBar = Math.max(3, size * 0.012);
      const barWidth = Math.max(2, (Math.PI * 2 * inner) / BARS * 0.38);

      const grad = ctx.createLinearGradient(cx - size / 2, cy, cx + size / 2, cy);
      grad.addColorStop(0, "#4d3bd6");
      grad.addColorStop(0.5, "#8b5cff");
      grad.addColorStop(1, "#ff6ec7");
      ctx.strokeStyle = grad;
      ctx.lineWidth = barWidth;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(124, 92, 255, 0.7)";
      ctx.shadowBlur = 16;

      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const length = minBar + heights[i] * maxBar;
        const r1 = inner;
        const r2 = inner + length;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
        ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(cx, cy, inner - size * 0.035, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(185, 168, 255, 0.16)";
      ctx.lineWidth = Math.max(1, size * 0.006);
      ctx.stroke();
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    if (reduced) {
      for (let i = 0; i < BARS; i++) heights[i] = 0.08;
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
  const radius = Math.max(0, Math.min(r, w / 2, h));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}
