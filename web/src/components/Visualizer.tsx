"use client";

import { useEffect, useRef } from "react";
import { getAudioSpectrum, subscribeAudioSpectrum } from "@/lib/audioSpectrum";
import { drawVisualizerScene, visualizerGeometry } from "@/lib/visualizerScene";

const DEFAULT_COLORS = ["#6c36ff", "#a87dff", "#f0a7ee"] as const;
interface VisualizerProps {
  isPlaying: boolean;
  className?: string;
  colors?: readonly string[];
  glow?: string;
}

/** Compact spectrum with the same real signal as the fullscreen scenes. */
export default function Visualizer(props: VisualizerProps) { return <SpectrumCanvas {...props} radial={false} />; }
export function RadialVisualizer(props: VisualizerProps) { return <SpectrumCanvas {...props} radial />; }

function SpectrumCanvas({ isPlaying, className = "", colors = DEFAULT_COLORS, glow = "#a87dff", radial }: VisualizerProps & { radial: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("Spectrum visualizer canvas did not mount.");
    const context = canvas.getContext("2d", { desynchronized: true });
    if (!context) throw new Error("Spectrum visualizer requires a Canvas 2D context.");
    if (colors.length < 2) throw new Error("Spectrum visualizer requires at least two palette colors.");
    const cv = canvas;
    const ctx = context;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const quiet = new Float32Array(48);
    let width = 1, height = 1;
    let intersects = true;
    let visible = document.visibilityState === "visible";
    let reduced = motion.matches;
    let unsubscribe: (() => void) | null = null;
    let spectrum = getAudioSpectrum();
    let gradient = ctx.createLinearGradient(0, 1, 0, 0);

    function draw() {
      const live = isPlaying && visible && intersects && !reduced && spectrum.active;
      const bands = live ? spectrum.bands : quiet;
      if (radial) {
        const size = Math.min(width, height);
        drawVisualizerScene(ctx, visualizerGeometry(width, height, width / 2, height / 2, size * 0.5, size * 0.5), { colors, primary: glow, rgb: [124, 92, 255] }, { bands, bass: live ? spectrum.bass : 0, mid: live ? spectrum.mid : 0, treble: live ? spectrum.treble : 0, energy: live ? spectrum.energy : 0, onset: live ? spectrum.onset : 0, phase: live ? spectrum.timeSeconds * 0.6 : 0 }, "orbit");
        return;
      }
      ctx.clearRect(0, 0, width, height);
      const count = bands.length;
      const step = width / count;
      const barWidth = Math.max(0.2, step * 0.65);
      ctx.fillStyle = gradient;
      ctx.shadowColor = glow;
      ctx.shadowBlur = live ? 8 : 0;
      for (let i = 0; i < count; i++) {
        const level = bands[i];
        const barHeight = Math.max(1.5, level * height * 0.85);
        ctx.globalAlpha = 0.25 + level * 0.75;
        ctx.beginPath();
        ctx.roundRect(i * step + step * 0.175, height - barHeight, barWidth, barHeight, Math.min(barWidth / 2, barHeight / 2));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    function sync() {
      const eligible = isPlaying && visible && intersects && !reduced;
      if (eligible && !unsubscribe) unsubscribe = subscribeAudioSpectrum((next) => { spectrum = next; draw(); });
      else if (!eligible && unsubscribe) { unsubscribe(); unsubscribe = null; }
      draw();
    }
    function resize() {
      const bounds = cv.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const dpr = Math.min(window.devicePixelRatio, 1.5);
      cv.width = Math.max(1, Math.round(width * dpr));
      cv.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gradient = ctx.createLinearGradient(0, height, width * 0.25, 0);
      colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
      draw();
    }
    function onVisibility() { visible = document.visibilityState === "visible"; sync(); }
    function onMotion(event: MediaQueryListEvent) { reduced = event.matches; sync(); }
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => { intersects = entry.isIntersecting; sync(); }, { threshold: 0.01 });
    resizeObserver.observe(cv);
    intersectionObserver.observe(cv);
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    resize();
    sync();
    return () => {
      unsubscribe?.();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
    };
  }, [isPlaying, colors, glow, radial]);
  return <canvas ref={canvasRef} className={className} aria-hidden role="presentation" />;
}
