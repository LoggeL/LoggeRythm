import assert from "node:assert/strict";
import test from "node:test";

import { createVisualizerSignal, sampleSpectrum, decaySpectrum } from "../src/lib/visualizerSignal.ts";

const geometry = { frequencyBinCount: 1024, fftSize: 2048, sampleRate: 44100 };
function signalAndBytes() {
  return { signal: createVisualizerSignal(geometry), bytes: new Uint8Array(geometry.frequencyBinCount) };
}
function close(actual, expected, tolerance = 0.00001) {
  assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${actual} to be close to ${expected}.`);
}

test("48 logarithmic bands follow actual FFT geometry and stay inside the real buffer", () => {
  const signal = createVisualizerSignal(geometry);
  assert.equal(signal.bands.length, 48);
  assert.equal(signal.ranges.length, 48);
  close(signal.ranges[0].minHz, 20);
  close(signal.ranges.at(-1).maxHz, 14000);
  const ratio = signal.ranges[0].maxHz / signal.ranges[0].minHz;
  for (const range of signal.ranges) {
    close(range.maxHz / range.minHz, ratio);
    assert.ok(range.startBin >= 1);
    assert.ok(range.endBin > range.startBin);
    assert.ok(range.endBin <= geometry.frequencyBinCount);
  }
  const lowerSampleRate = createVisualizerSignal({ ...geometry, sampleRate: 16000 });
  close(lowerSampleRate.ranges.at(-1).maxHz, 8000);
  assert.equal(lowerSampleRate.ranges.at(-1).endBin, 1024);
});

test("bass and treble impulses light their own frequency bands and envelopes", () => {
  const low = signalAndBytes();
  low.bytes[4] = 255; // 86 Hz.
  sampleSpectrum(low.signal, low.bytes, 200);
  assert.ok(low.signal.bass > 0);
  assert.equal(low.signal.mid, 0);
  assert.equal(low.signal.treble, 0);
  for (let index = 0; index < low.signal.ranges.length; index += 1) {
    const range = low.signal.ranges[index];
    assert.equal(low.signal.bands[index] > 0, range.startBin <= 4 && range.endBin > 4);
  }
  const high = signalAndBytes();
  high.bytes[500] = 255; // 10.8 kHz.
  sampleSpectrum(high.signal, high.bytes, 200);
  assert.equal(high.signal.bass, 0);
  assert.equal(high.signal.mid, 0);
  assert.ok(high.signal.treble > 0);
  assert.ok(high.signal.energy > 0);
});

test("attack and release use elapsed time rather than frame count", () => {
  const once = signalAndBytes();
  const split = signalAndBytes();
  once.bytes.fill(255);
  split.bytes.fill(255);
  sampleSpectrum(once.signal, once.bytes, 35);
  sampleSpectrum(split.signal, split.bytes, 17.5);
  sampleSpectrum(split.signal, split.bytes, 17.5);
  close(once.signal.energy, 1 - Math.exp(-1));
  close(once.signal.energy, split.signal.energy);
  close(once.signal.bands[20], split.signal.bands[20]);
  const peak = once.signal.energy;
  decaySpectrum(once.signal, 200);
  close(once.signal.energy, peak * Math.exp(-1));
  assert.ok(once.signal.energy > 0);
});

test("a positive rise produces one transient, sustained energy then releases", () => {
  const { signal, bytes } = signalAndBytes();
  bytes.fill(255);
  sampleSpectrum(signal, bytes, 35);
  const hit = signal.transient;
  assert.ok(hit > 0.9);
  sampleSpectrum(signal, bytes, 160);
  close(signal.transient, hit * Math.exp(-1));
  bytes.fill(0);
  sampleSpectrum(signal, bytes, 160);
  assert.ok(signal.transient < hit / 4);
});

test("silence and low-level FFT noise remain silent without fake motion", () => {
  const { signal, bytes } = signalAndBytes();
  bytes.fill(8);
  sampleSpectrum(signal, bytes, 35);
  assert.deepEqual(Array.from(signal.bands), Array(48).fill(0));
  assert.equal(signal.bass + signal.mid + signal.treble + signal.energy + signal.transient, 0);
  bytes.fill(255);
  sampleSpectrum(signal, bytes, 35);
  decaySpectrum(signal, 3000);
  assert.deepEqual(Array.from(signal.bands), Array(48).fill(0));
  assert.equal(signal.bass + signal.mid + signal.treble + signal.energy + signal.transient, 0);
});

test("sampling and paused decay reuse the same signal and band array", () => {
  const { signal, bytes } = signalAndBytes();
  const bands = signal.bands;
  bytes.fill(255);
  assert.equal(sampleSpectrum(signal, bytes, 35), signal);
  assert.equal(decaySpectrum(signal, 100), signal);
  assert.equal(signal.bands, bands);
  const before = Array.from(bands);
  assert.equal(sampleSpectrum(signal, bytes, 0), signal);
  assert.equal(decaySpectrum(signal, 0), signal);
  assert.deepEqual(Array.from(bands), before);
});

test("invalid analyser geometry and mismatched data report the cause", () => {
  for (const fftSize of [0, 31, 33, 2049, 65536, Number.NaN]) {
    assert.throws(() => createVisualizerSignal({ ...geometry, fftSize }), /fftSize/);
  }
  assert.throws(() => createVisualizerSignal({ ...geometry, frequencyBinCount: 512 }), /frequencyBinCount.*1024/);
  for (const sampleRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createVisualizerSignal({ ...geometry, sampleRate }), /sampleRate/);
  }
  for (const bandCount of [0, 1.5, 257]) {
    assert.throws(() => createVisualizerSignal({ ...geometry, bandCount }), /bandCount/);
  }
  const { signal, bytes } = signalAndBytes();
  assert.throws(() => sampleSpectrum(signal, new Uint8Array(12), 16), /1024 frequency bins/);
  assert.throws(() => sampleSpectrum(signal, new Float32Array(1024), 16), /Uint8Array/);
  for (const delta of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => sampleSpectrum(signal, bytes, delta), /deltaMs/);
    assert.throws(() => decaySpectrum(signal, delta), /deltaMs/);
  }
  assert.throws(() => sampleSpectrum({ ...signal }, bytes, 16), /createVisualizerSignal/);
});
