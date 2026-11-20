import { GENRE_SCENES, type GenreScene, type SceneGuess } from "./visualizerScenes";

/**
 * Guesses a scene from the music itself, using only the shared spectrum
 * frames the visualizer already reads (no extra audio processing).
 *
 * Six features over the last few seconds:
 *  - bpm: autocorrelation of the onset envelope (spectral flux)
 *  - bassShare: low bands against the whole spectrum
 *  - brightness: spectral centroid, 0 = all bass, 1 = all treble
 *  - onsetRate: distinct attacks per second
 *  - dynamics: loudness variation (coefficient of variation)
 *  - swing: triplet vs. straight subdivisions inside a beat
 *
 * Each scene has a reference point in that feature space; the nearest wins.
 * The references are set by hand from typical traits of each genre and still
 * need calibrating on real songs, so the decision rules in visualizerScenes
 * let listening overrule Deezer's genre only when it is confident and stable.
 */

export interface ListenerFrame {
  readonly bands: Float32Array;
  readonly active: boolean;
  readonly timeSeconds: number;
}

export interface ListenerFeatures {
  /** Seconds of music in the analysis window. */
  seconds: number;
  bpm: number;
  bassShare: number;
  brightness: number;
  onsetRate: number;
  dynamics: number;
  swing: number;
}

export const FEATURE_KEYS = ["bpm", "bassShare", "brightness", "onsetRate", "dynamics", "swing"] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Analysis window. */
const WINDOW_SECONDS = 6;
/** Below this much music there is no estimate. */
const MIN_SECONDS = 2;
const MAX_FRAMES = 512;
const MIN_BPM = 70;
const MAX_BPM = 190;

interface Sample { t: number; flux: number; bassShare: number; centroid: number; energy: number }

export interface GenreListener {
  push(frame: ListenerFrame): void;
  features(): ListenerFeatures | null;
  /** Seconds of music heard (capped at the window). */
  readonly seconds: number;
  reset(): void;
}

export function createGenreListener(): GenreListener {
  let samples: Sample[] = [];
  let previous: Float32Array | null = null;
  let lastTime = -Infinity;
  let heard = 0;

  function reset() { samples = []; previous = null; lastTime = -Infinity; heard = 0; }

  function push(frame: ListenerFrame) {
    // Paused or silent: the window keeps what it had, nothing new counts.
    if (!frame.active) { previous = null; return; }
    if (!Number.isFinite(frame.timeSeconds)) throw new RangeError("Genre listener needs frames with a finite timestamp.");
    if (frame.timeSeconds <= lastTime) return;
    const bands = frame.bands;
    if (bands.length < 12) throw new RangeError(`Genre listener needs at least 12 spectrum bands; received ${bands.length}.`);
    if (lastTime > -Infinity) heard += Math.min(0.2, frame.timeSeconds - lastTime);
    lastTime = frame.timeSeconds;
    const n = bands.length, lowEnd = Math.round(n / 6), midEnd = Math.round(n * 0.58);
    let flux = 0, low = 0, mid = 0, high = 0, weighted = 0, total = 0;
    for (let i = 0; i < n; i++) {
      const v = bands[i];
      if (!Number.isFinite(v) || v < 0) throw new RangeError(`Genre listener band ${i} must be a finite non-negative value; received ${v}.`);
      if (previous) flux += Math.max(0, v - previous[i]);
      if (i < lowEnd) low += v; else if (i < midEnd) mid += v; else high += v;
      weighted += i * v;
      total += v;
    }
    previous = previous && previous.length === n ? previous : new Float32Array(n);
    previous.set(bands);
    const lowMean = low / lowEnd, midMean = mid / (midEnd - lowEnd), highMean = high / (n - midEnd);
    samples.push({
      t: frame.timeSeconds,
      flux: Math.log1p(20 * flux / n),
      bassShare: lowMean / (lowMean + midMean + highMean + 1e-6),
      centroid: total > 0 ? weighted / total / (n - 1) : 0,
      energy: total / n,
    });
    const cutoff = frame.timeSeconds - WINDOW_SECONDS;
    let drop = 0;
    while (drop < samples.length && (samples[drop].t < cutoff || samples.length - drop > MAX_FRAMES)) drop++;
    if (drop) samples = samples.slice(drop);
  }

  function features(): ListenerFeatures | null {
    if (samples.length < 24 || heard < MIN_SECONDS) return null;
    const span = samples[samples.length - 1].t - samples[0].t;
    if (span <= 0) return null;
    const rate = (samples.length - 1) / span;
    const flux = samples.map((s) => s.flux);
    const fluxMean = mean(flux);
    const centered = flux.map((v) => v - fluxMean);
    const n = centered.length;

    const autocorrelation = (lag: number) => {
      const whole = Math.floor(lag), fraction = lag - whole;
      const at = (l: number) => {
        if (l >= n - 1) return 0;
        let sum = 0;
        for (let i = l; i < n; i++) sum += centered[i] * centered[i - l];
        return sum / (n - l);
      };
      return at(whole) * (1 - fraction) + at(whole + 1) * fraction;
    };
    // A beat period also repeats at 2x..4x and usually has a half-beat
    // subdivision; a mild prior keeps estimates near common tempi.
    const minLag = rate * 60 / MAX_BPM, maxLag = rate * 60 / MIN_BPM;
    const score = (lag: number) => {
      let sum = 0, used = 0;
      for (let m = 1; m <= 4 && lag * m < n * 0.7; m++) { sum += autocorrelation(lag * m); used++; }
      sum += 0.5 * autocorrelation(lag / 2); used += 0.5;
      return (sum / used) * Math.exp(-0.5 * (Math.log2(rate * 60 / lag / 120) / 0.9) ** 2);
    };
    let best = -Infinity, beatLag = 0;
    for (let lag = minLag; lag <= maxLag; lag += 0.25) {
      const s = score(lag);
      if (s > best) { best = s; beatLag = lag; }
    }
    // A strong 1.5- or 2-beat period usually means the real beat is faster.
    for (const k of [2 / 3, 1 / 2]) {
      const candidate = beatLag * k;
      if (candidate >= minLag && score(candidate) >= best * 0.8) { beatLag = candidate; break; }
    }

    const fluxDeviation = deviation(flux, fluxMean);
    let onsets = 0, lastOnset = -Infinity;
    for (let i = 1; i < n - 1; i++) {
      const isPeak = flux[i] > fluxMean + 1.2 * fluxDeviation && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1];
      if (isPeak && samples[i].t - lastOnset > 0.09) { onsets++; lastOnset = samples[i].t; }
    }

    let swing = 0;
    if (beatLag > 0) {
      const BINS = 24, fold = new Float32Array(BINS);
      for (let i = 0; i < n; i++) fold[Math.floor(((i / beatLag) % 1) * BINS) % BINS] += Math.max(0, centered[i]);
      let peak = 0;
      for (let b = 1; b < BINS; b++) if (fold[b] > fold[peak]) peak = b;
      const at = (phase: number) => {
        const c = peak + Math.round(phase * BINS);
        return Math.max(fold[(c - 1 + BINS) % BINS], fold[c % BINS], fold[(c + 1) % BINS]);
      };
      const triplet = at(1 / 3) + at(2 / 3), straight = at(1 / 4) + at(1 / 2) + at(3 / 4);
      swing = triplet / (triplet + straight * (2 / 3) + 1e-9);
    }

    const energy = samples.map((s) => s.energy);
    const energyMean = mean(energy);
    return {
      seconds: Math.min(heard, WINDOW_SECONDS),
      bpm: beatLag > 0 ? rate * 60 / beatLag : 0,
      bassShare: mean(samples.map((s) => s.bassShare)),
      brightness: mean(samples.map((s) => s.centroid)),
      onsetRate: onsets / span,
      dynamics: energyMean > 0 ? deviation(energy, energyMean) / energyMean : 0,
      swing,
    };
  }

  return { push, features, reset, get seconds() { return Math.min(heard, WINDOW_SECONDS); } };
}

function mean(values: readonly number[]) { return values.reduce((sum, v) => sum + v, 0) / values.length; }
function deviation(values: readonly number[], m: number) { return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length); }

/* ----------------------------------------------------------- classifier */

type Reference = Readonly<Record<FeatureKey, number>>;

/** Typical traits per scene's genres; see the module comment. */
export const SCENE_REFERENCES: Readonly<Record<GenreScene, readonly Reference[]>> = {
  // Four-on-the-floor club music: steady kick, strong bass, little variation.
  laser: [{ bpm: 125, bassShare: 0.46, brightness: 0.4, onsetRate: 3.6, dynamics: 0.22, swing: 0.15 }],
  // Slow, heavy low end, syncopated and often swung.
  monolith: [{ bpm: 90, bassShare: 0.5, brightness: 0.34, onsetRate: 2.6, dynamics: 0.34, swing: 0.32 }],
  // Fast, bright and dense: guitars fill the mids, cymbals the top.
  sparks: [
    { bpm: 140, bassShare: 0.32, brightness: 0.5, onsetRate: 3.6, dynamics: 0.18, swing: 0.14 },
    { bpm: 175, bassShare: 0.34, brightness: 0.52, onsetRate: 4.8, dynamics: 0.12, swing: 0.12 },
  ],
  // Mid-tempo, vocal-centred, balanced.
  bubbles: [{ bpm: 112, bassShare: 0.38, brightness: 0.44, onsetRate: 2.6, dynamics: 0.26, swing: 0.15 }],
  // Swung ride patterns, walking bass, wide dynamics.
  smoke: [{ bpm: 130, bassShare: 0.34, brightness: 0.46, onsetRate: 2.2, dynamics: 0.34, swing: 0.6 }],
  // No steady pulse, slow swells.
  aurora: [{ bpm: 100, bassShare: 0.36, brightness: 0.38, onsetRate: 0.6, dynamics: 0.45, swing: 0.3 }],
};

/** How far apart a feature counts as "different". */
const FEATURE_SCALE: Readonly<Record<FeatureKey, number>> = {
  bpm: 22, bassShare: 0.08, brightness: 0.07, onsetRate: 1, dynamics: 0.12, swing: 0.2,
};

/** Scenes ranked by how well they fit, probabilities summing to 1. */
export function classifyFeatures(features: ListenerFeatures): SceneGuess[] {
  for (const key of FEATURE_KEYS) {
    if (!Number.isFinite(features[key])) throw new RangeError(`Genre listener feature ${key} is not finite: ${features[key]}.`);
  }
  const fit = GENRE_SCENES.map((scene) => {
    let bestFit = 0;
    for (const reference of SCENE_REFERENCES[scene]) {
      let d2 = 0;
      for (const key of FEATURE_KEYS) d2 += ((features[key] - reference[key]) / FEATURE_SCALE[key]) ** 2;
      bestFit = Math.max(bestFit, Math.exp(-(d2 / FEATURE_KEYS.length) * 2.2));
    }
    return { scene, fit: bestFit };
  });
  const total = fit.reduce((sum, item) => sum + item.fit, 0);
  if (total <= 0) return GENRE_SCENES.map((scene) => ({ scene, p: 1 / GENRE_SCENES.length }));
  return fit.map(({ scene, fit: f }) => ({ scene, p: f / total })).sort((a, b) => b.p - a.p);
}
