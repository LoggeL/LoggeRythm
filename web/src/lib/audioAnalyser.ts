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
let source: MediaElementAudioSourceNode | null = null;
let connectedEl: HTMLAudioElement | null = null;

function getCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WebkitWindow).webkitAudioContext ?? null;
}

/**
 * Wire the given audio element into the analyser graph (once) and resume the
 * AudioContext. Call this in response to a user gesture (e.g. pressing play).
 * Returns the analyser, or null if Web Audio is unavailable / setup failed.
 */
export function ensureAnalyser(el: HTMLAudioElement | null): AnalyserNode | null {
  if (!el) return analyser;
  const Ctor = getCtor();
  if (!Ctor) return null;

  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  if (connectedEl !== el) {
    try {
      source = ctx.createMediaElementSource(el);
    } catch {
      // Element already routed elsewhere (or unsupported) — can't recover a new
      // source node. Leave any existing graph intact.
      return analyser;
    }
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256; // 128 frequency bins — plenty for a bar display
      analyser.smoothingTimeConstant = 0.82;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -10;
    }
    source.connect(analyser);
    analyser.connect(ctx.destination);
    connectedEl = el;
  }

  return analyser;
}

/** The analyser node, if it has been initialised. */
export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

/** Resume the AudioContext if it was suspended (e.g. on a fresh user gesture). */
export function resumeAudioContext(): void {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}
