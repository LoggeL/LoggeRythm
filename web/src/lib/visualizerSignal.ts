/** Real FFT measurements shared by the player's visual consumers. */

export interface VisualizerGeometry {
  frequencyBinCount: number;
  fftSize: number;
  sampleRate: number;
  bandCount?: number;
}

export interface SpectrumBandRange {
  /** Inclusive FFT bin index. DC is excluded. */
  readonly startBin: number;
  /** Exclusive FFT bin index. */
  readonly endBin: number;
  readonly minHz: number;
  readonly maxHz: number;
}

export interface VisualizerSignal {
  readonly frequencyBinCount: number;
  readonly fftSize: number;
  readonly sampleRate: number;
  readonly ranges: readonly SpectrumBandRange[];
  /** Smoothed, normalised measurements. This array is reused for every frame. */
  readonly bands: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  /** Positive energy rises only; a sustained tone produces no repeated hits. */
  transient: number;
}

interface SignalRuntime {
  previousEnergy: number;
  firstBin: number;
  lastBin: number;
  bassEndBin: number;
  midEndBin: number;
}

const runtimes = new WeakMap<VisualizerSignal, SignalRuntime>();
const SILENCE_FLOOR = 8;
const ATTACK_MS = 35;
const RELEASE_MS = 200;

function validateDelta(deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new RangeError(`Spectrum deltaMs must be finite and non-negative; received ${deltaMs}.`);
  }
}

function runtimeFor(signal: VisualizerSignal): SignalRuntime {
  const runtime = runtimes.get(signal);
  if (!runtime) {
    throw new TypeError("Spectrum signal must be created with createVisualizerSignal().");
  }
  return runtime;
}

function normalisedByte(value: number): number {
  return Math.max(0, value - SILENCE_FLOOR) / (255 - SILENCE_FLOOR);
}

function rms(bytes: Uint8Array, startBin: number, endBin: number): number {
  let sum = 0;
  for (let bin = startBin; bin < endBin; bin += 1) {
    const amplitude = normalisedByte(bytes[bin]);
    sum += amplitude * amplitude;
  }
  return endBin > startBin ? Math.sqrt(sum / (endBin - startBin)) : 0;
}

function smooth(current: number, target: number, attack: number, release: number): number {
  const value = current + (target - current) * (target > current ? attack : release);
  return value < 0.00001 ? 0 : value;
}

/**
 * Partition 20 Hz to 14 kHz (bounded by the actual Nyquist frequency) into
 * logarithmic bands. Adjacent low bands may share a bin when FFT resolution
 * is coarser than their interval; no frequency measurements are invented.
 */
export function createVisualizerSignal(geometry: VisualizerGeometry): VisualizerSignal {
  const { frequencyBinCount, fftSize, sampleRate, bandCount = 48 } = geometry;
  if (!Number.isInteger(fftSize) || fftSize < 32 || fftSize > 32768 || (fftSize & (fftSize - 1)) !== 0) {
    throw new RangeError(`Spectrum fftSize must be a power of two between 32 and 32768; received ${fftSize}.`);
  }
  if (!Number.isInteger(frequencyBinCount) || frequencyBinCount !== fftSize / 2) {
    throw new RangeError(`Spectrum frequencyBinCount must equal fftSize / 2 (${fftSize / 2}); received ${frequencyBinCount}.`);
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`Spectrum sampleRate must be finite and positive; received ${sampleRate}.`);
  }
  if (!Number.isInteger(bandCount) || bandCount < 1 || bandCount > 256) {
    throw new RangeError(`Spectrum bandCount must be an integer between 1 and 256; received ${bandCount}.`);
  }

  const binHz = sampleRate / fftSize;
  const maxHz = Math.min(14000, sampleRate / 2);
  const minHz = Math.min(20, maxHz / 32);
  const octaveRatio = maxHz / minHz;
  const ranges: SpectrumBandRange[] = [];
  for (let index = 0; index < bandCount; index += 1) {
    const low = minHz * octaveRatio ** (index / bandCount);
    const high = minHz * octaveRatio ** ((index + 1) / bandCount);
    const startBin = Math.min(frequencyBinCount - 1, Math.max(1, Math.floor(low / binHz)));
    const endBin = Math.min(frequencyBinCount, Math.max(startBin + 1, Math.ceil(high / binHz)));
    ranges.push(Object.freeze({ startBin, endBin, minHz: low, maxHz: high }));
  }

  const signal: VisualizerSignal = {
    frequencyBinCount,
    fftSize,
    sampleRate,
    ranges: Object.freeze(ranges),
    bands: new Float32Array(bandCount),
    bass: 0,
    mid: 0,
    treble: 0,
    energy: 0,
    transient: 0,
  };
  const firstBin = ranges[0].startBin;
  const lastBin = ranges[ranges.length - 1].endBin;
  runtimes.set(signal, {
    previousEnergy: 0,
    firstBin,
    lastBin,
    bassEndBin: Math.min(lastBin, Math.max(firstBin, Math.ceil(250 / binHz))),
    midEndBin: Math.min(lastBin, Math.max(firstBin, Math.ceil(4000 / binHz))),
  });
  return signal;
}

/** Read the actual analyser's byte-frequency buffer without allocating a frame. */
export function sampleSpectrum(signal: VisualizerSignal, bytes: Uint8Array, deltaMs: number): VisualizerSignal {
  const runtime = runtimeFor(signal);
  validateDelta(deltaMs);
  if (!(bytes instanceof Uint8Array) || bytes.length !== signal.frequencyBinCount) {
    throw new TypeError(`Spectrum input must be a Uint8Array with ${signal.frequencyBinCount} frequency bins.`);
  }
  if (deltaMs === 0) return signal;

  const attack = 1 - Math.exp(-deltaMs / ATTACK_MS);
  const release = 1 - Math.exp(-deltaMs / RELEASE_MS);
  let bandEnergy = 0;
  for (let index = 0; index < signal.ranges.length; index += 1) {
    const { startBin, endBin } = signal.ranges[index];
    const target = rms(bytes, startBin, endBin);
    signal.bands[index] = smooth(signal.bands[index], target, attack, release);
    bandEnergy += target * target;
  }
  const bass = rms(bytes, runtime.firstBin, runtime.bassEndBin);
  const mid = rms(bytes, runtime.bassEndBin, runtime.midEndBin);
  const treble = rms(bytes, runtime.midEndBin, runtime.lastBin);
  const energy = Math.sqrt(bandEnergy / signal.bands.length);
  signal.bass = smooth(signal.bass, bass, attack, release);
  signal.mid = smooth(signal.mid, mid, attack, release);
  signal.treble = smooth(signal.treble, treble, attack, release);
  signal.energy = smooth(signal.energy, energy, attack, release);
  const rise = Math.min(1, Math.max(0, energy - runtime.previousEnergy) * 3);
  signal.transient = smooth(signal.transient, rise, 1 - Math.exp(-deltaMs / 12), 1 - Math.exp(-deltaMs / 160));
  runtime.previousEnergy = energy;
  return signal;
}

/** Pause/unavailable analyser: let measured energy settle naturally to silence. */
export function decaySpectrum(signal: VisualizerSignal, deltaMs: number): VisualizerSignal {
  const runtime = runtimeFor(signal);
  validateDelta(deltaMs);
  if (deltaMs === 0) return signal;
  const release = 1 - Math.exp(-deltaMs / RELEASE_MS);
  for (let index = 0; index < signal.bands.length; index += 1) {
    signal.bands[index] = smooth(signal.bands[index], 0, 0, release);
  }
  signal.bass = smooth(signal.bass, 0, 0, release);
  signal.mid = smooth(signal.mid, 0, 0, release);
  signal.treble = smooth(signal.treble, 0, 0, release);
  signal.energy = smooth(signal.energy, 0, 0, release);
  signal.transient = smooth(signal.transient, 0, 0, 1 - Math.exp(-deltaMs / 160));
  runtime.previousEnergy = 0;
  return signal;
}
