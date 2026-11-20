import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VISUALIZER_PALETTE, MAX_WAVES, SPECTRUM_TEXELS, advanceDrive, blendColors, createDriveTracker, ingestSpectrum,
  paletteColors, parseCssColor, triggerWave, validateVisualizerPreferences,
} from "../src/lib/visualizerDrive.ts";

const FRAME = 1 / 30;

/** A synthetic track: a kick every `period` seconds over an optional steady bed. */
function frameAt(time, { period = 0.5, gain = 1, bed = 0.1, kick = true } = {}) {
  const phase = (time % period) / period;
  const hit = kick ? Math.exp(-phase * 9) : 0;
  const bands = new Float32Array(48);
  for (let i = 0; i < 48; i++) bands[i] = Math.min(1, (i < 14 ? bed + hit * 0.7 : bed * 0.6 + 0.05) * gain);
  const bass = Math.min(1, (bed + hit * 0.7) * gain);
  return { bands, bass, mid: Math.min(1, bed * gain), treble: Math.min(1, 0.05 * gain), energy: Math.min(1, (bed + hit * 0.3) * gain), active: true, timeSeconds: time };
}

function play(tracker, seconds, options, start = 0) {
  let beats = 0;
  for (let t = start; t < start + seconds; t += FRAME) {
    if (ingestSpectrum(tracker, frameAt(t, options))) beats++;
    advanceDrive(tracker, 1 / 60);
    advanceDrive(tracker, 1 / 60);
  }
  return beats;
}

test("kicks are detected at their tempo, not more often", () => {
  const tracker = createDriveTracker();
  // 120 BPM for 8 s → 16 kicks; the first second is the detector learning the track.
  const beats = play(tracker, 8, { period: 0.5 });
  assert.ok(beats >= 13 && beats <= 16, `expected ~16 kicks at 120 BPM, got ${beats}`);
  assert.equal(tracker.drive.beats, beats);
});

test("a sustained tone without transients produces no beats", () => {
  const tracker = createDriveTracker();
  // The tone's own onset is a genuine transient; after it, nothing may fire.
  play(tracker, 1, { kick: false, bed: 0.6 });
  assert.equal(play(tracker, 6, { kick: false, bed: 0.6 }, 1), 0);
  assert.equal(tracker.drive.beat, 0);
});

test("adaptive gain makes quiet and loud masters move alike", () => {
  const quiet = createDriveTracker(), loud = createDriveTracker();
  let quietPeak = 0, loudPeak = 0;
  for (let t = 0; t < 6; t += FRAME) {
    ingestSpectrum(quiet, frameAt(t, { gain: 0.35 }));
    ingestSpectrum(loud, frameAt(t, { gain: 1.2 }));
    advanceDrive(quiet, FRAME);
    advanceDrive(loud, FRAME);
    if (t > 3) { quietPeak = Math.max(quietPeak, quiet.drive.bass); loudPeak = Math.max(loudPeak, loud.drive.bass); }
  }
  assert.ok(quietPeak > 0.6, `quiet track still punches (${quietPeak})`);
  assert.ok(Math.abs(quietPeak - loudPeak) < 0.2, `similar motion: quiet ${quietPeak}, loud ${loudPeak}`);
});

test("rendering at display rate eases between 30 Hz spectrum frames", () => {
  const tracker = createDriveTracker();
  ingestSpectrum(tracker, frameAt(0.0001));
  const samples = [];
  for (let i = 0; i < 4; i++) { advanceDrive(tracker, 1 / 120); samples.push(tracker.drive.bass); }
  assert.ok(samples.every((value, index) => index === 0 || value > samples[index - 1]), "bass rises frame by frame, not in one jump");
  assert.ok(samples[3] < 1);
});

test("waves are emitted on kicks, age, recycle slots and expire", () => {
  const tracker = createDriveTracker();
  for (let i = 0; i < MAX_WAVES + 3; i++) triggerWave(tracker, 0.5);
  const strengths = [...tracker.drive.waves].filter((_, index) => index % 2 === 1);
  assert.equal(strengths.length, MAX_WAVES);
  assert.ok(strengths.every((value) => value === 0.5), "a dense beat reuses slots instead of growing");
  assert.equal(advanceDrive(tracker, 1), true);
  // Long frames are clamped to 100 ms, so age the waves in display-sized steps.
  for (let i = 0; i < 4 * 60; i++) advanceDrive(tracker, 1 / 60);
  assert.ok([...tracker.drive.waves].every((value) => value === 0), "expired waves free their slot");
  assert.throws(() => triggerWave(tracker, 2), /between 0 and 1/);
});

test("pause settles to a still scene and reports when the loop may stop", () => {
  const tracker = createDriveTracker();
  play(tracker, 3, {});
  const flow = tracker.drive.flow;
  assert.ok(flow > 0, "motion phase advances while music plays");
  ingestSpectrum(tracker, { ...frameAt(3), active: false });
  let frames = 0;
  while (advanceDrive(tracker, 1 / 60)) { frames++; assert.ok(frames < 600, "the drive must settle within 10 s"); }
  assert.equal(tracker.drive.flow, flow, "paused music doesn't move the scene");
  assert.equal(tracker.drive.bass + tracker.drive.level + tracker.drive.beat, 0);
  assert.ok(tracker.drive.spectrum.every((value) => value === 0));
  assert.equal(tracker.drive.spectrum.length, SPECTRUM_TEXELS);
});

test("bad inputs fail loudly", () => {
  const tracker = createDriveTracker();
  assert.throws(() => ingestSpectrum(tracker, { ...frameAt(1), bass: NaN }), /bass must be a finite value/);
  assert.throws(() => ingestSpectrum(tracker, { ...frameAt(1), timeSeconds: Infinity }), /finite timestamp/);
  assert.throws(() => ingestSpectrum(tracker, { ...frameAt(1), bands: new Float32Array(4) }), /bands/);
  assert.throws(() => advanceDrive(tracker, -1), /non-negative/);
  assert.throws(() => createDriveTracker(4), /at least 8/);
});

test("cover palettes parse, crossfade and reject malformed colours", () => {
  assert.deepEqual(parseCssColor("rgb(255, 255, 255)"), [1, 1, 1]);
  assert.deepEqual(parseCssColor("#000000"), [0, 0, 0]);
  assert.throws(() => parseCssColor("purple"), /rgb\(r, g, b\)/);
  assert.throws(() => parseCssColor("rgb(300, 0, 0)"), /out of range/);
  const brand = paletteColors(DEFAULT_VISUALIZER_PALETTE);
  const teal = paletteColors({ primary: "rgb(20, 180, 170)", secondary: "rgb(60, 200, 120)", gradient: ["rgb(5, 60, 70)", "rgb(20, 180, 170)", "rgb(180, 250, 230)"] });
  const current = brand.slice();
  assert.equal(blendColors(current, teal, 0.1), true);
  assert.ok(current[4] < brand[4] && current[4] > teal[4], "halfway between covers, not a hard cut");
  let frames = 0;
  while (blendColors(current, teal, 1 / 60)) frames++;
  assert.ok(frames > 20 && frames < 200, `crossfade takes a moment (${frames} frames)`);
  assert.deepEqual(current, teal);
});

test("stored preferences: default on, legacy scene choice dropped, junk rejected", () => {
  assert.deepEqual(validateVisualizerPreferences({ enabled: true }), { enabled: true });
  assert.deepEqual(validateVisualizerPreferences({ enabled: false, mode: "aurora" }), { enabled: false });
  assert.throws(() => validateVisualizerPreferences(null), /Objekt/);
  assert.throws(() => validateVisualizerPreferences([]), /Objekt/);
  assert.throws(() => validateVisualizerPreferences({ enabled: "yes" }), /Ein\/Aus-Schalter/);
  assert.throws(() => validateVisualizerPreferences({ enabled: true, theme: "x" }), /unbekannte Felder: theme/);
});
