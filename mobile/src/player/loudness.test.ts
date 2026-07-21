import { describe, expect, it } from 'vitest';
import { calculateLoudnessGain, loudnessMetadataFromTrack } from './loudness';

function closeTo(value: number, expected: number): void {
  expect(value).toBeGreaterThan(expected - 0.000001);
  expect(value).toBeLessThan(expected + 0.000001);
}

describe('calculateLoudnessGain', () => {
  it('returns neutral gain when no ReplayGain or R128 metadata exists', () => {
    expect(calculateLoudnessGain(null)).toEqual({
      targetLufs: -14,
      gainDb: 0,
      gainLinear: 1,
      source: 'none',
    });
  });

  it('uses ReplayGain adjustment metadata before integrated loudness', () => {
    const gain = calculateLoudnessGain({ replayGainDb: -6, integratedLoudnessLufs: -9 });
    expect(gain.source).toBe('metadata');
    expect(gain.gainDb).toBe(-6);
    closeTo(gain.gainLinear, 10 ** (-6 / 20));
  });

  it('derives attenuation from integrated LUFS and never boosts quiet tracks', () => {
    expect(calculateLoudnessGain({ integratedLoudnessLufs: -8 }).gainDb).toBe(-6);
    expect(calculateLoudnessGain({ integratedLoudnessLufs: -20 }).gainDb).toBe(0);
  });

  it('bounds extreme attenuation and ignores non-finite metadata', () => {
    expect(calculateLoudnessGain({ replayGainDb: -100 }).gainDb).toBe(-24);
    expect(calculateLoudnessGain({ replayGainDb: Number.NaN }).source).toBe('none');
  });

  it('projects public track fields into calculation metadata', () => {
    expect(loudnessMetadataFromTrack({
      loudness_gain_db: -3,
      loudness_lufs: -11,
      loudness_peak: 0.9,
    })).toEqual({ replayGainDb: -3, integratedLoudnessLufs: -11, peak: 0.9 });
  });
});
