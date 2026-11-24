// Offline mock of the LoggeRythm API for UI development.
//
//   npm run mock-api          # from web/, listens on http://127.0.0.1:8000
//   npm run dev               # in a second terminal — /api/* is proxied here
//
// The real backend refuses to start without a valid DEEZER_ARL. This server
// lets the web UI be developed and visually checked without any credentials:
// it serves a small fictional catalog, generated SVG artwork and synthesized
// audio, and keeps likes/playlists/party state in memory. It is a development
// tool only; unknown routes answer 501 loudly instead of pretending to work.

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_API_PORT ?? 8000);

// ---------------------------------------------------------------- catalog --

const PALETTES = [
  ["#ff7a59", "#7c2d4f"], ["#5eead4", "#155e75"], ["#fbbf24", "#9a3412"],
  ["#a78bfa", "#3b0764"], ["#f472b6", "#701a75"], ["#60a5fa", "#1e3a8a"],
  ["#bef264", "#166534"], ["#fda4af", "#881337"], ["#67e8f9", "#312e81"],
  ["#fdba74", "#422006"], ["#c4b5fd", "#0f172a"], ["#86efac", "#134e4a"],
];

const ARTISTS = [
  "Nachtfalter", "Velvet Motor", "Kiosk Royal", "Polar Hotel", "Die Leisen Riesen",
  "Mira Solaris", "Betonblume", "Tape Garden", "Hafenlicht", "Okapi Club",
  "Lumen & Laut", "Sandra Sturm",
].map((name, index) => ({ id: String(100 + index), name }));

const ALBUM_WORDS = ["Neonregen", "Zwischen den Jahren", "Kaltes Gold", "Fernweh FM", "Stadt ohne Schlaf",
  "Sommer im Parkhaus", "Atlas der Nächte", "Leuchtstoff", "Tiefenrausch", "Kurz vor Morgen",
  "Mondbasis", "Papierflieger", "Salz & Asphalt", "Echo Kammer", "Wolkenbruch", "Kleine Fluchten",
  "Hinterhofdisko", "Blaue Stunde", "Ruhepuls", "Signalfeuer", "Gegenlicht", "Mitternachtsbus",
  "Flimmern", "Nordwind"];

const TITLE_WORDS = ["Laternen", "Sekundenschlaf", "Kreisverkehr", "Glashaus", "Nebelhorn", "Tanzverbot",
  "Fensterplatz", "Autopilot", "Herzrasen", "Kopfkino", "Zuckerwatte", "Falschgeld", "Milchstraße",
  "Rückenwind", "Kaltstart", "Treibsand", "Leerlauf", "Wunderkerze", "Stromausfall", "Karussell",
  "Windschatten", "Morgenrot", "Kellerlicht", "Raketenstart", "Schneekugel", "Flaschenpost",
  "Nachtschicht", "Seifenblasen", "Unterwasser", "Feuerwerk", "Dachterrasse", "Zeitlupe",
  "Fernlicht", "Achterbahn", "Tiefgarage", "Polaroid", "Sternenstaub", "Wellenbrecher",
  "Goldfisch", "Hochhaus", "Sommerregen", "Funkloch", "Kompass", "Luftschloss", "Mondlandung",
  "Regenradar", "Sonnenbrand", "Taschenlampe"];

const cover = (kind, id) => `/api/mock-art/${kind}/${id}.svg`;

// Deezer genre ids cycle through the albums so every visualizer scene shows up,
// including a genre without a scene (Folk) and an album without any genre.
const ALBUM_GENRES = [
  [{ id: "106", name: "Electro" }], [{ id: "116", name: "Rap/Hip Hop" }], [{ id: "152", name: "Rock" }],
  [{ id: "132", name: "Pop" }, { id: "113", name: "Dance" }], [{ id: "129", name: "Jazz" }], [{ id: "98", name: "Klassik" }],
  [{ id: "466", name: "Folk" }], [],
];

const ALBUMS = ALBUM_WORDS.map((title, index) => {
  const artist = ARTISTS[index % ARTISTS.length];
  return {
    id: String(5000 + index), title, artist: artist.name, artist_id: artist.id,
    genres: ALBUM_GENRES[index % ALBUM_GENRES.length],
    cover: cover("album", 5000 + index),
    release_date: `202${6 - (index % 4)}-${String((index % 12) + 1).padStart(2, "0")}-1${index % 9}`,
  };
});

const TRACKS = [];
ALBUMS.forEach((album, albumIndex) => {
  for (let n = 0; n < 6; n++) {
    const serial = albumIndex * 6 + n;
    const part = ["", " II", " III"][Math.floor(serial / TITLE_WORDS.length)];
    const word = `${TITLE_WORDS[(serial * 7) % TITLE_WORDS.length]}${part}`;
    const id = String(900000 + albumIndex * 10 + n);
    const feat = n === 3 ? ARTISTS[(albumIndex + 5) % ARTISTS.length] : null;
    TRACKS.push({
      id, title: n === 5 ? `${word} (Live)` : word,
      artist: album.artist, artist_id: album.artist_id,
      artists: [{ id: album.artist_id, name: album.artist }, ...(feat ? [feat] : [])],
      album: album.title, album_id: album.id, cover: album.cover,
      duration_sec: 150 + ((albumIndex * 37 + n * 53) % 110),
      rank: 950000 - ((albumIndex * 6 + n) * 6100) % 900000,
      preview_url: "",
    });
  }
});
const trackById = new Map(TRACKS.map((track) => [track.id, track]));
/** `count` distinct tracks, walking the catalog with a stride coprime to its size. */
const pick = (start, count, step = 7) => {
  const stride = [step, 7, 5, 11, 13].find((candidate) => candidate % 2 && candidate % 3) ?? 1;
  return Array.from({ length: Math.min(count, TRACKS.length) }, (_, i) => TRACKS[(start + i * stride) % TRACKS.length]);
};

const GENRES = ["Pop", "Indie", "Elektro", "Hip-Hop", "Rock", "Jazz", "Soul", "Klassik", "Metal", "Folk", "Dance", "Ambient"]
  .map((name, index) => ({ id: String(index + 1), name, picture: cover("genre", index + 1) }));

const artistSummary = (artist) => ({ id: artist.id, name: artist.name, picture: cover("artist", artist.id) });
const albumSummary = ({ id, title, artist, cover: art, release_date }) => ({ id, title, artist, cover: art, release_date });

const SHELVES = [
  { key: "weekly", title: "Dein Wochenmix", subtitle: "Frisch gemischt aus allem, was du gerade hörst", tracks: pick(3, 30) },
  { key: "chill", title: "Ruhige Stunden", subtitle: "Leise Lieblinge für den Abend", tracks: pick(11, 25, 5) },
  { key: "discover", title: "Neu für dich", subtitle: "Titel, die du noch nicht kennst", tracks: pick(20, 30, 11) },
  { key: "energy", title: "Volle Kraft", subtitle: "Für Workout und lange Fahrten", tracks: pick(41, 25, 13) },
].map((shelf) => ({ ...shelf, cover: shelf.tracks[0].cover }));

const BECAUSE = ARTISTS.slice(0, 3).map((artist, index) => ({
  // Same key shape as routers/home.py: "byl-" + lowercased artist, spaces -> "-".
  key: `byl-${artist.name.toLowerCase().replaceAll(" ", "-")}`, title: `Mehr wie ${artist.name}`,
  subtitle: `Weil du ${artist.name} oft hörst`, tracks: pick(index * 17 + 2, 20, 9),
  cover: cover("artist", artist.id),
}));

const CHART_COLLECTIONS = ["Top 50 Deutschland", "Viral gerade", "Neu & gut", "Indie-Radar"].map((title, index) => ({
  key: `charts-${index}`, title, subtitle: "Täglich aktualisiert", tracks: pick(index * 9, 25, 3),
  cover: cover("genre", index + 1),
}));

const LYRIC_LINES = ["Die Stadt atmet aus, wir atmen ein", "Laternen zählen unsre Schritte", "Und alles, was wir waren, bleibt",
  "Zwischen Fenstern voller Licht", "Halt mich fest, bis der Morgen kommt", "Wir tanzen leise durch den Lärm",
  "Kein Wort zu viel, kein Blick zu wenig", "Die Nacht gehört uns ganz allein", "Und irgendwo fährt noch ein Zug",
  "Wir bleiben wach, bis es hell wird", "Ein letztes Lied, ein letzter Tanz", "Dann tragen uns die Straßen heim"];

// ------------------------------------------------------------------ state --

const me = { id: 1, email: "demo@loggerythm.test", display_name: "Demo", is_admin: true, is_approved: true, avatar_url: null };
let loggedIn = true;
const settings = { crossfade_enabled: false, crossfade_duration_sec: 5 };
const likes = new Map(pick(1, 14, 5).map((track) => [track.id, track]));
const follows = new Map(ARTISTS.slice(0, 5).map((artist) => [artist.id, artistSummary(artist)]));
let nextPlaylistId = 4;
const playlists = new Map([
  ["1", { id: 1, name: "Logge Recent", description: "Alles, was gerade läuft", is_public: true, tracks: pick(0, 42, 5), cover_url: cover("playlist", 1) }],
  ["2", { id: 2, name: "Sonntagmorgen", description: "Kaffee, Zeitung, leise Töne", is_public: false, tracks: pick(8, 18, 9), cover_url: cover("playlist", 2) }],
  ["3", { id: 3, name: "Roadtrip Süden", description: "", is_public: false, tracks: pick(30, 27, 4), cover_url: "" }],
]);
const publicPlaylists = [
  { id: 50, name: "Büro ohne Worte", description: "Instrumental", is_public: true, owner_name: "Jule", tracks: pick(6, 22, 8), cover_url: cover("playlist", 50) },
  { id: 51, name: "Kellerparty 2026", description: "", is_public: true, owner_name: "Tariq", tracks: pick(15, 35, 6), cover_url: cover("playlist", 51) },
];
const plays = pick(4, 12, 3);
const parties = new Map();
const SERVER_CACHED_IDS = new Set(pick(0, 30, 5).map((track) => track.id));
const partyStreams = new Map(); // code -> Set<{ res, viewer }>

// Connect multi-device hub state (in-memory for offline UI development)
const connectHub = {
  revision: 0,
  activeDeviceId: null,
  devices: new Map(), // device_id -> { device, socket }
  tickets: new Map(), // ticket -> expiresAt
  pendingCommands: new Map(), // command_id -> { senderSocket, requestId }
  commandCounter: 0,
  playback: {
    queue: [],
    origins: [],
    queue_context: null,
    current_index: -1,
    is_playing: false,
    position_sec: 0,
    duration_sec: 0,
    shuffle: false,
    repeat: "off",
    volume: 0.8,
    muted: false,
    updated_at: null,
  },
};

const playlistSummary = (playlist) => ({
  id: playlist.id, name: playlist.name, description: playlist.description, cover_url: playlist.cover_url,
  track_count: playlist.tracks.length, is_public: playlist.is_public, owner_name: playlist.owner_name ?? me.display_name,
});
const findPlaylist = (id) => playlists.get(String(id)) ?? publicPlaylists.find((playlist) => String(playlist.id) === String(id));

// ------------------------------------------------------------- generators --

function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function artwork(kind, id) {
  const seed = hash(`${kind}:${id}`);
  const [from, to] = PALETTES[seed % PALETTES.length];
  const round = kind === "artist";
  const shapes = Array.from({ length: 5 }, (_, i) => {
    const s = hash(`${seed}:${i}`);
    const x = s % 400, y = (s >> 8) % 400, r = 40 + ((s >> 16) % 130);
    return round || i % 2
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.05 + (i % 3) * 0.05}"/>`
      : `<rect x="${x - r}" y="${y - r / 2}" width="${r * 2}" height="${r}" rx="${r / 4}" transform="rotate(${s % 90} ${x} ${y})" fill="#000" opacity="${0.08 + (i % 3) * 0.05}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/>${shapes}</svg>`;
}

const audioCache = new Map();
/** Synthesized 8 kHz mono WAV: a pulsing two-note pattern unique per track. */
function audio(track) {
  const cached = audioCache.get(track.id);
  if (cached) return cached;
  const rate = 8000, samples = rate * track.duration_sec;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + samples, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate, 28); buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples, 40);
  const seed = hash(track.id);
  const scale = [110, 123.5, 130.8, 146.8, 164.8, 174.6, 196];
  const bpm = 96 + (seed % 40), beat = (60 / bpm) * rate;
  for (let i = 0; i < samples; i++) {
    const t = i / rate, step = Math.floor(i / beat), inBeat = (i % beat) / beat;
    const note = scale[(seed + step * 3 + (step >> 2)) % scale.length];
    const kick = Math.sin(2 * Math.PI * 55 * t * (1.6 - inBeat)) * Math.exp(-inBeat * 9);
    const lead = Math.sin(2 * Math.PI * note * 2 * t) * Math.exp(-inBeat * 3) * 0.5;
    const pad = Math.sin(2 * Math.PI * note * t) * 0.25;
    buffer[44 + i] = 128 + Math.round(Math.max(-1, Math.min(1, kick * 0.6 + lead + pad)) * 90);
  }
  if (audioCache.size > 12) audioCache.delete(audioCache.keys().next().value);
  audioCache.set(track.id, buffer);
  return buffer;
}

// ----------------------------------------------------------------- server --

// ------------------------------------------------------- import jobs --

const MOCK_IMPORT_TOTAL = 140;
const MOCK_IMPORT_MATCHED = 120;
const importJobs = new Map();
let importJobCounter = 0;

function importJobStatus(job) {
  const elapsed = Date.now() - job.startedAt;
  const base = { id: job.id, url: job.url, type: "", name: "", image: "", total: 0, source_total: 0, processed: 0, matched: 0,
    failed_lookups: 0, lookup_error: null, error: null, created_at: job.created_at, updated_at: new Date().toISOString(), finished_at: null };
  if (elapsed < 800) return { ...base, status: "queued" };
  if (elapsed < 2000) return { ...base, status: "running" };
  const source = { type: "playlist", name: "Riesige Roadtrip-Playlist", image: cover("playlist", 98), total: MOCK_IMPORT_TOTAL, source_total: MOCK_IMPORT_TOTAL };
  if (/fehler/.test(job.url)) {
    return { ...base, ...source, status: "failed", error: "Spotify-API-Anfrage fehlgeschlagen: 502 Bad Gateway", finished_at: new Date().toISOString() };
  }
  const processed = Math.min(MOCK_IMPORT_TOTAL, Math.floor((elapsed - 2000) / 80));
  const matched = Math.floor(processed * (MOCK_IMPORT_MATCHED / MOCK_IMPORT_TOTAL));
  if (processed < MOCK_IMPORT_TOTAL) return { ...base, ...source, status: "running", processed, matched };
  return { ...base, ...source, status: "done", processed, matched: MOCK_IMPORT_MATCHED, failed_lookups: 2,
    lookup_error: "Kiosk Royal – Rarität (Demo): DeezerClientError: HTTP 500", finished_at: new Date().toISOString() };
}

function send(res, status, body, headers = {}) {
  if (body === undefined) { res.writeHead(status, headers).end(); return; }
  const payload = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" || Buffer.isBuffer(body) ? "text/plain" : "application/json",
    ...headers,
  }).end(payload);
}
const fail = (res, status, detail) => send(res, status, { detail });

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text || !req.headers["content-type"]?.includes("application/json")) return {};
  return JSON.parse(text);
}

const HOST_VIEWER = { key: "u:1", name: "Demo", guest: false };

// Simulated background preload: from the playing track on, one track loads
// every few seconds; the fifth upcoming track fails like an unavailable one.
function partyLoad(party, index, deezerId) {
  if (SERVER_CACHED_IDS.has(String(deezerId))) {
    return { is_stored: true, load_state: "ready", load_error: null };
  }
  const ahead = index - Math.max(party.current_index, 0);
  if (ahead < 0) return { is_stored: true, load_state: "ready", load_error: null };
  if (ahead === 4) return { is_stored: false, load_state: "failed", load_error: "Deezer403Exception: Titel in dieser Region nicht verfügbar (Demo)" };
  const done = Math.floor((Date.now() - party.loadStart) / 4000);
  if (ahead < done) return { is_stored: true, load_state: "ready", load_error: null };
  if (ahead === done) return { is_stored: false, load_state: "loading", load_error: null };
  return { is_stored: false, load_state: ahead < 15 ? "queued" : "idle", load_error: null };
}

function partyState(party, viewer = HOST_VIEWER, ended = false) {
  return {
    code: party.code,
    name: party.name,
    host_name: me.display_name,
    is_host: !viewer.guest,
    current_index: party.current_index,
    members: [
      { key: "u:1", name: me.display_name, avatar_url: me.avatar_url, is_guest: false, is_host: true },
      ...party.extraMembers,
      ...[...party.guests.values()].map((guest) => ({ key: guest.key, name: guest.name, avatar_url: null, is_guest: true, is_host: false })),
    ],
    tracks: party.tracks.map((track, index) => ({
      added_by_member: "",
      added_by_avatar_url: null,
      ...track,
      ...partyLoad(party, index, track.deezer_id),
    })),
    guests_can_control: Boolean(party.guests_can_control),
    playback_changed_by: party.playback_changed_by ?? "",
    playback_revision: party.playback_revision ?? 0,
    ended,
    is_playing: ended ? false : party.is_playing,
    position_sec: party.position_sec,
    playback_updated_at: party.updated,
    server_time: new Date().toISOString(),
    viewer_key: viewer.key,
    viewer_name: viewer.name,
    viewer_is_guest: viewer.guest,
  };
}

function broadcastParty(party, ended = false) {
  const subs = partyStreams.get(party.code);
  if (!subs) return;
  for (const sub of subs) {
    try {
      sub.res.write(`data: ${JSON.stringify(partyState(party, sub.viewer, ended))}\n\n`);
      if (ended) sub.res.end();
    } catch {
      subs.delete(sub);
    }
  }
  if (ended) partyStreams.delete(party.code);
}

function connectStateSnapshot() {
  const devices = [...connectHub.devices.values()].map(({ device }) => ({
    ...device,
    is_active: device.device_id === connectHub.activeDeviceId,
  }));
  return {
    revision: connectHub.revision,
    active_device_id: connectHub.activeDeviceId,
    devices,
    playback: connectHub.playback,
    server_time: new Date().toISOString(),
  };
}

function wsEncodeFrame(opcode, payloadBuf) {
  const len = payloadBuf.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuf]);
}

function wsSendJson(socket, obj) {
  if (socket.destroyed) return;
  socket.write(wsEncodeFrame(0x1, Buffer.from(JSON.stringify(obj), "utf8")));
}

function wsClose(socket, code = 1000, reason = "") {
  if (socket.destroyed) return;
  const reasonBuf = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  socket.write(wsEncodeFrame(0x8, payload));
  socket.end();
}

function broadcastConnectState() {
  connectHub.revision += 1;
  const state = connectStateSnapshot();
  for (const entry of connectHub.devices.values()) {
    wsSendJson(entry.socket, { type: "state", state });
  }
}

function interpolatedMockPosition() {
  const pb = connectHub.playback;
  if (!pb.is_playing || !pb.updated_at) return pb.position_sec;
  const elapsed = Math.max(0, (Date.now() - Date.parse(pb.updated_at)) / 1000);
  const next = pb.position_sec + elapsed;
  return pb.duration_sec > 0 ? Math.min(pb.duration_sec, next) : next;
}

function partyGuest(req, party) {
  const token = /(?:^|;\s*)sf_party_guest=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  return token ? party.guests.get(token) ?? null : null;
}

const matches = (query, ...fields) => fields.some((field) => field.toLowerCase().includes(query));

async function handle(req, res) {
  const url = new URL(req.url, "http://mock");
  const method = req.method;
  const path = decodeURIComponent(url.pathname.replace(/^\/api/, ""));
  const seg = path.split("/").filter(Boolean);
  const is = (m, pattern) => method === m && new RegExp(`^${pattern}$`).test(path);

  if (is("GET", "/mock-art/[a-z]+/[^/]+\\.svg")) {
    return send(res, 200, artwork(seg[1], seg[2].replace(/\.svg$/, "")), { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
  }
  if (is("GET", "/version")) return send(res, 200, { api_version: "mock", min_android_version_code: 0 });

  // Auth
  if (is("POST", "/auth/login") || is("POST", "/auth/register")) { loggedIn = true; return send(res, 200, me); }
  if (is("POST", "/auth/logout")) { loggedIn = false; return send(res, 204); }
  if (is("POST", "/auth/password/forgot")) return send(res, 204);
  // Any token except "expired" is accepted, like a fresh link from the mail.
  if (is("POST", "/auth/password/reset")) {
    const { token } = await readJson(req);
    if (token === "expired") return fail(res, 400, "Der Link ist ungültig, abgelaufen oder wurde schon benutzt.");
    loggedIn = true;
    return send(res, 200, me);
  }
  if (is("GET", "/auth/me")) return loggedIn ? send(res, 200, me) : fail(res, 401, "Nicht angemeldet");
  // Like the real API: search is public, and party routes resolve their own
  // caller (account or anonymous guest cookie) below.
  const publicWhenLoggedOut = is("GET", "/search") || (seg[0] === "party" && seg[1]);
  if (!loggedIn && !publicWhenLoggedOut) return fail(res, 401, "Nicht angemeldet");

  if (is("PATCH", "/me")) { Object.assign(me, await readJson(req)); delete me.password; return send(res, 200, me); }
  if (is("GET", "/me/settings")) return send(res, 200, settings);
  if (is("PATCH", "/me/settings")) return send(res, 200, Object.assign(settings, await readJson(req)));
  if (is("PUT", "/me/avatar")) { me.avatar_url = cover("artist", "me"); return send(res, 200, me); }

  // Catalog
  if (is("GET", "/search")) {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return send(res, 200, TRACKS.filter((track) => matches(q, track.title, track.artist, track.album)).slice(0, 40));
  }
  if (is("GET", "/search/artist")) {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return send(res, 200, ARTISTS.filter((artist) => matches(q, artist.name)).map(artistSummary));
  }
  if (is("GET", "/search/playlist")) {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return send(res, 200, CHART_COLLECTIONS.filter((shelf) => matches(q, shelf.title) || q.length > 2)
      .map((shelf, index) => ({ id: 7000 + index, title: shelf.title, cover: shelf.cover, track_count: shelf.tracks.length })));
  }
  if (is("GET", "/charts")) return send(res, 200, pick(0, 40, 1).sort((a, b) => b.rank - a.rank));
  if (is("GET", "/home/mixes")) return send(res, 200, SHELVES);
  if (is("GET", "/home/because-you-listened")) return send(res, 200, BECAUSE);
  if (is("GET", "/home/charts-collections")) return send(res, 200, CHART_COLLECTIONS);
  if (is("GET", "/home/release-radar")) {
    return send(res, 200, pick(2, 18, 6).map((track, index) => {
      // Every third track comes from a watched artist who is not its primary artist.
      const contributor = index % 3 === 2
        ? track.artists[1] ?? ARTISTS.find((artist) => artist.id !== track.artist_id)
        : null;
      const source = contributor ?? { id: track.artist_id, name: track.artist };
      const followed = index % 3 === 0;
      return {
        ...track,
        release_date: new Date(Date.now() - index * 3 * 864e5).toISOString().slice(0, 10),
        radar_reason: {
          kind: followed ? "followed" : "played",
          artist_id: source.id,
          artist_name: source.name,
          play_count: followed ? index % 2 : 2 + index,
        },
      };
    }));
  }
  if (is("GET", "/home/mood/[^/]+")) return send(res, 200, pick(hash(seg[2]) % TRACKS.length, 30, 5));
  if (is("GET", "/genres")) return send(res, 200, GENRES);
  if (is("GET", "/genres/[^/]+")) {
    const genre = GENRES.find((entry) => entry.id === seg[1]);
    if (!genre) return fail(res, 404, "Genre nicht gefunden");
    const offset = Number(genre.id) * 5;
    return send(res, 200, { ...genre, tracks: pick(offset, 20, 3),
      albums: Array.from({ length: 10 }, (_, i) => albumSummary(ALBUMS[(offset + i) % ALBUMS.length])),
      artists: Array.from({ length: 8 }, (_, i) => artistSummary(ARTISTS[(offset + i) % ARTISTS.length])) });
  }
  if (is("GET", "/new-releases")) return send(res, 200, ALBUMS.slice(0, 18).map(albumSummary));
  if (is("GET", "/tracks/[^/]+/stream")) {
    const track = trackById.get(seg[1]);
    if (!track) return fail(res, 404, "Titel nicht gefunden");
    const data = audio(track);
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    const base = { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    if (!range) return send(res, 200, data, { ...base, "Content-Length": data.length });
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    return send(res, 206, data.subarray(start, end + 1), { ...base, "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": end - start + 1 });
  }
  if (is("POST", "/tracks/[^/]+/preload")) return send(res, 204);
  if (is("GET", "/tracks/[^/]+")) {
    const track = trackById.get(seg[1]);
    return track ? send(res, 200, track) : fail(res, 404, "Titel nicht gefunden");
  }
  if (is("GET", "/albums/[^/]+")) {
    const album = ALBUMS.find((entry) => entry.id === seg[1]);
    if (!album) return fail(res, 404, "Album nicht gefunden");
    const tracks = TRACKS.filter((track) => track.album_id === album.id);
    return send(res, 200, { ...album, nb_tracks: tracks.length, tracks });
  }
  if (is("GET", "/artists/[^/]+")) {
    const artist = ARTISTS.find((entry) => entry.id === seg[1]);
    if (!artist) return fail(res, 404, "Künstler nicht gefunden");
    const albums = ALBUMS.filter((album) => album.artist_id === artist.id);
    return send(res, 200, { ...artistSummary(artist), fans: 48000 + hash(artist.id) % 900000, albums_count: albums.length,
      top: TRACKS.filter((track) => track.artist_id === artist.id).slice(0, 10), albums: albums.map(albumSummary),
      related: ARTISTS.filter((entry) => entry.id !== artist.id).slice(0, 6).map(artistSummary) });
  }
  if (is("GET", "/artist-about")) {
    const name = url.searchParams.get("name") ?? "";
    return send(res, 200, { bio: `${name} veröffentlichen seit 2019 Musik zwischen Synthpop und Indie. Die Band gründete sich in einem Proberaum über einer Autowerkstatt und spielt seitdem auf kleinen wie großen Bühnen.`,
      listeners: 120000 + hash(name) % 800000, playcount: 2400000 + hash(name) % 9000000, tags: ["indie", "synthpop", "deutsch"] });
  }
  if (is("GET", "/lyrics")) {
    return send(res, 200, { lines: Array.from({ length: 36 }, (_, i) => ({ t: 6 + i * 4.5, text: LYRIC_LINES[i % LYRIC_LINES.length] })),
      synced: true, source: "mock", ai_generated: url.searchParams.get("variant") === "ai", cached: true });
  }
  if (is("GET", "/deezer-playlist/[^/]+")) {
    const shelf = CHART_COLLECTIONS[(Number(seg[1]) - 7000 + CHART_COLLECTIONS.length * 100) % CHART_COLLECTIONS.length];
    return send(res, 200, { id: seg[1], name: shelf.title, cover: shelf.cover, tracks: shelf.tracks });
  }
  if (is("GET", "/radio/[^/]+")) return send(res, 200, pick(hash(seg[1]) % TRACKS.length, 12, 11));
  if (is("POST", "/track-plays")) {
    const body = await readJson(req);
    return send(res, 200, Object.fromEntries((body.tracks ?? []).map((track) => [track.id, { plays: 20000 + hash(track.id) % 4000000, listeners: 3000 + hash(track.id) % 300000 }])));
  }
  if (is("GET", "/cached-tracks")) return send(res, 200, { ids: [...SERVER_CACHED_IDS] });
  // Spotify import jobs: progress is derived from the time since the start, so
  // a job visibly moves queued → running → done. A link containing "fehler"
  // fails after the Spotify phase, to show the failure state.
  if (is("POST", "/resolve/jobs")) {
    const { url: link } = await readJson(req);
    if (!/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(playlist|album|track)\/|spotify:(playlist|album|track):/.test(link ?? "")) {
      return send(res, 400, { detail: "Kein gültiger Spotify-Link (Playlist, Album oder Titel)." });
    }
    const job = { id: `job${++importJobCounter}`, url: link, startedAt: Date.now(), created_at: new Date().toISOString() };
    importJobs.set(job.id, job);
    return send(res, 202, importJobStatus(job));
  }
  if (is("GET", "/resolve/jobs")) return send(res, 200, [...importJobs.values()].reverse().map(importJobStatus));
  if (is("GET", "/resolve/jobs/[^/]+")) {
    const job = importJobs.get(seg[2]);
    if (!job) return send(res, 404, { detail: "Import nicht gefunden." });
    const status = importJobStatus(job);
    if (status.status !== "done") return send(res, 200, { ...status, result: null });
    const tracks = pick(12, MOCK_IMPORT_MATCHED, 4);
    return send(res, 200, { ...status, result: { type: "playlist", name: status.name, image: status.image, total: status.total,
      source_total: status.source_total, matched: tracks.length, tracks,
      unmatched: [{ title: "Unauffindbar", artist: "Niemand" }, { title: "Rarität (Demo)", artist: "Kiosk Royal" }] } });
  }
  if (is("DELETE", "/resolve/jobs/[^/]+")) {
    if (!importJobs.delete(seg[2])) return send(res, 404, { detail: "Import nicht gefunden." });
    return send(res, 204);
  }

  if (is("GET", "/resolve")) {
    const tracks = pick(12, 16, 4);
    return send(res, 200, { type: "playlist", name: "Importierte Playlist", image: cover("playlist", 99), total: 18, source_total: 18, matched: 16, tracks,
      unmatched: [{ title: "Unauffindbar", artist: "Niemand" }, { title: "Rarität (Demo)", artist: "Kiosk Royal" }] });
  }

  // Likes / follows
  if (is("GET", "/me/likes")) return send(res, 200, [...likes.values()]);
  if (is("GET", "/me/likes/contains")) {
    return send(res, 200, Object.fromEntries((url.searchParams.get("ids") ?? "").split(",").filter(Boolean).map((id) => [id, likes.has(id)])));
  }
  if (is("PUT", "/me/likes/[^/]+")) { likes.set(seg[2], await readJson(req)); return send(res, 204); }
  if (is("DELETE", "/me/likes/[^/]+")) { likes.delete(seg[2]); return send(res, 204); }
  if (is("GET", "/me/following/artists")) return send(res, 200, [...follows.values()]);
  if (is("GET", "/me/following/artists/contains")) {
    return send(res, 200, Object.fromEntries((url.searchParams.get("ids") ?? "").split(",").filter(Boolean).map((id) => [id, follows.has(id)])));
  }
  if (is("PUT", "/me/following/artists/[^/]+")) { follows.set(seg[3], await readJson(req)); return send(res, 204); }
  if (is("DELETE", "/me/following/artists/[^/]+")) { follows.delete(seg[3]); return send(res, 204); }

  // Plays / stats / profile
  if (is("POST", "/me/plays")) { plays.unshift(await readJson(req)); return send(res, 204); }
  if (is("GET", "/me/stats")) {
    const entry = (track, count) => ({ key: track.id, label: track.title, sublabel: track.artist, cover: track.cover, count });
    const artistEntry = (artist, count) => ({ key: artist.id, label: artist.name, sublabel: "", cover: cover("artist", artist.id), count });
    return send(res, 200, { total_plays: 1284, total_plays_month: 320,
      top_tracks: pick(3, 8, 9).map((track, i) => entry(track, 64 - i * 6)), top_artists: ARTISTS.slice(0, 8).map((artist, i) => artistEntry(artist, 210 - i * 22)),
      top_tracks_month: pick(9, 8, 4).map((track, i) => entry(track, 19 - i * 2)), top_artists_month: ARTISTS.slice(3, 11).map((artist, i) => artistEntry(artist, 41 - i * 4)),
      recent: plays.slice(0, 20).map(({ id, title, artist, artist_id, artists, album, album_id, cover: art, duration_sec }) => ({ id, title, artist, artist_id, artists, album, album_id, cover: art, duration_sec })) });
  }
  if (is("GET", "/users/[^/]+")) {
    return send(res, 200, { id: seg[1], display_name: seg[1] === "1" ? me.display_name : "Jule", avatar_url: null,
      playlists: [...playlists.values()].filter((playlist) => playlist.is_public).map(playlistSummary), top_artists: ARTISTS.slice(0, 6).map(artistSummary) });
  }

  // Playlists
  if (is("GET", "/playlists")) return send(res, 200, [...playlists.values()].map(playlistSummary));
  if (is("GET", "/playlists/public")) return send(res, 200, publicPlaylists.map(playlistSummary));
  if (is("POST", "/playlists")) {
    const body = await readJson(req);
    const playlist = { id: nextPlaylistId++, name: body.name, description: body.description ?? "", is_public: false, tracks: [], cover_url: "" };
    playlists.set(String(playlist.id), playlist);
    return send(res, 200, playlistSummary(playlist));
  }
  if (seg[0] === "playlists" && seg[1]) {
    const playlist = findPlaylist(seg[1]);
    if (!playlist) return fail(res, 404, "Playlist nicht gefunden");
    const own = playlists.has(String(playlist.id));
    if (is("GET", "/playlists/[^/]+")) return send(res, 200, { ...playlistSummary(playlist), is_owner: own, tracks: playlist.tracks });
    if (is("GET", "/playlists/[^/]+/export")) return send(res, 200, "mock export", { "Content-Disposition": 'attachment; filename="playlist.txt"' });
    if (!own) return fail(res, 403, "Nur eigene Playlists können geändert werden");
    if (is("PATCH", "/playlists/[^/]+")) return send(res, 200, playlistSummary(Object.assign(playlist, await readJson(req))));
    if (is("DELETE", "/playlists/[^/]+")) { playlists.delete(String(playlist.id)); return send(res, 204); }
    if (is("PATCH", "/playlists/[^/]+/visibility")) { playlist.is_public = (await readJson(req)).is_public; return send(res, 200, playlistSummary(playlist)); }
    if (is("PUT", "/playlists/[^/]+/cover")) { playlist.cover_url = cover("playlist", `${playlist.id}-${Date.now()}`); return send(res, 200, playlistSummary(playlist)); }
    if (is("POST", "/playlists/[^/]+/tracks")) { playlist.tracks.push(await readJson(req)); return send(res, 204); }
    if (is("POST", "/playlists/[^/]+/tracks/bulk")) {
      const body = await readJson(req); playlist.tracks.push(...body); return send(res, 200, { added: body.length });
    }
    if (is("PATCH", "/playlists/[^/]+/tracks/order")) {
      const order = (await readJson(req)).deezer_ids;
      playlist.tracks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return send(res, 204);
    }
    if (is("DELETE", "/playlists/[^/]+/tracks/[^/]+")) { playlist.tracks = playlist.tracks.filter((track) => track.id !== seg[3]); return send(res, 204); }
  }

  // Connect REST helpers
  if (is("POST", "/connect/ticket")) {
    const ticket = randomBytes(24).toString("hex");
    connectHub.tickets.set(ticket, Date.now() + 30_000);
    return send(res, 200, { ticket, expires_in_sec: 30 });
  }
  if (is("GET", "/connect/state")) {
    return send(res, 200, connectStateSnapshot());
  }

  // Party
  if (is("GET", "/party/active")) {
    const active = [...parties.values()][0];
    return send(res, 200, active ? partyState(active) : null);
  }
  if (is("POST", "/party")) {
    const code = "DEMO42";
    const body = await readJson(req);
    const party = {
      code,
      name: body.name || "Demo-Jam",
      current_index: 0,
      is_playing: false,
      position_sec: 0,
      updated: new Date().toISOString(),
      guests_can_control: Boolean(body.guests_can_control),
      playback_changed_by: "u:1",
      playback_revision: 1,
      nextId: 1,
      tracks: [],
      extraMembers: [{ key: "u:2", name: "Jule", avatar_url: null, is_guest: false, is_host: false }],
      guests: new Map(),
      loadStart: Date.now(),
    };
    const seed = body.tracks?.length ? body.tracks : pick(5, 6, 8);
    for (const track of seed) party.tracks.push({ ...track, id: party.nextId++, deezer_id: track.id, added_by: "Demo", added_by_member: "u:1" });
    if (body.tracks?.length) {
      Object.assign(party, {
        current_index: body.current_index,
        is_playing: body.is_playing,
        position_sec: body.position_sec,
        updated: new Date().toISOString(),
      });
    }
    parties.set(code, party);
    return send(res, 200, partyState(party));
  }
  if (seg[0] === "party" && seg[1]) {
    const party = parties.get(seg[1].toUpperCase());
    if (!party) return fail(res, 404, "Jam nicht gefunden");
    if (is("POST", "/party/[^/]+/guest")) {
      const nickname = String((await readJson(req)).nickname ?? "").trim().replace(/\s+/g, " ");
      if (!nickname) return fail(res, 422, "Der Nickname darf nicht nur aus Leerzeichen bestehen.");
      const taken = [me.display_name, ...party.extraMembers.map((m) => m.name), ...[...party.guests.values()].map((guest) => guest.name)];
      if (taken.some((name) => name.toLowerCase() === nickname.toLowerCase())) return fail(res, 409, `Der Nickname „${nickname}“ ist in dieser Jam schon vergeben.`);
      const token = `guest${party.guests.size + 1}x${Date.now()}`;
      const guest = { key: `g:${party.guests.size + 1}`, name: nickname, guest: true };
      party.guests.set(token, guest);
      broadcastParty(party);
      return send(res, 200, partyState(party, guest), { "Set-Cookie": `sf_party_guest=${token}; Path=/api/party/${party.code}; HttpOnly; SameSite=Lax` });
    }
    const guest = partyGuest(req, party);
    const viewer = loggedIn ? HOST_VIEWER : guest;
    if (!viewer) return fail(res, 401, "Not authenticated: sign in or join this party as a guest with a nickname");
    if (is("GET", "/party/[^/]+") || is("POST", "/party/[^/]+/join")) return send(res, 200, partyState(party, viewer));
    if (is("GET", "/party/[^/]+/cached-tracks")) return send(res, 200, { ids: [...SERVER_CACHED_IDS] });
    if (is("GET", "/party/[^/]+/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
      const entry = { res, viewer };
      if (!partyStreams.has(party.code)) partyStreams.set(party.code, new Set());
      partyStreams.get(party.code).add(entry);
      const push = () => res.write(`data: ${JSON.stringify(partyState(party, viewer))}\n\n`);
      push();
      const timer = setInterval(push, 2000);
      req.on("close", () => {
        clearInterval(timer);
        partyStreams.get(party.code)?.delete(entry);
      });
      return;
    }
    if (is("POST", "/party/[^/]+/leave")) {
      if (!viewer.guest) return send(res, 204);
      for (const [token, entry] of party.guests) if (entry === viewer) party.guests.delete(token);
      broadcastParty(party);
      return send(res, 204, undefined, { "Set-Cookie": `sf_party_guest=""; Path=/api/party/${party.code}; Max-Age=0` });
    }
    if (is("POST", "/party/[^/]+/tracks")) {
      const track = await readJson(req);
      const item = { ...track, id: party.nextId++, deezer_id: track.id, added_by: viewer.name, added_by_member: viewer.key };
      if (url.searchParams.get("insert") === "next" && party.current_index >= 0) {
        party.tracks.splice(party.current_index + 1, 0, item);
      } else {
        party.tracks.push(item);
      }
      broadcastParty(party);
      return send(res, 204);
    }
    if (is("DELETE", "/party/[^/]+/tracks/\\d+")) {
      const index = party.tracks.findIndex((track) => track.id === Number(seg[3]));
      if (index < 0) return fail(res, 404, "Party track not found");
      const canRemoveAnyUpcoming = !viewer.guest || party.guests_can_control;
      if (!canRemoveAnyUpcoming && party.tracks[index].added_by_member !== viewer.key) {
        return fail(res, 403, "Du kannst nur Titel entfernen, die du selbst hinzugefügt hast.");
      }
      if (viewer.guest && index === party.current_index) {
        return fail(res, 403, "Der Titel läuft gerade; nur der Host kann ihn jetzt entfernen.");
      }
      party.tracks.splice(index, 1);
      if (index < party.current_index) party.current_index -= 1;
      broadcastParty(party);
      return send(res, 204);
    }
    if (is("PATCH", "/party/[^/]+/settings")) {
      if (viewer.guest) return fail(res, 403, "Nur der Host kann Jam-Einstellungen ändern.");
      const body = await readJson(req);
      if (typeof body.name === "string") party.name = body.name.trim();
      if (typeof body.guests_can_control === "boolean") party.guests_can_control = body.guests_can_control;
      broadcastParty(party);
      return send(res, 200, partyState(party, viewer));
    }
    if (is("DELETE", "/party/[^/]+")) {
      if (viewer.guest) return fail(res, 403, "Nur der Host kann die Jam beenden.");
      broadcastParty(party, true);
      parties.delete(party.code);
      return send(res, 204);
    }
    if (is("DELETE", "/party/[^/]+/members/[^/]+")) {
      if (viewer.guest) return fail(res, 403, "Nur der Host kann Teilnehmer entfernen.");
      const key = seg[3];
      if (key === "u:1") return fail(res, 400, "Der Host kann nicht entfernt werden.");
      party.extraMembers = party.extraMembers.filter((m) => m.key !== key);
      for (const [token, g] of party.guests) if (g.key === key) party.guests.delete(token);
      broadcastParty(party);
      return send(res, 204);
    }
    if (viewer.guest && !party.guests_can_control) return fail(res, 403, "Nur der Host kann die Wiedergabe steuern.");
    if (is("PATCH", "/party/[^/]+/tracks/order")) {
      const order = (await readJson(req)).ids;
      party.tracks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      broadcastParty(party);
      return send(res, 204);
    }
    if (is("PATCH", "/party/[^/]+/current")) {
      party.current_index = (await readJson(req)).index;
      party.playback_changed_by = viewer.key;
      party.playback_revision += 1;
      broadcastParty(party);
      return send(res, 204);
    }
    if (is("PATCH", "/party/[^/]+/playback")) {
      const body = await readJson(req);
      Object.assign(party, {
        is_playing: body.is_playing,
        position_sec: body.position_sec,
        updated: new Date().toISOString(),
        playback_changed_by: viewer.key,
        playback_revision: party.playback_revision + 1,
      });
      broadcastParty(party);
      return send(res, 204);
    }
  }

  // Admin
  const storage = { track_count: 412, total_bytes: 3.1e9, disk_total: 64e9, disk_used: 22e9, disk_free: 42e9, retention_days: 30 };
  if (is("GET", "/admin/users")) {
    return send(res, 200, [{ ...me, created_at: "2026-01-04T10:00:00Z" },
      { id: 2, email: "jule@loggerythm.test", display_name: "Jule", is_admin: false, is_approved: true, created_at: "2026-03-11T18:20:00Z" },
      { id: 3, email: "neu@loggerythm.test", display_name: "Neuzugang", is_admin: false, is_approved: false, created_at: "2026-11-12T08:05:00Z" }]);
  }
  if (is("PUT", "/admin/users/[^/]+/approve") || is("DELETE", "/admin/users/[^/]+")) return send(res, 204);
  if (is("GET", "/admin/storage")) {
    return send(res, 200, { ...storage, tracks: pick(0, 25, 5).map((track, i) => ({ deezer_id: track.id, title: track.title, artist: track.artist, size_bytes: 6e6 + i * 3e5, last_accessed: new Date(Date.now() - i * 864e5).toISOString() })) });
  }
  if (is("POST", "/admin/storage/cleanup")) return send(res, 200, { removed: 3, freed_bytes: 2.1e7 });
  if (is("GET", "/admin/invites")) return send(res, 200, [{ code: "abc123", url: "http://localhost:3000/register?invite=abc123", used_by_name: "Jule", created_at: "2026-03-10T12:00:00Z" }]);
  if (is("POST", "/admin/invites")) return send(res, 200, { code: "new456", url: "http://localhost:3000/register?invite=new456", used_by_name: null, created_at: new Date().toISOString() });
  if (is("GET", "/admin/status")) {
    return send(res, 200, { deezer: { arl_configured: true, arl_ok: true, quality: "mp3" }, storage: { ...storage, cleanup_stopped_at: null, cleanup_error: null },
      users: { total: 3, approved: 2, pending: 1, admins: 1 },
      content: { playlists: playlists.size, likes: likes.size, follows: follows.size, plays: 1284, stored_lyrics: 96, parties: parties.size, invites_total: 2, invites_used: 1 },
      integrations: { spotify_configured: true, lastfm_configured: false, mail_configured: true },
      system: { app_env: "mock", database: "memory", jwt_secure: false, cookie_secure: false } });
  }

  return fail(res, 501, `Mock-API: ${method} ${path} ist nicht implementiert.`);
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(`${req.method} ${req.url}`, error);
    fail(res, 500, `Mock-API-Fehler: ${error instanceof Error ? error.message : String(error)}`);
  });
});

// Minimal RFC 6455 WebSocket handler for `/api/connect/ws` (zero dependencies).
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://mock");
  if (url.pathname !== "/api/connect/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const wsKey = req.headers["sec-websocket-key"];
  if (!wsKey) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(`${wsKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const ticket = url.searchParams.get("ticket");
  const validTicket = ticket && (connectHub.tickets.get(ticket) ?? 0) > Date.now();
  if (ticket) connectHub.tickets.delete(ticket);
  if (!loggedIn && !validTicket) {
    wsClose(socket, 4401, "Not authenticated");
    return;
  }

  let registeredId = null;
  let buffer = Buffer.alloc(0);

  const onMessage = (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      wsSendJson(socket, { type: "error", code: "invalid_json", detail: "Malformed JSON", request_id: null });
      return;
    }

    if (msg.type === "ping") {
      wsSendJson(socket, { type: "pong", ts: new Date().toISOString() });
      return;
    }
    if (msg.type === "pong") return;

    if (msg.type === "register") {
      const deviceId = String(msg.device_id || "").trim();
      if (!deviceId) {
        wsSendJson(socket, { type: "error", code: "invalid_payload", detail: "device_id required", request_id: null });
        return;
      }
      const existing = connectHub.devices.get(deviceId);
      if (existing && existing.socket !== socket) {
        wsClose(existing.socket, 4409, "Replaced by newer connection");
      }
      const now = new Date().toISOString();
      const device = {
        device_id: deviceId,
        name: String(msg.name || "Webplayer"),
        device_type: msg.device_type || "web",
        capabilities: {
          can_play_audio: msg.capabilities?.can_play_audio ?? true,
          can_control_volume: msg.capabilities?.can_control_volume ?? true,
        },
        volume: typeof msg.volume === "number" ? msg.volume : 0.8,
        muted: Boolean(msg.muted),
        is_active: false,
        party_code: msg.party_code ?? null,
        connected_at: now,
        last_seen_at: now,
      };
      registeredId = deviceId;
      connectHub.devices.set(deviceId, { device, socket });
      if (msg.take_active) {
        const oldActive = connectHub.activeDeviceId;
        connectHub.activeDeviceId = deviceId;
        if (msg.playback) connectHub.playback = { ...connectHub.playback, ...msg.playback, updated_at: now };
        if (oldActive && oldActive !== deviceId) {
          const oldEntry = connectHub.devices.get(oldActive);
          if (oldEntry) {
            wsSendJson(oldEntry.socket, {
              type: "deactivated",
              new_active_device_id: deviceId,
              reason: "claimed_by_other_device",
            });
          }
        }
      }
      connectHub.revision += 1;
      const state = connectStateSnapshot();
      wsSendJson(socket, { type: "welcome", self_device_id: deviceId, heartbeat_interval_sec: 20, state });
      for (const [id, entry] of connectHub.devices.entries()) {
        if (id !== deviceId) wsSendJson(entry.socket, { type: "state", state });
      }
      return;
    }

    if (!registeredId) {
      wsSendJson(socket, { type: "error", code: "not_registered", detail: "Register first", request_id: msg.request_id ?? null });
      return;
    }

    const selfEntry = connectHub.devices.get(registeredId);
    if (selfEntry) selfEntry.device.last_seen_at = new Date().toISOString();

    if (msg.type === "update_device" && selfEntry) {
      if (typeof msg.name === "string" && msg.name.trim()) selfEntry.device.name = msg.name.trim();
      if (typeof msg.volume === "number") selfEntry.device.volume = msg.volume;
      if (typeof msg.muted === "boolean") selfEntry.device.muted = msg.muted;
      if ("party_code" in msg) selfEntry.device.party_code = msg.party_code ?? null;
      broadcastConnectState();
      return;
    }

    if (msg.type === "playback_state") {
      if (connectHub.activeDeviceId !== registeredId) {
        if (!msg.claim_active) {
          wsSendJson(socket, { type: "error", code: "not_active_device", detail: "Only active device may update playback state", request_id: null });
          return;
        }
        const prevId = connectHub.activeDeviceId;
        connectHub.activeDeviceId = registeredId;
        if (prevId && prevId !== registeredId) {
          const prev = connectHub.devices.get(prevId);
          if (prev) wsSendJson(prev.socket, { type: "deactivated", new_active_device_id: registeredId, reason: "claimed_by_other_device" });
        }
      }
      connectHub.playback = { ...connectHub.playback, ...msg.state, updated_at: new Date().toISOString() };
      if (selfEntry) {
        selfEntry.device.volume = connectHub.playback.volume;
        selfEntry.device.muted = connectHub.playback.muted;
      }
      broadcastConnectState();
      return;
    }

    if (msg.type === "transfer") {
      const target = connectHub.devices.get(msg.target_device_id);
      if (!target) {
        wsSendJson(socket, { type: "error", code: "device_not_found", detail: "Zielgerät nicht verbunden.", request_id: msg.request_id ?? null });
        return;
      }
      if (!target.device.capabilities.can_play_audio) {
        wsSendJson(socket, { type: "error", code: "unsupported_capability", detail: "Zielgerät kann kein Audio abspielen.", request_id: msg.request_id ?? null });
        return;
      }
      const prevId = connectHub.activeDeviceId;
      const now = new Date().toISOString();
      const pos = interpolatedMockPosition();
      connectHub.playback = {
        ...connectHub.playback,
        position_sec: pos,
        is_playing: typeof msg.play === "boolean" ? msg.play : connectHub.playback.is_playing,
        updated_at: now,
      };
      connectHub.activeDeviceId = target.device.device_id;
      if (prevId && prevId !== target.device.device_id) {
        const prev = connectHub.devices.get(prevId);
        if (prev) wsSendJson(prev.socket, { type: "deactivated", new_active_device_id: target.device.device_id, reason: "transferred" });
      }
      wsSendJson(target.socket, { type: "activate", from_device_id: prevId, playback: connectHub.playback });
      broadcastConnectState();
      return;
    }

    if (msg.type === "command") {
      const targetId = msg.target_device_id || connectHub.activeDeviceId;
      if (!targetId) {
        wsSendJson(socket, { type: "error", code: "no_active_device", detail: "Kein aktives Gerät vorhanden.", request_id: msg.request_id ?? null });
        return;
      }
      const target = connectHub.devices.get(targetId);
      if (!target) {
        wsSendJson(socket, { type: "error", code: "device_not_found", detail: "Zielgerät nicht verbunden.", request_id: msg.request_id ?? null });
        return;
      }
      if ((msg.action === "set_volume" || msg.action === "set_mute") && !target.device.capabilities.can_control_volume) {
        wsSendJson(socket, { type: "error", code: "unsupported_capability", detail: "Zielgerät unterstützt keine Lautstärke-Steuerung.", request_id: msg.request_id ?? null });
        return;
      }
      const commandId = `cmd-${++connectHub.commandCounter}`;
      connectHub.pendingCommands.set(commandId, { senderSocket: socket, requestId: msg.request_id ?? null });
      wsSendJson(target.socket, {
        type: "command",
        command_id: commandId,
        request_id: msg.request_id ?? null,
        from_device_id: registeredId,
        action: msg.action,
        payload: msg.payload ?? {},
      });
      return;
    }

    if (msg.type === "command_ack") {
      const pending = connectHub.pendingCommands.get(msg.command_id);
      if (pending) {
        connectHub.pendingCommands.delete(msg.command_id);
        wsSendJson(pending.senderSocket, {
          type: "command_result",
          request_id: pending.requestId,
          command_id: msg.command_id,
          ok: Boolean(msg.ok),
          error: msg.error ?? null,
        });
      }
      return;
    }
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const frameLen = offset + (masked ? 4 : 0) + payloadLen;
      if (buffer.length < frameLen) return;
      let payload = buffer.subarray(offset + (masked ? 4 : 0), frameLen);
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ mask[i % 4];
        payload = unmasked;
      }
      buffer = buffer.subarray(frameLen);

      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        socket.write(wsEncodeFrame(0xA, payload));
        continue;
      }
      if (opcode === 0x1) {
        onMessage(payload.toString("utf8"));
      }
    }
  });

  const cleanup = () => {
    if (!registeredId) return;
    const entry = connectHub.devices.get(registeredId);
    if (entry && entry.socket === socket) {
      connectHub.devices.delete(registeredId);
      if (connectHub.activeDeviceId === registeredId) {
        connectHub.activeDeviceId = null;
        connectHub.playback = { ...connectHub.playback, is_playing: false, updated_at: new Date().toISOString() };
      }
      broadcastConnectState();
    }
    registeredId = null;
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`LoggeRythm mock API on http://127.0.0.1:${PORT} (${TRACKS.length} tracks, WS Connect + Jam ready)`);
});
