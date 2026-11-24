import type {
  ConnectCommandAction,
  ConnectDevice,
  ConnectPlaybackState,
  ConnectState,
  DeviceCapabilities,
  DeviceType,
  Track,
} from "@/types";

export const CONNECT_DEVICE_ID_KEY = "sf_connect_device_id";
export const CONNECT_DEVICE_NAME_KEY = "sf_connect_device_name";
export const CONNECT_ENABLED_KEY = "sf_connect_enabled";

const DEVICE_TYPES = new Set<DeviceType>([
  "web",
  "mobile",
  "tablet",
  "desktop",
  "tv",
  "speaker",
  "other",
]);

const REPEAT_MODES = new Set<"off" | "all" | "one">(["off", "all", "one"]);

const COMMAND_ACTIONS = new Set<ConnectCommandAction>([
  "play",
  "pause",
  "toggle",
  "next",
  "prev",
  "clear_queue",
  "seek",
  "set_volume",
  "set_mute",
  "set_shuffle",
  "set_repeat",
  "play_tracks",
  "queue_add",
  "queue_play_next",
  "queue_remove",
  "queue_reorder",
  "select_index",
]);

export type ConnectClientMessage =
  | {
      type: "register";
      device_id: string;
      name: string;
      device_type: DeviceType;
      capabilities: DeviceCapabilities;
      volume: number;
      muted: boolean;
      party_code: string | null;
      take_active: boolean;
      playback?: ConnectPlaybackState;
    }
  | { type: "ping" }
  | { type: "pong" }
  | {
      type: "update_device";
      name?: string;
      volume?: number;
      muted?: boolean;
      party_code?: string | null;
    }
  | {
      type: "playback_state";
      claim_active?: boolean;
      state: ConnectPlaybackState;
    }
  | {
      type: "transfer";
      target_device_id: string;
      play?: boolean;
      request_id?: string;
    }
  | {
      type: "command";
      request_id?: string;
      target_device_id?: string | null;
      action: ConnectCommandAction;
      payload?: Record<string, unknown>;
    }
  | {
      type: "command_ack";
      command_id: string;
      ok: boolean;
      error?: string | null;
    };

export type ConnectServerMessage =
  | {
      type: "welcome";
      self_device_id: string;
      heartbeat_interval_sec: number;
      state: ConnectState;
    }
  | {
      type: "state";
      state: ConnectState;
    }
  | {
      type: "activate";
      from_device_id: string | null;
      playback: ConnectPlaybackState;
    }
  | {
      type: "deactivated";
      new_active_device_id: string;
      reason: "transferred" | "claimed_by_other_device";
    }
  | {
      type: "command";
      command_id: string;
      request_id?: string | null;
      from_device_id: string;
      action: ConnectCommandAction;
      payload: Record<string, unknown>;
    }
  | {
      type: "command_result";
      request_id?: string | null;
      command_id: string;
      ok: boolean;
      error?: string | null;
    }
  | { type: "ping"; ts?: string }
  | { type: "pong"; ts?: string }
  | {
      type: "error";
      code: string;
      detail: string;
      request_id?: string | null;
    };

function fail(detail: string): never {
  throw new Error(`Connect-Protokollfehler: ${detail}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} muss ein Objekt sein.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    fail(`${label} muss eine${allowEmpty ? "" : " nicht leere"} Zeichenkette sein.`);
  }
  return value;
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} muss eine endliche Zahl sein.`);
  }
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} muss ein Wahrheitswert sein.`);
  }
  return value;
}

/**
 * Normalize a Track to the strict backend schema (`api/app/schemas/track.py`)
 * so strict web & mobile decoders always accept queue payloads over WS.
 */
export function normalizeConnectTrack(track: Track): Track {
  const id = String(track.id ?? "").trim();
  if (!id) fail("Track ohne gültige ID kann nicht über Connect gesendet werden.");
  if (typeof track.title !== "string") fail(`Track ${id}: title fehlt.`);
  if (typeof track.artist !== "string") fail(`Track ${id}: artist fehlt.`);
  if (typeof track.duration_sec !== "number" || !Number.isFinite(track.duration_sec)) {
    fail(`Track ${id}: duration_sec muss eine Zahl sein.`);
  }
  return {
    id,
    title: track.title,
    artist: track.artist,
    artist_id: track.artist_id !== undefined ? String(track.artist_id) : "",
    artists: Array.isArray(track.artists)
      ? track.artists.map((entry) => ({
          id: String(entry.id),
          name: String(entry.name),
        }))
      : [],
    album: typeof track.album === "string" ? track.album : "",
    album_id: track.album_id !== undefined ? String(track.album_id) : "",
    cover: typeof track.cover === "string" ? track.cover : "",
    duration_sec: Math.max(0, Math.round(track.duration_sec)),
    preview_url: typeof track.preview_url === "string" ? track.preview_url : "",
    rank: typeof track.rank === "number" && Number.isFinite(track.rank) ? track.rank : 0,
    release_date: typeof track.release_date === "string" ? track.release_date : "",
    ...(track.loudness_gain_db !== undefined ? { loudness_gain_db: track.loudness_gain_db } : {}),
    ...(track.loudness_lufs !== undefined ? { loudness_lufs: track.loudness_lufs } : {}),
    ...(track.loudness_peak !== undefined ? { loudness_peak: track.loudness_peak } : {}),
  };
}

export function decodeConnectTrack(value: unknown, label: string): Track {
  const raw = asRecord(value, label);
  const id = typeof raw.id === "number" ? String(raw.id) : asString(raw.id, `${label}.id`);
  const title = asString(raw.title, `${label}.title`, true);
  const artist = asString(raw.artist, `${label}.artist`, true);
  const album = raw.album === undefined ? "" : asString(raw.album, `${label}.album`, true);
  const cover = raw.cover === undefined ? "" : asString(raw.cover, `${label}.cover`, true);
  const durationSec = asFiniteNumber(raw.duration_sec, `${label}.duration_sec`);
  if (durationSec < 0) fail(`${label}.duration_sec darf nicht negativ sein.`);
  let artists: Track["artists"];
  if (raw.artists !== undefined) {
    if (!Array.isArray(raw.artists)) fail(`${label}.artists muss eine Liste sein.`);
    artists = raw.artists.map((entry, idx) => {
      const rec = asRecord(entry, `${label}.artists[${idx}]`);
      const artistId =
        typeof rec.id === "string" || typeof rec.id === "number"
          ? rec.id
          : fail(`${label}.artists[${idx}].id muss Zeichenkette oder Zahl sein.`);
      return { id: artistId, name: asString(rec.name, `${label}.artists[${idx}].name`, true) };
    });
  }
  const artistId =
    raw.artist_id === undefined || raw.artist_id === null
      ? undefined
      : typeof raw.artist_id === "string" || typeof raw.artist_id === "number"
        ? raw.artist_id
        : fail(`${label}.artist_id ist ungültig.`);
  const albumId =
    raw.album_id === undefined || raw.album_id === null
      ? undefined
      : typeof raw.album_id === "string" || typeof raw.album_id === "number"
        ? raw.album_id
        : fail(`${label}.album_id ist ungültig.`);

  return {
    id,
    title,
    artist,
    ...(artistId !== undefined ? { artist_id: artistId } : {}),
    ...(artists !== undefined ? { artists } : {}),
    album,
    ...(albumId !== undefined ? { album_id: albumId } : {}),
    cover,
    duration_sec: durationSec,
    ...(typeof raw.preview_url === "string" ? { preview_url: raw.preview_url } : {}),
    ...(typeof raw.rank === "number" && Number.isFinite(raw.rank) ? { rank: raw.rank } : {}),
    ...(typeof raw.release_date === "string" ? { release_date: raw.release_date } : {}),
    ...(raw.loudness_gain_db === null || typeof raw.loudness_gain_db === "number"
      ? { loudness_gain_db: raw.loudness_gain_db }
      : {}),
    ...(raw.loudness_lufs === null || typeof raw.loudness_lufs === "number"
      ? { loudness_lufs: raw.loudness_lufs }
      : {}),
    ...(raw.loudness_peak === null || typeof raw.loudness_peak === "number"
      ? { loudness_peak: raw.loudness_peak }
      : {}),
  };
}

export function decodeConnectDevice(value: unknown, label: string): ConnectDevice {
  const raw = asRecord(value, label);
  const deviceType = asString(raw.device_type, `${label}.device_type`) as DeviceType;
  if (!DEVICE_TYPES.has(deviceType)) {
    fail(`${label}.device_type "${deviceType}" wird nicht unterstützt.`);
  }
  const caps = asRecord(raw.capabilities, `${label}.capabilities`);
  return {
    device_id: asString(raw.device_id, `${label}.device_id`),
    name: asString(raw.name, `${label}.name`),
    device_type: deviceType,
    capabilities: {
      can_play_audio: asBoolean(caps.can_play_audio, `${label}.capabilities.can_play_audio`),
      can_control_volume: asBoolean(caps.can_control_volume, `${label}.capabilities.can_control_volume`),
    },
    volume: asFiniteNumber(raw.volume, `${label}.volume`),
    muted: asBoolean(raw.muted, `${label}.muted`),
    is_active: asBoolean(raw.is_active, `${label}.is_active`),
    party_code:
      raw.party_code === null || raw.party_code === undefined
        ? null
        : asString(raw.party_code, `${label}.party_code`),
    connected_at: asString(raw.connected_at, `${label}.connected_at`),
    last_seen_at: asString(raw.last_seen_at, `${label}.last_seen_at`),
  };
}

export function decodeConnectPlayback(value: unknown, label: string): ConnectPlaybackState {
  const raw = asRecord(value, label);
  if (!Array.isArray(raw.queue)) fail(`${label}.queue muss eine Liste sein.`);
  const queue = raw.queue.map((entry, idx) => decodeConnectTrack(entry, `${label}.queue[${idx}]`));
  if (!Array.isArray(raw.origins) || raw.origins.length !== queue.length) {
    fail(`${label}.origins muss dieselbe Länge wie queue (${queue.length}) haben.`);
  }
  const origins = raw.origins.map((entry, idx) => {
    if (entry !== "manual" && entry !== "context") {
      fail(`${label}.origins[${idx}] muss "manual" oder "context" sein.`);
    }
    return entry;
  });
  const currentIndex = asFiniteNumber(raw.current_index, `${label}.current_index`);
  if (!Number.isInteger(currentIndex) || currentIndex < -1 || currentIndex >= queue.length) {
    fail(`${label}.current_index ${currentIndex} liegt außerhalb von queue (${queue.length}).`);
  }
  const repeat = asString(raw.repeat, `${label}.repeat`) as "off" | "all" | "one";
  if (!REPEAT_MODES.has(repeat)) fail(`${label}.repeat "${repeat}" ist ungültig.`);
  const positionSec = asFiniteNumber(raw.position_sec, `${label}.position_sec`);
  const durationSec = asFiniteNumber(raw.duration_sec, `${label}.duration_sec`);
  return {
    queue,
    origins,
    queue_context:
      raw.queue_context === null || raw.queue_context === undefined
        ? null
        : asString(raw.queue_context, `${label}.queue_context`, true),
    current_index: currentIndex,
    is_playing: asBoolean(raw.is_playing, `${label}.is_playing`),
    position_sec: Math.max(0, positionSec),
    duration_sec: Math.max(0, durationSec),
    shuffle: asBoolean(raw.shuffle, `${label}.shuffle`),
    repeat,
    volume: Math.max(0, Math.min(1, asFiniteNumber(raw.volume, `${label}.volume`))),
    muted: asBoolean(raw.muted, `${label}.muted`),
    updated_at:
      raw.updated_at === null || raw.updated_at === undefined
        ? null
        : asString(raw.updated_at, `${label}.updated_at`),
  };
}

export function decodeConnectState(value: unknown, label = "state"): ConnectState {
  const raw = asRecord(value, label);
  if (!Array.isArray(raw.devices)) fail(`${label}.devices muss eine Liste sein.`);
  const revision = asFiniteNumber(raw.revision, `${label}.revision`);
  return {
    revision,
    active_device_id:
      raw.active_device_id === null || raw.active_device_id === undefined
        ? null
        : asString(raw.active_device_id, `${label}.active_device_id`),
    devices: raw.devices.map((device, idx) => decodeConnectDevice(device, `${label}.devices[${idx}]`)),
    playback: decodeConnectPlayback(raw.playback, `${label}.playback`),
    ...(typeof raw.server_time === "string" ? { server_time: raw.server_time } : {}),
  };
}

/** Strictly parse and validate a server WebSocket frame. Malformed frames throw loudly. */
export function parseConnectServerMessage(rawText: string): ConnectServerMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (cause) {
    throw new Error(
      `Connect-WS lieferte ungültiges JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const msg = asRecord(parsed, "Nachricht");
  const type = asString(msg.type, "type");
  switch (type) {
    case "welcome":
      return {
        type: "welcome",
        self_device_id: asString(msg.self_device_id, "welcome.self_device_id"),
        heartbeat_interval_sec: asFiniteNumber(msg.heartbeat_interval_sec, "welcome.heartbeat_interval_sec"),
        state: decodeConnectState(msg.state, "welcome.state"),
      };
    case "state":
      return {
        type: "state",
        state: decodeConnectState(msg.state, "state.state"),
      };
    case "activate":
      return {
        type: "activate",
        from_device_id:
          msg.from_device_id === null || msg.from_device_id === undefined
            ? null
            : asString(msg.from_device_id, "activate.from_device_id"),
        playback: decodeConnectPlayback(msg.playback, "activate.playback"),
      };
    case "deactivated": {
      const reason = asString(msg.reason, "deactivated.reason");
      if (reason !== "transferred" && reason !== "claimed_by_other_device") {
        fail(`deactivated.reason "${reason}" ist unbekannt.`);
      }
      return {
        type: "deactivated",
        new_active_device_id: asString(msg.new_active_device_id, "deactivated.new_active_device_id"),
        reason,
      };
    }
    case "command": {
      const action = asString(msg.action, "command.action") as ConnectCommandAction;
      if (!COMMAND_ACTIONS.has(action)) {
        fail(`Unbekannter Connect-Befehl "${action}".`);
      }
      const payload =
        msg.payload === undefined || msg.payload === null
          ? {}
          : asRecord(msg.payload, "command.payload");
      return {
        type: "command",
        command_id: asString(msg.command_id, "command.command_id"),
        request_id:
          msg.request_id === undefined || msg.request_id === null
            ? null
            : asString(msg.request_id, "command.request_id"),
        from_device_id: asString(msg.from_device_id, "command.from_device_id"),
        action,
        payload,
      };
    }
    case "command_result":
      return {
        type: "command_result",
        command_id: asString(msg.command_id, "command_result.command_id"),
        request_id:
          msg.request_id === undefined || msg.request_id === null
            ? null
            : asString(msg.request_id, "command_result.request_id"),
        ok: asBoolean(msg.ok, "command_result.ok"),
        error:
          msg.error === undefined || msg.error === null
            ? null
            : asString(msg.error, "command_result.error", true),
      };
    case "ping":
      return { type: "ping", ...(typeof msg.ts === "string" ? { ts: msg.ts } : {}) };
    case "pong":
      return { type: "pong", ...(typeof msg.ts === "string" ? { ts: msg.ts } : {}) };
    case "error":
      return {
        type: "error",
        code: asString(msg.code, "error.code"),
        detail: asString(msg.detail, "error.detail"),
        request_id:
          msg.request_id === undefined || msg.request_id === null
            ? null
            : asString(msg.request_id, "error.request_id"),
      };
    default:
      fail(`Unbekannter Nachrichtentyp "${type}".`);
  }
}

/** Detect a readable default browser + OS name like "Chrome auf macOS". */
export function detectBrowserDeviceName(userAgent?: string): string {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  let browser = "Webplayer";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  let os = "";
  if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Macintosh|Mac OS X/i.test(ua)) os = "macOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Linux/i.test(ua)) os = "Linux";

  return os ? `${browser} auf ${os}` : browser;
}

/** Compute the playhead of a remote playback snapshot accounting for elapsed time. */
export function interpolatedPositionSec(
  playback: ConnectPlaybackState,
  nowMs = Date.now(),
  clockOffsetMs = 0,
): number {
  if (!playback.is_playing || !playback.updated_at) {
    return Math.max(0, playback.position_sec);
  }
  const updatedMs = Date.parse(playback.updated_at);
  if (!Number.isFinite(updatedMs)) {
    return Math.max(0, playback.position_sec);
  }
  const serverNowMs = nowMs + clockOffsetMs;
  const elapsed = Math.max(0, (serverNowMs - updatedMs) / 1000);
  const raw = playback.position_sec + elapsed;
  return playback.duration_sec > 0 ? Math.min(playback.duration_sec, raw) : raw;
}

/** Build a same-origin WebSocket URL for `/api/connect/ws`. */
export function connectWsUrl(origin: string, ticket?: string): string {
  const url = new URL("/api/connect/ws", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (ticket) url.searchParams.set("ticket", ticket);
  return url.toString();
}
