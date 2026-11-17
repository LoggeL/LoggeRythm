import type { Track } from "@/types";
import { assertStoredTracks } from "./player";
import type { QueueOrigin } from "./queuePolicy";

/**
 * Listening session kept across reloads: the queue, the active entry and the
 * playhead. It is written once when the page is left (not on every playhead
 * tick) and read once when the player mounts. Preferences such as volume,
 * repeat and the open panels live in the store's own `sf_player` entry.
 */
export const PLAYER_SESSION_KEY = "sf_player_session";
const PLAYER_SESSION_VERSION = 1;

export interface PlayerSessionSnapshot {
  version: typeof PLAYER_SESSION_VERSION;
  /** Owner of the session; another account never inherits it. */
  userId: string;
  queue: Track[];
  origins: QueueOrigin[];
  originalQueue: Track[];
  originalOrigins: QueueOrigin[];
  queueContext: string | null;
  index: number;
  currentTime: number;
  shuffle: boolean;
  radioActive: boolean;
}

/** The slice of the player store a snapshot is taken from. */
export interface PlayerSessionSource {
  queue: Track[];
  origins: QueueOrigin[];
  originalQueue: Track[];
  originalOrigins: QueueOrigin[];
  queueContext: string | null;
  index: number;
  currentTime: number;
  shuffle: boolean;
  radioActive: boolean;
  partyBridge: object | null;
}

/**
 * Snapshot of the current session, or `null` while a party owns the queue:
 * that queue is server state and is re-synced by the party page itself.
 */
export function capturePlayerSession(
  state: PlayerSessionSource,
  userId: string,
): PlayerSessionSnapshot | null {
  if (state.partyBridge) return null;
  return {
    version: PLAYER_SESSION_VERSION,
    userId,
    queue: state.queue,
    origins: state.origins,
    originalQueue: state.originalQueue,
    originalOrigins: state.originalOrigins,
    queueContext: state.queueContext,
    index: state.index,
    currentTime: state.currentTime,
    shuffle: state.shuffle,
    radioActive: state.radioActive,
  };
}

function invalid(detail: string): Error {
  return new Error(`Lokale Daten "${PLAYER_SESSION_KEY}": ${detail}`);
}

function assertOrigins(
  field: string,
  value: unknown,
  length: number,
): asserts value is QueueOrigin[] {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((origin) => origin !== "manual" && origin !== "context")
  ) {
    throw invalid(`"${field}" muss ${length} Einträge mit "manual" oder "context" enthalten.`);
  }
}

/** Validates a stored snapshot. Corrupt data throws; it is never repaired or ignored. */
export function parsePlayerSession(value: unknown): PlayerSessionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("Ein Sitzungsobjekt wurde erwartet.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== PLAYER_SESSION_VERSION) {
    throw invalid(`Version ${PLAYER_SESSION_VERSION} wurde erwartet, gefunden: ${JSON.stringify(raw.version)}.`);
  }
  if (typeof raw.userId !== "string" || raw.userId === "") {
    throw invalid('"userId" muss eine nicht leere Zeichenkette sein.');
  }
  const { queue, origins, originalQueue, originalOrigins, queueContext, index, currentTime, shuffle, radioActive } = raw;
  assertStoredTracks(`${PLAYER_SESSION_KEY}.queue`, queue, "Eine Titelliste");
  assertStoredTracks(`${PLAYER_SESSION_KEY}.originalQueue`, originalQueue, "Eine Titelliste");
  assertOrigins("origins", origins, queue.length);
  assertOrigins("originalOrigins", originalOrigins, originalQueue.length);
  if (queueContext !== null && typeof queueContext !== "string") {
    throw invalid('"queueContext" muss eine Zeichenkette oder null sein.');
  }
  if (typeof index !== "number" || !Number.isInteger(index) || index < -1 || index >= queue.length) {
    throw invalid(`"index" ${JSON.stringify(index)} liegt außerhalb einer Warteschlange mit ${queue.length} Titeln.`);
  }
  if (typeof currentTime !== "number" || !Number.isFinite(currentTime) || currentTime < 0) {
    throw invalid(`"currentTime" muss eine nicht negative Zahl sein, gefunden: ${JSON.stringify(currentTime)}.`);
  }
  if (typeof shuffle !== "boolean" || typeof radioActive !== "boolean") {
    throw invalid('"shuffle" und "radioActive" müssen Wahrheitswerte sein.');
  }
  return {
    version: PLAYER_SESSION_VERSION,
    userId: raw.userId,
    queue,
    origins,
    originalQueue,
    originalOrigins,
    queueContext,
    index,
    currentTime,
    shuffle,
    radioActive,
  };
}

/**
 * Store patch that brings a snapshot back. Playback stays paused (a reload has
 * no user gesture to start audio with) and the engine seeks to the playhead.
 */
export function restoredPlayerState(snapshot: PlayerSessionSnapshot) {
  const active = snapshot.index >= 0;
  return {
    queue: snapshot.queue,
    origins: snapshot.origins,
    originalQueue: snapshot.originalQueue,
    originalOrigins: snapshot.originalOrigins,
    queueContext: snapshot.queueContext,
    index: snapshot.index,
    shuffle: snapshot.shuffle,
    radioActive: snapshot.radioActive,
    isPlaying: false,
    isBuffering: false,
    error: null,
    currentTime: active ? snapshot.currentTime : 0,
    duration: active ? snapshot.queue[snapshot.index].duration_sec : 0,
    seekTo: active ? snapshot.currentTime : null,
    partyQueueItemIds: [] as number[],
  };
}
