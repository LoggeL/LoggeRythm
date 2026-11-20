import { MAX_WAVES, SPECTRUM_TEXELS, type VisualizerColors, type VisualizerDrive } from "./visualizerDrive";

/**
 * One full-screen fragment pass on the GPU: a cover-coloured flow field, an
 * edge light that hugs the artwork and follows the spectrum, kick shockwaves
 * that morph from the cover's rounded square into circles, light rays and
 * particles drifting outward. No per-frame allocations, no CPU drawing.
 */

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uCorner;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform float uIntro;
uniform vec3 uColors[4];
uniform vec2 uWaves[${MAX_WAVES}];
uniform sampler2D uSpectrum;

out vec4 outColor;

const float PI = 3.14159265;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) {
    value += amplitude * vnoise(p);
    p = rotate * p;
    amplitude *= 0.5;
  }
  return value / 0.875;
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  float unit = uHalf.x;
  vec2 p = (frag - uCenter) / unit;
  vec2 box = uHalf / unit;
  float d = sdRoundBox(p, box, uCorner);
  float outside = max(d, 0.0);
  float r = length(p);
  vec2 dir = p / max(r, 1e-4);
  float ang = atan(p.x, p.y);
  // 0 straight below the cover (bass), 1 straight above (treble), mirrored.
  float u = abs(ang) / PI;
  float t = uTime;

  // Flow field: domain-warped noise in the cover's colours.
  vec2 q = p * 0.42;
  vec2 warp = vec2(fbm(q * 1.3 + vec2(t * 0.21, -t * 0.13)), fbm(q * 1.3 + vec2(-t * 0.17, t * 0.19) + 5.2));
  float f = fbm(q + (warp - 0.5) * (1.7 + uBass * 1.1) + vec2(0.0, -t * 0.08));
  vec3 aura = mix(uColors[0], uColors[1], smoothstep(0.3, 0.65, f));
  aura = mix(aura, uColors[2], smoothstep(0.55, 0.85, f + (warp.x - 0.5) * 0.4));
  // Falls off quickly so lyrics and controls beside the artwork stay legible.
  float reach = 1.15 - uBass * 0.3 - uBeat * 0.15;
  float auraLevel = (0.09 + uLevel * 0.22 + uBeat * 0.16) * exp(-outside * reach) * (0.4 + f * 0.9);
  vec3 col = aura * auraLevel;

  // Light rays leaving the artwork; treble opens them up.
  float rayNoise = vnoise(dir * 6.0 + vec2(t * 0.35, -t * 0.2)) * vnoise(dir * 13.0 - vec2(t * 0.5, t * 0.3));
  float rays = rayNoise * rayNoise * exp(-outside * 1.4) * smoothstep(0.0, 0.3, d) * (0.12 + uTreble * 0.9 + uBeat * 0.4);
  col += mix(uColors[1], uColors[3], 0.5) * rays * 1.3;

  // Edge light: hugs the cover, pushed out by the spectrum at each angle.
  // Five taps soften neighbouring bands into one liquid contour.
  float s0 = mix(0.01, 0.99, u);
  float spectrum = texture(uSpectrum, vec2(s0, 0.5)).r * 0.4
    + (texture(uSpectrum, vec2(s0 - 0.025, 0.5)).r + texture(uSpectrum, vec2(s0 + 0.025, 0.5)).r) * 0.2
    + (texture(uSpectrum, vec2(s0 - 0.055, 0.5)).r + texture(uSpectrum, vec2(s0 + 0.055, 0.5)).r) * 0.1;
  float shimmer = 0.5 + 0.5 * sin(u * PI * 10.0 - t * 4.0);
  float offset = 0.02 + spectrum * (0.13 + shimmer * 0.03) + uBass * 0.045 + uBeat * 0.04;
  float edge = d - offset;
  float core = exp(-abs(edge) * unit * 0.42);
  float halo = exp(-abs(edge) * 13.0) * 0.5;
  float band = (1.0 - smoothstep(offset - 0.01, offset + 0.004, d)) * smoothstep(-0.005, 0.02, d);
  vec3 edgeColor = mix(uColors[1], uColors[2], smoothstep(0.1, 0.9, u));
  col += edgeColor * (halo * (0.25 + spectrum * 0.8) + band * (0.14 + spectrum * 0.3));
  col += mix(edgeColor, uColors[3], 0.65) * core * (0.5 + spectrum + uBeat * 0.7);

  // A slower echo contour gives the edge depth.
  float echoOffset = offset * 1.7 + 0.06 + (vnoise(dir * 3.0 + t * 0.4) - 0.5) * 0.08;
  col += uColors[2] * exp(-abs(d - echoOffset) * unit * 0.2) * (0.08 + uMid * 0.3);

  // Kick shockwaves: rounded square at birth, circle as they travel.
  float cornerRadius = length(box);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec2 wave = uWaves[i];
    if (wave.y <= 0.0) continue;
    float age = wave.x;
    float morph = smoothstep(0.0, 1.3, age);
    float dist = mix(d, r - cornerRadius, morph);
    float radius = 0.04 + (1.0 - exp(-age * 1.45)) * 3.0 * (0.7 + 0.3 * wave.y);
    float width = 0.018 + age * 0.08;
    float x = (dist - radius) / width;
    float ring = exp(-x * x) * wave.y * exp(-age * 1.6) * exp(-max(dist, 0.0) * 0.35);
    col += mix(uColors[3], uColors[1], morph) * ring * 0.9;
  }

  // Particles drifting outward on a polar grid.
  float cells = 64.0;
  float radial = log(outside + 0.25) * 5.0 - t * 1.7;
  vec2 grid = vec2((ang + PI) / (2.0 * PI) * cells, radial);
  vec2 id = floor(grid);
  vec2 cell = fract(grid) - 0.5;
  float seed = hash12(id + 7.0);
  vec2 jitter = vec2(hash12(id + 1.3), hash12(id + 4.1)) - 0.5;
  float aspect = (2.0 * PI * max(r, 0.5) / cells) / ((outside + 0.25) / 5.0);
  vec2 local = (cell - jitter * 0.6) * vec2(aspect, 1.0);
  float star = smoothstep(0.2, 0.0, length(local)) * step(0.8, seed);
  float twinkle = 0.55 + 0.45 * sin(t * 9.0 + seed * 40.0);
  col += uColors[3] * star * twinkle * (0.2 + uTreble * 0.8 + uBeat * 0.5) * smoothstep(0.04, 0.25, d) * exp(-outside * 0.55);

  col *= uIntro;
  col = vec3(1.0) - exp(-col * 1.15);
  col *= smoothstep(-0.004, 0.008, d);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy + fract(t) * 61.0) - 0.5) / 255.0;
  col = clamp(col, 0.0, 1.0);
  // Premultiplied: the scene is light added over the blurred cover backdrop.
  outColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;

export interface VisualizerFrame {
  /** Drawing-buffer pixels. */
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
  /** Corner radius of the artwork, in units of its half width. */
  corner: number;
  /** 0..1 fade-in after mounting. */
  intro: number;
  drive: VisualizerDrive;
  colors: VisualizerColors;
}

export interface VisualizerRenderer {
  render(frame: VisualizerFrame): void;
  dispose(): void;
}

const UNIFORMS = ["uResolution", "uCenter", "uHalf", "uCorner", "uTime", "uLevel", "uBass", "uMid", "uTreble", "uBeat", "uIntro", "uColors", "uWaves", "uSpectrum"] as const;
type UniformName = (typeof UNIFORMS)[number];

function compile(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Visualizer: WebGL could not create the ${label} shader (context lost?).`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Visualizer: ${label} shader failed to compile: ${log ?? "no info log"}`);
  }
  return shader;
}

export function createVisualizerRenderer(gl: WebGL2RenderingContext): VisualizerRenderer {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER, "vertex");
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER, "fragment");
  const program = gl.createProgram();
  if (!program) throw new Error("Visualizer: WebGL could not create a shader program (context lost?).");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Visualizer: shader program failed to link: ${gl.getProgramInfoLog(program) ?? "no info log"}`);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  const locations = {} as Record<UniformName, WebGLUniformLocation>;
  for (const name of UNIFORMS) {
    const lookup = name === "uColors" || name === "uWaves" ? `${name}[0]` : name;
    const location = gl.getUniformLocation(program, lookup);
    if (!location) throw new Error(`Visualizer: shader uniform ${lookup} is missing from the linked program.`);
    locations[name] = location;
  }

  const vao = gl.createVertexArray();
  const texture = gl.createTexture();
  if (!vao || !texture) throw new Error("Visualizer: WebGL could not allocate its vertex array or spectrum texture.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SPECTRUM_TEXELS, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(SPECTRUM_TEXELS));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  let disposed = false;
  return {
    render(frame) {
      if (disposed) throw new Error("Visualizer: render() called on a disposed renderer.");
      const { drive } = frame;
      if (drive.spectrum.length !== SPECTRUM_TEXELS) throw new RangeError(`Visualizer spectrum must have ${SPECTRUM_TEXELS} texels.`);
      gl.viewport(0, 0, frame.width, frame.height);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPECTRUM_TEXELS, 1, gl.RED, gl.UNSIGNED_BYTE, drive.spectrum);
      gl.uniform1i(locations.uSpectrum, 0);
      gl.uniform2f(locations.uResolution, frame.width, frame.height);
      gl.uniform2f(locations.uCenter, frame.centerX, frame.centerY);
      gl.uniform2f(locations.uHalf, frame.halfWidth, frame.halfHeight);
      gl.uniform1f(locations.uCorner, frame.corner);
      gl.uniform1f(locations.uTime, drive.flow);
      gl.uniform1f(locations.uLevel, drive.level);
      gl.uniform1f(locations.uBass, drive.bass);
      gl.uniform1f(locations.uMid, drive.mid);
      gl.uniform1f(locations.uTreble, drive.treble);
      gl.uniform1f(locations.uBeat, drive.beat);
      gl.uniform1f(locations.uIntro, frame.intro);
      gl.uniform3fv(locations.uColors, frame.colors);
      gl.uniform2fv(locations.uWaves, drive.waves);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      disposed = true;
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(texture);
    },
  };
}
