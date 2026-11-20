import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// genreListener imports "./visualizerScenes" without an extension, like the app's bundler expects.
const resolver = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./visualizerScenes" && context.parentURL?.endsWith("/genreListener.ts")) {
      return next(new URL("../src/lib/visualizerScenes.ts", import.meta.url).href, context);
    }
    return next(specifier, context);
  },
});
const scenes = await import("../src/lib/visualizerScenes.ts");
const { classifyFeatures, createGenreListener, SCENE_REFERENCES } = await import("../src/lib/genreListener.ts");
resolver.deregister();

const {
  DEEZER_GENRE_SCENES, GENRE_SCENES, LISTEN_SECONDS, OVERRIDE_STREAK, SCENE_KEYS, SETTLE_SECONDS, UNDECIDED_SCENE,
  advanceDecision, initialDecision, metadataScene, sceneFingerprint, validateVisualizerPreferences,
} = scenes;

test("stored preferences: older saves mean automatic, legacy mode dropped, junk rejected", () => {
  assert.deepEqual(validateVisualizerPreferences({ enabled: true }), { enabled: true, scene: "auto" });
  assert.deepEqual(validateVisualizerPreferences({ enabled: false, mode: "aurora" }), { enabled: false, scene: "auto" });
  assert.deepEqual(validateVisualizerPreferences({ enabled: true, scene: "smoke" }), { enabled: true, scene: "smoke" });
  assert.throws(() => validateVisualizerPreferences({ enabled: true, scene: "disco" }), /unbekannte Szene: "disco"/);
  assert.throws(() => validateVisualizerPreferences(null), /Objekt/);
  assert.throws(() => validateVisualizerPreferences([]), /Objekt/);
  assert.throws(() => validateVisualizerPreferences({ enabled: "yes" }), /Ein\/Aus-Schalter/);
  assert.throws(() => validateVisualizerPreferences({ enabled: true, theme: "x" }), /unbekannte Felder: theme/);
});

test("Deezer genres map onto genre scenes; the first genre with a scene wins", () => {
  for (const scene of Object.values(DEEZER_GENRE_SCENES)) assert.ok(GENRE_SCENES.includes(scene));
  assert.deepEqual(metadataScene([{ id: "466", name: "Folk" }, { id: "106", name: "Electro" }]), { scene: "laser", genre: "Electro" });
  assert.deepEqual(metadataScene([{ id: "116", name: "Rap/Hip Hop" }, { id: "132", name: "Pop" }]), { scene: "monolith", genre: "Rap/Hip Hop" });
  assert.equal(metadataScene([{ id: "466", name: "Folk" }]), null);
  assert.equal(metadataScene([]), null);
  for (const key of SCENE_KEYS) assert.equal(typeof scenes.SCENE_LABELS[key], "string");
});

const guess = (scene, p) => [{ scene, p }, ...GENRE_SCENES.filter((s) => s !== scene).map((s) => ({ scene: s, p: (1 - p) / 5 }))];
const POP = { kind: "genre", scene: "bubbles", genre: "Pop" };

test("metadata decides at once; listening confirms it", () => {
  let decision = initialDecision(POP);
  assert.equal(decision.scene, "bubbles");
  assert.equal(decision.source, "metadata");
  assert.equal(decision.locked, false);
  // Too early: listening has not heard enough.
  assert.equal(advanceDecision(decision, POP, guess("bubbles", 0.8), LISTEN_SECONDS - 1), decision);
  decision = advanceDecision(decision, POP, guess("bubbles", 0.7), LISTEN_SECONDS);
  assert.equal(decision.locked, true);
  assert.match(decision.detail, /bestätigt \(70 %\)/);
});

test("listening overrules a genre only when confident for several evaluations in a row", () => {
  let decision = initialDecision(POP);
  for (let i = 0; i < OVERRIDE_STREAK - 1; i++) decision = advanceDecision(decision, POP, guess("laser", 0.8), LISTEN_SECONDS);
  assert.equal(decision.scene, "bubbles");
  // A weaker guess in between resets the streak.
  decision = advanceDecision(decision, POP, guess("laser", 0.4), LISTEN_SECONDS);
  assert.equal(decision.dissent, 0);
  for (let i = 0; i < OVERRIDE_STREAK; i++) decision = advanceDecision(decision, POP, guess("laser", 0.8), LISTEN_SECONDS);
  assert.equal(decision.scene, "laser");
  assert.equal(decision.source, "listening");
  assert.equal(decision.locked, true);
  assert.match(decision.detail, /Deezer sagt „Pop“, klingt aber nach Laser-Tunnel \(80 %\)/);
});

test("an unsure listener leaves the genre standing after the settle time", () => {
  const decision = advanceDecision(initialDecision(POP), POP, guess("laser", 0.3), SETTLE_SECONDS);
  assert.equal(decision.scene, "bubbles");
  assert.equal(decision.locked, true);
});

test("without a usable genre the step grid runs until listening decides", () => {
  const none = { kind: "none", names: ["Folk"] };
  let decision = initialDecision(none);
  assert.equal(decision.scene, UNDECIDED_SCENE);
  assert.match(decision.detail, /„Folk“/);
  decision = advanceDecision(decision, none, guess("smoke", 0.3), LISTEN_SECONDS);
  assert.equal(decision.scene, UNDECIDED_SCENE);
  decision = advanceDecision(decision, none, guess("smoke", 0.5), LISTEN_SECONDS);
  assert.equal(decision.scene, "smoke");
  assert.equal(decision.source, "listening");

  const failed = initialDecision({ kind: "error", message: "HTTP 502" });
  assert.match(failed.detail, /Genre nicht geladen \(HTTP 502\)/);
  // Still loading: listening waits for the genre instead of racing it.
  const loading = { kind: "loading" };
  assert.equal(advanceDecision(initialDecision(loading), loading, guess("smoke", 0.9), LISTEN_SECONDS).scene, UNDECIDED_SCENE);
});

test("the per-song fingerprint is stable per track and stays in range", () => {
  assert.deepEqual(sceneFingerprint("3135556"), sceneFingerprint("3135556"));
  assert.notDeepEqual(sceneFingerprint("3135556"), sceneFingerprint("3135557"));
  for (let i = 0; i < 200; i++) {
    const fp = sceneFingerprint(`track-${i}`);
    assert.ok(Number.isInteger(fp.sym) && fp.sym >= 3 && fp.sym <= 8);
    assert.ok(fp.speed >= 0.8 && fp.speed <= 1.25);
    assert.ok(fp.density >= 0.7 && fp.density <= 1.3);
    assert.ok(fp.twist >= -1 && fp.twist <= 1);
  }
  assert.throws(() => sceneFingerprint(""), /track id/);
});

/* ------------------------------------------------------------ listener */

/** 30 Hz frames: a kick on every beat plus an optional off-beat hat and steady pad. */
function* club({ bpm = 126, seconds = 8, pad = 0.25, drums = true } = {}) {
  const beat = 60 / bpm;
  for (let i = 0; i < seconds * 30; i++) {
    const t = i / 30;
    const sinceKick = t % beat, sinceHat = (t + beat / 2) % beat;
    const bands = new Float32Array(48);
    for (let b = 0; b < 48; b++) {
      const kick = drums && b < 8 ? Math.exp(-sinceKick * 9) : 0;
      const hat = drums && b > 36 ? 0.5 * Math.exp(-sinceHat * 30) : 0;
      const bed = b > 8 && b < 30 ? pad : 0.03;
      bands[b] = Math.min(1, kick + hat + bed);
    }
    yield { bands, active: true, timeSeconds: t };
  }
}

test("the listener measures tempo and pulse from spectrum frames", () => {
  const listener = createGenreListener();
  assert.equal(listener.features(), null);
  for (const frame of club({ bpm: 126 })) listener.push(frame);
  const features = listener.features();
  assert.ok(Math.abs(features.bpm - 126) < 6, `bpm ${features.bpm}`);
  assert.ok(features.onsetRate > 1.5, `onsets ${features.onsetRate}`);
  assert.ok(features.seconds >= 5.9);

  const padOnly = createGenreListener();
  for (const frame of club({ drums: false })) padOnly.push(frame);
  const calm = padOnly.features();
  assert.ok(calm.onsetRate < 0.5, `pad onsets ${calm.onsetRate}`);
  assert.ok(features.bassShare > calm.bassShare + 0.1, `bass ${features.bassShare} vs ${calm.bassShare}`);
});

test("paused frames add nothing and reset clears what was heard", () => {
  const listener = createGenreListener();
  for (const frame of club({ seconds: 3 })) listener.push({ ...frame, active: false });
  assert.equal(listener.seconds, 0);
  for (const frame of club({ seconds: 3 })) listener.push(frame);
  assert.ok(listener.seconds > 2.5);
  listener.reset();
  assert.equal(listener.seconds, 0);
  assert.throws(() => listener.push({ bands: new Float32Array(48), active: true, timeSeconds: Number.NaN }), /finite timestamp/);
  assert.throws(() => listener.push({ bands: new Float32Array(4), active: true, timeSeconds: 1 }), /at least 12/);
});

test("the classifier ranks each scene's own reference first and sums to one", () => {
  for (const scene of GENRE_SCENES) {
    for (const reference of SCENE_REFERENCES[scene]) {
      const ranking = classifyFeatures({ seconds: 6, ...reference });
      assert.equal(ranking[0].scene, scene);
      assert.ok(Math.abs(ranking.reduce((sum, g) => sum + g.p, 0) - 1) < 1e-9);
    }
  }
  assert.throws(() => classifyFeatures({ seconds: 6, bpm: Number.NaN, bassShare: 0, brightness: 0, onsetRate: 0, dynamics: 0, swing: 0 }), /bpm is not finite/);
});
