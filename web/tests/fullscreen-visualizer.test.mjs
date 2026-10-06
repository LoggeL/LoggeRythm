import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const source = await readFile(new URL("../src/components/FullscreenVisualizer.tsx", import.meta.url), "utf8");
const imports = {
  react: moduleUrl(`export const useEffect = callback => globalThis.__visualizerHarness.effects.push(callback); export const useRef = initial => globalThis.__visualizerHarness.ref(initial);`),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "@/lib/audioSpectrum": moduleUrl(`export const getAudioSpectrum = () => globalThis.__visualizerHarness.spectrum; export const subscribeAudioSpectrum = callback => globalThis.__visualizerHarness.subscribe(callback);`),
  "@/lib/visualizerScene": new URL("../src/lib/visualizerScene.ts", import.meta.url).href,
};
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
    assert.ok(imports[name], `Unexpected fullscreen visualizer import: ${name}`);
    return `from ${JSON.stringify(imports[name])}`;
  });
const { default: FullscreenVisualizer } = await import(moduleUrl(compiled));

function events() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener(name, callback) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(callback); },
    removeEventListener(name, callback) { handlers.get(name)?.delete(callback); },
    emit(name, value) { for (const callback of handlers.get(name) ?? []) callback(value); },
    count() { return [...handlers.values()].reduce((total, values) => total + values.size, 0); },
  };
}

function harness({ reduced = false, width = 900 } = {}) {
  let cleared = 0, refIndex = 0, nextId = 0, timestamp = 0;
  const frames = new Map(), subscribers = new Set(), refs = [], observers = [];
  const motion = { ...events(), matches: reduced };
  const document = { ...events(), visibilityState: "visible" };
  const scroller = events();
  const gradient = () => ({ addColorStop() {} });
  const context = {
    clearRect() { cleared++; }, save() {}, restore() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc() {}, ellipse() {}, translate() {}, rotate() {}, bezierCurveTo() {}, setTransform() {}, createLinearGradient: gradient, createRadialGradient: gradient,
  };
  const canvas = { width: 1, height: 1, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 600 }) };
  const cover = { getBoundingClientRect: () => ({ left: width / 2 - 140, top: 80, width: 280, height: 280 }), closest: () => scroller };
  const state = {
    effects: [],
    spectrum: { bands: new Float32Array(48), bass: 0, mid: 0, treble: 0, energy: 0, onset: 0, active: false, deltaSeconds: 0, timeSeconds: 0 },
    ref(initial) { const index = refIndex++; return refs[index] ??= { current: initial === null ? canvas : initial }; },
    subscribe(callback) { subscribers.add(callback); callback(state.spectrum); return () => subscribers.delete(callback); },
  };
  globalThis.__visualizerHarness = state;
  globalThis.window = { devicePixelRatio: 3, matchMedia: () => motion };
  globalThis.document = document;
  globalThis.requestAnimationFrame = (callback) => { const id = ++nextId; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  };
  globalThis.IntersectionObserver = class extends globalThis.ResizeObserver {};
  return {
    canvas, frames, subscribers, motion, document, scroller, observers,
    cleared: () => cleared,
    mount(isPlaying = true) {
      refIndex = 0;
      state.effects.length = 0;
      FullscreenVisualizer({ isPlaying, anchorRef: { current: cover }, surfaceRef: { current: {} } });
      return state.effects[0]();
    },
    audio() {
      state.spectrum = { bands: new Float32Array(48).fill(0.6), bass: 0.8, mid: 0.5, treble: 0.4, energy: 0.6, onset: 0.3, active: true, deltaSeconds: 1 / 30, timeSeconds: 1 };
      for (const subscriber of subscribers) subscriber(state.spectrum);
    },
    step(count = 1) {
      for (let i = 0; i < count; i++) {
        timestamp += 34;
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(timestamp);
      }
    },
  };
}

test("waiting audio has a static scene, real data starts motion, hidden panels release FFT and RAF", () => {
  const app = harness();
  const cleanup = app.mount();
  assert.equal(app.subscribers.size, 1);
  assert.equal(app.frames.size, 0, "no fake motion before the analyser supplies data");
  app.audio();
  app.step(3);
  assert.equal(app.frames.size, 1);
  const before = app.cleared();
  app.document.visibilityState = "hidden";
  app.document.emit("visibilitychange");
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.frames.size, 0);
  app.step(4);
  assert.equal(app.cleared(), before);
  app.document.visibilityState = "visible";
  app.document.emit("visibilitychange");
  assert.equal(app.subscribers.size, 1);
  cleanup();
  assert.equal(app.frames.size, 0);
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.document.count() + app.motion.count() + app.scroller.count(), 0);
  assert.ok(app.observers.every((observer) => observer.disconnected));
});

test("pause smoothly settles the current scene, then releases all animation work", () => {
  const app = harness();
  let cleanup = app.mount();
  app.audio();
  app.step(8);
  cleanup();
  cleanup = app.mount(false);
  assert.equal(app.subscribers.size, 0, "a paused visualizer does not poll the shared FFT");
  assert.equal(app.frames.size, 1, "the previous real signal gets a short release envelope");
  app.step(60);
  assert.equal(app.frames.size, 0);
  cleanup();
});

test("reduced motion is static, live changes stop motion and mobile DPR stays bounded", () => {
  const app = harness({ reduced: true, width: 350 });
  const cleanup = app.mount();
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.frames.size, 0);
  assert.equal(app.canvas.width, 438);
  app.motion.matches = false;
  app.motion.emit("change", { matches: false });
  app.audio();
  app.step(3);
  assert.equal(app.frames.size, 1);
  app.motion.matches = true;
  app.motion.emit("change", { matches: true });
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.frames.size, 0);
  cleanup();
});
