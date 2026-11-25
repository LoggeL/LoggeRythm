/**
 * Shared Web Audio graph for the player's two <audio> decks:
 *
 *   deckA ─┬─> analysisGainA ──┐
 *          └─> outputGainA  ───┼─> analyser (passive tap, pre-EQ & volume-independent)
 *                              │
 *   deckB ─┬─> analysisGainB ──┘
 *          └─> outputGainB  ───> masterBus ─> [5x BiquadFilter EQ] ─> [Compressor/Bypass] ─> destination
 *
 * `ensureAnalyser` wires each <audio> element once per lifetime (browsers allow
 * only one MediaElementAudioSourceNode per element). Crossfades schedule sample-
 * accurate equal-power curves directly onto `outputGain` and `analysisGain` via
 * `AudioParam.setValueCurveAtTime`, eliminating background-tab timer stutter.
 */

import {
  DEFAULT_AUDIO_EFFECTS,
  EQ_BANDS,
  type AudioEffectsSettings,
} from "./audioEffects";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let masterBus: GainNode | null = null;
let eqFilters: BiquadFilterNode[] = [];
let compressor: DynamicsCompressorNode | null = null;
let dryGain: GainNode | null = null;
let wetGain: GainNode | null = null;
let currentEffects: AudioEffectsSettings = {
  ...DEFAULT_AUDIO_EFFECTS,
  bands: [...DEFAULT_AUDIO_EFFECTS.bands] as [number, number, number, number, number],
};

const decks = new Map<
  HTMLAudioElement,
  {
    source: MediaElementAudioSourceNode;
    outputGain: GainNode;
    analysisGain: GainNode;
  }
>();
const pendingRelease = new Map<HTMLAudioElement, number>();

function getCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WebkitWindow).webkitAudioContext ?? null;
}

function syncEffectsToGraph(): void {
  if (!ctx || eqFilters.length !== EQ_BANDS.length || !dryGain || !wetGain) return;
  const now = ctx.currentTime;
  for (let i = 0; i < eqFilters.length; i++) {
    const targetDb = currentEffects.eqEnabled ? currentEffects.bands[i] : 0;
    eqFilters[i].gain.setTargetAtTime(targetDb, now, 0.015);
  }
  const wet = currentEffects.compressorEnabled ? 1 : 0;
  wetGain.gain.setTargetAtTime(wet, now, 0.02);
  dryGain.gain.setTargetAtTime(1 - wet, now, 0.02);
}

function ensureMasterChain(audioCtx: AudioContext): GainNode {
  if (masterBus) return masterBus;
  masterBus = audioCtx.createGain();
  masterBus.gain.value = 1;

  eqFilters = EQ_BANDS.map((band) => {
    const filter = audioCtx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.freq;
    if (band.type === "peaking") filter.Q.value = 1.1;
    filter.gain.value = 0;
    return filter;
  });

  // Chain masterBus -> filter[0] -> ... -> filter[4]
  let tail: AudioNode = masterBus;
  for (const filter of eqFilters) {
    tail.connect(filter);
    tail = filter;
  }

  // Parallel dry/wet Late-Night compressor stage (click-free cross-switch).
  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.2;

  dryGain = audioCtx.createGain();
  dryGain.gain.value = 1;
  wetGain = audioCtx.createGain();
  wetGain.gain.value = 0;

  tail.connect(dryGain);
  dryGain.connect(audioCtx.destination);
  tail.connect(compressor);
  compressor.connect(wetGain);
  wetGain.connect(audioCtx.destination);

  syncEffectsToGraph();
  return masterBus;
}

/**
 * Wire the given audio element into the shared analyser + effects graph (once
 * per element) and resume the AudioContext.
 */
export function ensureAnalyser(el: HTMLAudioElement | null): AnalyserNode | null {
  const Ctor = getCtor();
  if (!Ctor) return analyser;
  if (el) {
    const releaseTimer = pendingRelease.get(el);
    if (releaseTimer !== undefined) {
      window.clearTimeout(releaseTimer);
      pendingRelease.delete(el);
    }
  }

  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  if (!analyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -8;
  }

  const bus = ensureMasterChain(ctx);

  if (el && !decks.has(el)) {
    try {
      const source = ctx.createMediaElementSource(el);
      const outputGain = ctx.createGain();
      const analysisGain = ctx.createGain();
      outputGain.gain.value = el.volume;
      analysisGain.gain.value = 1;
      el.volume = 1;
      source.connect(analysisGain);
      analysisGain.connect(analyser);
      source.connect(outputGain);
      outputGain.connect(bus);
      decks.set(el, { source, outputGain, analysisGain });
    } catch {
      // Element already routed elsewhere (or unsupported) — leave it be.
    }
  }

  return analyser;
}

/** Apply EQ bands + Late-Night compressor live to the master audio chain. */
export function applyAudioEffects(settings: AudioEffectsSettings): void {
  currentEffects = {
    ...settings,
    bands: [...settings.bands] as [number, number, number, number, number],
  };
  syncEffectsToGraph();
}

/** Set playback speed on an audio deck (preserving pitch when supported). */
export function applyPlaybackRate(el: HTMLAudioElement | null, rate: number): void {
  if (!el) return;
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 2.5) {
    throw new RangeError(`Playback rate must be between 0.5 and 2.5; received ${rate}.`);
  }
  if (el.playbackRate !== rate) el.playbackRate = rate;
  if (el.defaultPlaybackRate !== rate) el.defaultPlaybackRate = rate;
  const mediaWithPitch = el as HTMLAudioElement & { preservesPitch?: boolean };
  if ("preservesPitch" in mediaWithPitch) {
    mediaWithPitch.preservesPitch = true;
  }
}

/**
 * Set an element's output volume (0..1) and its contribution to the shared
 * analyser (0..1), cancelling any active gain automation first.
 */
export function applyVolume(
  el: HTMLAudioElement | null,
  v: number,
  analysisWeight = 1,
): void {
  if (!el) return;
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new RangeError(`Audio output gain must be between 0 and 1; received ${v}.`);
  }
  if (!Number.isFinite(analysisWeight) || analysisWeight < 0 || analysisWeight > 1) {
    throw new RangeError(
      `Audio analysis weight must be between 0 and 1; received ${analysisWeight}.`,
    );
  }
  const deck = decks.get(el);
  if (deck && ctx) {
    const now = ctx.currentTime;
    el.volume = 1;
    deck.outputGain.gain.cancelScheduledValues(now);
    deck.outputGain.gain.setValueAtTime(v, now);
    deck.analysisGain.gain.cancelScheduledValues(now);
    deck.analysisGain.gain.setValueAtTime(analysisWeight, now);
  } else {
    el.volume = v;
  }
}

/**
 * Schedule sample-accurate crossfade curves directly on a deck's Web Audio
 * GainNodes (immune to background-tab timer throttling). Returns true when
 * scheduled on Web Audio, or false if the deck is not yet routed through Web Audio.
 */
export function scheduleDeckGainCurve(
  el: HTMLAudioElement | null,
  outputCurve: Float32Array,
  analysisCurve: Float32Array,
  durationSec: number,
): boolean {
  if (!el || !ctx) return false;
  const deck = decks.get(el);
  if (!deck) return false;
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new RangeError(`Crossfade schedule duration must be positive; received ${durationSec}.`);
  }
  const now = ctx.currentTime;
  el.volume = 1;
  deck.outputGain.gain.cancelScheduledValues(now);
  deck.outputGain.gain.setValueCurveAtTime(outputCurve, now, durationSec);

  deck.analysisGain.gain.cancelScheduledValues(now);
  deck.analysisGain.gain.setValueCurveAtTime(analysisCurve, now, durationSec);
  return true;
}

/**
 * Smoothly ramp a deck's output gain to `target` over `durationSec` (used for
 * the 10-second gentle sleep-timer fade-out). Returns true when Web Audio
 * scheduled the ramp.
 */
export function rampOutputGain(
  el: HTMLAudioElement | null,
  fromGain: number,
  targetGain: number,
  durationSec: number,
): boolean {
  if (!el || !ctx) return false;
  const deck = decks.get(el);
  if (!deck) return false;
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    applyVolume(el, targetGain);
    return true;
  }
  const now = ctx.currentTime;
  deck.outputGain.gain.cancelScheduledValues(now);
  deck.outputGain.gain.setValueAtTime(Math.max(0, Math.min(1, fromGain)), now);
  deck.outputGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, targetGain)), now + durationSec);
  return true;
}

/**
 * Disconnect a deck that is being permanently removed from the document.
 */
export function releaseAnalyser(el: HTMLAudioElement | null): void {
  if (!el || !decks.has(el) || pendingRelease.has(el)) return;
  const timer = window.setTimeout(() => {
    pendingRelease.delete(el);
    const deck = decks.get(el);
    if (!deck) return;

    deck.source.disconnect();
    deck.outputGain.disconnect();
    deck.analysisGain.disconnect();
    decks.delete(el);

    if (decks.size === 0 && ctx) {
      analyser?.disconnect();
      analyser = null;
      masterBus?.disconnect();
      masterBus = null;
      eqFilters.forEach((filter) => filter.disconnect());
      eqFilters = [];
      compressor?.disconnect();
      compressor = null;
      dryGain?.disconnect();
      dryGain = null;
      wetGain?.disconnect();
      wetGain = null;
      const closing = ctx;
      ctx = null;
      closing.close().catch((error) => {
        console.error("[player] failed to close AudioContext", error);
      });
    }
  }, 0);
  pendingRelease.set(el, timer);
}

const VOLUME_CURVE_EXPONENT = 2;

/** Map a linear slider position (0..1) to a perceptual audio gain (0..1). */
export function perceptualVolume(position: number): number {
  const p = Math.max(0, Math.min(1, position));
  return p ** VOLUME_CURVE_EXPONENT;
}

/** The analyser node, if it has been initialised. */
export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

/** Resume the AudioContext if it was suspended (e.g. on a fresh user gesture). */
export function resumeAudioContext(): void {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}
