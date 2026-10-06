import assert from "node:assert/strict";
import test from "node:test";
import { drawVisualizerScene, visualizerGeometry, validateVisualizerPreferences } from "../src/lib/visualizerScene.ts";

function recordingContext() {
  const calls = [];
  const numeric = (name) => (...args) => {
    assert.ok(args.every((value) => typeof value === "boolean" || Number.isFinite(value)), `${name} requires finite coordinates`);
    calls.push([name, ...args]);
  };
  const gradient = () => ({ addColorStop(offset, color) { assert.ok(offset >= 0 && offset <= 1); assert.equal(typeof color, "string"); } });
  const context = {
    clearRect: numeric("clear"), fillRect: numeric("fillRect"), moveTo: numeric("moveTo"), lineTo: numeric("lineTo"),
    arc: numeric("arc"), ellipse: numeric("ellipse"), translate: numeric("translate"), rotate: numeric("rotate"), bezierCurveTo: numeric("bezier"),
    createLinearGradient: gradient, createRadialGradient: gradient,
    save() {}, restore() {}, beginPath() {}, fill() { calls.push(["fill"]); }, stroke() { calls.push(["stroke"]); },
  };
  return { calls, context };
}
const palette = { colors: ["#6131e8", "#be83ff", "#ffa2db"], primary: "#be83ff", rgb: [190, 131, 255] };
const quiet = { bands: new Float32Array(48), bass: 0, mid: 0, treble: 0, energy: 0, onset: 0, phase: 0 };
const playing = { bands: Float32Array.from({ length: 48 }, (_, index) => (index % 8 + 1) / 9), bass: 0.7, mid: 0.5, treble: 0.6, energy: 0.6, onset: 0.4, phase: 3.2 };

test("cover anchoring follows the actual layout and rejects invalid dimensions", () => {
  const scene = visualizerGeometry(920, 600, 430, 250, 280, 280);
  assert.equal(scene.x, 430);
  assert.equal(scene.y, 250);
  assert.equal(scene.compact, false);
  assert.equal(visualizerGeometry(350, 440, 175, 130, 180, 180).compact, true);
  assert.throws(() => visualizerGeometry(0, 600, 430, 250, 280, 280), /geometry/);
  assert.throws(() => visualizerGeometry(900, 600, NaN, 250, 280, 280), /geometry/);
});

test("all three modes form distinct finite scenes in mobile and desktop layouts", () => {
  for (const width of [1, 350, 920]) {
    const recordings = new Map();
    for (const mode of ["orbit", "aurora", "constellation"]) {
      const { calls, context } = recordingContext();
      drawVisualizerScene(context, visualizerGeometry(width, 460, width / 2, 170, 180, 180), palette, playing, mode);
      assert.ok(calls.length > 100, `${mode} paints a complete scene`);
      recordings.set(mode, calls);
    }
    assert.notDeepEqual(recordings.get("orbit"), recordings.get("aurora"));
    assert.notDeepEqual(recordings.get("aurora"), recordings.get("constellation"));
  }
});

test("real frequency levels and bass attacks visibly expand the orbit", () => {
  const geometry = visualizerGeometry(900, 600, 450, 280, 280, 280);
  const silentContext = recordingContext(), liveContext = recordingContext();
  drawVisualizerScene(silentContext.context, geometry, palette, quiet, "orbit");
  drawVisualizerScene(liveContext.context, geometry, palette, playing, "orbit");
  const longestRay = (calls) => Math.max(...calls.filter(([name]) => name === "lineTo").map(([, x, y]) => Math.hypot(x - geometry.x, y - geometry.y)));
  assert.ok(longestRay(liveContext.calls) > longestRay(silentContext.calls) + 30);
});

test("paused and missing audio render a stable scene without randomized movement", () => {
  for (const mode of ["orbit", "aurora", "constellation"]) {
    const first = recordingContext(), second = recordingContext();
    const geometry = visualizerGeometry(900, 600, 450, 250, 280, 280);
    drawVisualizerScene(first.context, geometry, palette, quiet, mode);
    drawVisualizerScene(second.context, geometry, palette, quiet, mode);
    assert.deepEqual(first.calls, second.calls);
  }
});

test("invalid palette and persisted choices fail with a specific error", () => {
  const geometry = visualizerGeometry(900, 600, 450, 250, 280, 280);
  assert.throws(() => drawVisualizerScene(recordingContext().context, geometry, { ...palette, colors: ["#fff"] }, playing, "orbit"), /palette/);
  assert.throws(() => validateVisualizerPreferences(null), /Objekt/);
  assert.throws(() => validateVisualizerPreferences({ enabled: true, mode: "made-up" }), /ungültigen/);
  assert.throws(() => validateVisualizerPreferences({ enabled: "yes", mode: "orbit" }), /ungültigen/);
  const choice = { enabled: false, mode: "aurora" };
  assert.equal(validateVisualizerPreferences(choice), choice);
});
