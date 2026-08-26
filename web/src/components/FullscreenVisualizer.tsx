"use client";

import { useEffect, useRef, type RefObject } from "react";
import { getAnalyser } from "@/lib/audioAnalyser";

const TAU = Math.PI * 2;
const DEFAULT_COLORS = ["#4d3bd6", "#8b5cff", "#ff6ec7"] as const;
const DEFAULT_GLOW = "#8b5cff";
const DEFAULT_RGB = [124, 92, 255] as const;
const SPECTRUM_BANDS = 32;
const RAY_COUNT = 40;
const FRAME_INTERVAL_MS = 1000 / 30;

const RAY_COS = new Float32Array(RAY_COUNT);
const RAY_SIN = new Float32Array(RAY_COUNT);
const RAY_BANDS = new Uint8Array(RAY_COUNT);
for (let ray = 0; ray < RAY_COUNT; ray++) {
  const phase = ray / RAY_COUNT;
  const angle = phase * TAU - Math.PI / 2;
  RAY_COS[ray] = Math.cos(angle);
  RAY_SIN[ray] = Math.sin(angle);
  RAY_BANDS[ray] = Math.round(
    Math.abs(phase * 2 - 1) * (SPECTRUM_BANDS - 1),
  );
}

interface FullscreenVisualizerProps {
  isPlaying: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLElement | null>;
  className?: string;
  /** Gradient stops from the cover palette. */
  colors?: readonly string[];
  /** Primary cover color used for the quiet outer ring. */
  glow?: string;
  /** RGB form of the primary cover color used by the ambient canvas glow. */
  rgb?: readonly [number, number, number];
}

/**
 * Audio-reactive backdrop for the fullscreen "Jetzt läuft" view.
 *
 * The visualizer deliberately renders one restrained spectrum at 30 fps. It
 * stops completely while paused, hidden, offscreen, or under reduced motion;
 * those states keep a single static frame instead of an idle animation.
 */
export default function FullscreenVisualizer({
  isPlaying,
  anchorRef,
  surfaceRef,
  className = "",
  colors,
  glow = DEFAULT_GLOW,
  rgb = DEFAULT_RGB,
}: FullscreenVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Fullscreen visualizer canvas did not mount.");
    }
    const ctx2d = canvas.getContext("2d", { desynchronized: true });
    if (!ctx2d) {
      throw new Error("Fullscreen visualizer requires a Canvas 2D context.");
    }
    const anchor = anchorRef.current;
    if (!anchor) {
      throw new Error("Fullscreen visualizer cover anchor did not mount.");
    }
    const surface = surfaceRef.current;
    if (!surface) {
      throw new Error("Fullscreen visualizer panel surface did not mount.");
    }
    if (colors && colors.length < 2) {
      throw new Error("Fullscreen visualizer palette requires at least two colors.");
    }

    const cv = canvas;
    const ctx = ctx2d;
    const cover = anchor;
    const panel = surface;
    const palette = colors ?? DEFAULT_COLORS;
    const [red, green, blue] = rgb;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    let reduced = motionQuery.matches;
    let documentVisible = document.visibilityState === "visible";
    let intersects = false;
    let intersectionKnown = false;
    let running = false;
    let disposed = false;
    let raf = 0;
    let geometryRaf = 0;
    let geometryDirty = true;
    let lastFrameAt = 0;
    let nextFrameAt = 0;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let centerX = 0;
    let centerY = 0;
    let coverRadius = 1;
    let energy = 0;
    let analyserNode: AnalyserNode | null = null;
    let spectrum: Uint8Array<ArrayBuffer> | null = null;
    let bandStarts: Uint32Array | null = null;
    let bandEnds: Uint32Array | null = null;
    let orbitGradient: CanvasGradient | null = null;
    let ambientGradient: CanvasGradient | null = null;
    let waitingFrameDrawn = false;
    const bandLevels = new Float32Array(SPECTRUM_BANDS);

    function updateGeometry() {
      const canvasRect = cv.getBoundingClientRect();
      const coverRect = cover.getBoundingClientRect();
      centerX = coverRect.left - canvasRect.left + coverRect.width / 2;
      centerY = coverRect.top - canvasRect.top + coverRect.height / 2;
      coverRadius = Math.max(1, Math.max(coverRect.width, coverRect.height) / 2);

      orbitGradient = ctx.createLinearGradient(
        centerX - coverRadius * 1.5,
        centerY,
        centerX + coverRadius * 1.5,
        centerY,
      );
      for (let i = 0; i < palette.length; i++) {
        orbitGradient.addColorStop(i / (palette.length - 1), palette[i]);
      }

      const bloomRadius = Math.max(180, coverRadius * 2.15);
      ambientGradient = ctx.createRadialGradient(
        centerX,
        centerY,
        coverRadius * 0.35,
        centerX,
        centerY,
        bloomRadius,
      );
      ambientGradient.addColorStop(
        0,
        `rgba(${red}, ${green}, ${blue}, 0.72)`,
      );
      ambientGradient.addColorStop(
        0.42,
        `rgba(${red}, ${green}, ${blue}, 0.2)`,
      );
      ambientGradient.addColorStop(1, "transparent");

      geometryDirty = false;
    }

    function resize() {
      if (disposed) return;
      const rect = cv.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      const maxDpr = nextWidth < 600 ? 1 : 1.25;
      const nextDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const pixelWidth = Math.round(nextWidth * nextDpr);
      const pixelHeight = Math.round(nextHeight * nextDpr);

      width = nextWidth;
      height = nextHeight;
      if (cv.width !== pixelWidth || cv.height !== pixelHeight || dpr !== nextDpr) {
        dpr = nextDpr;
        cv.width = pixelWidth;
        cv.height = pixelHeight;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      updateGeometry();
      if (
        !running &&
        documentVisible &&
        (intersects || !intersectionKnown)
      ) {
        renderStatic();
      }
    }

    function configureAnalyser(analyser: AnalyserNode) {
      const binCount = analyser.frequencyBinCount;
      const binHz = analyser.context.sampleRate / analyser.fftSize;
      if (binCount < 2 || !Number.isFinite(binHz) || binHz <= 0) {
        throw new Error(
          `Fullscreen visualizer cannot use FFT ${analyser.fftSize} at ${analyser.context.sampleRate} Hz.`,
        );
      }

      spectrum = new Uint8Array(binCount);
      bandStarts = new Uint32Array(SPECTRUM_BANDS);
      bandEnds = new Uint32Array(SPECTRUM_BANDS);
      const lowHz = 40;
      const highHz = Math.min(12000, analyser.context.sampleRate * 0.45);
      const ratio = highHz / lowHz;
      for (let band = 0; band < SPECTRUM_BANDS; band++) {
        const bandLow = lowHz * Math.pow(ratio, band / SPECTRUM_BANDS);
        const bandHigh = lowHz * Math.pow(ratio, (band + 1) / SPECTRUM_BANDS);
        const start = Math.min(
          binCount - 1,
          Math.max(1, Math.floor(bandLow / binHz)),
        );
        const end = Math.min(
          binCount,
          Math.max(start + 1, Math.ceil(bandHigh / binHz)),
        );
        bandStarts[band] = start;
        bandEnds[band] = end;
      }
      analyserNode = analyser;
      bandLevels.fill(0);
      energy = 0;
    }

    function readSpectrum(deltaMs: number, analyser: AnalyserNode) {
      if (
        analyserNode !== analyser ||
        !spectrum ||
        spectrum.length !== analyser.frequencyBinCount
      ) {
        configureAnalyser(analyser);
      }
      if (!spectrum || !bandStarts || !bandEnds) {
        throw new Error(
          "Fullscreen visualizer spectrum buffers were not initialized.",
        );
      }

      analyser.getByteFrequencyData(spectrum);
      const attack = 1 - Math.exp(-deltaMs / 55);
      const release = 1 - Math.exp(-deltaMs / 220);
      let lowEnergy = 0;
      for (let band = 0; band < SPECTRUM_BANDS; band++) {
        const start = bandStarts[band];
        const end = bandEnds[band];
        let total = 0;
        for (let bin = start; bin < end; bin++) {
          total += spectrum[bin];
        }
        const average = total / (end - start) / 255;
        const target = Math.max(
          0,
          Math.min(1, Math.pow(average * 1.42, 1.2)),
        );
        const current = bandLevels[band];
        bandLevels[band] =
          current +
          (target - current) * (target > current ? attack : release);
        if (band < 8) lowEnergy += bandLevels[band];
      }
      const energyTarget = lowEnergy / 8;
      const energyRate = energyTarget > energy ? attack : release;
      energy += (energyTarget - energy) * energyRate;
    }

    function draw() {
      if (!orbitGradient || !ambientGradient) {
        throw new Error("Fullscreen visualizer gradients were not initialized.");
      }

      ctx.clearRect(0, 0, width, height);

      const bloomRadius = Math.max(180, coverRadius * 2.15);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.08 + energy * 0.18;
      ctx.fillStyle = ambientGradient;
      ctx.fillRect(
        centerX - bloomRadius,
        centerY - bloomRadius,
        bloomRadius * 2,
        bloomRadius * 2,
      );

      const baseRadius = coverRadius + Math.max(12, coverRadius * 0.055);
      const maxRayLength = Math.max(24, Math.min(68, coverRadius * 0.28));
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = orbitGradient;
      ctx.lineCap = "round";
      for (let ray = 0; ray < RAY_COUNT; ray++) {
        const level = bandLevels[RAY_BANDS[ray]];
        const rayLength = 4 + level * maxRayLength;
        const cos = RAY_COS[ray];
        const sin = RAY_SIN[ray];
        ctx.beginPath();
        ctx.moveTo(
          centerX + cos * baseRadius,
          centerY + sin * baseRadius,
        );
        ctx.lineTo(
          centerX + cos * (baseRadius + rayLength),
          centerY + sin * (baseRadius + rayLength),
        );
        ctx.globalAlpha = 0.22 + level * 0.62;
        ctx.lineWidth = 1.25 + level * 2.4;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius + maxRayLength * 0.7, 0, TAU);
      ctx.strokeStyle = glow;
      ctx.globalAlpha = 0.1 + energy * 0.16;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    function renderStatic() {
      for (let band = 0; band < SPECTRUM_BANDS; band++) {
        bandLevels[band] = 0.035 + (band % 5) * 0.004;
      }
      energy = 0;
      draw();
      waitingFrameDrawn = true;
    }

    function frame(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (nextFrameAt !== 0 && now < nextFrameAt) return;
      nextFrameAt =
        nextFrameAt === 0 || now - nextFrameAt > FRAME_INTERVAL_MS
          ? now + FRAME_INTERVAL_MS
          : nextFrameAt + FRAME_INTERVAL_MS;

      const deltaMs =
        lastFrameAt === 0
          ? FRAME_INTERVAL_MS
          : Math.min(80, Math.max(1, now - lastFrameAt));
      lastFrameAt = now;
      if (geometryDirty) updateGeometry();

      const analyser = getAnalyser();
      if (!analyser) {
        if (!waitingFrameDrawn) renderStatic();
        return;
      }

      waitingFrameDrawn = false;
      readSpectrum(deltaMs, analyser);
      draw();
    }

    function start() {
      if (running || disposed) return;
      running = true;
      lastFrameAt = 0;
      nextFrameAt = 0;
      waitingFrameDrawn = false;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    }

    function syncActivity() {
      if (documentVisible && intersects && geometryDirty) {
        updateGeometry();
      }
      if (isPlaying && !reduced && documentVisible && intersects) {
        start();
        return;
      }

      stop();
      if (documentVisible && intersects && (!isPlaying || reduced)) {
        renderStatic();
      }
    }

    function flushGeometry() {
      geometryRaf = 0;
      if (!geometryDirty || !documentVisible || !intersects) return;
      updateGeometry();
      if (!running) renderStatic();
    }

    function onScroll() {
      geometryDirty = true;
      if (
        !running &&
        documentVisible &&
        intersects &&
        geometryRaf === 0
      ) {
        geometryRaf = requestAnimationFrame(flushGeometry);
      }
    }

    function onVisibilityChange() {
      documentVisible = document.visibilityState === "visible";
      syncActivity();
    }

    function onMotionChange(event: MediaQueryListEvent) {
      reduced = event.matches;
      syncActivity();
    }

    const scroller = cover.closest<HTMLElement>("[data-np-scroll]");
    if (!scroller) {
      throw new Error("Fullscreen visualizer could not find its scrolling panel.");
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(cv);
    resizeObserver.observe(cover);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (disposed) return;
        intersectionKnown = true;
        intersects = entry.isIntersecting && entry.intersectionRatio > 0;
        syncActivity();
      },
      { threshold: 0.01 },
    );
    intersectionObserver.observe(panel);

    scroller.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", onMotionChange);
    resize();

    return () => {
      disposed = true;
      stop();
      cancelAnimationFrame(geometryRaf);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, [anchorRef, colors, glow, isPlaying, rgb, surfaceRef]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      role="presentation"
    />
  );
}
