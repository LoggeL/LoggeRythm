/**
 * Scene choice for the fullscreen visualizer.
 *
 * Every song gets a scene in three steps:
 *  1. Metadata: the album's Deezer genre picks a scene at once.
 *  2. Listening: features measured from the live spectrum (see genreListener)
 *     confirm that choice, decide it when there is no usable genre, or
 *     overrule a genre that clearly does not match the sound.
 *  3. The per-song fingerprint (see sceneFingerprint) varies the chosen scene.
 */

export const SCENE_KEYS = ["laser", "monolith", "sparks", "bubbles", "smoke", "aurora", "steps", "aura"] as const;
export type SceneKey = (typeof SCENE_KEYS)[number];

/** Scenes a genre (or the listener) can lead to. */
export const GENRE_SCENES = ["laser", "monolith", "sparks", "bubbles", "smoke", "aurora"] as const;
export type GenreScene = (typeof GENRE_SCENES)[number];

/** Shown while no genre fits yet: the brand step grid. */
export const UNDECIDED_SCENE: SceneKey = "steps";

export const SCENE_LABELS: Readonly<Record<SceneKey, string>> = {
  laser: "Laser-Tunnel",
  monolith: "Bass-Monolith",
  sparks: "Funkenflug",
  bubbles: "Gummiblasen",
  smoke: "Rauch & Rille",
  aurora: "Polarlicht",
  steps: "Step-Sequencer",
  aura: "Aura",
};

/**
 * Deezer genre id → scene (ids from api.deezer.com/genre). Genres not listed
 * (Folk, Country, Reggae, Latin, Deutsche Musik, Kids, Hörbücher …) have no
 * fitting scene; for them listening decides.
 */
export const DEEZER_GENRE_SCENES: Readonly<Record<string, GenreScene>> = {
  "106": "laser", // Electro
  "113": "laser", // Dance
  "116": "monolith", // Rap/Hip Hop
  "152": "sparks", // Rock
  "464": "sparks", // Heavy Metal
  "85": "sparks", // Alternative
  "132": "bubbles", // Pop
  "165": "bubbles", // R&B
  "129": "smoke", // Jazz
  "169": "smoke", // Soul & Funk
  "153": "smoke", // Blues
  "98": "aurora", // Klassik
  "173": "aurora", // Filme/Videospiele
};

export interface GenreRef { readonly id: string; readonly name: string }

export type ScenePreference = "auto" | SceneKey;

export function isSceneKey(value: unknown): value is SceneKey {
  return typeof value === "string" && (SCENE_KEYS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------- preferences */

export interface VisualizerPreferences {
  enabled: boolean;
  /** "auto" picks a scene per song (genre + listening); otherwise one fixed scene. */
  scene: ScenePreference;
}
export const VISUALIZER_PREFERENCES_KEY = "player:visualizer";
export const INITIAL_VISUALIZER_PREFERENCES: VisualizerPreferences = { enabled: true, scene: "auto" };
export const VISUALIZER_SCENE_CYCLE: readonly ScenePreference[] = ["auto", ...SCENE_KEYS];

/**
 * Advance the persisted visualizer preference through:
 *   off -> auto -> laser -> ... -> aura -> off
 */
export function nextCycledVisualizerPreferences(current: VisualizerPreferences): VisualizerPreferences {
  if (!current.enabled) return { enabled: true, scene: "auto" };
  const idx = VISUALIZER_SCENE_CYCLE.indexOf(current.scene);
  const nextIdx = idx + 1;
  if (nextIdx >= VISUALIZER_SCENE_CYCLE.length) {
    return { enabled: false, scene: "auto" };
  }
  return { enabled: true, scene: VISUALIZER_SCENE_CYCLE[nextIdx] };
}

/** `mode` is the scene choice of the retired three-scene visualizer; it is dropped. */
const LEGACY_PREFERENCE_KEYS = new Set(["mode"]);

export function validateVisualizerPreferences(value: unknown): VisualizerPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Die gespeicherte Visualisierung muss ein Objekt sein.");
  }
  const { enabled, scene, ...rest } = value as Record<string, unknown>;
  if (typeof enabled !== "boolean") {
    throw new Error(`Die gespeicherte Visualisierung enthält einen ungültigen Ein/Aus-Schalter: ${JSON.stringify(enabled)}.`);
  }
  // Saved before the scene choice existed (no `scene` key): automatic.
  if (scene !== undefined && scene !== "auto" && !isSceneKey(scene)) {
    throw new Error(`Die gespeicherte Visualisierung enthält eine unbekannte Szene: ${JSON.stringify(scene)}.`);
  }
  const unknown = Object.keys(rest).filter((key) => !LEGACY_PREFERENCE_KEYS.has(key));
  if (unknown.length) {
    throw new Error(`Die gespeicherte Visualisierung enthält unbekannte Felder: ${unknown.join(", ")}.`);
  }
  return { enabled, scene: scene === undefined ? "auto" : scene };
}

/** The first of an album's genres that has a scene, or null when none does. */
export function metadataScene(genres: readonly GenreRef[]): { scene: GenreScene; genre: string } | null {
  for (const genre of genres) {
    const scene = DEEZER_GENRE_SCENES[genre.id];
    if (scene) return { scene, genre: genre.name };
  }
  return null;
}

/* ------------------------------------------------------------- decision */

/** What metadata says about the current track. */
export type MetadataState =
  | { kind: "loading" }
  | { kind: "genre"; scene: GenreScene; genre: string }
  /** No album, no genres, or only genres without a scene. `names` lists the latter. */
  | { kind: "none"; names: readonly string[] }
  | { kind: "error"; message: string };

export interface SceneGuess { readonly scene: GenreScene; readonly p: number }

export type DecisionSource = "pending" | "metadata" | "listening";

export interface SceneDecision {
  scene: SceneKey;
  source: DecisionSource;
  /** Final for this track: later listening no longer changes it. */
  locked: boolean;
  /** One German sentence on why this scene runs. */
  detail: string;
  /** Consecutive evaluations in which listening disagreed with metadata. */
  dissent: number;
}

/** Listening needs this much music before its guess counts. */
export const LISTEN_SECONDS = 6;
/** After this long without a confident override, metadata stands. */
export const SETTLE_SECONDS = 10;
/** Confidence the listener needs to decide a track without usable metadata. */
export const DECIDE_CONFIDENCE = 0.45;
/** Confidence the listener needs to overrule a Deezer genre; high while its references are uncalibrated … */
export const OVERRIDE_CONFIDENCE = 0.75;
/** … held for this many consecutive evaluations (~0.5 s apart). */
export const OVERRIDE_STREAK = 4;

const pct = (p: number) => `${Math.round(p * 100)} %`;

export function initialDecision(metadata: MetadataState): SceneDecision {
  switch (metadata.kind) {
    case "genre":
      return { scene: metadata.scene, source: "metadata", locked: false, dissent: 0, detail: `Deezer-Genre „${metadata.genre}“. Zuhören prüft noch.` };
    case "loading":
      return { scene: UNDECIDED_SCENE, source: "pending", locked: false, dissent: 0, detail: "Genre wird geladen." };
    case "none":
      return {
        scene: UNDECIDED_SCENE, source: "pending", locked: false, dissent: 0,
        detail: metadata.names.length
          ? `Für „${metadata.names.join(", ")}“ gibt es keine eigene Szene. Zuhören entscheidet.`
          : "Kein Genre bei Deezer. Zuhören entscheidet.",
      };
    case "error":
      return { scene: UNDECIDED_SCENE, source: "pending", locked: false, dissent: 0, detail: `Genre nicht geladen (${metadata.message}). Zuhören entscheidet.` };
  }
}

/**
 * One evaluation step. `guesses` is the listener's ranking (best first) or
 * null while it has too little signal; `seconds` is how much music it heard.
 */
export function advanceDecision(
  current: SceneDecision,
  metadata: MetadataState,
  guesses: readonly SceneGuess[] | null,
  seconds: number,
): SceneDecision {
  if (current.locked || !guesses?.length || seconds < LISTEN_SECONDS) return current;
  const top = guesses[0];
  const name = `${pct(top.p)} ${SCENE_LABELS[top.scene]}`;
  if (metadata.kind !== "genre") {
    if (metadata.kind === "loading" || top.p < DECIDE_CONFIDENCE) return current;
    return { scene: top.scene, source: "listening", locked: true, dissent: 0, detail: `Gehört: ${name}.` };
  }
  if (top.scene === metadata.scene) {
    return { ...current, scene: metadata.scene, source: "metadata", locked: true, dissent: 0, detail: `Deezer-Genre „${metadata.genre}“, vom Zuhören bestätigt (${pct(top.p)}).` };
  }
  const dissent = top.p >= OVERRIDE_CONFIDENCE ? current.dissent + 1 : 0;
  if (dissent >= OVERRIDE_STREAK) {
    return { scene: top.scene, source: "listening", locked: true, dissent, detail: `Deezer sagt „${metadata.genre}“, klingt aber nach ${SCENE_LABELS[top.scene]} (${pct(top.p)}).` };
  }
  if (seconds >= SETTLE_SECONDS && dissent === 0) {
    return { ...current, locked: true, dissent, detail: `Deezer-Genre „${metadata.genre}“.` };
  }
  return dissent === current.dissent ? current : { ...current, dissent };
}

/* ---------------------------------------------------------- fingerprint */

/** Per-song variation of a scene: stable for a track id, different across tracks. */
export interface SceneFingerprint {
  /** Polygon sides / symmetry, 3..8. */
  sym: number;
  /** Motion speed factor, 0.8..1.25. */
  speed: number;
  /** Particle / dot density factor, 0.7..1.3. */
  density: number;
  /** Rotation direction and amount, -1..1. */
  twist: number;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (const ch of value) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function seededRandom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sceneFingerprint(trackId: string): SceneFingerprint {
  if (!trackId) throw new Error("Visualizer fingerprint needs a track id.");
  const random = seededRandom(hashString(trackId));
  return {
    sym: 3 + Math.floor(random() * 6),
    speed: 0.8 + random() * 0.45,
    density: 0.7 + random() * 0.6,
    twist: random() * 2 - 1,
  };
}
