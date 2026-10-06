import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const resolver = registerHooks({
  resolve(specifier, context, next) {
    if ((specifier === "./audioAnalyser" || specifier === "./visualizerSignal") && context.parentURL.endsWith('/audioSpectrum.ts')) {
      return next(new URL(`../src/lib/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return next(specifier, context);
  },
});
const { createAudioSpectrumSource, getAudioSpectrum } = await import('../src/lib/audioSpectrum.ts');
resolver.deregister();

function environment() {
  const callbacks = new Map();
  const events = new Map();
  let next = 0;
  let reads = 0;
  const node = {
    frequencyBinCount: 1024, fftSize: 2048, context: { state: 'running', sampleRate: 44100 },
    getByteFrequencyData(bytes) { reads++; bytes.fill(160); },
  };
  let analyser = node;
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name) };
  const motion = { matches: false, addEventListener: (name, fn) => events.set(`motion:${name}`, fn), removeEventListener: (name) => events.delete(`motion:${name}`) };
  const source = createAudioSpectrumSource({
    readAnalyser: () => analyser,
    requestFrame: (fn) => { const id = ++next; callbacks.set(id, fn); return id; },
    cancelFrame: (id) => callbacks.delete(id), document, motion,
  });
  return { source, callbacks, events, node, document, motion, reads: () => reads, setAnalyser: (value) => { analyser = value; },
    step(time) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(fn => fn(time)); } };
}

test('server import exposes a quiet spectrum without touching browser globals', () => {
  assert.equal(getAudioSpectrum().active, false);
  assert.equal(getAudioSpectrum().bands.length, 48);
  assert.equal(getAudioSpectrum().energy, 0);
});

test('multiple indicators share one FFT read and final unmount releases all work', () => {
  const env = environment();
  const stopA = env.source.subscribe(() => {});
  const stopB = env.source.subscribe(() => {});
  assert.equal(env.callbacks.size, 1);
  env.step(40);
  assert.equal(env.reads(), 1);
  assert.equal(env.source.getFrame().active, true);
  assert.ok(env.source.getFrame().energy > 0);
  const bands = env.source.getFrame().bands;
  env.step(50);
  assert.equal(env.reads(), 1, '60Hz callbacks do not multiply FFT reads');
  env.step(80);
  assert.equal(env.reads(), 2);
  assert.equal(env.source.getFrame().bands, bands, 'spectrum arrays are reused');
  stopA();
  assert.equal(env.callbacks.size, 1);
  stopB(); stopB();
  assert.equal(env.callbacks.size, 0);
  assert.equal(env.events.size, 0);
  assert.equal(env.source.getFrame().active, false);
});

test('hidden and reduced-motion views stop FFT work and resume with fresh measurements', () => {
  const env = environment();
  const stop = env.source.subscribe(() => {});
  env.step(40);
  env.document.visibilityState = 'hidden';
  env.events.get('visibilitychange')();
  assert.equal(env.callbacks.size, 0);
  assert.equal(env.source.getFrame().energy, 0);
  env.document.visibilityState = 'visible';
  env.events.get('visibilitychange')();
  env.step(80);
  assert.equal(env.reads(), 2);
  env.motion.matches = true;
  env.events.get('motion:change')();
  assert.equal(env.callbacks.size, 0);
  assert.equal(env.source.getFrame().active, false);
  env.motion.matches = false;
  env.events.get('motion:change')();
  env.step(120);
  assert.equal(env.reads(), 3);
  stop();
});

test('late audio initialization and analyser replacement rebuild validated FFT geometry', () => {
  const env = environment();
  env.setAnalyser(null);
  const stop = env.source.subscribe(() => {});
  env.step(40);
  assert.equal(env.source.getFrame().active, false);
  assert.equal(env.reads(), 0);
  env.setAnalyser(env.node);
  env.step(80);
  assert.equal(env.source.getFrame().active, true);
  const old = env.source.getFrame().bands;
  env.setAnalyser({ ...env.node, frequencyBinCount: 2048, fftSize: 4096, context: { state: 'running', sampleRate: 48000 } });
  env.step(120);
  assert.notEqual(env.source.getFrame().bands, old);
  assert.equal(env.source.getFrame().bands.length, 48);
  stop();
});

test('a failed subscriber is reported while the other consumers receive the frame', () => {
  const env = environment();
  const received = [];
  const stopA = env.source.subscribe(frame => { if (frame.active) throw new Error('consumer failed'); });
  const stopB = env.source.subscribe(frame => received.push(frame.active));
  assert.throws(() => env.step(40), { name: 'AggregateError', message: 'Audio spectrum consumer failed.' });
  assert.equal(received.at(-1), true);
  stopA(); stopB();
});
