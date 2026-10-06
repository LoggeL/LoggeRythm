import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const source = await readFile(new URL("../src/components/BassReactiveArtwork.tsx", import.meta.url), "utf8");
const imports = {
  react: moduleUrl(`export const useEffect = callback => globalThis.__bassHarness.effects.push(callback); export const useRef = initial => globalThis.__bassHarness.ref(initial);`),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "@/store/player": moduleUrl(`export const usePlayerStore = selector => selector({isPlaying: globalThis.__bassHarness.isPlaying});`),
  "@/lib/audioSpectrum": moduleUrl(`export const subscribeAudioSpectrum = callback => globalThis.__bassHarness.subscribe(callback);`),
  "@/lib/artworkPulse": new URL("../src/lib/artworkPulse.ts", import.meta.url).href,
};
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
    assert.ok(imports[name], `Unexpected bass artwork import: ${name}`);
    return `from ${JSON.stringify(imports[name])}`;
  });
const { default: BassReactiveArtwork } = await import(moduleUrl(compiled));

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name, value) { for (const callback of listeners.get(name) ?? []) callback(value); },
    count() { return [...listeners.values()].reduce((total, entries) => total + entries.size, 0); },
  };
}
function harness() {
  const parent = { style: { transform: "none" }, width: 280, height: 280 };
  const artwork = { style: {}, dataset: {}, parentElement: parent };
  const motion = { ...eventTarget(), matches: false };
  const document = { ...eventTarget(), visibilityState: "visible" };
  const subscribers = new Set(), refs = [], observers = [];
  let refIndex = 0;
  const fixture = {
    isPlaying: true,
    effects: [],
    ref(initial) { const index = refIndex++; return refs[index] ??= { current: index === 0 ? artwork : initial }; },
    subscribe(callback) { subscribers.add(callback); callback({ active: false }); return () => subscribers.delete(callback); },
  };
  globalThis.__bassHarness = fixture;
  globalThis.window = { matchMedia: () => motion };
  globalThis.document = document;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(value) { assert.equal(value, parent, "observe stable outer geometry, not the moving artwork"); }
    disconnect() { this.disconnected = true; }
  };
  const render = () => { refIndex = 0; fixture.effects.length = 0; BassReactiveArtwork({ children: "cover" }); };
  render();
  fixture.effects[0]();
  const cleanup = fixture.effects[1]();
  return {
    parent, artwork, motion, document, subscribers, cleanup,
    show(visible) { observers[0].callback([{ isIntersecting: visible }]); },
    play(value) { fixture.isPlaying = value; render(); fixture.effects[0](); },
    audio(bass = 0.85, onset = 0.5) { for (const callback of subscribers) callback({ active: true, bass, onset, deltaSeconds: 1 / 30 }); },
    disconnected: () => observers[0].disconnected,
  };
}

test("actual bass scales the complete inner artwork while its anchor stays unchanged", () => {
  const app = harness();
  assert.equal(app.subscribers.size, 0, "offscreen artwork must not subscribe");
  app.show(true);
  assert.equal(app.subscribers.size, 1);
  app.audio();
  app.audio();
  const scale = Number(app.artwork.style.transform.match(/scale\(([^)]+)\)/)[1]);
  assert.ok(scale > 1.04 && scale <= 1.07);
  assert.equal(app.parent.style.transform, "none");
  assert.equal(app.parent.width, 280);
  app.play(false);
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.artwork.style.transform, "translateZ(0) scale(1.00000)");
  assert.match(app.artwork.style.transition, /180ms/);
  app.play(true);
  app.audio();
  assert.equal(app.subscribers.size, 1);
  app.cleanup();
  assert.equal(app.subscribers.size, 0);
  assert.ok(app.disconnected());
  assert.equal(app.document.count() + app.motion.count(), 0);
});

test("hidden, offscreen and reduced-motion artwork releases FFT and resets without idle motion", () => {
  const app = harness();
  app.show(true);
  app.audio();
  app.document.visibilityState = "hidden";
  app.document.emit("visibilitychange");
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.artwork.style.transform, "translateZ(0) scale(1.00000)");
  app.document.visibilityState = "visible";
  app.document.emit("visibilitychange");
  app.audio();
  app.motion.matches = true;
  app.motion.emit("change", { matches: true });
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.artwork.style.transition, "none");
  app.motion.matches = false;
  app.motion.emit("change", { matches: false });
  app.show(false);
  assert.equal(app.subscribers.size, 0);
  assert.equal(app.artwork.style.willChange, "auto");
  app.cleanup();
});
