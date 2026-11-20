import assert from "node:assert/strict";
import test from "node:test";
import { compileSource } from "./support/compile.mjs";

const drivePath = new URL("../src/lib/visualizerDrive.ts", import.meta.url).href;
const { createVisualizerRenderer } = await import(await compileSource("src/lib/visualizerShader.ts", { "./visualizerDrive": drivePath }, "shader"));
const { createDriveTracker, paletteColors, DEFAULT_VISUALIZER_PALETTE } = await import(drivePath);

/** Records the calls that matter; every constant is a distinct number. */
function fakeGl({ compileError = null, missingUniform = null } = {}) {
  const calls = [];
  const sources = [];
  let id = 0;
  const gl = new Proxy({
    getShaderParameter: () => compileError === null,
    getShaderInfoLog: () => compileError,
    getProgramParameter: () => true,
    getUniformLocation: (_program, name) => (name === missingUniform ? null : { name }),
    shaderSource: (_shader, source) => sources.push(source),
    createShader: () => ({ id: ++id }), createProgram: () => ({ id: ++id }), createVertexArray: () => ({ id: ++id }), createTexture: () => ({ id: ++id }),
  }, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === "string" && /^[A-Z0-9_]+$/.test(key)) return key;
      return (...args) => { calls.push([key, ...args]); };
    },
  });
  return { gl, calls, sources };
}

const frame = () => ({
  width: 800, height: 600, centerX: 300, centerY: 280, halfWidth: 150, halfHeight: 150, corner: 0.05, intro: 1,
  drive: createDriveTracker().drive, colors: paletteColors(DEFAULT_VISUALIZER_PALETTE),
});

test("one full-screen triangle per frame, with the spectrum uploaded in place", () => {
  const { gl, calls, sources } = fakeGl();
  const renderer = createVisualizerRenderer(gl);
  assert.equal(sources.length, 2);
  assert.match(sources[1], /uniform vec2 uWaves\[6\]/);
  calls.length = 0;
  const current = frame();
  current.drive.spectrum[3] = 200;
  renderer.render(current);
  const upload = calls.find(([name]) => name === "texSubImage2D");
  assert.equal(upload.at(-1), current.drive.spectrum, "uploads the drive's own buffer, no per-frame copy");
  assert.deepEqual(calls.filter(([name]) => name === "drawArrays"), [["drawArrays", "TRIANGLES", 0, 3]]);
  assert.deepEqual(calls.find(([name]) => name === "viewport"), ["viewport", 0, 0, 800, 600]);
  renderer.dispose();
  assert.throws(() => renderer.render(current), /disposed/);
});

test("shader compile errors and missing uniforms fail with the driver's message", () => {
  assert.throws(() => createVisualizerRenderer(fakeGl({ compileError: "ERROR: 0:12: 'foo' : undeclared identifier" }).gl), /vertex shader failed to compile: ERROR: 0:12/);
  assert.throws(() => createVisualizerRenderer(fakeGl({ missingUniform: "uBeat" }).gl), /uniform uBeat is missing/);
});
