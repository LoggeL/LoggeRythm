"use client";

import { useEffect, useRef, type RefObject } from "react";
import { getAnalyser } from "@/lib/audioAnalyser";

const TAU = Math.PI * 2;
const DEFAULT_COLORS = ["#4d3bd6", "#8b5cff", "#ff6ec7"] as const;
const DEFAULT_GLOW = "#8b5cff";
const DEFAULT_RGB = [124, 92, 255] as const;
const SPECTRUM_BANDS = 48;
const FLUX_HISTORY = 64;
const FLUX_WINDOW_MS = 850;
const DETECTOR_WARMUP_MS = 180;
const FRAME_INTERVAL_MS = 1000 / 60;

interface Shockwave {
  age: number;
  life: number;
  strength: number;
  colorIndex: number;
}

interface Spark {
  angle: number;
  distance: number;
  speed: number;
  drift: number;
  age: number;
  life: number;
  size: number;
  colorIndex: number;
}

interface FullscreenVisualizerProps {
  isPlaying: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLElement | null>;
  className?: string;
  /** Gradient stops from the cover palette. */
  colors?: readonly string[];
  /** Primary cover color used for bloom and shadows. */
  glow?: string;
  /** RGB form of the primary cover color for DOM shadows. */
  rgb?: readonly [number, number, number];
}

/**
 * Full-panel visual stage for the "Jetzt läuft" view.
 *
 * One animation loop performs Hz-aware audio analysis, adaptive spectral-flux
 * beat detection, canvas rendering, and cover/panel lighting. The cover is the
 * visual anchor: spectrum rays orbit it, detected beats launch shockwaves and
 * sparks, while a mirrored low-to-high spectrum grounds the bottom edge.
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
  const playingRef = useRef(isPlaying);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Fullscreen visualizer canvas did not mount.");
    }
    const ctx2d = canvas.getContext("2d");
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

    // Stable non-null bindings for the nested animation callbacks.
    const cv = canvas;
    const cover = anchor;
    const panel = surface;
    const ctx = ctx2d;
    if (colors && colors.length < 2) {
      throw new Error("Fullscreen visualizer palette requires at least two colors.");
    }
    const palette = colors ?? DEFAULT_COLORS;
    const [red, green, blue] = rgb;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let centerX = 0;
    let centerY = 0;
    let coverRadius = 1;
    let orbitGradient: CanvasGradient | null = null;
    let floorGradient: CanvasGradient | null = null;
    let vignetteGradient: CanvasGradient | null = null;
    let raf = 0;
    let lastFrameAt = 0;
    let nextFrameAt = 0;
    let lastBeatAt = -Infinity;
    let lastPanelStyleAt = -Infinity;
    let lastBassRaw = 0;
    let bassFast = 0;
    let bassSlow = 0.08;
    let bass = 0;
    let mids = 0;
    let highs = 0;
    let energy = 0;
    let onset = 0;
    let beatPulse = 0;
    let spectrum: Uint8Array<ArrayBuffer> | null = null;
    let previousSpectrum: Float32Array | null = null;
    let spectrumPrimed = false;
    let liveLastFrame = false;
    let fluxCursor = 0;
    let fluxCount = 0;
    let randomState = 0x9e3779b9;
    const fluxHistory = new Float32Array(FLUX_HISTORY);
    const fluxTimes = new Float64Array(FLUX_HISTORY);
    const bandLevels = new Float32Array(SPECTRUM_BANDS);
    const bandPeaks = new Float32Array(SPECTRUM_BANDS);
    const bandTargets = new Float32Array(SPECTRUM_BANDS);
    const shockwaves: Shockwave[] = [];
    const sparks: Spark[] = [];

    function random() {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    }

    function resize() {
      const rect = cv.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const maxDpr = width < 600 ? 1.5 : 2;
      dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      updateGeometry();
      if (reduced) draw(0);
    }

    function updateGeometry() {
      const canvasRect = cv.getBoundingClientRect();
      const coverRect = cover.getBoundingClientRect();
      centerX = coverRect.left - canvasRect.left + coverRect.width / 2;
      centerY = coverRect.top - canvasRect.top + coverRect.height / 2;
      coverRadius = Math.max(cover.offsetWidth, cover.offsetHeight) / 2;

      orbitGradient = ctx.createLinearGradient(
        centerX - coverRadius * 1.6,
        centerY,
        centerX + coverRadius * 1.6,
        centerY,
      );
      floorGradient = ctx.createLinearGradient(
        0,
        height,
        0,
        height - Math.min(96, height * 0.15),
      );
      for (let i = 0; i < palette.length; i++) {
        const stop = i / (palette.length - 1);
        orbitGradient.addColorStop(stop, palette[i]);
        floorGradient.addColorStop(stop, palette[i]);
      }

      const vignetteRadius = Math.max(width, height) * 0.78;
      vignetteGradient = ctx.createRadialGradient(
        centerX,
        centerY,
        Math.min(width, height) * 0.18,
        centerX,
        centerY,
        vignetteRadius,
      );
      vignetteGradient.addColorStop(0, "transparent");
      vignetteGradient.addColorStop(0.68, "rgba(4, 3, 13, 0.06)");
      vignetteGradient.addColorStop(1, "rgba(4, 3, 13, 0.38)");
    }

    function rangeLevel(
      data: Uint8Array<ArrayBuffer>,
      analyser: AnalyserNode,
      lowHz: number,
      highHz: number,
    ) {
      const binHz = analyser.context.sampleRate / analyser.fftSize;
      // Interpolated sampling avoids duplicate plateaus when a narrow low-end
      // logarithmic band is smaller than a single FFT bin.
      const samples = Math.max(2, Math.min(16, Math.ceil((highHz - lowHz) / binHz) * 2));
      let level = 0;
      for (let sample = 0; sample < samples; sample++) {
        const hz = lowHz + ((sample + 0.5) / samples) * (highHz - lowHz);
        const position = Math.min(data.length - 1, Math.max(1, hz / binHz));
        const lower = Math.floor(position);
        const upper = Math.min(data.length - 1, lower + 1);
        const mix = position - lower;
        level += (data[lower] * (1 - mix) + data[upper] * mix) / 255;
      }
      return level / samples;
    }

    function resetBeatDetector() {
      spectrumPrimed = false;
      previousSpectrum?.fill(0);
      fluxHistory.fill(0);
      fluxTimes.fill(0);
      fluxCursor = 0;
      fluxCount = 0;
      lastBassRaw = 0;
      bassFast = 0;
      bassSlow = 0.08;
    }

    function median(values: number[]) {
      if (values.length === 0) return 0;
      values.sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle];
    }

    function recentFluxStats(now: number) {
      const values: number[] = [];
      let oldest = now;
      for (let i = 0; i < fluxCount; i++) {
        if (now - fluxTimes[i] <= FLUX_WINDOW_MS) {
          values.push(fluxHistory[i]);
          oldest = Math.min(oldest, fluxTimes[i]);
        }
      }
      const center = median([...values]);
      const deviation = median(values.map((value) => Math.abs(value - center)));
      return { center, deviation, count: values.length, age: now - oldest };
    }

    function readAudio(deltaMs: number, now: number) {
      const analyser = getAnalyser();
      const live = Boolean(analyser && playingRef.current);
      let bassTarget = 0;
      let midTarget = 0;
      let highTarget = 0;
      let onsetTarget = 0;

      if (analyser && live) {
        if (!spectrum || spectrum.length !== analyser.frequencyBinCount) {
          spectrum = new Uint8Array(analyser.frequencyBinCount);
          previousSpectrum = new Float32Array(analyser.frequencyBinCount);
          resetBeatDetector();
        }
        if (!previousSpectrum) {
          throw new Error("Fullscreen visualizer spectrum history was not initialized.");
        }

        analyser.getByteFrequencyData(spectrum);

        const subRaw = rangeLevel(spectrum, analyser, 28, 80);
        const kickRaw = rangeLevel(spectrum, analyser, 60, 190);
        const midRaw = rangeLevel(spectrum, analyser, 190, 2200);
        const highRaw = rangeLevel(spectrum, analyser, 2200, 12000);
        const bassRaw = subRaw * 0.38 + kickRaw * 0.62;

        bassTarget = clamp01(Math.pow(bassRaw * 1.32, 1.12));
        midTarget = clamp01(Math.pow(midRaw * 1.18, 1.16));
        highTarget = clamp01(Math.pow(highRaw * 1.28, 1.2));

        const binHz = analyser.context.sampleRate / analyser.fftSize;
        const fluxStart = Math.max(1, Math.ceil(28 / binHz));
        const fluxEnd = Math.min(spectrum.length - 1, Math.floor(5200 / binHz));
        let flux = 0;
        let totalFluxWeight = 0;
        const wasPrimed = spectrumPrimed;
        for (let bin = fluxStart; bin <= fluxEnd; bin++) {
          const value = Math.pow(spectrum[bin] / 255, 1.35);
          const rise = value - previousSpectrum[bin];
          previousSpectrum[bin] = value;
          const hz = bin * binHz;
          const weight = hz < 220 ? 2.15 : hz < 2000 ? 1.1 : 0.72;
          totalFluxWeight += weight;
          if (rise > 0) {
            flux += rise * weight;
          }
        }
        if (totalFluxWeight === 0) {
          throw new Error(
            `Fullscreen visualizer cannot analyze 28-5200 Hz with FFT ${analyser.fftSize}.`,
          );
        }
        flux /= totalFluxWeight;
        spectrumPrimed = true;

        const bassRise = Math.max(0, bassRaw - lastBassRaw);
        bassFast = approach(bassFast, bassRaw, deltaMs, 45);
        bassSlow = approach(bassSlow, bassRaw, deltaMs, 520);
        const bassAccent = Math.max(0, bassFast - bassSlow);

        if (wasPrimed) {
          const stats = recentFluxStats(now);
          const threshold = stats.center + Math.max(0.00055, stats.deviation * 3.2);
          const normalizedFlux = clamp01(
            (flux - stats.center) / Math.max(0.0012, stats.deviation * 6),
          );
          onsetTarget = clamp01(
            normalizedFlux * 0.76 + bassRise * 4.4 + bassAccent * 1.5,
          );

          const detectorReady =
            stats.count >= 6 && stats.age >= DETECTOR_WARMUP_MS;
          const bassLed = bassRise > 0.008 || bassAccent > 0.032;
          const strongBroadOnset =
            flux > stats.center + Math.max(0.002, stats.deviation * 6.5);
          const beatDetected =
            detectorReady &&
            now - lastBeatAt >= 165 &&
            flux > threshold &&
            (bassLed || strongBroadOnset);

          if (beatDetected) {
            const excess = clamp01(
              (flux - threshold) / Math.max(0.0016, stats.deviation * 7),
            );
            const strength = clamp01(
              0.28 + excess * 0.58 + bassRise * 3.5 + bassAccent * 1.2,
            );
            beatPulse = Math.max(beatPulse, strength);
            lastBeatAt = now;
            shockwaves.push({
              age: 0,
              life: 620 + strength * 260,
              strength,
              colorIndex: Math.floor(random() * palette.length),
            });
            const sparkCount = 6 + Math.round(strength * 7 + highTarget * 4);
            for (let i = 0; i < sparkCount; i++) {
              sparks.push({
                angle: random() * TAU,
                distance: 8 + random() * 8,
                speed: 55 + random() * (95 + strength * 80),
                drift: (random() - 0.5) * 0.8,
                age: 0,
                life: 520 + random() * 720,
                size: 1.2 + random() * (2.2 + highTarget * 2.2),
                colorIndex: Math.floor(random() * palette.length),
              });
            }
          }

          fluxHistory[fluxCursor] = flux;
          fluxTimes[fluxCursor] = now;
          fluxCursor = (fluxCursor + 1) % FLUX_HISTORY;
          fluxCount = Math.min(FLUX_HISTORY, fluxCount + 1);
        }

        lastBassRaw = bassRaw;

        const lowHz = 34;
        const highHz = Math.min(16000, analyser.context.sampleRate * 0.46);
        const ratio = highHz / lowHz;
        for (let band = 0; band < SPECTRUM_BANDS; band++) {
          const bandLow = lowHz * Math.pow(ratio, band / SPECTRUM_BANDS);
          const bandHigh = lowHz * Math.pow(ratio, (band + 1) / SPECTRUM_BANDS);
          const raw = rangeLevel(spectrum, analyser, bandLow, bandHigh);
          bandTargets[band] = clamp01(Math.pow(raw * 1.38, 1.18));
        }
      } else {
        if (liveLastFrame) {
          resetBeatDetector();
        }
        for (let band = 0; band < SPECTRUM_BANDS; band++) {
          const wave = 0.5 + 0.5 * Math.sin(now * 0.0007 + band * 0.42);
          bandTargets[band] = reduced ? 0.045 : 0.035 + wave * 0.035;
        }
      }
      liveLastFrame = live;

      bass = approach(bass, bassTarget, deltaMs, bassTarget > bass ? 38 : 230);
      mids = approach(mids, midTarget, deltaMs, midTarget > mids ? 44 : 190);
      highs = approach(highs, highTarget, deltaMs, highTarget > highs ? 34 : 150);
      onset = approach(onset, onsetTarget, deltaMs, onsetTarget > onset ? 24 : 135);
      const energyTarget = bassTarget * 0.46 + midTarget * 0.34 + highTarget * 0.2;
      energy = approach(energy, energyTarget, deltaMs, energyTarget > energy ? 55 : 260);
      beatPulse *= Math.exp(-deltaMs / 190);
      beatPulse = Math.max(beatPulse, onset * 0.28);

      for (let band = 0; band < SPECTRUM_BANDS; band++) {
        const target = bandTargets[band];
        bandLevels[band] = approach(
          bandLevels[band],
          target,
          deltaMs,
          target > bandLevels[band] ? 32 : 210,
        );
        bandPeaks[band] = Math.max(
          bandLevels[band],
          bandPeaks[band] - (deltaMs / 1000) * 0.48,
        );
      }
    }

    function updateEffects(deltaMs: number) {
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        shockwaves[i].age += deltaMs;
        if (shockwaves[i].age >= shockwaves[i].life) shockwaves.splice(i, 1);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i];
        spark.age += deltaMs;
        spark.distance += spark.speed * (deltaMs / 1000);
        if (spark.age >= spark.life) sparks.splice(i, 1);
      }
    }

    function draw(now: number) {
      ctx.clearRect(0, 0, width, height);
      const time = now / 1000;

      drawBloom(centerX, centerY, coverRadius);
      drawShockwaves(centerX, centerY, coverRadius);
      drawOrbit(centerX, centerY, coverRadius, time);
      drawSparks(centerX, centerY, coverRadius);
      drawFloorSpectrum(time);
      drawVignette();
    }

    function drawBloom(cx: number, cy: number, radius: number) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const bloomRadius = Math.max(radius * (2.2 + beatPulse * 0.35), 180);
      const bloom = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, bloomRadius);
      bloom.addColorStop(0, glow);
      bloom.addColorStop(0.25, palette[Math.min(1, palette.length - 1)]);
      bloom.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.055 + energy * 0.13 + beatPulse * 0.12;
      ctx.fillStyle = bloom;
      ctx.fillRect(cx - bloomRadius, cy - bloomRadius, bloomRadius * 2, bloomRadius * 2);

      if (beatPulse > 0.04) {
        const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.25);
        flash.addColorStop(0, "white");
        flash.addColorStop(0.22, glow);
        flash.addColorStop(1, "transparent");
        ctx.globalAlpha = beatPulse * 0.14;
        ctx.fillStyle = flash;
        ctx.fillRect(cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6);
      }
      ctx.restore();
    }

    function drawShockwaves(cx: number, cy: number, radius: number) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const wave of shockwaves) {
        const progress = wave.age / wave.life;
        const eased = 1 - Math.pow(1 - progress, 3);
        const waveRadius = radius + 16 + eased * radius * 1.55;
        ctx.beginPath();
        ctx.arc(cx, cy, waveRadius, 0, TAU);
        ctx.strokeStyle = palette[wave.colorIndex % palette.length];
        ctx.globalAlpha = Math.pow(1 - progress, 2) * wave.strength * 0.62;
        ctx.lineWidth = Math.max(1, (1 - progress) * 4.5);
        ctx.shadowColor = glow;
        ctx.shadowBlur = 18;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawOrbit(cx: number, cy: number, radius: number, time: number) {
      if (!orbitGradient) {
        throw new Error("Fullscreen visualizer orbit gradient was not initialized.");
      }
      const rayCount = width < 560 ? 64 : 96;
      const baseRadius = radius + Math.max(12, radius * 0.055) + beatPulse * 4;
      const maxRay = Math.max(22, Math.min(72, radius * 0.3));

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = orbitGradient;
      ctx.lineCap = "round";
      ctx.shadowColor = glow;
      ctx.shadowBlur = 4 + beatPulse * 8;
      for (let ray = 0; ray < rayCount; ray++) {
        const phase = ray / rayCount;
        const mirrored = Math.abs(phase * 2 - 1);
        const bandPosition = mirrored * (SPECTRUM_BANDS - 1);
        const lowerBand = Math.floor(bandPosition);
        const upperBand = Math.min(SPECTRUM_BANDS - 1, lowerBand + 1);
        const bandMix = bandPosition - lowerBand;
        const level =
          bandLevels[lowerBand] * (1 - bandMix) + bandLevels[upperBand] * bandMix;
        const shimmer = Math.sin(time * 1.7 + ray * 0.31) * 0.5 + 0.5;
        const rayLength = 4 + level * maxRay + beatPulse * (4 + shimmer * 9);
        const angle = phase * TAU - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * baseRadius, cy + Math.sin(angle) * baseRadius);
        ctx.lineTo(
          cx + Math.cos(angle) * (baseRadius + rayLength),
          cy + Math.sin(angle) * (baseRadius + rayLength),
        );
        ctx.globalAlpha = 0.2 + level * 0.58 + beatPulse * 0.08;
        ctx.lineWidth = 1.25 + level * 2.5;
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.setLineDash([Math.max(10, radius * 0.09), Math.max(18, radius * 0.15)]);
      for (let orbit = 0; orbit < 2; orbit++) {
        const orbitRadius = baseRadius + maxRay * (0.62 + orbit * 0.37);
        const rotation = time * (orbit === 0 ? 0.18 : -0.11) + orbit * 1.7;
        ctx.beginPath();
        ctx.arc(cx, cy, orbitRadius, rotation, rotation + TAU * (0.66 + highs * 0.18));
        ctx.strokeStyle = palette[(orbit + 1) % palette.length];
        ctx.globalAlpha = 0.12 + highs * 0.25 + beatPulse * 0.08;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawSparks(cx: number, cy: number, radius: number) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const spark of sparks) {
        const progress = spark.age / spark.life;
        const alpha = Math.sin(progress * Math.PI) * (0.36 + highs * 0.5);
        const angle = spark.angle + spark.drift * progress;
        const distance = radius + spark.distance;
        const tail = 5 + spark.speed * 0.035;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(cx + cos * (distance - tail), cy + sin * (distance - tail));
        ctx.lineTo(cx + cos * distance, cy + sin * distance);
        ctx.strokeStyle = palette[spark.colorIndex % palette.length];
        ctx.globalAlpha = alpha;
        ctx.lineWidth = spark.size * (1 - progress * 0.65);
        ctx.shadowColor = palette[spark.colorIndex % palette.length];
        ctx.shadowBlur = 8;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawFloorSpectrum(time: number) {
      if (!floorGradient) {
        throw new Error("Fullscreen visualizer floor gradient was not initialized.");
      }
      const barCount = width < 560 ? 40 : width < 1050 ? 64 : 80;
      const slot = width / barCount;
      const barWidth = Math.max(1.5, slot * 0.46);
      const maxBarHeight = Math.min(96, height * 0.15);
      const floor = height - 1;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = floorGradient;
      ctx.lineCap = "round";
      ctx.lineWidth = barWidth;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 5 + beatPulse * 6;
      for (let bar = 0; bar < barCount; bar++) {
        const centerDistance = Math.abs((bar + 0.5) / barCount - 0.5) * 2;
        const bandPosition = centerDistance * (SPECTRUM_BANDS - 1);
        const lowerBand = Math.floor(bandPosition);
        const upperBand = Math.min(SPECTRUM_BANDS - 1, lowerBand + 1);
        const bandMix = bandPosition - lowerBand;
        const level =
          bandLevels[lowerBand] * (1 - bandMix) + bandLevels[upperBand] * bandMix;
        const idle = 0.5 + 0.5 * Math.sin(time * 0.8 + bar * 0.27);
        const value = Math.max(level, playingRef.current ? 0 : 0.025 + idle * 0.02);
        const barHeight = 2 + value * maxBarHeight + beatPulse * bass * 18;
        const x = (bar + 0.5) * slot;
        ctx.beginPath();
        ctx.moveTo(x, floor + barWidth);
        ctx.lineTo(x, floor - barHeight);
        ctx.globalAlpha = 0.3 + value * 0.42;
        ctx.stroke();

        const peak =
          bandPeaks[lowerBand] * (1 - bandMix) + bandPeaks[upperBand] * bandMix;
        const peakY = floor - 2 - peak * maxBarHeight;
        ctx.beginPath();
        ctx.moveTo(x, peakY);
        ctx.lineTo(x, peakY - 0.5);
        ctx.globalAlpha = 0.16 + value * 0.3;
        ctx.lineWidth = Math.max(1, barWidth * 0.62);
        ctx.stroke();
        ctx.lineWidth = barWidth;
      }
      ctx.restore();
    }

    function drawVignette() {
      if (!vignetteGradient) {
        throw new Error("Fullscreen visualizer vignette was not initialized.");
      }
      ctx.fillStyle = vignetteGradient;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, width, height);
    }

    function applySurfaceStyles(now: number) {
      const kick = clamp01(beatPulse);
      const scale = 1 + bass * 0.018 + kick * 0.048;
      const coverSpread = 45 + energy * 80 + kick * 80;
      const coverAlpha = 0.26 + energy * 0.42 + kick * 0.2;
      cover.style.transform = `translateZ(0) scale(${scale.toFixed(4)})`;
      cover.style.boxShadow =
        `0 0 ${coverSpread.toFixed(1)}px rgba(${red}, ${green}, ${blue}, ${coverAlpha.toFixed(3)}), ` +
        `0 0 ${(18 + kick * 28).toFixed(1)}px rgba(255, 255, 255, ${(kick * 0.13).toFixed(3)})`;

      // The large panel shadow is paint-heavy, so update it at 15 fps while
      // the composited cover pulse and canvas continue at the render cadence.
      if (now - lastPanelStyleAt < 1000 / 15) return;
      lastPanelStyleAt = now;
      const panelSpread = 16 + energy * 34 + kick * 38;
      const panelAlpha = 0.07 + energy * 0.18 + kick * 0.2;
      panel.style.boxShadow =
        `0 0 ${panelSpread.toFixed(1)}px rgba(${red}, ${green}, ${blue}, ${panelAlpha.toFixed(3)}), ` +
        `inset 0 0 ${(18 + energy * 30).toFixed(1)}px rgba(${red}, ${green}, ${blue}, ${(0.025 + energy * 0.055).toFixed(3)})`;
      panel.style.borderColor = `rgba(${red}, ${green}, ${blue}, ${(0.18 + energy * 0.24 + kick * 0.18).toFixed(3)})`;
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (nextFrameAt !== 0 && now < nextFrameAt) return;
      nextFrameAt =
        nextFrameAt === 0 || now - nextFrameAt > FRAME_INTERVAL_MS
          ? now + FRAME_INTERVAL_MS
          : nextFrameAt + FRAME_INTERVAL_MS;

      const elapsed = lastFrameAt === 0 ? FRAME_INTERVAL_MS : now - lastFrameAt;
      if (elapsed > 120) resetBeatDetector();
      const deltaMs = elapsed > 120 ? FRAME_INTERVAL_MS : Math.min(50, Math.max(1, elapsed));
      lastFrameAt = now;
      readAudio(deltaMs, now);
      updateEffects(deltaMs);
      draw(now);
      applySurfaceStyles(now);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(cv);
    observer.observe(cover);
    const scroller = cover.closest<HTMLElement>("[data-np-scroll]");
    if (!scroller) {
      throw new Error("Fullscreen visualizer could not find its scrolling panel.");
    }
    const onScroll = () => {
      updateGeometry();
      if (reduced) draw(0);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    const renderReduced = () => {
      bass = 0;
      mids = 0;
      highs = 0;
      energy = 0;
      onset = 0;
      beatPulse = 0;
      shockwaves.length = 0;
      sparks.length = 0;
      resetBeatDetector();
      for (let band = 0; band < SPECTRUM_BANDS; band++) {
        bandLevels[band] = 0.045;
        bandPeaks[band] = 0.045;
      }
      draw(0);
      lastPanelStyleAt = -Infinity;
      applySurfaceStyles(0);
    };
    const onMotionChange = (event: MediaQueryListEvent) => {
      reduced = event.matches;
      cancelAnimationFrame(raf);
      if (reduced) {
        renderReduced();
      } else {
        lastFrameAt = 0;
        nextFrameAt = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    motionQuery.addEventListener("change", onMotionChange);
    resize();

    if (reduced) {
      renderReduced();
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      scroller.removeEventListener("scroll", onScroll);
      cover.style.removeProperty("transform");
      cover.style.removeProperty("box-shadow");
      panel.style.removeProperty("box-shadow");
      panel.style.removeProperty("border-color");
    };
  }, [anchorRef, colors, glow, rgb, surfaceRef]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      role="presentation"
    />
  );
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function approach(current: number, target: number, deltaMs: number, timeMs: number) {
  return current + (target - current) * (1 - Math.exp(-deltaMs / timeMs));
}
