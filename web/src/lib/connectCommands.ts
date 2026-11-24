import type { ConnectCommandAction, ConnectPlaybackState, Track } from "@/types";
import type { QueueOrigin, RepeatMode } from "@/store/player";
import { decodeConnectTrack, normalizeConnectTrack } from "@/lib/connectProtocol";

export interface LocalPlayerExecutor {
  queue: Track[];
  origins: QueueOrigin[];
  queueContext: string | null;
  index: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  clearQueue: () => void;
  seek: (positionSec: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  playQueue: (tracks: Track[], startIndex?: number, context?: string) => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  jumpTo: (index: number) => void;
}

/** Build a strictly schema-compliant ConnectPlaybackState from the local player store. */
export function buildConnectPlaybackSnapshot(state: {
  queue: Track[];
  origins: QueueOrigin[];
  queueContext: string | null;
  index: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
}): ConnectPlaybackState {
  const queue = state.queue.map(normalizeConnectTrack);
  const origins: ("manual" | "context")[] =
    state.origins.length === queue.length
      ? state.origins.map((origin) => (origin === "manual" ? "manual" : "context"))
      : queue.map(() => "context");
  const currentIndex =
    state.index >= 0 && state.index < queue.length ? state.index : -1;
  const durationSec =
    state.duration > 0
      ? state.duration
      : currentIndex >= 0
        ? queue[currentIndex].duration_sec
        : 0;
  return {
    queue,
    origins,
    queue_context: state.queueContext ?? null,
    current_index: currentIndex,
    is_playing: currentIndex >= 0 && state.isPlaying,
    position_sec: currentIndex >= 0 ? Math.max(0, state.currentTime) : 0,
    duration_sec: Math.max(0, durationSec),
    shuffle: state.shuffle,
    repeat: state.repeat,
    volume: Math.max(0, Math.min(1, state.volume)),
    muted: state.muted,
    updated_at: new Date().toISOString(),
  };
}

function requireNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Ungültiger Connect-Befehl: "${key}" muss eine endliche Zahl sein.`);
  }
  return value;
}

function requireInt(payload: Record<string, unknown>, key: string): number {
  const value = requireNumber(payload, key);
  if (!Number.isInteger(value)) {
    throw new Error(`Ungültiger Connect-Befehl: "${key}" muss eine ganze Zahl sein.`);
  }
  return value;
}

/**
 * Execute an incoming Connect remote command against the local player store.
 * Validates all parameters strictly and throws descriptive errors on invalid payloads.
 */
export function executeLocalConnectCommand(
  action: ConnectCommandAction,
  payload: Record<string, unknown>,
  player: LocalPlayerExecutor,
  setRepeatDirect?: (repeat: RepeatMode) => void,
  setMuteDirect?: (muted: boolean) => void,
): void {
  switch (action) {
    case "play":
      player.play();
      return;
    case "pause":
      player.pause();
      return;
    case "toggle":
      player.toggle();
      return;
    case "next":
      player.next();
      return;
    case "prev":
      player.prev();
      return;
    case "clear_queue":
      player.clearQueue();
      return;
    case "seek": {
      const pos = requireNumber(payload, "position_sec");
      if (pos < 0) throw new Error("Ungültiger Connect-Befehl: position_sec darf nicht negativ sein.");
      player.seek(pos);
      return;
    }
    case "set_volume": {
      const vol = requireNumber(payload, "volume");
      if (vol < 0 || vol > 1) {
        throw new Error("Ungültiger Connect-Befehl: volume muss zwischen 0 und 1 liegen.");
      }
      player.setVolume(vol);
      return;
    }
    case "set_mute": {
      const muted = payload.muted;
      if (typeof muted !== "boolean") {
        throw new Error('Ungültiger Connect-Befehl: "muted" muss ein Wahrheitswert sein.');
      }
      if (setMuteDirect) {
        setMuteDirect(muted);
      } else if (player.muted !== muted) {
        player.toggleMute();
      }
      return;
    }
    case "set_shuffle": {
      const shuffle = payload.shuffle;
      if (typeof shuffle !== "boolean") {
        throw new Error('Ungültiger Connect-Befehl: "shuffle" muss ein Wahrheitswert sein.');
      }
      if (player.shuffle !== shuffle) {
        player.toggleShuffle();
      }
      return;
    }
    case "set_repeat": {
      const repeat = payload.repeat;
      if (repeat !== "off" && repeat !== "all" && repeat !== "one") {
        throw new Error('Ungültiger Connect-Befehl: "repeat" muss "off", "all" oder "one" sein.');
      }
      if (setRepeatDirect) {
        setRepeatDirect(repeat);
      } else {
        while (player.repeat !== repeat) player.cycleRepeat();
      }
      return;
    }
    case "play_tracks": {
      if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) {
        throw new Error('Ungültiger Connect-Befehl: "tracks" muss eine nicht leere Liste sein.');
      }
      const tracks = payload.tracks.map((entry, idx) =>
        decodeConnectTrack(entry, `play_tracks.tracks[${idx}]`),
      );
      const startIndex = requireInt(payload, "start_index");
      if (startIndex < 0 || startIndex >= tracks.length) {
        throw new Error(
          `Ungültiger Connect-Befehl: start_index ${startIndex} liegt außerhalb von tracks (${tracks.length}).`,
        );
      }
      const context =
        payload.queue_context === undefined || payload.queue_context === null
          ? undefined
          : typeof payload.queue_context === "string"
            ? payload.queue_context
            : (() => {
                throw new Error('Ungültiger Connect-Befehl: "queue_context" muss eine Zeichenkette oder null sein.');
              })();
      player.playQueue(tracks, startIndex, context);
      return;
    }
    case "queue_add": {
      const track = decodeConnectTrack(payload.track, "queue_add.track");
      player.addToQueue(track);
      return;
    }
    case "queue_play_next": {
      const track = decodeConnectTrack(payload.track, "queue_play_next.track");
      player.playNext(track);
      return;
    }
    case "queue_remove": {
      const index = requireInt(payload, "index");
      if (index < 0 || index >= player.queue.length) {
        throw new Error(`Ungültiger Connect-Befehl: index ${index} liegt außerhalb der Warteschlange.`);
      }
      player.removeFromQueue(index);
      return;
    }
    case "queue_reorder": {
      const fromIndex = requireInt(payload, "from_index");
      const toIndex = requireInt(payload, "to_index");
      if (
        fromIndex < 0 ||
        fromIndex >= player.queue.length ||
        toIndex < 0 ||
        toIndex >= player.queue.length
      ) {
        throw new Error("Ungültiger Connect-Befehl: Verschiebe-Indizes liegen außerhalb der Warteschlange.");
      }
      player.reorderQueue(fromIndex, toIndex);
      return;
    }
    case "select_index": {
      const index = requireInt(payload, "index");
      if (index < 0 || index >= player.queue.length) {
        throw new Error(`Ungültiger Connect-Befehl: index ${index} liegt außerhalb der Warteschlange.`);
      }
      player.jumpTo(index);
      return;
    }
  }
}
