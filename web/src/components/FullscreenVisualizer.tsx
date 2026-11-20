"use client";

import { useEffect, useRef, type RefObject } from "react";
import { getAudioSpectrum, subscribeAudioSpectrum, type AudioSpectrumFrame } from "@/lib/audioSpectrum";
import {
  DEFAULT_VISUALIZER_PALETTE, advanceDrive, blendColors, createDriveTracker, ingestSpectrum, paletteColors, triggerWave,
  type PaletteSource,
} from "@/lib/visualizerDrive";
import { createVisualizerRenderer, type VisualizerRenderer } from "@/lib/visualizerShader";

export type VisualizerStatus = "live" | "waiting" | "paused" | "reduced";

interface FullscreenVisualizerProps {
  isPlaying: boolean;
  /** The artwork the scene is composed around; may remount while mounted. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Cover palette; `null` while the cover is still being sampled or has none. */
  palette: PaletteSource | null;
  className?: string;
  onStatusChange?: (status: VisualizerStatus) => void;
}

/** Drawing-buffer density: the scene is soft light, so it never needs full retina. */
const MAX_DENSITY = 1.25;
const MIN_QUALITY = 0.5;
/** A missing cover palette waits this long before fading to the default theme. */
const PALETTE_GRACE_MS = 700;
const INTRO_SECONDS = 0.9;
const SILENT: Pick<AudioSpectrumFrame, "bands" | "bass" | "mid" | "treble" | "energy" | "active" | "timeSeconds"> = {
  bands: new Float32Array(48), bass: 0, mid: 0, treble: 0, energy: 0, active: false, timeSeconds: 0,
};

/**
 * The fullscreen player's visualizer: one WebGL2 pass behind the whole
 * player, composed around the artwork and driven by the shared real FFT.
 */
export default function FullscreenVisualizer({ isPlaying, anchorRef, palette, className = "", onStatusChange }: FullscreenVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(isPlaying);
  const paletteRef = useRef(palette);
  const statusRef = useRef(onStatusChange);
  const syncRef = useRef<(() => void) | null>(null);
  const paletteSyncRef = useRef<(() => void) | null>(null);

  useEffect(() => { playingRef.current = isPlaying; syncRef.current?.(); }, [isPlaying]);
  useEffect(() => { paletteRef.current = palette; paletteSyncRef.current?.(); }, [palette]);
  useEffect(() => { statusRef.current = onStatusChange; }, [onStatusChange]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) throw new Error("Fullscreen visualizer requires its mounted canvas.");
    const canvas = element;
    const context = canvas.getContext("webgl2", {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    if (!context) throw new Error("Der Vollbild-Visualizer braucht WebGL2, aber der Browser stellt keinen WebGL2-Kontext bereit.");
    const gl = context;
    let renderer: VisualizerRenderer | null = createVisualizerRenderer(gl);
    const tracker = createDriveTracker();
    const initialPalette = paletteRef.current ?? DEFAULT_VISUALIZER_PALETTE;
    const colors = paletteColors(initialPalette);
    let targetColors = paletteColors(initialPalette);
    let appliedPalette: PaletteSource | null = paletteRef.current;
    let paletteTimer = 0;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    let visible = document.visibilityState === "visible";
    let disposed = false;
    let running = false;
    let raf = 0;
    let last = 0;
    let intro = reduced ? 1 : 0;
    let quality = 1;
    let windowFrames = 0;
    let windowSlow = 0;
    let slowWindows = 0;
    let smoothWindows = 0;
    let governedFrames = 0;
    let unsubscribe: (() => void) | null = null;
    let spectrum: Pick<AudioSpectrumFrame, "active"> = getAudioSpectrum();
    let status: VisualizerStatus | null = null;
    let observedAnchor: HTMLElement | null = null;
    let corner = 0;

    const geometry = { width: 1, height: 1, centerX: 0, centerY: 0, halfWidth: 1, halfHeight: 1 };

    function publishStatus() {
      const next: VisualizerStatus = reduced ? "reduced" : !playingRef.current ? "paused" : spectrum.active ? "live" : "waiting";
      if (next !== status) { status = next; statusRef.current?.(next); }
    }

    function density() {
      return Math.min(window.devicePixelRatio, MAX_DENSITY) * quality;
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      const scale = density();
      const width = Math.max(1, Math.round(bounds.width * scale));
      const height = Math.max(1, Math.round(bounds.height * scale));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      canvas.dataset.renderScale = scale.toFixed(3);
    }

    function measure() {
      const anchor = anchorRef.current;
      if (!anchor) throw new Error("Fullscreen visualizer lost its artwork anchor while it was still mounted.");
      if (anchor !== observedAnchor) {
        if (observedAnchor) resizeObserver.unobserve(observedAnchor);
        resizeObserver.observe(anchor);
        observedAnchor = anchor;
      }
      const bounds = canvas.getBoundingClientRect();
      const box = anchor.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || box.width <= 0 || box.height <= 0) {
        throw new Error(`Fullscreen visualizer needs a visible canvas and artwork (canvas ${bounds.width}×${bounds.height}, artwork ${box.width}×${box.height}).`);
      }
      const radius = parseFloat(getComputedStyle(anchor).borderTopLeftRadius);
      if (!Number.isFinite(radius)) throw new Error("Fullscreen visualizer could not read the artwork's corner radius.");
      const sx = canvas.width / bounds.width, sy = canvas.height / bounds.height;
      geometry.width = canvas.width;
      geometry.height = canvas.height;
      geometry.centerX = (box.left - bounds.left + box.width / 2) * sx;
      geometry.centerY = (box.top - bounds.top + box.height / 2) * sy;
      geometry.halfWidth = box.width / 2 * sx;
      geometry.halfHeight = box.height / 2 * sy;
      corner = radius / (box.width / 2);
    }

    function draw() {
      if (!renderer) return;
      measure();
      renderer.render({ ...geometry, corner, intro: easeIntro(intro), drive: tracker.drive, colors });
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    function start() {
      if (running || disposed || !renderer || !visible) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }

    /**
     * Fill-rate governor: a GPU that can't hold ~50 fps renders fewer pixels.
     * Only sustained slowness counts — isolated stalls (opening the player,
     * a React render, a screenshot) are main-thread hiccups, not fill rate —
     * and quality climbs back once frames have been smooth for a while.
     */
    function govern(dt: number) {
      governedFrames += 1;
      if (governedFrames < 60 || dt > 0.1) return;
      windowFrames += 1;
      if (dt > 1 / 48) windowSlow += 1;
      if (windowFrames < 60) return;
      const slow = windowSlow / windowFrames > 0.5;
      windowFrames = 0;
      windowSlow = 0;
      slowWindows = slow ? slowWindows + 1 : 0;
      smoothWindows = slow ? 0 : smoothWindows + 1;
      if (slowWindows >= 2 && quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, quality * 0.8);
        slowWindows = 0;
        resize();
      } else if (smoothWindows >= 8 && quality < 1) {
        quality = Math.min(1, quality / 0.8);
        smoothWindows = 0;
        resize();
      }
    }

    function frame(now: number) {
      if (!running || disposed) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      const animating = reduced ? false : advanceDrive(tracker, dt);
      const recolouring = blendColors(colors, targetColors, dt);
      if (intro < 1) intro = Math.min(1, intro + dt / INTRO_SECONDS);
      draw();
      if (animating && playingRef.current) govern(dt);
      if (animating || recolouring || intro < 1) raf = requestAnimationFrame(frame);
      else stop();
    }

    function onSpectrum(next: AudioSpectrumFrame) {
      spectrum = next;
      // Beat count is exposed for verification; it changes a few times a second at most.
      if (ingestSpectrum(tracker, next)) canvas.dataset.beats = String(tracker.drive.beats);
      publishStatus();
      // Inactive frames only need the running loop to settle, not a restart.
      if (next.active) start();
    }

    function sync() {
      if (disposed) return;
      const eligible = playingRef.current && visible && !reduced;
      if (eligible && !unsubscribe) unsubscribe = subscribeAudioSpectrum(onSpectrum);
      else if (!eligible && unsubscribe) {
        const release = unsubscribe;
        unsubscribe = null;
        release();
      }
      if (!eligible) { spectrum = SILENT; ingestSpectrum(tracker, SILENT); }
      publishStatus();
      if (!visible || !renderer) { stop(); return; }
      if (reduced) {
        stop();
        intro = 1;
        draw();
        return;
      }
      start();
      if (!running) draw();
    }

    function syncPalette() {
      if (disposed) return;
      window.clearTimeout(paletteTimer);
      const next = paletteRef.current;
      if (next === appliedPalette) return;
      const apply = (source: PaletteSource | null) => {
        appliedPalette = source;
        targetColors = paletteColors(source ?? DEFAULT_VISUALIZER_PALETTE);
        if (tracker.live) triggerWave(tracker, 0.6);
        if (reduced) { colors.set(targetColors); draw(); } else start();
      };
      // A new track's cover is sampled asynchronously; don't flash the
      // default theme in between two covers.
      if (next) apply(next);
      else paletteTimer = window.setTimeout(() => apply(null), PALETTE_GRACE_MS);
    }

    function onResize() {
      if (disposed) return;
      resize();
      if (!running && visible && renderer) draw();
    }
    function onVisibilityChange() { visible = document.visibilityState === "visible"; sync(); }
    function onMotionChange(event: MediaQueryListEvent) { reduced = event.matches; sync(); }
    function onContextLost(event: Event) {
      // Required so the browser will restore the context later.
      event.preventDefault();
      stop();
      renderer = null;
    }
    function onContextRestored() {
      renderer = createVisualizerRenderer(gl);
      resize();
      sync();
    }

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", onMotionChange);
    syncRef.current = sync;
    paletteSyncRef.current = syncPalette;
    resize();
    sync();
    return () => {
      disposed = true;
      syncRef.current = null;
      paletteSyncRef.current = null;
      stop();
      window.clearTimeout(paletteTimer);
      unsubscribe?.();
      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", onMotionChange);
      renderer?.dispose();
    };
  }, [anchorRef]);

  return <canvas ref={canvasRef} className={className} aria-hidden role="presentation" data-visualizer="" />;
}

function easeIntro(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
