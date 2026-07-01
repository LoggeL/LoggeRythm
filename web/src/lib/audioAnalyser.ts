/**
 * Shared Web Audio analyser for the player's <audio> element.
 *
 * The browser only allows ONE MediaElementSource per media element, and once an
 * element is routed through Web Audio its output must be re-connected to the
 * destination or it falls silent. We therefore set this up exactly once (keyed
 * by the element) and keep the graph alive for the lifetime of the page:
 *
 *   <audio> ── MediaElementSource ──> AnalyserNode ──> destination
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
// for gapless crossfades) and wire each so the analyser taps the signal BEFORE
// the volume gain — the visualizer stays full-amplitude regardless of volume:
//
//   source ─┬─> analyser            (tap, not connected to output)
//           └─> gain ──> destination (audible, volume-controlled)
const decks = new Map<
  HTMLAudioElement,
  { source: MediaElementAudioSourceNode; gain: GainNode }
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
    analyser.fftSize = 256; // 128 frequency bins — plenty for a bar display
    analyser.smoothingTimeConstant = 0.82;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -10;
    // Not connected to the destination — it's a passive tap on the source.
  }

  if (el && !decks.has(el)) {
    try {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      // Carry over the element's current volume, then decouple the element so
      // its `volume` no longer scales the analyser tap.
      gain.gain.value = el.volume;
      el.volume = 1;
      source.connect(analyser); // full-amplitude tap for the visualizer
      source.connect(gain);
      gain.connect(ctx.destination); // audible path, volume via the gain
      decks.set(el, { source, gain });
    } catch {
      // Element already routed elsewhere (or unsupported) — leave it be.
    }
  }

  return analyser;
}

/**
 * Set an element's output volume (0..1). Once the element is wired into the
 * Web Audio graph this drives the gain node (keeping the element itself at full
 * volume so the analyser is unaffected); before then it falls back to the
 * element's own volume.
 */
export function applyVolume(el: HTMLAudioElement | null, v: number): void {
  if (!el) return;
  const deck = decks.get(el);
  if (deck) {
    el.volume = 1;
    deck.gain.gain.value = v;
  } else {
    el.volume = v;
  }
}

/** The analyser node, if it has been initialised. */
export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

/** Resume the AudioContext if it was suspended (e.g. on a fresh user gesture). */
export function resumeAudioContext(): void {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}
