import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateLoudnessGain,
  loudnessMetadataFromTrack,
} from "../src/lib/loudness.ts";

function closeTo(value, expected) {
  assert.ok(value > expected - 0.000001 && value < expected + 0.000001);
}

test("loudness calculation is neutral without ReplayGain/R128 metadata", () => {
  assert.deepEqual(calculateLoudnessGain(null), {
    targetLufs: -14,
    gainDb: 0,
    gainLinear: 1,
    source: "none",
  });
});

test("ReplayGain adjustment wins over integrated LUFS", () => {
  const gain = calculateLoudnessGain({ replayGainDb: -6, integratedLoudnessLufs: -9 });
  assert.equal(gain.source, "metadata");
  assert.equal(gain.gainDb, -6);
  closeTo(gain.gainLinear, 10 ** (-6 / 20));
});

test("integrated loudness attenuates loud tracks but never digitally boosts quiet tracks", () => {
  assert.equal(calculateLoudnessGain({ integratedLoudnessLufs: -8 }).gainDb, -6);
  assert.equal(calculateLoudnessGain({ integratedLoudnessLufs: -20 }).gainDb, 0);
});

test("gain is bounded and non-finite metadata is ignored", () => {
  assert.equal(calculateLoudnessGain({ replayGainDb: -100 }).gainDb, -24);
  assert.equal(calculateLoudnessGain({ replayGainDb: Number.NaN }).source, "none");
});

test("track wire fields map to public loudness metadata", () => {
  assert.deepEqual(loudnessMetadataFromTrack({
    loudness_gain_db: -3,
    loudness_lufs: -11,
    loudness_peak: 0.9,
  }), { replayGainDb: -3, integratedLoudnessLufs: -11, peak: 0.9 });
});
