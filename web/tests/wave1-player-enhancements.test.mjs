import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";
import { compileSource, moduleUrl } from "./support/compile.mjs";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier === "./queuePolicy" && context.parentURL?.endsWith("/store/player.ts")) {
      return nextResolve(new URL("../src/store/queuePolicy.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
  removeItem: (key) => saved.delete(key),
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  setTimeout: () => 0,
  dispatchEvent: () => true,
};

const { usePlayerStore } = await import("../src/store/player.ts");
const { api } = await import("../src/lib/api.ts");
const { TRACK_DRAG_MIME, serializeDraggedTrack, parseDraggedTrack } = await import("../src/lib/trackDrag.ts");
const {
  isCommandQuery,
  matchFollowedArtists,
  matchOwnPlaylists,
  matchPaletteCommands,
  paletteRows,
} = await import("../src/components/commandPaletteModel.ts");
const { isManualScrollActive, MANUAL_SCROLL_PAUSE_MS } = await import(
  "../src/components/now-playing/useActiveLineScroll.ts"
);
const {
  SCENE_KEYS,
  nextCycledVisualizerPreferences,
} = await import("../src/lib/visualizerScenes.ts");
resolver.deregister();

const noopStub = moduleUrl("export default {};");
const sideEffectsUrl = await compileSource(
  "src/components/player/usePlayerSideEffects.ts",
  {
    react: import.meta.resolve("react"),
    "@/store/player": moduleUrl("export const usePlayerStore = () => null; export const currentTrack = () => null;"),
    "@/store/audioEffects": moduleUrl("export const useAudioEffectsStore = () => 1;"),
    "@/store/connect": moduleUrl("export const useConnectStore = { getState: () => ({}) };"),
    "@/store/uiModals": moduleUrl("export const useUiModalsStore = { getState: () => ({}) };"),
    "@/store/addToPlaylist": moduleUrl("export const openAddToPlaylist = () => {};"),
    "@/store/playerSession": moduleUrl("export const PLAYER_SESSION_KEY = 'k'; export const capturePlayerSession = () => null; export const parsePlayerSession = (v) => v; export const restoredPlayerState = () => ({});"),
    "@/lib/api": moduleUrl("export const api = {};"),
    "@/lib/playbackClock": moduleUrl("export const readLivePlaybackClock = () => null;"),
    "@/hooks/useAuth": moduleUrl("export const useMe = () => ({ data: null });"),
    "@/hooks/useLibrary": moduleUrl("export const useLikedTrack = () => false; export const useToggleLike = () => ({ isPending: false, mutate() {} });"),
    "@/hooks/useLocalJson": moduleUrl("export const readLocalJsonSnapshot = () => null; export const writeLocalJsonValue = () => {};"),
    "@/lib/trackArtists": moduleUrl("export const trackArtistLabel = (t) => t.artist;"),
    "@/store/toast": moduleUrl("export const toast = { info() {}, success() {}, error() {} };"),
    default: noopStub,
  },
  "usePlayerSideEffects",
);
const { buildMediaPositionState, resolvePlayIdempotencyKey } = await import(sideEffectsUrl);

const track = (id, title = `Track ${id}`) => ({
  id: String(id),
  title,
  artist: `Artist ${id}`,
  album: `Album ${id}`,
  cover: `https://cdn.example/${id}.jpg`,
  duration_sec: 210,
});

beforeEach(() => {
  saved.clear();
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
});

test("addManyToQueue batches collection enqueue into one state transition and starts playback when idle", () => {
  const store = () => usePlayerStore.getState();

  // Idle player: starts playing the collection with context label.
  store().addManyToQueue([track(1), track(2)], "Release Radar");
  assert.deepEqual(store().queue.map((t) => t.id), ["1", "2"]);
  assert.equal(store().index, 0);
  assert.equal(store().isPlaying, true);
  assert.equal(store().queueContext, "Release Radar");

  // Active player: inserts all tracks in order into the manual block in a single store notification.
  let updates = 0;
  const unsub = usePlayerStore.subscribe(() => { updates += 1; });
  store().addManyToQueue([track(3), track(4), track(5)]);
  unsub();

  assert.equal(updates, 1);
  assert.deepEqual(store().queue.map((t) => t.id), ["1", "3", "4", "5", "2"]);
  assert.deepEqual(store().origins, ["context", "manual", "manual", "manual", "context"]);
});

test("_crossfadeAdvance supports repeat === 'all' wraparound from the last track back to index 0", () => {
  const store = () => usePlayerStore.getState();
  store().playQueue([track(1), track(2), track(3)], 2, "Album");
  store().cycleRepeat(); // off -> all
  assert.equal(store().repeat, "all");

  const ok = store()._crossfadeAdvance("3", "1", 2.4, 210, 0);
  assert.equal(ok, true);
  assert.equal(store().index, 0);
  assert.equal(store().queue[store().index].id, "1");
  assert.equal(store().currentTime, 2.4);
  assert.equal(store().seekTo, null);

  // Without repeat === 'all' (and no explicit target), last track cannot wraparound.
  store().jumpTo(2);
  store().cycleRepeat(); // all -> one
  store().cycleRepeat(); // one -> off
  assert.equal(store()._crossfadeAdvance("3", "1", 0.5, 210), false);
});

test("api.recordPlay forwards explicit Idempotency-Key and auto-generates unique keys when omitted", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response(null, { status: 204 });
  });

  await api.recordPlay(track(42), "play-42-12345");
  await api.recordPlay(track(43));
  await api.recordPlay(track(44));

  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers.get("Idempotency-Key"), "play-42-12345");
  const auto1 = calls[1].headers.get("Idempotency-Key");
  const auto2 = calls[2].headers.get("Idempotency-Key");
  assert.ok(auto1 && auto1.length >= 16);
  assert.ok(auto2 && auto2.length >= 16);
  assert.notEqual(auto1, auto2);
});

test("buildMediaPositionState clamps position to [0, duration] and rejects non-finite or non-positive inputs", () => {
  assert.deepEqual(buildMediaPositionState(200, 45.5, 1.25), {
    duration: 200,
    position: 45.5,
    playbackRate: 1.25,
  });
  assert.deepEqual(buildMediaPositionState(200, 260, 1), {
    duration: 200,
    position: 200,
    playbackRate: 1,
  });
  assert.deepEqual(buildMediaPositionState(200, -5, 1), {
    duration: 200,
    position: 0,
    playbackRate: 1,
  });
  assert.equal(buildMediaPositionState(0, 0, 1), null);
  assert.equal(buildMediaPositionState(Number.NaN, 10, 1), null);
  assert.equal(buildMediaPositionState(200, Number.POSITIVE_INFINITY, 1), null);
  assert.equal(buildMediaPositionState(200, 10, 0), null);
});

test("isManualScrollActive pauses auto-scroll until MANUAL_SCROLL_PAUSE_MS elapses", () => {
  assert.equal(MANUAL_SCROLL_PAUSE_MS, 5000);
  assert.equal(isManualScrollActive(null, 10_000), false);
  assert.equal(isManualScrollActive(15_000, 10_000), true);
  assert.equal(isManualScrollActive(15_000, 14_999), true);
  assert.equal(isManualScrollActive(15_000, 15_000), false);
});

test("trackDrag serializes and parses dragged tracks and fails loudly on malformed payloads", () => {
  assert.equal(TRACK_DRAG_MIME, "application/x-loggerythm-track");
  assert.equal(parseDraggedTrack(""), null);
  const original = track("99", "Midnight Signal");
  const roundTripped = parseDraggedTrack(serializeDraggedTrack(original));
  assert.equal(roundTripped?.id, "99");
  assert.equal(roundTripped?.title, "Midnight Signal");
  assert.equal(roundTripped?.duration_sec, 210);

  assert.throws(() => parseDraggedTrack("{broken"), /kein gültiges JSON/);
  assert.throws(() => parseDraggedTrack(JSON.stringify({ id: "99" })), /Pflichtfelder/);
});

test("commandPaletteModel supports '>' command mode, own playlists, followed artists, and deduplication", () => {
  const commands = [
    { id: "sleep-30", label: "Sleep-Timer: 30 Minuten", detail: "Ausblenden", keywords: ["sleep", "timer", "30"] },
    { id: "eq", label: "Equalizer & Tempo öffnen", detail: "5-Band-EQ", keywords: ["eq", "equalizer"] },
  ];
  const ownPlaylists = [
    { id: 10, name: "Late Night Drive", track_count: 18, cover_url: null, is_public: false, owner_id: 1 },
  ];
  const followedArtists = [
    { id: "7", name: "Daft Punk", picture: "" },
  ];

  assert.equal(isCommandQuery(">sleep"), true);
  assert.equal(isCommandQuery("  > eq"), true);
  assert.equal(isCommandQuery("daft"), false);

  assert.deepEqual(matchPaletteCommands(commands, ">").map((c) => c.id), ["sleep-30", "eq"]);
  assert.deepEqual(matchPaletteCommands(commands, ">sleep 30").map((c) => c.id), ["sleep-30"]);
  assert.deepEqual(matchPaletteCommands(commands, "equalizer").map((c) => c.id), ["eq"]);
  assert.deepEqual(matchOwnPlaylists(ownPlaylists, "night").map((p) => p.id), [10]);
  assert.deepEqual(matchOwnPlaylists(ownPlaylists, ">night"), []);
  assert.deepEqual(matchFollowedArtists(followedArtists, "daft").map((a) => a.id), ["7"]);

  // Command mode returns ONLY commands.
  const cmdRows = paletteRows({
    commandMode: true,
    commands,
    tracks: [track("1")],
    ownPlaylists,
  });
  assert.deepEqual(cmdRows.map((r) => r.kind), ["command", "command"]);

  // Normal search mode puts library/ownPlaylists/followedArtists before catalog, deduplicating followed artists and trailing commands.
  const searchRows = paletteRows({
    commandMode: false,
    commands,
    ownPlaylists,
    followedArtists,
    tracks: [track("1")],
    artists: [{ id: "7", name: "Daft Punk", picture: "" }, { id: "8", name: "Justice", picture: "" }],
  });
  assert.deepEqual(
    searchRows.map((r) => r.kind),
    ["own-playlist", "followed-artist", "track", "artist", "command", "command"],
  );
  assert.equal(searchRows[3].kind === "artist" && searchRows[3].artist.id, "8");
});

test("resolvePlayIdempotencyKey reuses the same key across retries and rotates on new occurrences", () => {
  let seq = 0;
  const nextKey = () => `key-${++seq}`;
  const first = resolvePlayIdempotencyKey(null, "0:101", nextKey);
  assert.deepEqual(first, { occurrence: "0:101", key: "key-1" });

  // Retrying the same failed occurrence preserves the exact Idempotency-Key.
  const retry = resolvePlayIdempotencyKey(first, "0:101", nextKey);
  assert.equal(retry, first);
  assert.equal(retry.key, "key-1");

  // Moving to another queue occurrence (or after success clears pending) mints a fresh key.
  const nextOccurrence = resolvePlayIdempotencyKey(first, "1:101", nextKey);
  assert.deepEqual(nextOccurrence, { occurrence: "1:101", key: "key-2" });
  const afterSuccess = resolvePlayIdempotencyKey(null, "1:101", nextKey);
  assert.deepEqual(afterSuccess, { occurrence: "1:101", key: "key-3" });
});

test("nextCycledVisualizerPreferences cycles off -> auto -> all scenes -> off cleanly", () => {
  let pref = { enabled: false, scene: "auto" };
  pref = nextCycledVisualizerPreferences(pref);
  assert.deepEqual(pref, { enabled: true, scene: "auto" });
  for (const scene of SCENE_KEYS) {
    pref = nextCycledVisualizerPreferences(pref);
    assert.deepEqual(pref, { enabled: true, scene });
  }
  pref = nextCycledVisualizerPreferences(pref);
  assert.deepEqual(pref, { enabled: false, scene: "auto" });
});
