import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
  removeItem: (key) => saved.delete(key),
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  dispatchEvent: () => true,
};

const {
  AUDIO_EFFECTS_STORAGE_KEY,
  DEFAULT_AUDIO_EFFECTS,
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  EQ_PRESET_GAINS,
  buildEqualPowerCrossfadeCurves,
  computeCrossfadeWallDuration,
  equalPowerWeights,
  isAudioEffectsActive,
  validateAudioEffects,
} = await import("../src/lib/audioEffects.ts");
const { useAudioEffectsStore } = await import("../src/store/audioEffects.ts");
resolver.deregister();

beforeEach(() => {
  saved.clear();
  useAudioEffectsStore.setState({ ...useAudioEffectsStore.getInitialState(), hydrated: false }, true);
});

test("buildEqualPowerCrossfadeCurves maintains constant acoustic power and exact endpoints", () => {
  const { outgoing, incoming } = buildEqualPowerCrossfadeCurves(65, 1, 1, 0);
  assert.equal(outgoing.length, 65);
  assert.equal(incoming.length, 65);
  assert.equal(outgoing[0], 1);
  assert.equal(incoming[0], 0);
  assert.equal(outgoing[64], 0);
  assert.equal(incoming[64], 1);
  // Every sample point obeys cos^2 + sin^2 === 1 (no ~3 dB linear midpoint dip).
  for (let i = 0; i < outgoing.length; i++) {
    const power = outgoing[i] * outgoing[i] + incoming[i] * incoming[i];
    assert.ok(Math.abs(power - 1) < 1e-5, `sample ${i} power=${power}`);
  }
  assert.ok(Math.abs(outgoing[32] - Math.SQRT1_2) < 1e-5);
  assert.ok(Math.abs(incoming[32] - Math.SQRT1_2) < 1e-5);
});

test("buildEqualPowerCrossfadeCurves supports mid-fade rescheduling and per-deck loudness peaks", () => {
  const { outgoing, incoming } = buildEqualPowerCrossfadeCurves(17, 0.8, 0.5, 0.5);
  assert.ok(Math.abs(outgoing[0] - Math.SQRT1_2 * 0.8) < 1e-5);
  assert.ok(Math.abs(incoming[0] - Math.SQRT1_2 * 0.5) < 1e-5);
  assert.equal(outgoing[16], 0);
  assert.equal(incoming[16], 0.5);
});

test("buildEqualPowerCrossfadeCurves and equalPowerWeights fail loud on invalid inputs", () => {
  assert.throws(() => buildEqualPowerCrossfadeCurves(1, 1, 1), RangeError);
  assert.throws(() => buildEqualPowerCrossfadeCurves(16, -0.1, 1), RangeError);
  assert.throws(() => buildEqualPowerCrossfadeCurves(16, 1, 1.2), RangeError);
  assert.throws(() => buildEqualPowerCrossfadeCurves(16, 1, 1, Number.NaN), RangeError);
  assert.throws(() => equalPowerWeights(-0.01), RangeError);
  assert.throws(() => equalPowerWeights(1.01), RangeError);

  const mid = equalPowerWeights(0.5);
  assert.ok(Math.abs(mid.outgoing - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(mid.incoming - Math.SQRT1_2) < 1e-12);
});

test("validateAudioEffects validates strictly and fails loudly on malformed stored payloads", () => {
  const valid = validateAudioEffects({
    eqEnabled: true,
    preset: "bass",
    bands: [6, 3.5, -1, 0.5, 1.5],
    compressorEnabled: false,
    playbackRate: 1.25,
  });
  assert.equal(valid.preset, "bass");
  assert.equal(isAudioEffectsActive(DEFAULT_AUDIO_EFFECTS), false);
  assert.equal(isAudioEffectsActive(valid), true);
  assert.equal(isAudioEffectsActive({ ...DEFAULT_AUDIO_EFFECTS, compressorEnabled: true }), true);
  assert.equal(isAudioEffectsActive({ ...DEFAULT_AUDIO_EFFECTS, playbackRate: 1.5 }), true);

  assert.throws(() => validateAudioEffects(null), new RegExp(AUDIO_EFFECTS_STORAGE_KEY));
  assert.throws(() => validateAudioEffects({ ...DEFAULT_AUDIO_EFFECTS, preset: "metal" }), /Unbekanntes EQ-Preset/);
  assert.throws(() => validateAudioEffects({ ...DEFAULT_AUDIO_EFFECTS, bands: [0, 0, 0] }), /genau 5 Werte/);
  assert.throws(() => validateAudioEffects({ ...DEFAULT_AUDIO_EFFECTS, bands: [15, 0, 0, 0, 0] }), /zwischen -12 und 12/);
  assert.throws(() => validateAudioEffects({ ...DEFAULT_AUDIO_EFFECTS, playbackRate: 4 }), /Wiedergabegeschwindigkeit/);
});

test("useAudioEffectsStore manages presets, custom bands, persistence, hydration and fail-loud corruption", () => {
  const store = () => useAudioEffectsStore.getState();

  store().applyPreset("bass");
  assert.equal(store().eqEnabled, true);
  assert.equal(store().preset, "bass");
  assert.deepEqual(store().bands, [...EQ_PRESET_GAINS.bass]);

  store().applyPreset("late_night");
  assert.equal(store().compressorEnabled, true);
  store().applyPreset("vocal");
  assert.equal(store().compressorEnabled, false);

  store().setBandGain(0, 20); // clamps to EQ_MAX_DB
  store().setBandGain(EQ_BANDS.length - 1, -20); // clamps to EQ_MIN_DB
  assert.equal(store().preset, "custom");
  assert.equal(store().bands[0], EQ_MAX_DB);
  assert.equal(store().bands[4], EQ_MIN_DB);
  assert.throws(() => store().setBandGain(99, 2), RangeError);

  store().setPlaybackRate(1.5);
  assert.equal(store().playbackRate, 1.5);
  assert.throws(() => store().setPlaybackRate(0.1), RangeError);

  // Persist round-trip via fresh hydration.
  const persisted = saved.get(AUDIO_EFFECTS_STORAGE_KEY);
  assert.ok(persisted);
  useAudioEffectsStore.setState({ ...useAudioEffectsStore.getInitialState(), hydrated: false }, true);
  store().hydrate();
  assert.equal(store().hydrated, true);
  assert.equal(store().preset, "custom");
  assert.equal(store().playbackRate, 1.5);

  store().reset();
  assert.deepEqual(store().bands, [...DEFAULT_AUDIO_EFFECTS.bands]);
  assert.equal(store().eqEnabled, false);
  assert.equal(store().compressorEnabled, false);
  assert.equal(store().playbackRate, 1);

  // Corrupt persisted settings fail loudly during hydrate instead of silently resetting.
  saved.set(AUDIO_EFFECTS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_AUDIO_EFFECTS, preset: "broken" }));
  useAudioEffectsStore.setState({ ...useAudioEffectsStore.getInitialState(), hydrated: false }, true);
  assert.throws(() => store().hydrate(), /Unbekanntes EQ-Preset/);
});

test("computeCrossfadeWallDuration scales crossfade window by playbackRate and clamps to remaining media", () => {
  assert.equal(computeCrossfadeWallDuration(6, 6, 1), 6);
  // At 2x speed, 6 media seconds take 3 wall-clock seconds so outgoing doesn't finish mid-fade.
  assert.equal(computeCrossfadeWallDuration(6, 6, 2), 3);
  // At 0.75x speed, 6 media seconds take 8 wall-clock seconds.
  assert.equal(computeCrossfadeWallDuration(6, 6, 0.75), 8);
  // Late trigger with only 4 media seconds remaining clamps to 4 / rate wall seconds.
  assert.equal(computeCrossfadeWallDuration(6, 4, 2), 2);

  assert.throws(() => computeCrossfadeWallDuration(0, 6, 1), RangeError);
  assert.throws(() => computeCrossfadeWallDuration(6, 0, 1), RangeError);
  assert.throws(() => computeCrossfadeWallDuration(6, 6, 0), RangeError);
});
