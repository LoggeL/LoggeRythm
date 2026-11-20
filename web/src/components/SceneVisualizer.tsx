"use client";

import { useEffect, useRef, type RefObject } from "react";
import { getAudioSpectrum, subscribeAudioSpectrum, type AudioSpectrumFrame } from "@/lib/audioSpectrum";
import {
  DEFAULT_VISUALIZER_PALETTE, advanceDrive, blendColors, createDriveTracker, ingestSpectrum, paletteColors,
  type PaletteSource, type VisualizerColors,
} from "@/lib/visualizerDrive";
import { SCENE_RENDERERS, focusAroundArtwork, type Rgb, type SceneColors, type SceneState } from "@/lib/sceneRenderers";
import { sceneFingerprint, type SceneKey } from "@/lib/visualizerScenes";
import type { VisualizerStatus } from "@/components/FullscreenVisualizer";

export type CanvasSceneKey = Exclude<SceneKey, "aura">;

interface SceneVisualizerProps {
  scene: CanvasSceneKey;
  isPlaying: boolean;
  /** The artwork the scene is composed around. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Cover palette; `null` while sampling or without a cover. */
  palette: PaletteSource | null;
  /** Seeds the per-song variation of the scene. */
  trackId: string;
  className?: string;
  onStatusChange?: (status: VisualizerStatus) => void;
}

/** Canvas 2D at full retina would cost a lot of fill for soft shapes. */
const MAX_DENSITY = 1.25;
const CROSSFADE_SECONDS = 0.6;
/** Pace of beat-locked motion until kicks reveal the tempo. */
const START_TEMPO = 120;
const SILENT: Pick<AudioSpectrumFrame, "bands" | "bass" | "mid" | "treble" | "energy" | "active" | "timeSeconds"> = {
  bands: new Float32Array(48), bass: 0, mid: 0, treble: 0, energy: 0, active: false, timeSeconds: 0,
};

function toSrgb(linear: number) {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, c)) * 255);
}
function sceneColors(colors: VisualizerColors): SceneColors {
  const at = (index: number): Rgb => [toSrgb(colors[index * 3]), toSrgb(colors[index * 3 + 1]), toSrgb(colors[index * 3 + 2])];
  return { deep: at(0), primary: at(1), secondary: at(2), light: at(3) };
}

/** Median kick interval → tempo, folded into 70..190 BPM. */
function tempoFromKicks(kicks: readonly number[]): number | null {
  if (kicks.length < 5) return null;
  const gaps = kicks.slice(1).map((t, i) => t - kicks[i]).filter((g) => g > 0.2 && g < 2).sort((a, b) => a - b);
  if (gaps.length < 4) return null;
  let bpm = 60 / gaps[Math.floor(gaps.length / 2)];
  while (bpm < 70) bpm *= 2;
  while (bpm > 190) bpm /= 2;
  return bpm;
}

/**
 * The genre scenes of the fullscreen visualizer (everything except the WebGL
 * "Aura", see FullscreenVisualizer): one transparent Canvas 2D layer behind
 * the whole player, composed around the artwork and driven by the shared FFT.
 */
export default function SceneVisualizer({ scene, isPlaying, anchorRef, palette, trackId, className = "", onStatusChange }: SceneVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(isPlaying);
  const paletteRef = useRef(palette);
  const sceneRef = useRef(scene);
  const fingerprintRef = useRef(sceneFingerprint(trackId));
  const statusRef = useRef(onStatusChange);
  const syncRef = useRef<(() => void) | null>(null);
  const sceneSyncRef = useRef<(() => void) | null>(null);

  useEffect(() => { playingRef.current = isPlaying; syncRef.current?.(); }, [isPlaying]);
  useEffect(() => { paletteRef.current = palette; syncRef.current?.(); }, [palette]);
  useEffect(() => { sceneRef.current = scene; sceneSyncRef.current?.(); }, [scene]);
  useEffect(() => { fingerprintRef.current = sceneFingerprint(trackId); syncRef.current?.(); }, [trackId]);
  useEffect(() => { statusRef.current = onStatusChange; }, [onStatusChange]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) throw new Error("Scene visualizer requires its mounted canvas.");
    const canvas = element;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Der Visualizer braucht einen Canvas-2D-Kontext, aber der Browser stellt keinen bereit.");
    const ctx = context;
    const snapshot = document.createElement("canvas");
    const snapshotContext = snapshot.getContext("2d");
    if (!snapshotContext) throw new Error("Der Visualizer konnte keinen Canvas für den Szenenwechsel anlegen.");

    const tracker = createDriveTracker();
    const colors = paletteColors(paletteRef.current ?? DEFAULT_VISUALIZER_PALETTE);
    let targetColors = paletteColors(paletteRef.current ?? DEFAULT_VISUALIZER_PALETTE);
    let activeScene = sceneRef.current;
    let state: SceneState = {};
    let crossfade = 0;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    let visible = document.visibilityState === "visible";
    let disposed = false;
    let running = false;
    let raf = 0;
    let last = 0;
    let unsubscribe: (() => void) | null = null;
    let spectrum: Pick<AudioSpectrumFrame, "active"> = getAudioSpectrum();
    let status: VisualizerStatus | null = null;
    let observedAnchor: HTMLElement | null = null;

    let clock = 0;
    let beatPosition = 0;
    let tempo = START_TEMPO;
    let seenBeats = 0;
    const kicks: number[] = [];
    let lastHitAttack = 0;
    let lastHit = -Infinity;
    const bands = new Float32Array(48);
    const view = { width: 1, height: 1, cx: 0, cy: 0, half: 1, corner: 0, scale: 1 };

    function publishStatus() {
      const next: VisualizerStatus = reduced ? "reduced" : !playingRef.current ? "paused" : spectrum.active ? "live" : "waiting";
      if (next !== status) { status = next; statusRef.current?.(next); }
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio, MAX_DENSITY);
      const width = Math.max(1, Math.round(bounds.width * scale));
      const height = Math.max(1, Math.round(bounds.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        state = {};
      }
    }

    function measure() {
      const anchor = anchorRef.current;
      if (!anchor) throw new Error("Scene visualizer lost its artwork anchor while it was still mounted.");
      if (anchor !== observedAnchor) {
        if (observedAnchor) resizeObserver.unobserve(observedAnchor);
        resizeObserver.observe(anchor);
        observedAnchor = anchor;
      }
      const bounds = canvas.getBoundingClientRect();
      const box = anchor.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || box.width <= 0 || box.height <= 0) {
        throw new Error(`Scene visualizer needs a visible canvas and artwork (canvas ${bounds.width}×${bounds.height}, artwork ${box.width}×${box.height}).`);
      }
      const radius = parseFloat(getComputedStyle(anchor).borderTopLeftRadius);
      if (!Number.isFinite(radius)) throw new Error("Scene visualizer could not read the artwork's corner radius.");
      const scale = canvas.width / bounds.width;
      view.width = canvas.width;
      view.height = canvas.height;
      view.cx = (box.left - bounds.left + box.width / 2) * scale;
      view.cy = (box.top - bounds.top + box.height / 2) * scale;
      view.half = (box.width / 2) * scale;
      view.corner = radius / (box.width / 2);
      view.scale = scale;
    }

    function draw(dt: number) {
      measure();
      const drive = tracker.drive;
      for (let i = 0; i < bands.length; i++) bands[i] = drive.spectrum[i] / 255;
      const kickEdge = drive.beats !== seenBeats;
      if (kickEdge) {
        seenBeats = drive.beats;
        kicks.push(clock);
        if (kicks.length > 12) kicks.shift();
        tempo = tempoFromKicks(kicks) ?? tempo;
      }
      const attack = (drive.mid + drive.treble) / 2;
      const hitEdge = attack - lastHitAttack > 0.16 && clock - lastHit > 0.12;
      if (hitEdge) lastHit = clock;
      lastHitAttack = attack;
      ctx.save();
      SCENE_RENDERERS[activeScene](ctx, view, {
        bands, bass: drive.bass, mid: drive.mid, treble: drive.treble, level: drive.level,
        kick: drive.beat, kickEdge, hitEdge, time: clock, beatPosition, tempo, reduced,
      }, state, fingerprintRef.current, sceneColors(colors), dt);
      ctx.restore();
      if (crossfade > 0) {
        ctx.globalAlpha = crossfade / CROSSFADE_SECONDS;
        ctx.drawImage(snapshot, 0, 0, view.width, view.height);
        ctx.globalAlpha = 1;
      }
      focusAroundArtwork(ctx, view);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    function start() {
      if (running || disposed || !visible || reduced) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }

    function frame(now: number) {
      if (!running || disposed) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      const animating = advanceDrive(tracker, dt);
      const recolouring = blendColors(colors, targetColors, dt);
      if (tracker.live) {
        clock += dt;
        beatPosition += dt * tempo / 60;
      }
      crossfade = Math.max(0, crossfade - dt);
      draw(dt);
      if (animating || recolouring || crossfade > 0) raf = requestAnimationFrame(frame);
      else stop();
    }

    function onSpectrum(next: AudioSpectrumFrame) {
      spectrum = next;
      ingestSpectrum(tracker, next);
      publishStatus();
      if (next.active) start();
    }

    function sync() {
      if (disposed) return;
      targetColors = paletteColors(paletteRef.current ?? DEFAULT_VISUALIZER_PALETTE);
      const eligible = playingRef.current && visible && !reduced;
      if (eligible && !unsubscribe) unsubscribe = subscribeAudioSpectrum(onSpectrum);
      else if (!eligible && unsubscribe) {
        const release = unsubscribe;
        unsubscribe = null;
        release();
      }
      if (!eligible) { spectrum = SILENT; ingestSpectrum(tracker, SILENT); }
      publishStatus();
      if (!visible) { stop(); return; }
      if (reduced) {
        stop();
        colors.set(targetColors);
        draw(0);
        return;
      }
      start();
    }

    function syncScene() {
      if (disposed || sceneRef.current === activeScene) return;
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshotContext!.clearRect(0, 0, snapshot.width, snapshot.height);
      snapshotContext!.drawImage(canvas, 0, 0);
      activeScene = sceneRef.current;
      state = {};
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (reduced) { draw(0); return; }
      crossfade = CROSSFADE_SECONDS;
      start();
    }

    function onResize() {
      if (disposed) return;
      resize();
      if (!running && visible) draw(0);
    }
    function onVisibilityChange() { visible = document.visibilityState === "visible"; sync(); }
    function onMotionChange(event: MediaQueryListEvent) { reduced = event.matches; sync(); }

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", onMotionChange);
    syncRef.current = sync;
    sceneSyncRef.current = syncScene;
    resize();
    sync();
    return () => {
      disposed = true;
      syncRef.current = null;
      sceneSyncRef.current = null;
      stop();
      unsubscribe?.();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, [anchorRef]);

  return <canvas ref={canvasRef} className={className} aria-hidden role="presentation" data-visualizer="" data-scene={scene} />;
}
