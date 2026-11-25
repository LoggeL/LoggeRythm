import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { compileSource, moduleUrl } from "./support/compile.mjs";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  AUDIO_QUALITY_META,
  activeWordIndex,
  computeCueAwareCrossfade,
  decodeTrackAudioMeta,
  wordKaraokeProgress,
} = await import("../src/lib/audioIntelligence.ts");
const {
  decodeUserStatsInsights,
  formatInsightsSummaryText,
  formatListeningHours,
} = await import("../src/lib/statsInsights.ts");
const {
  cacheOfflineLyricsMap,
  clearOfflineLyricsCache,
  deleteOfflineLyrics,
  readOfflineLyrics,
} = await import("../src/lib/offlineLyrics.ts");
const { api, streamUrl } = await import("../src/lib/api.ts");
const { isPersistedQueryKey, shouldRemoveQueryForUserChange } = await import("../src/lib/queryPersistence.ts");
resolver.deregister();

const connectEngineUrl = await compileSource(
  "src/components/player/ConnectEngine.tsx",
  {
    react: import.meta.resolve("react"),
    "@/hooks/useAuth": moduleUrl("export const useMe = () => ({ data: null });"),
    "@/lib/connectSocket": moduleUrl("export class ConnectSocket {}"),
    "@/lib/connectProtocol": moduleUrl("export const interpolatedPositionSec = () => 0; export const normalizeConnectTrack = (t) => t;"),
    "@/lib/connectCommands": moduleUrl("export const buildConnectPlaybackSnapshot = () => ({}); export const executeLocalConnectCommand = () => {};"),
    "@/store/connect": moduleUrl("export const activeRemoteDevice = () => null; export const canControlActiveVolume = () => true; export const isControllingRemoteDevice = () => false; export const useConnectStore = () => null;"),
    "@/store/party": moduleUrl("export const usePartyStore = () => false;"),
    "@/store/player": moduleUrl("export const usePlayerStore = () => null;"),
    "@/store/toast": moduleUrl("export const toast = { info() {}, error() {} };"),
  },
  "ConnectEngine",
);
const { shouldHydrateServerPlayback } = await import(connectEngineUrl);

const playlistEventsUrl = await compileSource(
  "src/hooks/usePlaylistEvents.ts",
  {
    react: import.meta.resolve("react"),
    "@tanstack/react-query": moduleUrl("export const useQueryClient = () => ({ invalidateQueries() {} });"),
    "@/lib/api": moduleUrl("export const playlistEventsUrl = (id) => `/api/playlists/${id}/events`;"),
    "@/store/toast": moduleUrl("export const toast = { info() {}, error() {} };"),
  },
  "usePlaylistEvents",
);
const { classifyPlaylistSseEvent, parsePlaylistSseEvent } = await import(playlistEventsUrl);

const kioskUrl = await compileSource(
  "src/components/party/PartyScreenKiosk.tsx",
  {
    react: import.meta.resolve("react"),
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "qrcode.react": moduleUrl("export function QRCodeSVG() { return null; }"),
    "@/store/player": moduleUrl("export const usePlayerStore = () => false;"),
    "@/hooks/useCoverColors": moduleUrl("export const useCoverColors = () => null;"),
    "@/hooks/useDialogFocus": moduleUrl("export const useDialogFocus = () => {};"),
    "@/hooks/useLivePlaybackTime": moduleUrl("export const useLivePlaybackTime = () => 0;"),
    "@/hooks/useLocalJson": moduleUrl("export const useLocalJson = () => [{ enabled: false, scene: 'auto' }];"),
    "@/hooks/useLyrics": moduleUrl("export const useLyrics = () => ({ lines: [], active: -1, hasTimedLines: false, instrumental: false, isLoading: false });"),
    "@/hooks/useVisualizerScene": moduleUrl("export const useVisualizerScene = () => ({ scene: 'steps' });"),
    "@/lib/cover": moduleUrl("export const hiResCover = (u) => u;"),
    "@/lib/fullscreenTheme": moduleUrl("export const fullscreenTheme = () => ({});"),
    "@/lib/trackArtists": moduleUrl("export const trackArtistLabel = (t) => t.artist;"),
    "@/lib/visualizerScenes": moduleUrl("export const INITIAL_VISUALIZER_PREFERENCES = { enabled: true, scene: 'auto' }; export const VISUALIZER_PREFERENCES_KEY = 'player:visualizer'; export const validateVisualizerPreferences = (v) => v;"),
    "@/components/Avatar": moduleUrl("export default function Avatar() { return null; }"),
    "@/components/CoverPlaceholder": moduleUrl("export default function CoverPlaceholder() { return null; }"),
    "@/components/FullscreenVisualizer": moduleUrl("export default function FullscreenVisualizer() { return null; }"),
    "@/components/KaraokeLine": moduleUrl("export default function KaraokeLine() { return null; }"),
    "@/components/SceneVisualizer": moduleUrl("export default function SceneVisualizer() { return null; }"),
    "@/components/icons": moduleUrl("export const CloseIcon = () => null; export const NextIcon = CloseIcon; export const PauseIcon = CloseIcon; export const PlayIcon = CloseIcon;"),
  },
  "PartyScreenKiosk",
);
const { reactionLeftPct } = await import(kioskUrl);

test("decodeTrackAudioMeta validates 96-peak payloads strictly and rejects malformed data", () => {
  const peaks = Array.from({ length: 96 }, (_, i) => Number(((i % 10) / 10).toFixed(2)));
  const decoded = decodeTrackAudioMeta({
    deezer_id: "12345",
    peaks,
    loudness_lufs: -11.4,
    loudness_gain_db: -2.6,
    loudness_peak: 0.98,
    bpm: 124.5,
    duration_sec: 215,
    intro_end_sec: 2.4,
    outro_start_sec: 207.5,
    analyzed_at: "2026-11-25T18:00:00Z",
  });
  assert.equal(decoded.deezer_id, "12345");
  assert.equal(decoded.peaks.length, 96);
  assert.equal(decoded.bpm, 124.5);
  assert.equal(decoded.outro_start_sec, 207.5);
  assert.equal(AUDIO_QUALITY_META.lossless.badge, "FLAC");

  assert.throws(() => decodeTrackAudioMeta(null), /JSON-Objekt/);
  assert.throws(() => decodeTrackAudioMeta({ deezer_id: "", peaks: [0.5] }), /deezer_id/);
  assert.throws(() => decodeTrackAudioMeta({ deezer_id: "1", peaks: [] }), /peaks/);
  assert.throws(() => decodeTrackAudioMeta({ deezer_id: "1", peaks: [0.5, 1.4] }), /außerhalb von \[0, 1\]/);
  assert.throws(() => decodeTrackAudioMeta({ deezer_id: "1", peaks: [0.5], bpm: Number.NaN }), /bpm/);
});

test("computeCueAwareCrossfade honors outro_start_sec and intro_end_sec with safe bounds", () => {
  // Without cues: starts at duration - configuredCrossfadeSec, incoming starts at 0.
  const plain = computeCueAwareCrossfade({
    configuredCrossfadeSec: 6,
    outgoingDurationSec: 200,
  });
  assert.deepEqual(plain, { triggerMediaSec: 194, fadeMediaSec: 6, incomingStartSec: 0 });

  // With outro_start_sec=192 and intro_end_sec=2.1: triggers at 192, trims 2.0s leading silence.
  const smart = computeCueAwareCrossfade({
    configuredCrossfadeSec: 6,
    outgoingDurationSec: 200,
    outgoingOutroStartSec: 192,
    incomingIntroEndSec: 2.1,
  });
  assert.equal(smart.triggerMediaSec, 192);
  assert.equal(smart.fadeMediaSec, 6);
  assert.ok(Math.abs(smart.incomingStartSec - 2.0) < 1e-9);

  // Very early outro_start_sec is clamped to at most 1.5x configured crossfade before end.
  const clamped = computeCueAwareCrossfade({
    configuredCrossfadeSec: 6,
    outgoingDurationSec: 200,
    outgoingOutroStartSec: 150,
    incomingIntroEndSec: 12,
  });
  assert.equal(clamped.triggerMediaSec, 191);
  assert.equal(clamped.incomingStartSec, 4);

  assert.throws(() => computeCueAwareCrossfade({ configuredCrossfadeSec: 0, outgoingDurationSec: 200 }), RangeError);
  assert.throws(() => computeCueAwareCrossfade({ configuredCrossfadeSec: 6, outgoingDurationSec: 0 }), RangeError);
});

test("wordKaraokeProgress and activeWordIndex compute smooth word-level timing", () => {
  const words = [
    { t: 10.0, end: 10.5, text: "Hello" },
    { t: 10.5, end: 11.5, text: "world" },
    { t: 11.5, end: 12.0, text: "now" },
  ];
  assert.equal(wordKaraokeProgress(words[0], 9.8), 0);
  assert.ok(Math.abs(wordKaraokeProgress(words[0], 10.25) - 0.5) < 1e-9);
  assert.equal(wordKaraokeProgress(words[0], 10.6), 1);
  assert.equal(activeWordIndex(words, 9.5), -1);
  assert.equal(activeWordIndex(words, 10.2), 0);
  assert.equal(activeWordIndex(words, 11.0), 1);
  assert.equal(activeWordIndex(words, 12.1), 2);
});

test("decodeUserStatsInsights validates contract strictly and formatInsightsSummaryText summarizes clearly", () => {
  const validPayload = {
    range: "30d",
    listening_sec: 14_400,
    play_count: 68,
    unique_tracks: 42,
    unique_artists: 19,
    top_tracks: [{ key: "101", label: "Signal", sublabel: "Logge", cover: "", count: 12 }],
    top_artists: [{ key: "7", label: "Logge", sublabel: "", cover: "", count: 20 }],
    top_albums: [{ key: "55", label: "Ink & Paper", sublabel: "Logge", cover: "", count: 15 }],
    current_streak_days: 5,
    longest_streak_days: 14,
    hourly_distribution: Array.from({ length: 24 }, (_, h) => (h === 21 ? 10 : 1)),
    weekday_distribution: [4, 5, 6, 7, 12, 18, 16],
    new_artists_count: 6,
    recent_plays: [
      {
        id: "101",
        title: "Signal",
        artist: "Logge",
        artist_id: "7",
        artists: [{ id: "7", name: "Logge" }],
        album: "Ink & Paper",
        album_id: "55",
        cover: "",
        duration_sec: 210,
        played_at: "2026-11-25T17:30:00Z",
      },
    ],
  };

  const insights = decodeUserStatsInsights(validPayload);
  assert.equal(insights.play_count, 68);
  assert.equal(insights.hourly_distribution.length, 24);
  assert.equal(insights.weekday_distribution.length, 7);
  assert.equal(formatListeningHours(14_400), "4 Std.");

  const summary = formatInsightsSummaryText(insights, "Alex");
  assert.match(summary, /30 Tage/);
  assert.match(summary, /Alex/);
  assert.match(summary, /68 Wiedergaben/);
  assert.match(summary, /Signal/);

  assert.throws(() => decodeUserStatsInsights({ ...validPayload, range: "2w" }), /Unbekannter Zeitraum/);
  assert.throws(() => decodeUserStatsInsights({ ...validPayload, hourly_distribution: [1, 2, 3] }), /Genau 24/);
  assert.throws(() => decodeUserStatsInsights({ ...validPayload, weekday_distribution: [1, 2] }), /Genau 7/);
  assert.throws(() => decodeUserStatsInsights({ ...validPayload, play_count: -1 }), /nicht-negative Ganzzahl/);
});

test("offlineLyrics caches, reads, deletes, and clears lyrics in Cache Storage and fails loud on corrupt JSON", async () => {
  const buckets = new Map();
  const prevCaches = globalThis.caches;
  globalThis.caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const map = buckets.get(name);
      return {
        async put(key, res) { map.set(key, res.clone()); },
        async match(key) { const hit = map.get(key); return hit ? hit.clone() : undefined; },
        async delete(key) { return map.delete(key); },
      };
    },
    async delete(name) { return buckets.delete(name); },
  };
  try {
    const count = await cacheOfflineLyricsMap({
      "901": {
        lines: [{ t: 1.2, text: "Hello world", words: [{ t: 1.2, end: 1.6, text: "Hello" }] }],
        synced: true,
        source: "groq-word-v3",
        ai_generated: true,
        instrumental: false,
      },
      "902": {
        lines: null,
        synced: false,
        instrumental: true,
      },
    });
    assert.equal(count, 2);

    const lyric901 = await readOfflineLyrics("901");
    assert.equal(lyric901?.lines?.[0].words?.[0].text, "Hello");
    const lyric902 = await readOfflineLyrics("902");
    assert.equal(lyric902?.instrumental, true);
    assert.equal(await readOfflineLyrics("999"), null);

    await deleteOfflineLyrics(["901"]);
    assert.equal(await readOfflineLyrics("901"), null);
    assert.equal((await readOfflineLyrics("902"))?.instrumental, true);

    await clearOfflineLyricsCache();
    assert.equal(await readOfflineLyrics("902"), null);
  } finally {
    globalThis.caches = prevCaches;
  }
});

test("Wave 2 API helpers send album/duration lyrics params, import target options, radioSeed, and quality streamUrl", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({});
  });

  await api.lyrics("Daft Punk", "Veridis Quo", "77", undefined, { album: "Discovery", duration_sec: 344.6 });
  await api.startImportJob("https://open.spotify.com/playlist/abc", { create_playlist_name: "Imported" });
  await api.radioSeed({ track_ids: ["1", "2"], limit: 25 });

  assert.match(calls[0].url, /album=Discovery/);
  assert.match(calls[0].url, /duration_sec=345/);
  assert.deepEqual(calls[1].body, {
    url: "https://open.spotify.com/playlist/abc",
    create_playlist_name: "Imported",
  });
  assert.equal(calls[2].url, "/api/radio/seed");
  assert.deepEqual(calls[2].body, { track_ids: ["1", "2"], limit: 25 });

  assert.equal(streamUrl("42"), "/api/tracks/42/stream");
  assert.equal(streamUrl("42", "lossless"), "/api/tracks/42/stream?quality=lossless");
  assert.equal(streamUrl("42", "saver"), "/api/tracks/42/stream?quality=saver");
});

test("shouldHydrateServerPlayback hydrates async server state only when idle, non-Jam, and no active device exists", () => {
  const savedPlayback = { queue: [{ id: "1" }, { id: "2" }], current_index: 1 };
  assert.equal(
    shouldHydrateServerPlayback({
      activeDeviceId: null,
      playback: savedPlayback,
      localQueueLength: 0,
      partyOwnsPlayback: false,
    }),
    true,
  );
  // Active device elsewhere: Connect remote controller handles it instead.
  assert.equal(
    shouldHydrateServerPlayback({
      activeDeviceId: "dev-phone",
      playback: savedPlayback,
      localQueueLength: 0,
      partyOwnsPlayback: false,
    }),
    false,
  );
  // Local queue already populated: don't clobber it.
  assert.equal(
    shouldHydrateServerPlayback({
      activeDeviceId: null,
      playback: savedPlayback,
      localQueueLength: 3,
      partyOwnsPlayback: false,
    }),
    false,
  );
  // Jam active: Jam owns playback.
  assert.equal(
    shouldHydrateServerPlayback({
      activeDeviceId: null,
      playback: savedPlayback,
      localQueueLength: 0,
      partyOwnsPlayback: true,
    }),
    false,
  );
  // Empty server playback: nothing to hydrate.
  assert.equal(
    shouldHydrateServerPlayback({
      activeDeviceId: null,
      playback: { queue: [], current_index: -1 },
      localQueueLength: 0,
      partyOwnsPlayback: false,
    }),
    false,
  );
});

test("classifyPlaylistSseEvent & parsePlaylistSseEvent handle reconnect snapshots, updates, revocations, deletions, and corrupt frames", () => {
  assert.equal(classifyPlaylistSseEvent({ playlist_id: 1, revision: 3, event: "snapshot" }, undefined), "ignore");
  assert.equal(classifyPlaylistSseEvent({ playlist_id: 1, revision: 3, event: "snapshot" }, 3), "ignore");
  // Newer snapshot revision after SSE reconnect refreshes missed edits.
  assert.equal(classifyPlaylistSseEvent({ playlist_id: 1, revision: 5, event: "snapshot" }, 3), "refresh");
  assert.equal(classifyPlaylistSseEvent({ playlist_id: 1, revision: 3, event: "updated" }, 3), "ignore");
  assert.equal(classifyPlaylistSseEvent({ playlist_id: 1, revision: 4, event: "updated" }, 3), "refresh");
  assert.equal(classifyPlaylistSseEvent({ playlist_id: 1, revision: 4, event: "revoked" }, 4), "revoked");
  assert.equal(classifyPlaylistSseEvent({ playlist_id: 1, revision: 4, event: "deleted" }, 4), "deleted");

  assert.deepEqual(
    parsePlaylistSseEvent(JSON.stringify({ playlist_id: 9, revision: 2, event: "updated" })),
    { playlist_id: 9, revision: 2, event: "updated" },
  );
  assert.throws(() => parsePlaylistSseEvent("{bad"), /Ungültiges JSON/);
  assert.throws(() => parsePlaylistSseEvent(JSON.stringify({ playlist_id: 9, revision: 2, event: "bogus" })), /Unbekannter Event-Typ/);
  assert.throws(() => parsePlaylistSseEvent(JSON.stringify({ playlist_id: 9, revision: -1, event: "updated" })), /Ungültige Revision/);
});

test("queryPersistence evicts all Wave 2 private & user-scoped queries on account switch/logout", () => {
  for (const key of [
    ["stats-insights", "30d"],
    ["social-activity"],
    ["playlist-duplicates", "42"],
    ["playlist-sync-preview", "42"],
  ]) {
    assert.equal(shouldRemoveQueryForUserChange(key, "user-2"), true);
    assert.equal(shouldRemoveQueryForUserChange(key, undefined), true);
    assert.equal(isPersistedQueryKey(key), false);
  }
  assert.equal(isPersistedQueryKey(["home-personal-mixes", "user-1"]), true);
  assert.equal(isPersistedQueryKey(["home-personal-mixes"]), false);
  assert.equal(shouldRemoveQueryForUserChange(["home-personal-mixes", "user-1"], "user-1"), false);
  assert.equal(shouldRemoveQueryForUserChange(["home-personal-mixes", "user-1"], "user-2"), true);
});

test("reactionLeftPct hashes hex string PartyReaction IDs cleanly without NaN", () => {
  for (const id of ["a1b2c3d4e5f6", "000000000000", "ff99aa11bb22"]) {
    const pct = reactionLeftPct(id);
    assert.equal(Number.isFinite(pct), true);
    assert.ok(pct >= 14 && pct < 86, `expected ${pct} in [14, 86)`);
  }
  assert.equal(reactionLeftPct("a1b2c3d4e5f6"), reactionLeftPct("a1b2c3d4e5f6"));
});
