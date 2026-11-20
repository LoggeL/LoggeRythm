import { seededRandom, type SceneFingerprint, type SceneKey } from "./visualizerScenes";

/**
 * Canvas 2D genre scenes for the fullscreen visualizer. Each one is composed
 * around the artwork (centre `cx/cy`, half size `half`), draws on a
 * transparent canvas so the cover-tinted backdrop shows through, and reads
 * only the normalised drive values (see visualizerDrive).
 */

export type Rgb = readonly [number, number, number];

export interface SceneColors {
  /** Dark stop of the cover palette. */
  readonly deep: Rgb;
  readonly primary: Rgb;
  readonly secondary: Rgb;
  readonly light: Rgb;
}

export interface SceneView {
  readonly width: number;
  readonly height: number;
  readonly cx: number;
  readonly cy: number;
  /** Half the artwork's width in canvas pixels. */
  readonly half: number;
  /** Artwork corner radius as a fraction of `half`. */
  readonly corner: number;
  /** Canvas pixels per CSS pixel. */
  readonly scale: number;
}

export interface SceneFrame {
  /** 48 bands, 0..1, normalised to the track's recent peak. */
  readonly bands: Float32Array;
  readonly bass: number;
  readonly mid: number;
  readonly treble: number;
  readonly level: number;
  /** Kick envelope: jumps on a kick, then decays. */
  readonly kick: number;
  /** A kick started this frame. */
  readonly kickEdge: boolean;
  /** A snare/clap-like mid-high attack started this frame. */
  readonly hitEdge: boolean;
  /** Scene clock in seconds; advances only while music plays. */
  readonly time: number;
  /** Beats since the scene started, at the measured tempo. */
  readonly beatPosition: number;
  readonly tempo: number;
  /** prefers-reduced-motion: no strobes, no trails, no confetti. */
  readonly reduced: boolean;
}

/** Scratch space a scene keeps between frames; reset on scene or size change. */
export type SceneState = Record<string, unknown>;

export type SceneRenderer = (
  ctx: CanvasRenderingContext2D,
  view: SceneView,
  frame: SceneFrame,
  state: SceneState,
  fingerprint: SceneFingerprint,
  colors: SceneColors,
  dt: number,
) => void;

const TAU = Math.PI * 2;
const BAND_COUNT = 48;

const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const GREY: Rgb = [128, 128, 128];
const WHITE: Rgb = [255, 255, 255];
const band = (frame: SceneFrame, index: number) => frame.bands[Math.max(0, Math.min(BAND_COUNT - 1, Math.floor(index)))];
const average = (frame: SceneFrame, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += band(frame, i);
  return sum / Math.max(1, to - from);
};

function clear(ctx: CanvasRenderingContext2D, view: SceneView) { ctx.clearRect(0, 0, view.width, view.height); }

/** Fade what is already drawn (trails) without painting a background. */
function fade(ctx: CanvasRenderingContext2D, view: SceneView, frame: SceneFrame, amount: number) {
  if (frame.reduced) { clear(ctx, view); return; }
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0,0,0,${amount})`;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.globalCompositeOperation = "source-over";
}

/** The artwork's outline grown by `grow` canvas pixels. */
function artworkOutline(ctx: CanvasRenderingContext2D, view: SceneView, grow: number) {
  const half = view.half + grow;
  ctx.roundRect(view.cx - half, view.cy - half, half * 2, half * 2, Math.max(0, view.corner * view.half + grow));
}

function list<T>(state: SceneState, key: string): T[] {
  const existing = state[key];
  if (existing) return existing as T[];
  const created: T[] = [];
  state[key] = created;
  return created;
}

function num(state: SceneState, key: string): number {
  return (state[key] as number | undefined) ?? 0;
}

/* --------------------------------------------------------------- scenes */

/** Electro/Dance: neon polygons rush out of the cover, lasers, a kick strobe. */
const laser: SceneRenderer = (ctx, view, frame, state, fp, colors, dt) => {
  clear(ctx, view);
  const z = num(state, "z") + dt * (frame.tempo / 60) * 0.5 * fp.speed;
  state.z = z;
  const { cx, cy, half } = view;
  const inner = half * 1.45;
  const reach = Math.hypot(view.width, view.height);
  const sides = Math.max(4, fp.sym);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  for (let k = 0; k < sides * 2; k++) {
    const angle = (k / (sides * 2)) * TAU + frame.time * 0.12 * (fp.twist + 0.3);
    const b = band(frame, (k * 5 + 30) % BAND_COUNT);
    ctx.strokeStyle = rgba(k % 2 ? colors.secondary : colors.primary, 0.04 + b * 0.32);
    ctx.lineWidth = (1 + b * 3) * view.scale;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
    ctx.stroke();
  }
  const rings = 20, frac = z % 1, base = Math.floor(z);
  for (let i = rings - 1; i >= 0; i--) {
    const depth = (i + 1 - frac) / rings;
    const radius = inner / depth;
    const b = band(frame, depth * BAND_COUNT * 0.9);
    const alpha = Math.min(1, (1 - depth) * 1.6) * (0.25 + 0.75 * b);
    const rotation = frame.time * 0.2 * fp.twist + depth * fp.twist * 2;
    ctx.strokeStyle = rgba((i + base) % 2 ? colors.secondary : colors.primary, alpha);
    ctx.lineWidth = (1 + 6 * (1 - depth) * (0.4 + frame.kick)) * view.scale;
    ctx.beginPath();
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * TAU + rotation;
      const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
      if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  if (!frame.reduced && frame.kick > 0.6) {
    ctx.fillStyle = rgba(colors.light, (frame.kick - 0.6) * 0.15);
    ctx.fillRect(0, 0, view.width, view.height);
  }
  ctx.globalCompositeOperation = "source-over";
};

/** Hip-Hop: the cover is the speaker cone; halftone dots radiate with the bass. */
const monolith: SceneRenderer = (ctx, view, frame, _state, fp, colors) => {
  clear(ctx, view);
  const { cx, cy, half } = view;
  const step = Math.max(9 * view.scale, half / (6.5 * fp.density));
  ctx.fillStyle = rgba(colors.primary, 0.6);
  ctx.beginPath();
  for (let y = step / 2; y < view.height; y += step) {
    for (let x = step / 2; x < view.width; x += step) {
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      if (dx < half && dy < half) continue;
      const outside = Math.max(0, Math.hypot(Math.max(0, dx - half), Math.max(0, dy - half)) / (half * 3.2));
      const v = band(frame, outside * BAND_COUNT) * (1 - Math.min(0.7, outside * 0.6)) + frame.bass * 0.45 * Math.max(0, 1 - outside * 2);
      const r = step * 0.4 * Math.min(1, v);
      if (r > 0.6 * view.scale) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    }
  }
  ctx.fill();
  ctx.strokeStyle = rgba(mix(colors.secondary, colors.deep, 0.3), 0.55);
  ctx.lineWidth = half * 0.05 * (1 + frame.kick * 0.5);
  ctx.beginPath(); artworkOutline(ctx, view, half * 0.045); ctx.stroke();
  for (let k = 1; k <= 4; k++) {
    ctx.strokeStyle = rgba(colors.light, (0.28 - k * 0.05) * (0.4 + frame.bass));
    ctx.lineWidth = Math.max(1, half * 0.012);
    ctx.beginPath();
    artworkOutline(ctx, view, half * (0.08 + 0.07 * k * (1 + frame.bass * 0.8) + frame.kick * 0.03 * k));
    ctx.stroke();
  }
};

interface Spark { x: number; y: number; vx: number; vy: number; life: number; tone: 0 | 1 }

/** Rock/Metal: jagged oscilloscope lines and sparks off the snare. */
const sparks: SceneRenderer = (ctx, view, frame, state, fp, colors, dt) => {
  fade(ctx, view, frame, 0.32);
  const { width, height, cx, cy, half } = view;
  const glow = ctx.createLinearGradient(0, height, 0, height * 0.3);
  glow.addColorStop(0, rgba(colors.primary, 0.05 + frame.bass * 0.14));
  glow.addColorStop(1, rgba(colors.primary, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  const random = seededRandom(Math.floor(frame.time * 60));
  for (let line = 0; line < 3; line++) {
    ctx.beginPath();
    const stepX = 5 * view.scale;
    for (let x = 0; x <= width + stepX; x += stepX) {
      const u = x / width;
      let wave = 0;
      for (let k = 0; k < 6; k++) {
        wave += band(frame, (k * 8 + line * 3) % BAND_COUNT) * Math.sin(u * TAU * (k + 1) * (1 + fp.twist * 0.25) + frame.time * (2 + k) * fp.speed * (line % 2 ? 1 : -1));
      }
      const y = cy + (line - 1) * half * 0.5 + wave * half * 0.22 + (random() - 0.5) * frame.treble * half * 0.08;
      if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    const color = line === 1 ? colors.primary : colors.secondary;
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.lineWidth = (1.5 + frame.mid * 3) * view.scale;
    ctx.shadowColor = rgba(color, 1);
    ctx.shadowBlur = 12 * view.scale;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  const particles = list<Spark>(state, "sparks");
  if (!frame.reduced && (frame.hitEdge || frame.kickEdge)) {
    const count = Math.round((frame.hitEdge ? 24 : 8) + 28 * frame.level * fp.density);
    for (let i = 0; i < count && particles.length < 400; i++) {
      const side = Math.random();
      const x = side < 0.6 ? cx + (Math.random() * 2 - 1) * half : cx + (side < 0.8 ? -half : half);
      const y = side < 0.6 ? cy - half : cy + (Math.random() * 2 - 1) * half;
      const outward = x < cx ? -1 : 1;
      particles.push({
        x, y,
        vx: (side < 0.6 ? (Math.random() - 0.5) * 1.2 : outward * (0.4 + Math.random() * 0.8)) * half * 1.6,
        vy: -(0.6 + Math.random() * 1.4) * half * 1.4,
        life: 0.5 + Math.random() * 0.8,
        tone: Math.random() < 0.5 ? 0 : 1,
      });
    }
  }
  ctx.lineCap = "round";
  ctx.lineWidth = 2 * view.scale;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += half * 3.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0 || p.y > height + 20) { particles.splice(i, 1); continue; }
    ctx.strokeStyle = rgba(p.tone ? colors.light : colors.secondary, Math.min(1, p.life * 1.4));
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025); ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
};

interface Confetti { x: number; y: number; vx: number; vy: number; rotation: number; spin: number; tone: 0 | 1 | 2; size: number }

/** Pop/R&B: soft glowing bubbles orbit the cover, a ring on every beat, confetti on claps. */
const bubbles: SceneRenderer = (ctx, view, frame, state, fp, colors, dt) => {
  clear(ctx, view);
  const { width, height, cx, cy, half } = view;
  const palette = [colors.primary, colors.secondary, colors.light] as const;
  const count = Math.round(6 * fp.density) + 2;
  const direction = fp.twist >= 0 ? 1 : -1;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const phase = i * 2.399;
    const angle = phase + frame.time * 0.23 * fp.speed * (1 + i * 0.07) * direction;
    const orbit = half * (1.75 + 0.55 * Math.sin(frame.time * 0.31 * fp.speed * (1 + i * 0.05) + phase * 1.3));
    const x = cx + Math.cos(angle) * orbit * 1.25;
    const y = cy + Math.sin(angle) * orbit * 0.95 - frame.kick * half * 0.05;
    const r = half * (0.24 + band(frame, (i * 7 + 3) % BAND_COUNT) * 0.42 + frame.kick * 0.08);
    const color = palette[i % 3];
    const gradient = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, 0, x, y, r);
    gradient.addColorStop(0, rgba(mix(color, WHITE, 0.35), 0.75));
    gradient.addColorStop(0.5, rgba(color, 0.32));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  const beat = frame.beatPosition % 1;
  ctx.strokeStyle = rgba(colors.light, (1 - beat) * 0.3 * Math.min(1, frame.level * 2));
  ctx.lineWidth = (2 + (1 - beat) * 4) * view.scale;
  ctx.beginPath(); artworkOutline(ctx, view, half * (0.06 + beat * 1.4)); ctx.stroke();
  const confetti = list<Confetti>(state, "confetti");
  if (frame.hitEdge && !frame.reduced) {
    for (let i = 0; i < 14 && confetti.length < 300; i++) {
      confetti.push({
        x: Math.random() * width, y: -10 - Math.random() * height * 0.2,
        vx: (Math.random() - 0.5) * 60 * view.scale, vy: height * (0.22 + Math.random() * 0.28),
        rotation: Math.random() * TAU, spin: (Math.random() - 0.5) * 8,
        tone: (i % 3) as 0 | 1 | 2, size: half * (0.025 + Math.random() * 0.025),
      });
    }
  }
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.x += c.vx * dt; c.y += c.vy * dt; c.rotation += c.spin * dt;
    if (c.y > height + 20) { confetti.splice(i, 1); continue; }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rotation);
    ctx.fillStyle = rgba(palette[c.tone], 0.85);
    ctx.fillRect(-c.size, -c.size * 0.45, c.size * 2, c.size * 0.9);
    ctx.restore();
  }
};

interface Glint { angle: number; radius: number; life: number }

/** Jazz/Soul/Blues: the cover sits on a spinning record; smoke curls around it. */
const smoke: SceneRenderer = (ctx, view, frame, state, fp, colors, dt) => {
  fade(ctx, view, frame, 0.08);
  const { cx, cy, half } = view;
  const drift = num(state, "drift") + dt * fp.speed * (0.35 + frame.mid * 1.2);
  state.drift = drift;
  const previous = list<[number, number] | null>(state, "smoke");
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let c = 0; c < 3; c++) {
    const s = drift + c * 1.7;
    const amplitude = 0.6 + band(frame, 10 + c * 6) * 1.1;
    const x = cx + Math.sin(s * (2 + c * 0.5) + c) * half * 2.6 * amplitude;
    const y = cy + Math.sin(s * (3 + c * 0.35) + c * 2) * half * 1.9 * Math.min(1.2, amplitude);
    const last = previous[c];
    if (last) {
      ctx.strokeStyle = rgba(c === 1 ? colors.light : colors.primary, 0.3);
      ctx.lineWidth = (1.2 + band(frame, 30) * 4) * view.scale;
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(x, y); ctx.stroke();
    }
    previous[c] = [x, y];
  }
  ctx.globalCompositeOperation = "source-over";
  const record = half * 2.1;
  const rotation = num(state, "rotation") + dt * 3.49 * (0.85 + 0.25 * fp.speed); // 33⅓ rpm
  state.rotation = rotation;
  ctx.fillStyle = rgba(mix(colors.deep, [0, 0, 0], 0.75), 0.9);
  ctx.beginPath(); ctx.arc(cx, cy, record, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(1, half * 0.008);
  const groove = mix(colors.primary, GREY, 0.55);
  for (let r = half * 1.02; r < record * 0.985; r += half * 0.035) {
    const v = band(frame, ((r - half) / (record - half)) * BAND_COUNT);
    ctx.strokeStyle = rgba(groove, 0.06 + v * 0.5);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  }
  ctx.strokeStyle = rgba(colors.light, 0.18);
  ctx.lineWidth = Math.max(1.5, half * 0.02);
  ctx.beginPath(); ctx.arc(cx, cy, record * 0.97, rotation, rotation + 0.35); ctx.stroke();
  const glints = list<Glint>(state, "glints");
  if (frame.hitEdge && glints.length < 40) glints.push({ angle: Math.random() * TAU, radius: half * (1.1 + Math.random() * 0.95), life: 0.5 });
  for (let i = glints.length - 1; i >= 0; i--) {
    const g = glints[i];
    g.life -= dt;
    if (g.life <= 0) { glints.splice(i, 1); continue; }
    const a = g.angle + rotation;
    ctx.fillStyle = rgba(colors.light, g.life * 1.6);
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * g.radius, cy + Math.sin(a) * g.radius, half * 0.014, 0, TAU); ctx.fill();
  }
};

/** Classical/Score: slow aurora curtains over a starry sky. */
const aurora: SceneRenderer = (ctx, view, frame, state, fp, colors) => {
  fade(ctx, view, frame, 0.2);
  const { width, height } = view;
  let stars = state.stars as [number, number, number][] | undefined;
  if (!stars) {
    const random = seededRandom(99);
    stars = Array.from({ length: 160 }, () => [random(), random() * 0.8, random()] as [number, number, number]);
    state.stars = stars;
  }
  for (const [sx, sy, sp] of stars) {
    ctx.fillStyle = `rgba(230,240,255,${(0.2 + 0.35 * Math.sin(frame.time * (0.5 + sp) + sp * 20) ** 2).toFixed(3)})`;
    ctx.fillRect(sx * width, sy * height, 1.4 * view.scale, 1.4 * view.scale);
  }
  ctx.globalCompositeOperation = "lighter";
  const step = Math.max(4 * view.scale, width / 240);
  const tones = [colors.primary, colors.secondary, colors.light];
  for (let r = 0; r < 3; r++) {
    const gradient = ctx.createLinearGradient(0, height * 0.04, 0, height * 0.85);
    gradient.addColorStop(0, rgba(tones[r], 0));
    gradient.addColorStop(0.22, rgba(tones[r], 0.38));
    gradient.addColorStop(1, rgba(tones[r], 0));
    ctx.fillStyle = gradient;
    for (let x = 0; x < width; x += step) {
      const u = x / width;
      const top = height * (0.1 + r * 0.06)
        + Math.sin(u * 5 * (1 + fp.twist * 0.2) + frame.time * 0.15 * fp.speed * (r + 1)) * height * 0.07
        + Math.sin(u * 13 - frame.time * 0.21 * fp.speed) * height * 0.025;
      const v = band(frame, u * (BAND_COUNT - 10) + 4 + r * 2);
      ctx.globalAlpha = 0.12 + v * 0.45;
      ctx.fillRect(x, top, step * 0.9, height * (0.12 + v * 0.45 + frame.level * 0.08));
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
};

/** Undecided / brand: the logo's step grid continues around the cover and plays along. */
const steps: SceneRenderer = (ctx, view, frame, state, _fp, colors) => {
  clear(ctx, view);
  const { width, height, cx, cy, half } = view;
  const pitch = half / 2;
  const cell = pitch * 0.75;
  const offset = (pitch - cell) / 2;
  const firstCol = -Math.ceil((cx - half) / pitch), lastCol = Math.ceil((width - (cx - half)) / pitch) - 1;
  const firstRow = -Math.ceil((cy - half) / pitch), lastRow = Math.ceil((height - (cy - half)) / pitch) - 1;
  const columns = lastCol - firstCol + 1, rows = lastRow - firstRow + 1;
  const play = firstCol + (Math.floor(frame.beatPosition * 4) % columns);
  let grid = state.grid as Map<number, Float32Array> | undefined;
  if (!grid) { grid = new Map(); state.grid = grid; }
  if (state.lastColumn !== play) {
    const levels = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      const from = Math.floor((1 - (r + 1) / rows) * BAND_COUNT), to = Math.max(from + 1, Math.floor((1 - r / rows) * BAND_COUNT));
      levels[r] = average(frame, from, to);
    }
    grid.set(play, levels);
    state.lastColumn = play;
  }
  const originX = cx - half + offset, originY = cy - half + offset;
  ctx.fillStyle = rgba(colors.primary, 0.05);
  ctx.fillRect(originX + play * pitch - offset, 0, pitch, height);
  for (let c = firstCol; c <= lastCol; c++) {
    const levels = grid.get(c);
    const x = originX + c * pitch;
    for (let r = 0; r < rows; r++) {
      const row = firstRow + r;
      const y = originY + row * pitch;
      if (x + cell > cx - half && x < cx + half && y + cell > cy - half && y < cy + half) continue;
      const v = levels ? levels[r] : 0;
      if (v > 0.32) {
        ctx.fillStyle = c === play ? rgba(colors.light, 1) : rgba(colors.primary, 0.25 + 0.6 * v);
        ctx.beginPath(); ctx.roundRect(x, y, cell, cell, cell * 0.28); ctx.fill();
      } else {
        ctx.fillStyle = rgba(colors.primary, c === play ? 0.45 : 0.18);
        ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.17, 0, TAU); ctx.fill();
      }
    }
  }
};

export const SCENE_RENDERERS: Readonly<Record<Exclude<SceneKey, "aura">, SceneRenderer>> = {
  laser, monolith, sparks, bubbles, smoke, aurora, steps,
};

/** Fade the scene out with distance from the artwork, so side panels stay readable. */
export function focusAroundArtwork(ctx: CanvasRenderingContext2D, view: SceneView) {
  const outer = Math.max(view.half * 5, Math.hypot(view.width, view.height) * 0.45);
  const mask = ctx.createRadialGradient(view.cx, view.cy, view.half * 1.2, view.cx, view.cy, outer);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.globalCompositeOperation = "source-over";
}
