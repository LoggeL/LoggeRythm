/**
 * Pure Wave 2 audio-intelligence & karaoke utilities:
 * - Strict validation for `GET /api/tracks/{id}/audio-meta` (zero fake peaks)
 * - Cue-aware crossfade window calculation (`intro_end_sec`, `outro_start_sec`)
 * - Word-by-word karaoke timing progress
 * - Audio quality tier labels & badges
 */

import type { AudioQuality, LyricsWord, TrackAudioMeta } from "@/types";

export const AUDIO_PEAK_COUNT = 96;

export const AUDIO_QUALITY_META: Readonly<
  Record<AudioQuality, { label: string; badge: string; detail: string }>
> = {
  lossless: {
    label: "Verlustfrei (FLAC)",
    badge: "FLAC",
    detail: "CD-Qualität ohne Kompression (höherer Datenverbrauch)",
  },
  high: {
    label: "Hoch (320 kbps)",
    badge: "320",
    detail: "Ausgewogene MP3-Qualität für Alltag & WLAN",
  },
  saver: {
    label: "Datensparmodus (128 kbps)",
    badge: "128",
    detail: "Sparsamer Stream für unterwegs",
  },
};

export const AUDIO_QUALITY_ORDER: readonly AudioQuality[] = ["lossless", "high", "saver"];

export function isAudioQuality(value: unknown): value is AudioQuality {
  return value === "lossless" || value === "high" || value === "saver";
}

function optionalFiniteNumber(raw: unknown, field: string): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`Audio-Metadaten: Feld "${field}" muss eine endliche Zahl oder null sein.`);
  }
  return raw;
}

/**
 * Strictly decode `GET /api/tracks/{id}/audio-meta`. Throws loudly on malformed
 * shapes or invalid peak arrays instead of inventing placeholder waveforms.
 */
export function decodeTrackAudioMeta(raw: unknown): TrackAudioMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Audio-Metadaten: Ein JSON-Objekt wurde erwartet.");
  }
  const data = raw as Record<string, unknown>;
  if (typeof data.deezer_id !== "string" || data.deezer_id.trim() === "") {
    throw new Error('Audio-Metadaten: "deezer_id" fehlt oder ist ungültig.');
  }
  if (!Array.isArray(data.peaks) || data.peaks.length === 0) {
    throw new Error('Audio-Metadaten: "peaks" muss ein nicht-leeres Zahlenarray sein.');
  }
  const peaks = data.peaks.map((entry, idx) => {
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 1) {
      throw new Error(`Audio-Metadaten: Peak #${idx} liegt außerhalb von [0, 1] (${String(entry)}).`);
    }
    return entry;
  });
  const analyzedAt = data.analyzed_at;
  if (analyzedAt !== null && analyzedAt !== undefined && typeof analyzedAt !== "string") {
    throw new Error('Audio-Metadaten: "analyzed_at" muss ein Zeitstempel oder null sein.');
  }

  return {
    deezer_id: data.deezer_id,
    peaks,
    loudness_lufs: optionalFiniteNumber(data.loudness_lufs, "loudness_lufs"),
    loudness_gain_db: optionalFiniteNumber(data.loudness_gain_db, "loudness_gain_db"),
    loudness_peak: optionalFiniteNumber(data.loudness_peak, "loudness_peak"),
    bpm: optionalFiniteNumber(data.bpm, "bpm"),
    duration_sec: optionalFiniteNumber(data.duration_sec, "duration_sec"),
    intro_end_sec: optionalFiniteNumber(data.intro_end_sec, "intro_end_sec"),
    outro_start_sec: optionalFiniteNumber(data.outro_start_sec, "outro_start_sec"),
    analyzed_at: (analyzedAt as string | null | undefined) ?? null,
  };
}

export interface CueAwareCrossfadePlan {
  /** Media timestamp (seconds) on the outgoing track when crossfade should start. */
  triggerMediaSec: number;
  /** Media duration (seconds) of the outgoing fade tail. */
  fadeMediaSec: number;
  /** Media timestamp (seconds) where the incoming track should start (skipping dead silence). */
  incomingStartSec: number;
}

/**
 * Compute silence-aware crossfade trigger and incoming cue offset from
 * server-analyzed `outro_start_sec` and `intro_end_sec`.
 *
 * - Never triggers earlier than the midpoint of the outgoing track.
 * - Never exceeds the configured `crossfadeSec` fade duration (avoids cutting
 *   into singing if a quiet bridge occurs early).
 * - Trims leading dead silence on the incoming track up to `min(introEndSec, 4s)`.
 */
export function computeCueAwareCrossfade(params: {
  configuredCrossfadeSec: number;
  outgoingDurationSec: number;
  outgoingOutroStartSec?: number | null;
  incomingIntroEndSec?: number | null;
}): CueAwareCrossfadePlan {
  const {
    configuredCrossfadeSec,
    outgoingDurationSec,
    outgoingOutroStartSec,
    incomingIntroEndSec,
  } = params;
  if (!Number.isFinite(configuredCrossfadeSec) || configuredCrossfadeSec <= 0) {
    throw new RangeError(`Crossfade duration must be positive; received ${configuredCrossfadeSec}.`);
  }
  if (!Number.isFinite(outgoingDurationSec) || outgoingDurationSec <= 0) {
    throw new RangeError(`Outgoing track duration must be positive; received ${outgoingDurationSec}.`);
  }

  let triggerMediaSec = Math.max(0, outgoingDurationSec - configuredCrossfadeSec);
  if (
    typeof outgoingOutroStartSec === "number" &&
    Number.isFinite(outgoingOutroStartSec) &&
    outgoingOutroStartSec > outgoingDurationSec * 0.5 &&
    outgoingOutroStartSec < outgoingDurationSec - 0.5
  ) {
    // Allow cueing slightly earlier into trailing silence, bounded to 1.5x configured crossfade.
    const earliestAllowed = Math.max(
      outgoingDurationSec * 0.5,
      outgoingDurationSec - configuredCrossfadeSec * 1.5,
    );
    triggerMediaSec = Math.max(earliestAllowed, Math.min(triggerMediaSec, outgoingOutroStartSec));
  }

  const remainingFromTrigger = Math.max(0.2, outgoingDurationSec - triggerMediaSec);
  const fadeMediaSec = Math.min(configuredCrossfadeSec, remainingFromTrigger);

  let incomingStartSec = 0;
  if (
    typeof incomingIntroEndSec === "number" &&
    Number.isFinite(incomingIntroEndSec) &&
    incomingIntroEndSec > 0.15
  ) {
    // Trim leading digital silence / quiet fade-in (capped conservatively at 4s).
    incomingStartSec = Math.min(4, Math.max(0, incomingIntroEndSec - 0.1));
  }

  return { triggerMediaSec, fadeMediaSec, incomingStartSec };
}

/**
 * Returns 0..1 highlight progress of a single karaoke word at `currentTime`.
 */
export function wordKaraokeProgress(word: LyricsWord, currentTime: number): number {
  if (!Number.isFinite(currentTime) || !Number.isFinite(word.t) || !Number.isFinite(word.end)) {
    return 0;
  }
  if (currentTime <= word.t) return 0;
  const span = word.end - word.t;
  if (span <= 0.001) return currentTime >= word.t ? 1 : 0;
  if (currentTime >= word.end) return 1;
  return (currentTime - word.t) / span;
}

/**
 * Index of the currently active word inside a timed lyric line, or -1 if none.
 */
export function activeWordIndex(words: readonly LyricsWord[], currentTime: number): number {
  if (!words.length || !Number.isFinite(currentTime)) return -1;
  let active = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].t <= currentTime + 0.04) active = i;
    else break;
  }
  return active;
}
