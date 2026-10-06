import { getAnalyser } from "./audioAnalyser";
import { createVisualizerSignal, sampleSpectrum, type VisualizerSignal } from "./visualizerSignal";

export interface AudioSpectrumFrame {
  readonly bands: Float32Array;
  readonly bass: number;
  readonly mid: number;
  readonly treble: number;
  readonly energy: number;
  readonly onset: number;
  readonly active: boolean;
  readonly deltaSeconds: number;
  readonly timeSeconds: number;
}
type Listener = (frame: AudioSpectrumFrame) => void;
interface SpectrumRuntime {
  readAnalyser: () => AnalyserNode | null;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  motion: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
}
const FRAME_INTERVAL_MS = 1000 / 30;
const EMPTY_FRAME: AudioSpectrumFrame = {
  bands: new Float32Array(48), bass: 0, mid: 0, treble: 0, energy: 0,
  onset: 0, active: false, deltaSeconds: 0, timeSeconds: 0,
};

/** One FFT read shared by every inline indicator and fullscreen scene. */
export function createAudioSpectrumSource(runtime: SpectrumRuntime) {
  const listeners = new Set<Listener>();
  let frame: AudioSpectrumFrame = { ...EMPTY_FRAME, bands: new Float32Array(48) };
  let node: AnalyserNode | null = null;
  let signal: VisualizerSignal | null = null;
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  let raf: number | null = null;
  let lastSample: number | null = null;
  let attached = false;
  const allowed = () => runtime.document.visibilityState === "visible" && !runtime.motion.matches;
  function publish() {
    const failures: unknown[] = [];
    for (const listener of listeners) {
      try { listener(frame); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Audio spectrum consumer failed.");
  }
  function stop() {
    if (raf !== null) runtime.cancelFrame(raf);
    raf = null;
    lastSample = null;
  }
  function reset() {
    node = null;
    signal = null;
    bytes = null;
    frame = { ...EMPTY_FRAME, bands: frame.bands };
    frame.bands.fill(0);
  }
  function schedule() {
    if (raf === null && listeners.size && allowed()) raf = runtime.requestFrame(tick);
  }
  function tick(timestamp: number) {
    raf = null;
    if (!listeners.size || !allowed()) return;
    schedule();
    if (lastSample !== null && timestamp - lastSample < FRAME_INTERVAL_MS - 1) return;
    const deltaMs = lastSample === null ? FRAME_INTERVAL_MS : Math.min(timestamp - lastSample, 100);
    lastSample = timestamp;
    const current = runtime.readAnalyser();
    if (!current || current.context.state !== "running") {
      reset();
      frame = { ...frame, deltaSeconds: deltaMs / 1000, timeSeconds: timestamp / 1000 };
      publish();
      return;
    }
    if (node !== current || !signal || signal.fftSize !== current.fftSize || signal.sampleRate !== current.context.sampleRate) {
      node = current;
      signal = createVisualizerSignal({ frequencyBinCount: current.frequencyBinCount, fftSize: current.fftSize, sampleRate: current.context.sampleRate });
      bytes = new Uint8Array(current.frequencyBinCount);
    }
    if (!bytes) throw new Error("Audio spectrum FFT buffer was not initialized.");
    current.getByteFrequencyData(bytes);
    sampleSpectrum(signal, bytes, deltaMs);
    frame = {
      bands: signal.bands, bass: signal.bass, mid: signal.mid, treble: signal.treble,
      energy: signal.energy, onset: signal.transient, active: true,
      deltaSeconds: deltaMs / 1000, timeSeconds: timestamp / 1000,
    };
    publish();
  }
  function refresh() {
    if (allowed()) schedule();
    else { stop(); reset(); publish(); }
  }
  function detach() {
    stop();
    reset();
    if (attached) {
      runtime.document.removeEventListener("visibilitychange", refresh);
      runtime.motion.removeEventListener("change", refresh);
      attached = false;
    }
  }
  return {
    getFrame: () => frame,
    subscribe(listener: Listener) {
      if (listeners.has(listener)) throw new Error("Audio spectrum listener was subscribed twice.");
      listeners.add(listener);
      if (!attached) {
        runtime.document.addEventListener("visibilitychange", refresh);
        runtime.motion.addEventListener("change", refresh);
        attached = true;
      }
      try { listener(frame); } catch (error) {
        listeners.delete(listener);
        if (!listeners.size) detach();
        throw error;
      }
      schedule();
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        listeners.delete(listener);
        if (!listeners.size) detach();
      };
    },
  };
}
let source: ReturnType<typeof createAudioSpectrumSource> | null = null;
export function getAudioSpectrum(): AudioSpectrumFrame { return source?.getFrame() ?? EMPTY_FRAME; }
export function subscribeAudioSpectrum(listener: Listener): () => void {
  if (typeof window === "undefined") throw new Error("Live audio spectrum subscriptions require a browser.");
  source ??= createAudioSpectrumSource({
    readAnalyser: getAnalyser,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    document,
    motion: window.matchMedia("(prefers-reduced-motion: reduce)"),
  });
  return source.subscribe(listener);
}
