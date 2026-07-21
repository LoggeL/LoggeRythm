import type { Track } from '../api/types';

export const LOUDNESS_TARGET_LUFS = -14;
export const MIN_LOUDNESS_GAIN_DB = -24;
export const MAX_LOUDNESS_GAIN_DB = 0;

export interface LoudnessMetadata {
  /** ReplayGain/R128 track gain in dB, when metadata already provides an adjustment. */
  replayGainDb?: number | null;
  /** Integrated track loudness in LUFS/LKFS, when measured or supplied by the backend. */
  integratedLoudnessLufs?: number | null;
  /** True peak/sample peak as a linear ratio where 1.0 is digital full scale. */
  peak?: number | null;
}

export interface LoudnessGain {
  targetLufs: number;
  gainDb: number;
  gainLinear: number;
  source: 'metadata' | 'none';
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clippingCeilingDb(peak: number | null): number {
  if (peak === null || peak <= 0 || peak >= 1) return 0;
  return -20 * Math.log10(peak);
}

export function calculateLoudnessGain(
  metadata: LoudnessMetadata | null | undefined,
  targetLufs = LOUDNESS_TARGET_LUFS,
): LoudnessGain {
  const replayGainDb = finite(metadata?.replayGainDb);
  const integrated = finite(metadata?.integratedLoudnessLufs);
  const peak = finite(metadata?.peak);
  const rawGainDb = replayGainDb ?? (integrated === null ? null : targetLufs - integrated);
  if (rawGainDb === null) {
    return { targetLufs, gainDb: 0, gainLinear: 1, source: 'none' };
  }

  // Every current playback backend exposes a bounded 0..1 output gain. We therefore
  // normalize by attenuating loud tracks and never digitally boost quiet tracks; that
  // keeps clipping impossible and makes Android/web behavior identical.
  const gainDb = clamp(
    rawGainDb,
    MIN_LOUDNESS_GAIN_DB,
    Math.min(MAX_LOUDNESS_GAIN_DB, clippingCeilingDb(peak)),
  );
  const gainLinear = 10 ** (gainDb / 20);
  return { targetLufs, gainDb, gainLinear, source: 'metadata' };
}

export function loudnessMetadataFromTrack(track: Pick<Track,
  'loudness_gain_db' | 'loudness_lufs' | 'loudness_peak'
>): LoudnessMetadata {
  return {
    replayGainDb: track.loudness_gain_db ?? null,
    integratedLoudnessLufs: track.loudness_lufs ?? null,
    peak: track.loudness_peak ?? null,
  };
}
