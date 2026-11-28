import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

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

const { api } = await import("../src/lib/api.ts");
const {
  activePartyItemId,
  canSendRemotePartyPlayback,
  detectMemberRemoval,
  findHostTrackAdvanceIndex,
  isLocalPlaybackDetachedFromParty,
  partyCurrentItemId,
  shouldBindPartyRoute,
  shouldHostBroadcastPlayback,
  shouldRestoreActiveParty,
} = await import("../src/lib/partySync.ts");
const { exitPartySession } = await import("../src/lib/partyExit.ts");
const { canControlPartyPlayback, usePartyStore } = await import("../src/store/party.ts");
const { usePlayerStore } = await import("../src/store/player.ts");
resolver.deregister();

const makeTrack = (id) => ({
  id: String(id),
  title: `Song ${id}`,
  artist: "Artist",
  album: "Album",
  cover: "",
  duration_sec: 180,
});

const makePartyTrack = (itemId, deezerId) => ({
  id: itemId,
  deezer_id: String(deezerId),
  title: `Song ${deezerId}`,
  artist: "Artist",
  artist_id: "1",
  artists: [{ id: "1", name: "Artist" }],
  album: "Album",
  album_id: "2",
  cover: "",
  duration_sec: 180,
  added_by: "Host",
  added_by_member: "u:1",
  added_by_avatar_url: null,
  is_stored: true,
  load_state: "ready",
  load_error: null,
});

const makeParty = (overrides = {}) => ({
  code: "YBA7W0",
  name: "Jam",
  host_name: "Host",
  is_host: true,
  guests_can_control: false,
  current_index: 0,
  is_playing: true,
  position_sec: 12,
  playback_updated_at: "2026-11-24T20:00:00Z",
  playback_changed_by: "u:1",
  playback_revision: 1,
  ended: false,
  server_time: "2026-11-24T20:00:00Z",
  viewer_key: "u:1",
  viewer_name: "Host",
  viewer_is_guest: false,
  members: [{ key: "u:1", name: "Host", avatar_url: null, is_guest: false, is_host: true }],
  tracks: [makePartyTrack(10, "100"), makePartyTrack(11, "200")],
  ...overrides,
});

beforeEach(() => {
  saved.clear();
  usePartyStore.setState(usePartyStore.getInitialState(), true);
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
});

test("listen mode survives ordinary frames and resets on a new Jam or host promotion", () => {
  const store = usePartyStore.getState();
  const party = makeParty({ is_host: false });
  store.applyPartyState(party);
  store.setListenLocally(false);
  store.applyPartyState(party);
  assert.equal(usePartyStore.getState().listenLocally, false);
  store.setActiveCode("BBB222");
  assert.equal(usePartyStore.getState().listenLocally, true);
  store.applyPartyState(party);
  store.setListenLocally(false);
  store.applyPartyState({ ...party, is_host: true });
  assert.equal(usePartyStore.getState().listenLocally, true);
});

test("host never broadcasts PATCH /playback when no party track is selected or local player is detached", () => {
  const emptyParty = makeParty({ tracks: [], current_index: -1, is_playing: false });
  // Regression for: API /party/YBA7W0/playback: Select a party track before starting playback
  const localPlayingOtherSong = {
    queue: [makeTrack("999")],
    index: 0,
    isPlaying: true,
    partyQueueItemIds: [],
  };
  assert.equal(partyCurrentItemId(emptyParty), null);
  assert.equal(activePartyItemId(localPlayingOtherSong), null);
  assert.equal(isLocalPlaybackDetachedFromParty(localPlayingOtherSong), true);
  assert.equal(
    shouldHostBroadcastPlayback(emptyParty, localPlayingOtherSong, {
      detached: false,
      exitingCode: null,
      reason: "change",
    }),
    false,
  );
  assert.equal(
    shouldHostBroadcastPlayback(emptyParty, localPlayingOtherSong, {
      detached: false,
      exitingCode: null,
      reason: "heartbeat",
    }),
    false,
  );
  assert.equal(canSendRemotePartyPlayback(emptyParty), false);

  // Even when the party HAS a selected track, playing non-party music locally must not broadcast to the Jam.
  const activeParty = makeParty({ current_index: 0, is_playing: true });
  assert.equal(
    shouldHostBroadcastPlayback(activeParty, localPlayingOtherSong, {
      detached: false,
      exitingCode: null,
      reason: "change",
    }),
    false,
  );

  // Playing the matching party item broadcasts cleanly, skips idle paused heartbeats, and heals drift.
  const onPartyTrackPlaying = {
    queue: [makeTrack("100"), makeTrack("200")],
    index: 0,
    isPlaying: true,
    partyQueueItemIds: [10, 11],
  };
  assert.equal(isLocalPlaybackDetachedFromParty(onPartyTrackPlaying), false);
  assert.equal(
    shouldHostBroadcastPlayback(activeParty, onPartyTrackPlaying, {
      detached: false,
      exitingCode: null,
      reason: "heartbeat",
    }),
    true,
  );
  assert.equal(
    shouldHostBroadcastPlayback(activeParty, onPartyTrackPlaying, {
      detached: true,
      exitingCode: null,
      reason: "change",
    }),
    false,
  );
  assert.equal(
    shouldHostBroadcastPlayback(activeParty, onPartyTrackPlaying, {
      detached: false,
      exitingCode: "YBA7W0",
      reason: "change",
    }),
    false,
  );

  const pausedParty = makeParty({ current_index: 0, is_playing: false });
  const onPartyTrackPaused = { ...onPartyTrackPlaying, isPlaying: false };
  assert.equal(
    shouldHostBroadcastPlayback(pausedParty, onPartyTrackPaused, {
      detached: false,
      exitingCode: null,
      reason: "heartbeat",
    }),
    false,
  );
  assert.equal(
    shouldHostBroadcastPlayback(pausedParty, onPartyTrackPaused, {
      detached: false,
      exitingCode: null,
      reason: "change",
    }),
    true,
  );
  // Server still thinks playing while host is paused -> heartbeat heals drift.
  assert.equal(
    shouldHostBroadcastPlayback(activeParty, onPartyTrackPaused, {
      detached: false,
      exitingCode: null,
      reason: "heartbeat",
    }),
    true,
  );
});

test("local advance inside the party queue (crossfade) resolves the server target index instead of mismatched playback", () => {
  const party = makeParty({ current_index: 0, is_playing: true });
  const advancedPlayer = {
    queue: [makeTrack("100"), makeTrack("200")],
    index: 1,
    isPlaying: true,
    partyQueueItemIds: [10, 11],
  };
  assert.equal(findHostTrackAdvanceIndex(party, advancedPlayer), 1);
  assert.equal(
    shouldHostBroadcastPlayback(party, advancedPlayer, {
      detached: false,
      exitingCode: null,
      reason: "change",
    }),
    false,
  );
});

test("member removal detection avoids false kick before join and detects solo host leaving elsewhere", () => {
  const hostOnlyFrame = makeParty({
    is_host: false,
    viewer_key: "u:2",
    members: [{ key: "u:1", name: "Host", avatar_url: null, is_guest: false, is_host: true }],
  });
  // SSE frame arrived before POST /join finished: must NOT falsely kick.
  assert.equal(detectMemberRemoval(hostOnlyFrame, false), null);
  // Once confirmed as a member, disappearing means kicked by host.
  assert.equal(detectMemberRemoval(hostOnlyFrame, true), "kicked");

  // Solo host leaving from another tab leaves members=[] -> detected cleanly as left_elsewhere, not kicked.
  const emptyMembersHost = makeParty({ is_host: true, viewer_key: "u:1", members: [] });
  assert.equal(detectMemberRemoval(emptyMembersHost, true), "left_elsewhere");
});

test("exitPartySession leaves cleanly without allowing route re-bind or stale active-party resurrection", async (t) => {
  const party = makeParty();
  usePartyStore.getState().setActiveCode(party.code);
  usePartyStore.getState().applyPartyState(party);
  usePlayerStore.getState().setPartyBridge({ addToQueue() {}, removeAt() {}, reorder() {}, setCurrent() {} });
  usePlayerStore.getState().setSuppressLocalAudio(true);

  const calls = [];
  const fakeQueryClient = {
    cancelQueries: async (filter) => calls.push(["cancel", filter.queryKey]),
    removeQueries: (filter) => calls.push(["remove", filter.queryKey]),
  };

  let observedExitingDuringRequest = null;
  t.mock.method(api, "leaveParty", async (code) => {
    observedExitingDuringRequest = usePartyStore.getState().exitingCode;
    calls.push(["leave", code]);
  });

  await exitPartySession("yba7w0", "leave", { queryClient: fakeQueryClient });

  assert.equal(observedExitingDuringRequest, "YBA7W0");
  assert.deepEqual(calls, [
    ["cancel", ["party", "YBA7W0"]],
    ["leave", "YBA7W0"],
    ["remove", ["party", "YBA7W0"]],
  ]);
  assert.equal(usePartyStore.getState().code, null);
  assert.equal(usePartyStore.getState().active, false);
  assert.equal(usePartyStore.getState().exitingCode, null);
  assert.equal(usePartyStore.getState().lastExitedCode, "YBA7W0");
  assert.equal(usePlayerStore.getState().partyBridge, null);
  assert.equal(usePlayerStore.getState().suppressLocalAudio, false);

  // Stale GET /party/active response for YBA7W0 must NOT resurrect the Jam.
  assert.equal(shouldRestoreActiveParty(party, usePartyStore.getState()), false);
  // Still-mounted /party/YBA7W0 page before router.push("/") finishes must NOT re-bind.
  assert.equal(shouldBindPartyRoute("YBA7W0", usePartyStore.getState(), "YBA7W0"), false);

  // Intentionally opening YBA7W0 again later clears lastExitedCode.
  usePartyStore.getState().setActiveCode("YBA7W0");
  assert.equal(usePartyStore.getState().lastExitedCode, null);
  assert.equal(usePartyStore.getState().code, "YBA7W0");
});

test("a failed exitPartySession clears exitingCode, preserves Jam state, and rethrows loudly", async (t) => {
  const party = makeParty();
  usePartyStore.getState().setActiveCode(party.code);
  usePartyStore.getState().applyPartyState(party);

  t.mock.method(api, "endParty", async () => {
    assert.equal(usePartyStore.getState().exitingCode, "YBA7W0");
    throw new Error("API /party/YBA7W0: HTTP 503");
  });

  await assert.rejects(exitPartySession("YBA7W0", "end"), /HTTP 503/);
  assert.equal(usePartyStore.getState().exitingCode, null);
  assert.equal(usePartyStore.getState().code, "YBA7W0");
  assert.equal(usePartyStore.getState().active, true);
});

test("detached Jam playback unlocks local player controls for non-hosts", () => {
  assert.equal(
    canControlPartyPlayback({ active: true, isHost: false, guestsCanControl: false, detached: false }),
    false,
  );
  assert.equal(
    canControlPartyPlayback({ active: true, isHost: false, guestsCanControl: false, detached: true }),
    true,
  );
});
