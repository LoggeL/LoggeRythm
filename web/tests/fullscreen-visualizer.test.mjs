import assert from "node:assert/strict";
import test from "node:test";
import { compileSource, moduleUrl } from "./support/compile.mjs";

const stubs = {
  react: moduleUrl(`export const useEffect = callback => globalThis.__visualizerHarness.effects.push(callback); export const useRef = initial => globalThis.__visualizerHarness.ref(initial);`),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "@/lib/audioSpectrum": moduleUrl(`export const getAudioSpectrum = () => globalThis.__visualizerHarness.spectrum; export const subscribeAudioSpectrum = callback => globalThis.__visualizerHarness.subscribe(callback);`),
  "@/lib/visualizerDrive": new URL("../src/lib/visualizerDrive.ts", import.meta.url).href,
  "@/lib/visualizerShader": moduleUrl(`export const createVisualizerRenderer = gl => globalThis.__visualizerHarness.createRenderer(gl);`),
};
const { default: FullscreenVisualizer } = await import(await compileSource("src/components/FullscreenVisualizer.tsx", stubs, "visualizer"));

/** Starts on the app's default theme so the fallback test can return to it. */
const { DEFAULT_VISUALIZER_PALETTE: BRAND } = await import(stubs["@/lib/visualizerDrive"]);
const TEAL = { primary: "rgb(20, 180, 170)", secondary: "rgb(60, 200, 120)", gradient: ["rgb(5, 60, 70)", "rgb(20, 180, 170)", "rgb(180, 250, 230)"] };

function events() {
  const handlers = new Map();
  return {
    addEventListener(name, callback) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(callback); },
    removeEventListener(name, callback) { handlers.get(name)?.delete(callback); },
    emit(name, value) { for (const callback of handlers.get(name) ?? []) callback(value); },
    count() { return [...handlers.values()].reduce((total, values) => total + values.size, 0); },
  };
}

function harness({ reduced = false, webgl2 = true, width = 1440 } = {}) {
  let refIndex = 0, nextId = 0, timestamp = 0, cleanup = null;
  const frames = new Map(), subscribers = new Set(), refs = [], observers = [], timers = new Map(), renders = [], renderers = [];
  const motion = { ...events(), matches: reduced };
  const document = { ...events(), visibilityState: "visible" };
  const canvas = {
    ...events(), width: 1, height: 1, dataset: {},
    getContext: (kind) => (kind === "webgl2" && webgl2 ? { kind } : null),
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 900 }),
  };
  let anchor = { getBoundingClientRect: () => ({ left: 200, top: 160, width: 400, height: 400 }) };
  const state = {
    effects: [],
    spectrum: { bands: new Float32Array(48), bass: 0, mid: 0, treble: 0, energy: 0, onset: 0, active: false, deltaSeconds: 0, timeSeconds: 0 },
    ref(initial) { const index = refIndex++; return refs[index] ??= { current: index === 0 ? canvas : initial }; },
    subscribe(callback) { subscribers.add(callback); callback(state.spectrum); return () => subscribers.delete(callback); },
    createRenderer(gl) {
      const renderer = { gl, disposed: false, render(frame) { renders.push({ ...frame, colors: frame.colors.slice(), bass: frame.drive.bass, flow: frame.drive.flow }); }, dispose() { this.disposed = true; } };
      renderers.push(renderer);
      return renderer;
    },
  };
  globalThis.__visualizerHarness = state;
  globalThis.window = {
    devicePixelRatio: 2, matchMedia: () => motion,
    setTimeout: (callback) => { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  globalThis.document = document;
  globalThis.getComputedStyle = () => ({ borderTopLeftRadius: "8px" });
  globalThis.requestAnimationFrame = (callback) => { const id = ++nextId; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.observed = new Set(); this.disconnected = false; observers.push(this); }
    observe(target) { this.observed.add(target); } unobserve(target) { this.observed.delete(target); } disconnect() { this.disconnected = true; }
  };
  const anchorRef = { current: anchor };
  const props = { isPlaying: true, anchorRef, palette: BRAND };
  function render(next, { mount = false } = {}) {
    Object.assign(props, next);
    refIndex = 0;
    state.effects.length = 0;
    FullscreenVisualizer(props);
    // Effects: playing, palette, status callback, then the mount effect.
    const [playing, palette, status, main] = state.effects;
    if (mount) { playing(); palette(); status(); cleanup = main(); }
    else { playing(); palette(); status(); }
  }
  return {
    canvas, frames, subscribers, motion, document, observers, timers, renders, renderers, anchorRef,
    mount(next = {}) { render(next, { mount: true }); return () => cleanup(); },
    rerender: (next) => render(next),
    audio(bass = 0.8) {
      state.spectrum = { bands: new Float32Array(48).fill(0.6), bass, mid: 0.5, treble: 0.4, energy: 0.6, onset: 0.3, active: true, deltaSeconds: 1 / 30, timeSeconds: timestamp / 1000 + 0.001 };
      for (const subscriber of subscribers) subscriber(state.spectrum);
    },
    step(count = 1) {
      for (let i = 0; i < count; i++) {
        timestamp += 16.7;
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(timestamp);
      }
    },
    settle() { let guard = 0; while (frames.size) { this.step(); assert.ok(++guard < 2000, "the render loop must settle"); } return guard; },
  };
}

test("live audio renders every display frame; hidden documents release FFT, RAF and listeners", () => {
  const app = harness();
  const cleanup = app.mount();
  assert.equal(app.subscribers.size, 1);
  assert.equal(app.canvas.width, 1800, "buffer density is capped at 1.25× even on 2× screens");
  assert.equal(app.canvas.dataset.renderScale, "1.250");
  app.settle();
  const idle = app.renders.length;
  app.audio();
  app.step(10);
  assert.equal(app.renders.length, idle + 10, "one GPU pass per display frame at 60 Hz, not 30");
  const last = app.renders.at(-1);
  assert.equal(last.centerX, 400 * 1.25);
  assert.equal(last.halfWidth, 200 * 1.25);
  assert.equal(last.corner, 8 / 200);
  assert.ok(last.bass > 0 && last.flow > 0);
  app.document.visibilityState = "hidden";
  app.document.emit("visibilitychange");
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.frames.size, 0);
  app.document.visibilityState = "visible";
  app.document.emit("visibilitychange");
  assert.equal(app.subscribers.size, 1);
  cleanup();
  assert.equal(app.frames.size, 0);
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.document.count() + app.motion.count() + app.canvas.count(), 0);
  assert.ok(app.observers.every((observer) => observer.disconnected));
  assert.ok(app.renderers.every((renderer) => renderer.disposed));
});

test("pause stops polling the FFT, eases the scene to rest, then releases the loop", () => {
  const app = harness();
  const cleanup = app.mount();
  app.audio();
  app.step(20);
  const statuses = [];
  app.rerender({ onStatusChange: (status) => statuses.push(status) });
  app.rerender({ isPlaying: false });
  assert.equal(app.subscribers.size, 0, "a paused visualizer does not poll the shared FFT");
  assert.ok(app.frames.size > 0, "the last real signal gets a release envelope");
  const flow = app.renders.at(-1).flow;
  const frames = app.settle();
  assert.ok(frames > 10, "release is eased over several frames");
  assert.equal(app.renders.at(-1).bass, 0);
  assert.equal(app.renders.at(-1).flow, flow, "paused music doesn't keep the scene drifting");
  assert.deepEqual(statuses, ["paused"]);
  cleanup();
});

test("reduced motion draws one static frame and never subscribes", () => {
  const app = harness({ reduced: true });
  const cleanup = app.mount();
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.frames.size, 0);
  assert.equal(app.renders.length, 1);
  assert.equal(app.renders[0].intro, 1, "no fade-in animation either");
  app.motion.matches = false;
  app.motion.emit("change", { matches: false });
  assert.equal(app.subscribers.size, 1);
  app.motion.matches = true;
  app.motion.emit("change", { matches: true });
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.frames.size, 0);
  cleanup();
});

test("a new cover crossfades; a missing palette waits before falling back to the default theme", () => {
  const app = harness();
  const cleanup = app.mount();
  app.settle();
  const brand = app.renders.at(-1).colors;
  app.rerender({ palette: null });
  assert.equal(app.timers.size, 1, "no immediate flash to the default while the next cover is sampled");
  app.rerender({ palette: TEAL });
  assert.equal(app.timers.size, 0, "the arriving palette cancels the pending default");
  app.step(5);
  const mid = app.renders.at(-1).colors;
  assert.notDeepEqual(mid, brand);
  app.settle();
  const teal = app.renders.at(-1).colors;
  assert.ok((mid[4] - brand[4]) * (teal[4] - mid[4]) > 0, "mid-fade green channel lies between the default theme and the teal cover");
  app.rerender({ palette: null });
  [...app.timers.values()][0]();
  app.settle();
  assert.deepEqual(app.renders.at(-1).colors, brand, "no cover palette ends on the app's default theme");
  cleanup();
});

test("missing WebGL2 or a vanished artwork anchor fail loudly; a lost context is restored", () => {
  assert.throws(() => harness({ webgl2: false }).mount(), /braucht WebGL2/);
  const app = harness();
  const cleanup = app.mount();
  let prevented = false;
  app.canvas.emit("webglcontextlost", { preventDefault() { prevented = true; } });
  assert.ok(prevented, "the browser is told we want the context back");
  assert.equal(app.frames.size, 0);
  app.canvas.emit("webglcontextrestored");
  assert.equal(app.renderers.length, 2);
  app.anchorRef.current = null;
  assert.throws(() => app.step(), /lost its artwork anchor/);
  cleanup();
});
