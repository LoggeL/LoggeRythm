/**
 * Audio → motion for the fullscreen visualizer.
 *
 * The shared FFT tap publishes at ~30 Hz. `ingestSpectrum` consumes each of
 * those frames (adaptive gain, kick detection), while `advanceDrive` runs on
 * every display frame and eases the rendered values toward their targets, so
 * the picture moves at the display's own rate without stepping.
 */

export interface VisualizerPreferences { enabled: boolean }
export const INITIAL_VISUALIZER_PREFERENCES: VisualizerPreferences = { enabled: true };

/** `mode` is the scene choice of the retired three-scene visualizer; it is dropped. */
const LEGACY_PREFERENCE_KEYS = new Set(["mode"]);

export function validateVisualizerPreferences(value: unknown): VisualizerPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Die gespeicherte Visualisierung muss ein Objekt sein.");
  }
  const { enabled, ...rest } = value as Record<string, unknown>;
  if (typeof enabled !== "boolean") {
    throw new Error(`Die gespeicherte Visualisierung enthält einen ungültigen Ein/Aus-Schalter: ${JSON.stringify(enabled)}.`);
  }
  const unknown = Object.keys(rest).filter((key) => !LEGACY_PREFERENCE_KEYS.has(key));
  if (unknown.length) {
    throw new Error(`Die gespeicherte Visualisierung enthält unbekannte Felder: ${unknown.join(", ")}.`);
  }
  return { enabled };
}

/** The subset of the shared spectrum frame the drive reads. */
export interface SpectrumInput {
  readonly bands: Float32Array;
  readonly bass: number;
  readonly mid: number;
  readonly treble: number;
  readonly energy: number;
  readonly active: boolean;
  readonly timeSeconds: number;
}

export const MAX_WAVES = 6;
/** Spectrum resolution handed to the shader (one texel per band). */
export const SPECTRUM_TEXELS = 48;
const WAVE_LIFETIME = 2.6;
const MIN_BEAT_GAP = 0.27;
const PEAK_FLOOR = 0.06;

interface Envelope { value: number; target: number }
interface Gain { peak: number; mean: number }

export interface VisualizerDrive {
  /** Overall loudness relative to the track's own recent peak, 0..1. */
  level: number;
  bass: number;
  mid: number;
  treble: number;
  /** Jumps on a detected kick, then decays; 0..1. */
  beat: number;
  /** Accumulated motion phase; advances only while music plays. */
  flow: number;
  /** Rendered spectrum, 0..255, mirrored around the artwork by the shader. */
  readonly spectrum: Uint8Array;
  /** `MAX_WAVES` pairs of (age seconds, strength); strength 0 = free slot. */
  readonly waves: Float32Array;
  beats: number;
}

export interface DriveTracker {
  readonly drive: VisualizerDrive;
  live: boolean;
  lastFrameTime: number;
  lastBeat: number;
  fluxMean: number;
  fluxVar: number;
  readonly previousLow: Float32Array;
  readonly targets: { level: Envelope; bass: Envelope; mid: Envelope; treble: Envelope };
  readonly gains: { level: Gain; bass: Gain; mid: Gain; treble: Gain; spectrum: Gain };
  readonly spectrumTarget: Float32Array;
  readonly spectrumValue: Float32Array;
}

const envelope = (): Envelope => ({ value: 0, target: 0 });
const gain = (): Gain => ({ peak: PEAK_FLOOR, mean: 0 });

export function createDriveTracker(bandCount = SPECTRUM_TEXELS): DriveTracker {
  if (!Number.isInteger(bandCount) || bandCount < 8) throw new RangeError(`Visualizer drive needs at least 8 spectrum bands; received ${bandCount}.`);
  return {
    drive: {
      level: 0, bass: 0, mid: 0, treble: 0, beat: 0, flow: 0, beats: 0,
      spectrum: new Uint8Array(SPECTRUM_TEXELS),
      waves: new Float32Array(MAX_WAVES * 2),
    },
    live: false,
    lastFrameTime: -1,
    lastBeat: -Infinity,
    fluxMean: 0,
    fluxVar: 0,
    previousLow: new Float32Array(lowBandCount(bandCount)),
    targets: { level: envelope(), bass: envelope(), mid: envelope(), treble: envelope() },
    gains: { level: gain(), bass: gain(), mid: gain(), treble: gain(), spectrum: gain() },
    spectrumTarget: new Float32Array(SPECTRUM_TEXELS),
    spectrumValue: new Float32Array(SPECTRUM_TEXELS),
  };
}

/** Bands are a log partition of 20 Hz–14 kHz; the lowest 30 % hold kick and sub. */
function lowBandCount(bandCount: number) { return Math.max(3, Math.round(bandCount * 0.3)); }

function unitCheck(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`Visualizer ${name} must be a finite value between 0 and 1; received ${value}.`);
}

/**
 * Normalise against the track's recent peak and mean: quiet masters move as
 * much as loud ones, and a constant bass bed doesn't pin the scene at max.
 */
function normalise(g: Gain, value: number, dt: number): number {
  g.peak = Math.max(value, PEAK_FLOOR, g.peak * Math.exp(-dt / 5));
  g.mean += (value - g.mean) * (1 - Math.exp(-dt / 1.6));
  const body = value / g.peak;
  const punch = Math.max(0, value - g.mean * 0.8) / Math.max(0.04, g.peak - g.mean * 0.8);
  return Math.min(1, body * 0.45 + punch * 0.55);
}

function emitWave(drive: VisualizerDrive, strength: number) {
  // Reuse the oldest (or a free) slot so a dense beat never grows memory.
  let slot = 0, oldest = -1;
  for (let i = 0; i < MAX_WAVES; i++) {
    if (drive.waves[i * 2 + 1] === 0) { slot = i; break; }
    if (drive.waves[i * 2] > oldest) { oldest = drive.waves[i * 2]; slot = i; }
  }
  drive.waves[slot * 2] = 0;
  drive.waves[slot * 2 + 1] = strength;
}

/** A single expanding ring without a beat — used when the cover changes. */
export function triggerWave(tracker: DriveTracker, strength: number) {
  unitCheck(strength, "wave strength");
  if (strength > 0) emitWave(tracker.drive, strength);
}

/** Consume one published spectrum frame. Returns true when it contained a kick. */
export function ingestSpectrum(tracker: DriveTracker, frame: SpectrumInput): boolean {
  if (!frame.active) {
    tracker.live = false;
    tracker.targets.level.target = tracker.targets.bass.target = tracker.targets.mid.target = tracker.targets.treble.target = 0;
    tracker.spectrumTarget.fill(0);
    return false;
  }
  if (!Number.isFinite(frame.timeSeconds)) throw new RangeError("Visualizer spectrum frames need a finite timestamp.");
  if (frame.timeSeconds === tracker.lastFrameTime) return false;
  for (const [name, value] of [["bass", frame.bass], ["mid", frame.mid], ["treble", frame.treble], ["energy", frame.energy]] as const) unitCheck(value, name);
  if (frame.bands.length < tracker.previousLow.length) throw new RangeError(`Visualizer spectrum needs ${tracker.previousLow.length}+ bands; received ${frame.bands.length}.`);

  const dt = tracker.lastFrameTime < 0 ? 1 / 30 : Math.min(0.2, Math.max(0.001, frame.timeSeconds - tracker.lastFrameTime));
  tracker.lastFrameTime = frame.timeSeconds;
  tracker.live = true;
  const { targets, gains } = tracker;
  targets.level.target = normalise(gains.level, frame.energy, dt);
  targets.bass.target = normalise(gains.bass, frame.bass, dt);
  targets.mid.target = normalise(gains.mid, frame.mid, dt);
  targets.treble.target = normalise(gains.treble, frame.treble, dt);

  let loudest = 0;
  for (let i = 0; i < frame.bands.length; i++) loudest = Math.max(loudest, frame.bands[i]);
  const spectrumPeak = gains.spectrum.peak = Math.max(loudest, PEAK_FLOOR, gains.spectrum.peak * Math.exp(-dt / 4));
  for (let i = 0; i < SPECTRUM_TEXELS; i++) {
    const source = frame.bands[Math.min(frame.bands.length - 1, Math.floor(i * frame.bands.length / SPECTRUM_TEXELS))];
    // Treble bands carry far less energy; tilt them up so the whole ring moves.
    const tilt = 1 + (i / SPECTRUM_TEXELS) * 0.8;
    tracker.spectrumTarget[i] = Math.min(1, Math.pow(source / spectrumPeak, 1.25) * tilt);
  }

  // Kick detection: positive spectral flux in the low bands, against an
  // adaptive mean + deviation threshold, with a refractory gap.
  const low = tracker.previousLow;
  let flux = 0;
  for (let i = 0; i < low.length; i++) {
    flux += Math.max(0, frame.bands[i] - low[i]);
    low[i] = frame.bands[i];
  }
  flux /= low.length;
  const deviation = Math.sqrt(tracker.fluxVar);
  const threshold = tracker.fluxMean + deviation * 1.5 + 0.012;
  const isBeat = flux > threshold && frame.timeSeconds - tracker.lastBeat >= MIN_BEAT_GAP && frame.bass > 0.08;
  const k = 1 - Math.exp(-dt / 0.9);
  const diff = flux - tracker.fluxMean;
  tracker.fluxMean += diff * k;
  tracker.fluxVar = (1 - k) * (tracker.fluxVar + k * diff * diff);
  if (isBeat) {
    tracker.lastBeat = frame.timeSeconds;
    const strength = Math.min(1, Math.max(0.4, 0.4 + (flux - threshold) / Math.max(0.02, deviation * 3 + 0.02)));
    tracker.drive.beat = Math.max(tracker.drive.beat, strength);
    tracker.drive.beats += 1;
    emitWave(tracker.drive, strength);
  }
  return isBeat;
}

function ease(env: Envelope, attack: number, release: number, dt: number) {
  const tau = env.target > env.value ? attack : release;
  env.value += (env.target - env.value) * (1 - Math.exp(-dt / tau));
  if (env.value < 1e-4) env.value = 0;
  return env.value;
}

/**
 * Advance one display frame. Returns false once everything has settled
 * (paused/silent, no waves in flight) so the caller can stop its loop.
 */
export function advanceDrive(tracker: DriveTracker, dtSeconds: number): boolean {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) throw new RangeError(`Visualizer frame duration must be finite and non-negative; received ${dtSeconds}.`);
  const dt = Math.min(dtSeconds, 0.1);
  const { drive, targets } = tracker;
  drive.level = ease(targets.level, 0.07, 0.45, dt);
  drive.bass = ease(targets.bass, 0.03, 0.16, dt);
  drive.mid = ease(targets.mid, 0.05, 0.25, dt);
  drive.treble = ease(targets.treble, 0.03, 0.2, dt);
  drive.beat *= Math.exp(-dt / 0.2);
  if (drive.beat < 1e-3) drive.beat = 0;
  let spectrumMoving = false;
  for (let i = 0; i < SPECTRUM_TEXELS; i++) {
    const target = tracker.spectrumTarget[i];
    const current = tracker.spectrumValue[i];
    const next = current + (target - current) * (1 - Math.exp(-dt / (target > current ? 0.035 : 0.18)));
    tracker.spectrumValue[i] = next < 1e-3 ? 0 : next;
    drive.spectrum[i] = Math.round(tracker.spectrumValue[i] * 255);
    if (tracker.spectrumValue[i] > 0) spectrumMoving = true;
  }
  let wavesInFlight = false;
  for (let i = 0; i < MAX_WAVES; i++) {
    if (drive.waves[i * 2 + 1] === 0) continue;
    drive.waves[i * 2] += dt;
    if (drive.waves[i * 2] > WAVE_LIFETIME) { drive.waves[i * 2] = 0; drive.waves[i * 2 + 1] = 0; }
    else wavesInFlight = true;
  }
  if (tracker.live) drive.flow += dt * (0.05 + drive.level * 0.32 + drive.bass * 0.18 + drive.beat * 0.45);
  return tracker.live || wavesInFlight || spectrumMoving || drive.level > 0 || drive.bass > 0 || drive.mid > 0 || drive.treble > 0 || drive.beat > 0;
}

/* ------------------------------------------------------------------ palette */

/** Four cover-derived colours, linear 0..1 RGB: deep, primary, secondary, light. */
export type VisualizerColors = Float32Array;

export interface PaletteSource {
  primary: string;
  secondary: string;
  gradient: readonly [string, string, string];
}

/** The app's default violet theme, used while a track has no sampled cover. */
export const DEFAULT_VISUALIZER_PALETTE: PaletteSource = {
  primary: "rgb(124, 92, 255)",
  secondary: "rgb(168, 125, 255)",
  gradient: ["rgb(70, 36, 190)", "rgb(124, 92, 255)", "rgb(240, 167, 238)"],
};

const RGB_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,?\s*(\d{1,3})\s*,?\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/;
const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

function toLinear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function parseCssColor(value: string): [number, number, number] {
  const rgb = RGB_PATTERN.exec(value.trim());
  let channels: number[];
  if (rgb) channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  else {
    const hex = HEX_PATTERN.exec(value.trim());
    if (!hex) throw new Error(`Visualizer colour must be rgb(r, g, b) or #rrggbb; received ${JSON.stringify(value)}.`);
    const n = parseInt(hex[1], 16);
    channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (channels.some((c) => c > 255)) throw new Error(`Visualizer colour channel out of range in ${JSON.stringify(value)}.`);
  return [toLinear(channels[0]), toLinear(channels[1]), toLinear(channels[2])];
}

export function paletteColors(source: PaletteSource): VisualizerColors {
  const out = new Float32Array(12);
  [source.gradient[0], source.primary, source.secondary, source.gradient[2]].forEach((color, index) => out.set(parseCssColor(color), index * 3));
  return out;
}

/** Crossfade the rendered colours toward a new cover's palette. */
export function blendColors(current: VisualizerColors, target: VisualizerColors, dtSeconds: number, seconds = 0.9): boolean {
  if (current.length !== 12 || target.length !== 12) throw new RangeError("Visualizer palettes hold exactly four RGB colours.");
  const k = 1 - Math.exp(-Math.min(dtSeconds, 0.1) / (seconds / 3));
  let moving = false;
  for (let i = 0; i < 12; i++) {
    const delta = target[i] - current[i];
    if (Math.abs(delta) < 1e-4) { current[i] = target[i]; continue; }
    current[i] += delta * k;
    moving = true;
  }
  return moving;
}
