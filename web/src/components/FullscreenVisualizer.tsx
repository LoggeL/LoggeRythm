"use client";

import { useEffect, useRef, type RefObject } from "react";
import { getAudioSpectrum, subscribeAudioSpectrum } from "@/lib/audioSpectrum";
import { drawVisualizerScene, visualizerGeometry, type VisualizerMode, type VisualizerSceneFrame } from "@/lib/visualizerScene";

const DEFAULT_COLORS = ["#6c36ff", "#a87dff", "#f0a7ee"] as const;
const DEFAULT_RGB = [124, 92, 255] as const;
const FRAME_INTERVAL = 1000 / 30;

export type VisualizerStatus = "live" | "waiting" | "paused" | "reduced";

interface FullscreenVisualizerProps {
  isPlaying: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLElement | null>;
  mode?: VisualizerMode;
  className?: string;
  colors?: readonly string[];
  glow?: string;
  rgb?: readonly [number, number, number];
  onStatusChange?: (status: VisualizerStatus) => void;
}

/** Three cover-anchored scenes, driven by the same real FFT as the mini player. */
export default function FullscreenVisualizer({
  isPlaying, anchorRef, surfaceRef, mode = "orbit", className = "",
  colors = DEFAULT_COLORS, glow = "#a87dff", rgb = DEFAULT_RGB, onStatusChange,
}: FullscreenVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<VisualizerSceneFrame>({ bands: new Float32Array(48), bass: 0, mid: 0, treble: 0, energy: 0, onset: 0, phase: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const cover = anchorRef.current;
    const surface = surfaceRef.current;
    if (!canvas || !cover || !surface) throw new Error("Fullscreen visualizer requires its mounted canvas, artwork and panel.");
    const context = canvas.getContext("2d", { desynchronized: true });
    if (!context) throw new Error("Fullscreen visualizer requires a Canvas 2D context.");
    if (colors.length < 2) throw new Error("Fullscreen visualizer requires at least two cover palette colors.");
    const scroller = cover.closest<HTMLElement>("[data-np-scroll]");
    if (!scroller) throw new Error("Fullscreen visualizer requires its scrolling player panel.");
    const ctx = context;
    const cv = canvas;
    const artwork = cover;
    const scene = sceneRef.current;
    const palette = { colors, primary: glow, rgb };
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    let visible = document.visibilityState === "visible";
    let intersects = true;
    let disposed = false;
    let running = false;
    let raf = 0;
    let geometryRaf = 0;
    let lastDraw = 0;
    let geometryDirty = true;
    let unsubscribe: (() => void) | null = null;
    let subscribing = false;
    let spectrum = getAudioSpectrum();
    let status: VisualizerStatus | null = null;
    let geometry = visualizerGeometry(1, 1, 0, 0, 0, 0);

    function publishStatus() {
      const next: VisualizerStatus = reduced ? "reduced" : !isPlaying ? "paused" : spectrum.active ? "live" : "waiting";
      if (next !== status) { status = next; onStatusChange?.(next); }
    }

    function updateGeometry() {
      const bounds = cv.getBoundingClientRect();
      const anchor = artwork.getBoundingClientRect();
      geometry = visualizerGeometry(Math.max(1, bounds.width), Math.max(1, bounds.height), anchor.left - bounds.left + anchor.width / 2, anchor.top - bounds.top + anchor.height / 2, anchor.width, anchor.height);
      geometryDirty = false;
    }

    function draw() {
      if (geometryDirty) updateGeometry();
      drawVisualizerScene(ctx, geometry, palette, scene, mode);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      lastDraw = 0;
    }

    function frame(now: number) {
      if (!running || disposed) return;
      raf = requestAnimationFrame(frame);
      if (lastDraw && now - lastDraw < FRAME_INTERVAL - 1) return;
      const delta = lastDraw ? Math.min(80, now - lastDraw) : FRAME_INTERVAL;
      lastDraw = now;
      const live = isPlaying && spectrum.active;
      const attack = 1 - Math.exp(-delta / 18);
      const release = 1 - Math.exp(-delta / 170);
      const approach = (current: number, target: number) => current + (target - current) * (target > current ? attack : release);
      for (let i = 0; i < scene.bands.length; i++) scene.bands[i] = approach(scene.bands[i], live ? spectrum.bands[i] : 0);
      scene.bass = approach(scene.bass, live ? spectrum.bass : 0);
      scene.mid = approach(scene.mid, live ? spectrum.mid : 0);
      scene.treble = approach(scene.treble, live ? spectrum.treble : 0);
      scene.energy = approach(scene.energy, live ? spectrum.energy : 0);
      scene.onset = approach(scene.onset, live ? spectrum.onset : 0);
      // Time advances only with the actual audio signal. Pause keeps the galaxy still.
      if (live && spectrum.energy > 0.005) scene.phase += delta / 1000 * (0.4 + spectrum.energy * 1.3);
      draw();
      if (!live && scene.energy < 0.001 && scene.bands.every((band) => band < 0.001)) stop();
    }

    function syncActivity() {
      if (disposed) return;
      const eligible = isPlaying && visible && intersects && !reduced;
      if (eligible && !unsubscribe && !subscribing) {
        subscribing = true;
        unsubscribe = subscribeAudioSpectrum((next) => { spectrum = next; syncActivity(); });
        subscribing = false;
      } else if (!eligible && unsubscribe) {
        const release = unsubscribe;
        unsubscribe = null;
        release();
      }
      publishStatus();
      if (!visible || !intersects) { stop(); return; }
      if (reduced) {
        stop();
        scene.bands.fill(0);
        scene.bass = scene.mid = scene.treble = scene.energy = scene.onset = 0;
        draw();
        return;
      }
      if ((isPlaying && spectrum.active) || scene.energy >= 0.001 || scene.bands.some((band) => band >= 0.001)) {
        if (!running) { running = true; raf = requestAnimationFrame(frame); }
      } else { stop(); draw(); }
    }

    function resize() {
      if (disposed) return;
      const bounds = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, bounds.width < 600 ? 1.25 : 1.5);
      const nextWidth = Math.max(1, Math.round(bounds.width * dpr));
      const nextHeight = Math.max(1, Math.round(bounds.height * dpr));
      if (cv.width !== nextWidth || cv.height !== nextHeight) {
        cv.width = nextWidth;
        cv.height = nextHeight;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      geometryDirty = true;
      if (visible && intersects) draw();
    }

    function onScroll() {
      geometryDirty = true;
      if (!running && visible && intersects && !geometryRaf) geometryRaf = requestAnimationFrame(() => { geometryRaf = 0; draw(); });
    }
    function onVisibilityChange() { visible = document.visibilityState === "visible"; syncActivity(); }
    function onMotionChange(event: MediaQueryListEvent) { reduced = event.matches; syncActivity(); }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(cv);
    resizeObserver.observe(artwork);
    const intersectionObserver = new IntersectionObserver(([entry]) => { intersects = entry.isIntersecting; syncActivity(); }, { threshold: 0.01 });
    intersectionObserver.observe(surface);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", onMotionChange);
    resize();
    syncActivity();
    return () => {
      disposed = true;
      stop();
      cancelAnimationFrame(geometryRaf);
      unsubscribe?.();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, [anchorRef, surfaceRef, isPlaying, mode, colors, glow, rgb, onStatusChange]);

  return <canvas ref={canvasRef} className={className} aria-hidden role="presentation" data-visualizer-mode={mode} />;
}
