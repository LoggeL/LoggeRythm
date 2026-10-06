/** Canvas-only scene composition. Audio is supplied by the shared FFT tap. */
export const VISUALIZER_MODES = [
  { id: "orbit", label: "Orbit" },
  { id: "aurora", label: "Aurora" },
  { id: "constellation", label: "Kosmos" },
] as const;

export type VisualizerMode = (typeof VISUALIZER_MODES)[number]["id"];
export interface VisualizerPreferences { enabled: boolean; mode: VisualizerMode }
export const INITIAL_VISUALIZER_PREFERENCES: VisualizerPreferences = { enabled: true, mode: "orbit" };

export function validateVisualizerPreferences(value: unknown): VisualizerPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Die gespeicherte Visualisierung muss ein Objekt sein.");
  }
  const { enabled, mode } = value as Partial<VisualizerPreferences>;
  if (typeof enabled !== "boolean" || !VISUALIZER_MODES.some((item) => item.id === mode)) {
    throw new Error("Die gespeicherte Visualisierung enthält einen ungültigen Modus oder Schalter.");
  }
  return value as VisualizerPreferences;
}

export interface VisualizerGeometry {
  width: number; height: number; x: number; y: number; radius: number; compact: boolean;
}
export interface VisualizerPalette {
  colors: readonly string[];
  primary: string;
  rgb: readonly [number, number, number];
}
export interface VisualizerSceneFrame {
  bands: Float32Array;
  bass: number; mid: number; treble: number; energy: number; onset: number; phase: number;
}

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Keep the same composition around the actual artwork, including after scroll. */
export function visualizerGeometry(
  width: number, height: number, x: number, y: number, coverWidth: number, coverHeight: number,
): VisualizerGeometry {
  if (![width, height, x, y, coverWidth, coverHeight].every(Number.isFinite)
    || width <= 0 || height <= 0 || coverWidth < 0 || coverHeight < 0) {
    throw new Error("Visualizer geometry requires finite coordinates and a visible canvas.");
  }
  return { width, height, x, y, radius: Math.max(24, Math.max(coverWidth, coverHeight) * 0.68 + 13), compact: width < 600 };
}

function sceneGradient(ctx: CanvasRenderingContext2D, geometry: VisualizerGeometry, colors: readonly string[]) {
  const gradient = ctx.createLinearGradient(geometry.x - geometry.radius * 2, geometry.y - geometry.radius, geometry.x + geometry.radius * 2, geometry.y + geometry.radius);
  colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
  return gradient;
}

function ambient(ctx: CanvasRenderingContext2D, geometry: VisualizerGeometry, palette: VisualizerPalette, frame: VisualizerSceneFrame) {
  const { x, y, radius, width, height } = geometry;
  const [r, g, b] = palette.rgb;
  const bloom = Math.max(radius * 2.4, 220) + frame.bass * 100;
  const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, bloom);
  gradient.addColorStop(0, `rgba(${r},${g},${b},${0.16 + frame.energy * 0.35})`);
  gradient.addColorStop(0.38, `rgba(${r},${g},${b},${0.06 + frame.bass * 0.15})`);
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** A tightly articulated spectrum halo, bass rings and two elliptical satellites. */
function orbit(ctx: CanvasRenderingContext2D, g: VisualizerGeometry, p: VisualizerPalette, f: VisualizerSceneFrame) {
  const { x, y, radius } = g;
  const count = g.compact ? 80 : 112;
  const extension = Math.min(92, radius * 0.48);
  const gradient = sceneGradient(ctx, g, p.colors);
  ctx.strokeStyle = gradient;
  ctx.lineCap = "round";
  ctx.shadowColor = p.primary;
  ctx.shadowBlur = 16 + f.onset * 16;
  for (let i = 0; i < count; i++) {
    const angle = i / count * TAU - Math.PI / 2;
    // Mirror the spectrum so kick and vocal frequencies frame both sides.
    const band = Math.min(f.bands.length - 1, Math.floor(Math.abs(2 * i / count - 1) * f.bands.length));
    const level = f.bands[band];
    const base = radius + f.bass * 7;
    const end = base + 3 + level * extension + f.onset * 12;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    ctx.globalAlpha = 0.23 + level * 0.7;
    ctx.lineWidth = 1.5 + level * 2;
    ctx.beginPath();
    ctx.moveTo(x + cos * base, y + sin * base);
    ctx.lineTo(x + cos * end, y + sin * end);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (let ring = 0; ring < 3; ring++) {
    ctx.globalAlpha = 0.1 + f.bass * (0.15 - ring * 0.035);
    ctx.lineWidth = ring === 0 ? 1.5 : 0.7;
    ctx.beginPath();
    ctx.arc(x, y, radius + 12 + ring * 17 + f.bass * (8 + ring * 10), 0, TAU);
    ctx.stroke();
  }
  for (let plane = 0; plane < 2; plane++) {
    const tilt = plane === 0 ? -0.42 : 0.5;
    const major = radius * 1.54 + f.bass * 13;
    const minor = radius * 0.74;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.globalAlpha = 0.15 + f.mid * 0.22;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, major, minor, 0, 0, TAU);
    ctx.stroke();
    const position = f.phase * (plane === 0 ? 0.32 : -0.23) + plane * 2;
    ctx.globalAlpha = 0.7 + f.treble * 0.3;
    ctx.fillStyle = p.colors[p.colors.length - 1];
    ctx.shadowColor = p.primary;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(Math.cos(position) * major, Math.sin(position) * minor, 3 + f.onset * 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/** Layered luminous silk, with actual frequency contours along every ribbon. */
function aurora(ctx: CanvasRenderingContext2D, g: VisualizerGeometry, p: VisualizerPalette, f: VisualizerSceneFrame) {
  const { width, x, y, radius } = g;
  const segments = g.compact ? 42 : 64;
  const gradient = sceneGradient(ctx, g, p.colors);
  ctx.strokeStyle = gradient;
  ctx.lineCap = "round";
  const wave = (progress: number, layer: number) => {
    const band = Math.min(f.bands.length - 1, Math.floor(progress * (f.bands.length - 1)));
    const frequency = f.bands[band];
    const envelope = Math.sin(progress * Math.PI);
    const sweep = Math.sin(progress * TAU * 1.2 + f.phase * 0.33 + layer * 0.52);
    const detail = Math.sin(progress * TAU * 3 - f.phase * 0.22 + layer) * frequency;
    return y + (layer - 2.5) * 30 + sweep * (radius * 0.45 + f.mid * 78) * envelope
      + detail * (18 + f.treble * 30) + frequency * (layer % 2 ? -1 : 1) * 40;
  };
  for (let layer = 0; layer < 6; layer++) {
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const progress = i / segments;
      const px = -35 + progress * (width + 70);
      const py = wave(progress, layer);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.globalAlpha = 0.055 + f.energy * 0.075;
    ctx.lineWidth = 24 + layer * 7 + f.bass * 22;
    ctx.shadowColor = p.primary;
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.globalAlpha = 0.2 + f.mid * 0.5;
    ctx.lineWidth = 1.2 + f.treble * 1.3;
    ctx.shadowBlur = 12;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // Receding contour lines give the lower field depth without covering controls.
  for (let line = 0; line < 8; line++) {
    ctx.globalAlpha = (0.055 + f.energy * 0.13) * (1 - line / 11);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    const spread = radius + line * 23;
    ctx.moveTo(x - spread * 2, y + spread * 0.55);
    ctx.bezierCurveTo(x - spread, y + spread * 0.1 - f.bass * 25, x + spread, y + spread * 0.1 - f.bass * 25, x + spread * 2, y + spread * 0.55);
    ctx.stroke();
  }
}

/** Ordered golden-angle particles form a rotating galaxy, rather than random noise. */
function constellation(ctx: CanvasRenderingContext2D, g: VisualizerGeometry, p: VisualizerPalette, f: VisualizerSceneFrame) {
  const { x, y, radius } = g;
  const count = g.compact ? 70 : 110;
  const rotation = f.phase * 0.075;
  ctx.strokeStyle = sceneGradient(ctx, g, p.colors);
  for (let i = 0; i < count; i++) {
    const depth = (i % 9) / 8;
    const angle = i * GOLDEN_ANGLE + rotation * (depth > 0.5 ? 1 : -1);
    const distance = radius * (1.03 + depth * 1.6) + f.bass * (14 + depth * 40);
    const px = x + Math.cos(angle) * distance;
    const py = y + Math.sin(angle) * distance * (0.6 + depth * 0.35);
    const band = f.bands[i % f.bands.length];
    const intensity = band * 0.55 + f.treble * 0.45;
    ctx.globalAlpha = 0.3 + intensity * 0.65;
    ctx.fillStyle = p.colors[1 + i % (p.colors.length - 1)];
    ctx.shadowColor = p.primary;
    ctx.shadowBlur = intensity > 0.5 ? 13 : 0;
    ctx.beginPath();
    ctx.arc(px, py, 1 + depth * 1.6 + intensity * 2.3, 0, TAU);
    ctx.fill();
    // Neighbouring spiral arms supply a sparse, stable constellation network.
    if (i >= 13 && i % 3 === 0) {
      const previousIndex = i - 13;
      const previousDepth = (previousIndex % 9) / 8;
      const previousAngle = previousIndex * GOLDEN_ANGLE + rotation * (previousDepth > 0.5 ? 1 : -1);
      const previousDistance = radius * (1.03 + previousDepth * 1.6) + f.bass * (14 + previousDepth * 40);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.075 + intensity * 0.23;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(previousAngle) * previousDistance, y + Math.sin(previousAngle) * previousDistance * (0.6 + previousDepth * 0.35));
      ctx.lineTo(px, py);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  for (let arm = 0; arm < 3; arm++) {
    ctx.globalAlpha = 0.12 + f.mid * 0.26;
    ctx.lineWidth = 1 + f.onset;
    ctx.beginPath();
    for (let step = 0; step <= 44; step++) {
      const t = step / 44;
      const angle = arm / 3 * TAU + t * Math.PI * 1.5 + rotation;
      const distance = radius * (1.03 + t * 1.7) + f.bass * t * 32;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance * 0.75;
      if (step === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

export function drawVisualizerScene(ctx: CanvasRenderingContext2D, geometry: VisualizerGeometry, palette: VisualizerPalette, frame: VisualizerSceneFrame, mode: VisualizerMode) {
  if (palette.colors.length < 2 || frame.bands.length === 0) {
    throw new Error("Visualizer scenes require at least two palette colors and live spectrum bands.");
  }
  ctx.clearRect(0, 0, geometry.width, geometry.height);
  ctx.save();
  ambient(ctx, geometry, palette, frame);
  ctx.globalCompositeOperation = "lighter";
  if (mode === "orbit") orbit(ctx, geometry, palette, frame);
  else if (mode === "aurora") aurora(ctx, geometry, palette, frame);
  else if (mode === "constellation") constellation(ctx, geometry, palette, frame);
  else throw new Error(`Unsupported visualizer mode: ${mode}`);
  ctx.restore();
}
