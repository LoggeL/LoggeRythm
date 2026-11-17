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

const ALBUMS = ALBUM_WORDS.map((title, index) => {
  const artist = ARTISTS[index % ARTISTS.length];
  return {
    id: String(5000 + index), title, artist: artist.name, artist_id: artist.id,
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

function partyState(party) {
  return { code: party.code, name: party.name, host_name: me.display_name, is_host: true,
    current_index: party.current_index, members: [{ name: me.display_name, avatar_url: null }, { name: "Jule" }, { name: "Tariq" }],
    tracks: party.tracks, is_playing: party.is_playing, position_sec: party.position_sec, playback_updated_at: party.updated };
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
  if (is("GET", "/auth/me")) return loggedIn ? send(res, 200, me) : fail(res, 401, "Nicht angemeldet");
  if (!loggedIn) return fail(res, 401, "Nicht angemeldet");

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
    return send(res, 200, pick(2, 18, 6).map((track, index) => ({ ...track, release_date: new Date(Date.now() - index * 3 * 864e5).toISOString().slice(0, 10) })));
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
  if (is("GET", "/cached-tracks")) return send(res, 200, { ids: pick(0, 30, 5).map((track) => track.id) });
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

  // Party
  if (is("POST", "/party")) {
    const code = "DEMO42";
    const party = { code, name: (await readJson(req)).name || "Demo-Party", current_index: 0, is_playing: false, position_sec: 0, updated: null, nextId: 1, tracks: [] };
    for (const track of pick(5, 6, 8)) party.tracks.push({ ...track, id: party.nextId++, deezer_id: track.id, added_by: ["Demo", "Jule", "Tariq"][party.tracks.length % 3] });
    parties.set(code, party);
    return send(res, 200, partyState(party));
  }
  if (seg[0] === "party" && seg[1]) {
    const party = parties.get(seg[1].toUpperCase());
    if (!party) return fail(res, 404, "Party nicht gefunden");
    if (is("GET", "/party/[^/]+") || is("POST", "/party/[^/]+/join")) return send(res, 200, partyState(party));
    if (is("GET", "/party/[^/]+/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      const push = () => res.write(`data: ${JSON.stringify(partyState(party))}\n\n`);
      push();
      const timer = setInterval(push, 2000);
      req.on("close", () => clearInterval(timer));
      return;
    }
    if (is("POST", "/party/[^/]+/leave")) return send(res, 204);
    if (is("POST", "/party/[^/]+/tracks")) {
      const track = await readJson(req);
      party.tracks.push({ ...track, id: party.nextId++, deezer_id: track.id, added_by: me.display_name });
      return send(res, 204);
    }
    if (is("DELETE", "/party/[^/]+/tracks/\\d+")) { party.tracks = party.tracks.filter((track) => track.id !== Number(seg[3])); return send(res, 204); }
    if (is("PATCH", "/party/[^/]+/tracks/order")) {
      const order = (await readJson(req)).ids;
      party.tracks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return send(res, 204);
    }
    if (is("PATCH", "/party/[^/]+/current")) { party.current_index = (await readJson(req)).index; return send(res, 204); }
    if (is("PATCH", "/party/[^/]+/playback")) {
      const body = await readJson(req);
      Object.assign(party, { is_playing: body.is_playing, position_sec: body.position_sec, updated: new Date().toISOString() });
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
    return send(res, 200, { deezer: { arl_configured: true, arl_ok: true, quality: "mp3" }, storage,
      users: { total: 3, approved: 2, pending: 1, admins: 1 },
      content: { playlists: playlists.size, likes: likes.size, follows: follows.size, plays: 1284, stored_lyrics: 96, parties: parties.size, invites_total: 2, invites_used: 1 },
      integrations: { spotify_configured: true, lastfm_configured: false },
      system: { app_env: "mock", database: "memory", jwt_secure: false, cookie_secure: false } });
  }

  return fail(res, 501, `Mock-API: ${method} ${path} ist nicht implementiert.`);
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(`${req.method} ${req.url}`, error);
    fail(res, 500, `Mock-API-Fehler: ${error instanceof Error ? error.message : String(error)}`);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`LoggeRythm mock API on http://127.0.0.1:${PORT} (${TRACKS.length} tracks, no credentials needed)`);
});
