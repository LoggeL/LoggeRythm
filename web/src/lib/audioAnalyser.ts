/**
 * Shared Web Audio analyser for the player's <audio> element.
 *
 * The browser only allows ONE MediaElementSource per media element, and once an
 * element is routed through Web Audio its output must be re-connected to the
 * destination or it falls silent. We therefore set this up exactly once (keyed
 * by the element) and keep the graph alive for the lifetime of the page:
 *
 *   source ─┬─> analysisGain ──> analyser
 *           └─> outputGain ──> destination
 *
 * `ensureAnalyser` is safe to call repeatedly; the visualizer reads the live
 * analyser each animation frame via `getAnalyser`, so it picks up the node as
 * soon as playback initialises it (after a user gesture, per autoplay policy).
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
// Each <audio> element may only have ONE MediaElementSource ever, and once
// routed through Web Audio it must reach the destination through the graph or
// it falls silent. We track every connected element (the player uses two decks
// for gapless crossfades) and give analysis its own mix gain. That gain follows
// the crossfade but not the user volume, so visuals reflect what is audibly in
// the mix even while muted:
//
//   source ─┬─> analysisGain ──> analyser
//           └─> outputGain ──> destination
const decks = new Map<
  HTMLAudioElement,
  {
    source: MediaElementAudioSourceNode;
    outputGain: GainNode;
    analysisGain: GainNode;
  }
>();

function getCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WebkitWindow).webkitAudioContext ?? null;
}

/**
 * Wire the given audio element into the shared analyser graph (once per
 * element) and resume the AudioContext. Safe to call repeatedly and for several
 * elements. Call it in response to a user gesture (e.g. pressing play), before
 * the element starts playing, so its output is routed to the speakers + analyser.
 * Returns the analyser, or null if Web Audio is unavailable / setup failed.
 */
export function ensureAnalyser(el: HTMLAudioElement | null): AnalyserNode | null {
  const Ctor = getCtor();
  if (!Ctor) return analyser;

  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  if (!analyser) {
    analyser = ctx.createAnalyser();
    // 2048 keeps kick/sub bands distinct (≈21.5 Hz per bin at 44.1 kHz).
    // A moderate analyser-level smoothing preserves drum transients; each
    // visual consumer can still apply its own time-based release envelope.
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -8;
    // Not connected to the destination — it's a passive tap on the source.
  }

  if (el && !decks.has(el)) {
    try {
      const source = ctx.createMediaElementSource(el);
      const outputGain = ctx.createGain();
      const analysisGain = ctx.createGain();
      // Carry over the element's current volume, then decouple the element so
      // its `volume` no longer scales the analyser tap.
      outputGain.gain.value = el.volume;
      analysisGain.gain.value = 1;
      el.volume = 1;
      source.connect(analysisGain);
      analysisGain.connect(analyser);
      source.connect(outputGain);
      outputGain.connect(ctx.destination);
      decks.set(el, { source, outputGain, analysisGain });
    } catch {
      // Element already routed elsewhere (or unsupported) — leave it be.
    }
  }

  return analyser;
}

/**
 * Set an element's output volume (0..1) and its contribution to the shared
 * analyser (0..1). The analysis weight follows crossfade position but remains
 * independent from user volume/mute. Before Web Audio setup, output volume is
 * applied directly to the media element.
 */
export function applyVolume(
  el: HTMLAudioElement | null,
  v: number,
  analysisWeight = 1,
): void {
  if (!el) return;
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new RangeError(`Audio output gain must be between 0 and 1; received ${v}.`);
  }
  if (!Number.isFinite(analysisWeight) || analysisWeight < 0 || analysisWeight > 1) {
    throw new RangeError(
      `Audio analysis weight must be between 0 and 1; received ${analysisWeight}.`,
    );
  }
  const deck = decks.get(el);
  if (deck) {
    el.volume = 1;
    deck.outputGain.gain.value = v;
    deck.analysisGain.gain.value = analysisWeight;
  } else {
    el.volume = v;
  }
}

// Human loudness perception is roughly logarithmic, so a linear slider feels
// like nearly all the change happens in the bottom third. Map the slider
// position (0..1) through a power curve to the audible gain: quieter low end,
// finer control up top. Endpoints are preserved (0->0, 1->1). Raise the
// exponent for a stronger taper.
const VOLUME_CURVE_EXPONENT = 2;

/** Map a linear slider position (0..1) to a perceptual audio gain (0..1). */
export function perceptualVolume(position: number): number {
  const p = Math.max(0, Math.min(1, position));
  return p ** VOLUME_CURVE_EXPONENT;
}

/** The analyser node, if it has been initialised. */
export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

/** Resume the AudioContext if it was suspended (e.g. on a fresh user gesture). */
export function resumeAudioContext(): void {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}
