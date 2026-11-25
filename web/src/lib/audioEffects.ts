/**
 * Web Audio signal-processing model:
 * - Equal-power crossfade curves (avoids the ~3 dB midpoint dip of linear ramps)
 * - 5-band graphic equalizer presets + custom band gains (-12..+12 dB)
 * - Late-Night dynamic range compressor toggle
 * - Playback speed (0.75x..2.0x)
 *
 * Persisted in localStorage with strict fail-loud validation (AGENTS.md).
 */

export const AUDIO_EFFECTS_STORAGE_KEY = "sf_audio_effects";

export const EQ_BANDS = [
  { id: "sub", freq: 60, label: "60 Hz", type: "lowshelf" as BiquadFilterType },
  { id: "low", freq: 230, label: "230 Hz", type: "peaking" as BiquadFilterType },
  { id: "mid", freq: 910, label: "910 Hz", type: "peaking" as BiquadFilterType },
  { id: "high", freq: 3600, label: "3,6 kHz", type: "peaking" as BiquadFilterType },
  { id: "air", freq: 14000, label: "14 kHz", type: "highshelf" as BiquadFilterType },
] as const;

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export type EqPresetKey = "flat" | "bass" | "vocal" | "late_night" | "custom";

export const EQ_PRESET_LABELS: Readonly<Record<EqPresetKey, string>> = {
  flat: "Linear",
  bass: "Bass Boost",
  vocal: "Gesang",
  late_night: "Nachtmodus",
  custom: "Eigene",
};

export const EQ_PRESET_GAINS: Readonly<Record<Exclude<EqPresetKey, "custom">, readonly [number, number, number, number, number]>> = {
  flat: [0, 0, 0, 0, 0],
  bass: [6, 3.5, -1, 0.5, 1.5],
  vocal: [-2, 0.5, 4, 3, -0.5],
  late_night: [-3, 1, 2.5, 1, -2.5],
};

export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface AudioEffectsSettings {
  eqEnabled: boolean;
  preset: EqPresetKey;
  /** Gain in dB for each of the 5 EQ_BANDS, bounded to [EQ_MIN_DB, EQ_MAX_DB]. */
  bands: [number, number, number, number, number];
  /** Enables a gentle DynamicsCompressorNode for late-night listening. */
  compressorEnabled: boolean;
  /** Audio element playbackRate (0.75..2). */
  playbackRate: number;
}

export const DEFAULT_AUDIO_EFFECTS: AudioEffectsSettings = {
  eqEnabled: false,
  preset: "flat",
  bands: [0, 0, 0, 0, 0],
  compressorEnabled: false,
  playbackRate: 1,
};

const VALID_PRESETS = new Set<string>(Object.keys(EQ_PRESET_LABELS));

export function validateAudioEffects(value: unknown): AudioEffectsSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Lokale Daten "${AUDIO_EFFECTS_STORAGE_KEY}": Ein Audio-Einstellungsobjekt wurde erwartet.`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.eqEnabled !== "boolean") {
    throw new Error(`Lokale Daten "${AUDIO_EFFECTS_STORAGE_KEY}": "eqEnabled" muss ein Wahrheitswert sein.`);
  }
  if (typeof raw.preset !== "string" || !VALID_PRESETS.has(raw.preset)) {
    throw new Error(`Lokale Daten "${AUDIO_EFFECTS_STORAGE_KEY}": Unbekanntes EQ-Preset ${JSON.stringify(raw.preset)}.`);
  }
  if (!Array.isArray(raw.bands) || raw.bands.length !== EQ_BANDS.length) {
    throw new Error(`Lokale Daten "${AUDIO_EFFECTS_STORAGE_KEY}": "bands" muss genau ${EQ_BANDS.length} Werte enthalten.`);
  }
  const bands = raw.bands.map((entry, idx) => {
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < EQ_MIN_DB || entry > EQ_MAX_DB) {
      throw new Error(
        `Lokale Daten "${AUDIO_EFFECTS_STORAGE_KEY}": EQ-Band ${idx + 1} muss zwischen ${EQ_MIN_DB} und ${EQ_MAX_DB} dB liegen.`,
      );
    }
    return entry;
  }) as [number, number, number, number, number];

  if (typeof raw.compressorEnabled !== "boolean") {
    throw new Error(`Lokale Daten "${AUDIO_EFFECTS_STORAGE_KEY}": "compressorEnabled" muss ein Wahrheitswert sein.`);
  }
  if (typeof raw.playbackRate !== "number" || !Number.isFinite(raw.playbackRate) || raw.playbackRate < 0.5 || raw.playbackRate > 2.5) {
    throw new Error(`Lokale Daten "${AUDIO_EFFECTS_STORAGE_KEY}": Ungültige Wiedergabegeschwindigkeit ${JSON.stringify(raw.playbackRate)}.`);
  }

  return {
    eqEnabled: raw.eqEnabled,
    preset: raw.preset as EqPresetKey,
    bands,
    compressorEnabled: raw.compressorEnabled,
    playbackRate: raw.playbackRate,
  };
}

export function isAudioEffectsActive(settings: AudioEffectsSettings): boolean {
  return (
    settings.eqEnabled ||
    settings.compressorEnabled ||
    Math.abs(settings.playbackRate - 1) > 0.001
  );
}

/**
 * Equal-power crossfade curves using cos/sin quarter-wave shaping:
 * outgoing(t)^2 + incoming(t)^2 === 1 for all t in [0, 1], preventing
 * the perceptual ~3 dB volume dip of linear fades.
 */
export function buildEqualPowerCrossfadeCurves(
  steps: number,
  outgoingPeak: number,
  incomingPeak: number,
  startProgress = 0,
): { outgoing: Float32Array; incoming: Float32Array } {
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError(`Crossfade curve requires at least 2 integer steps; received ${steps}.`);
  }
  if (!Number.isFinite(outgoingPeak) || outgoingPeak < 0 || outgoingPeak > 1) {
    throw new RangeError(`Outgoing crossfade gain must be in [0, 1]; received ${outgoingPeak}.`);
  }
  if (!Number.isFinite(incomingPeak) || incomingPeak < 0 || incomingPeak > 1) {
    throw new RangeError(`Incoming crossfade gain must be in [0, 1]; received ${incomingPeak}.`);
  }
  if (!Number.isFinite(startProgress) || startProgress < 0 || startProgress > 1) {
    throw new RangeError(`Crossfade startProgress must be in [0, 1]; received ${startProgress}.`);
  }
  const outgoing = new Float32Array(steps);
  const incoming = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    const t = startProgress + (1 - startProgress) * u;
    const angle = t * (Math.PI / 2);
    outgoing[i] = Math.cos(angle) * outgoingPeak;
    incoming[i] = Math.sin(angle) * incomingPeak;
  }
  // Pin endpoints exactly so Web Audio settles cleanly at 0 / peak.
  outgoing[steps - 1] = 0;
  incoming[steps - 1] = incomingPeak;
  return { outgoing, incoming };
}

/**
 * Equal-power pair at a single normalized progress t in [0, 1].
 */
export function equalPowerWeights(t: number): { outgoing: number; incoming: number } {
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    throw new RangeError(`Crossfade progress must be in [0, 1]; received ${t}.`);
  }
  const angle = t * (Math.PI / 2);
  return {
    outgoing: Math.cos(angle),
    incoming: Math.sin(angle),
  };
}

/**
 * Convert a configured crossfade window (in media seconds) and the outgoing
 * deck's remaining media time into the wall-clock duration that Web Audio's
 * `AudioContext.currentTime` and `setTimeout` should run for at `playbackRate`.
 */
export function computeCrossfadeWallDuration(
  crossfadeMediaSec: number,
  remainingMediaSec: number,
  playbackRate: number,
): number {
  if (!Number.isFinite(crossfadeMediaSec) || crossfadeMediaSec <= 0) {
    throw new RangeError(`Crossfade duration must be positive; received ${crossfadeMediaSec}.`);
  }
  if (!Number.isFinite(remainingMediaSec) || remainingMediaSec <= 0) {
    throw new RangeError(`Remaining media duration must be positive; received ${remainingMediaSec}.`);
  }
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    throw new RangeError(`Playback rate must be positive; received ${playbackRate}.`);
  }
  return Math.min(crossfadeMediaSec, remainingMediaSec) / playbackRate;
}
