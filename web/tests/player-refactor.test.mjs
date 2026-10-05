import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

// The application uses Next's source aliases and extensionless TS imports.
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
const { startTrackRadio } = await import("../src/lib/radio.ts");
const { useToastStore } = await import("../src/store/toast.ts");
resolver.deregister();

const track = (id) => ({
  id: String(id), title: `Track ${id}`, artist: "Artist", album: "Album", cover: "", duration_sec: 180,
});
const state = () => usePlayerStore.getState();
const ids = () => state().queue.map((item) => item.id);
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  saved.clear();
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  useToastStore.setState({ toasts: [] });
});

test("explicit replay requests a native seek even when the track ID is unchanged", () => {
  state().playTrack(track(1));
  state()._clearSeek();
  state()._setCurrentTime(48);
  state().playTrack(track(1));
  assert.equal(state().currentTime, 0);
  assert.equal(state().seekTo, 0);
});

test("duplicate queue entries restart the native playhead on the next entry", () => {
  state().playQueue([track(1), track(1)]);
  state()._clearSeek();
  state()._setCurrentTime(48);
  state().next();
  assert.equal(state().index, 1);
  assert.equal(state().seekTo, 0);
});

test("crossfade promotion retains the incoming deck's clock without seeking", () => {
  state().playQueue([track(1), track(2)]);
  assert.equal(state()._crossfadeAdvance("1", "2", 4.5, 180), true);
  assert.equal(state().currentTime, 4.5);
  assert.equal(state().seekTo, null);
});

test("a slower radio start cannot overwrite a newer station", async (t) => {
  const first = deferred();
  const second = deferred();
  t.mock.method(api, "radio", (id) => id === "1" ? first.promise : second.promise);
  const older = startTrackRadio(track(1));
  const newer = startTrackRadio(track(2));
  second.resolve([track(3)]);
  await newer;
  first.resolve([track(4)]);
  await older;
  assert.deepEqual(ids(), ["2", "3"]);
  assert.equal(state().radioActive, true);
  assert.equal(useToastStore.getState().toasts.length, 1);
});

test("choosing a track or clearing the queue cancels pending radio ownership", async (t) => {
  const request = deferred();
  t.mock.method(api, "radio", () => request.promise);
  const pending = startTrackRadio(track(1));
  state().playTrack(track(2));
  request.resolve([track(3)]);
  await pending;
  assert.deepEqual(ids(), ["2"]);
  assert.equal(state().radioActive, false);

  const clearedRequest = deferred();
  api.radio.mock.mockImplementation(() => clearedRequest.promise);
  const clearedPending = startTrackRadio(track(4));
  state().clearQueue();
  clearedRequest.resolve([track(5)]);
  await clearedPending;
  assert.deepEqual(ids(), ["2"]);
  assert.equal(state().radioActive, false);
});

test("entering a party cancels pending radio ownership", async (t) => {
  const request = deferred();
  t.mock.method(api, "radio", () => request.promise);
  const pending = startTrackRadio(track(1));
  state().setPartyBridge({ addToQueue() {}, removeAt() {}, reorder() {}, setCurrent() {} });
  state().setPartyQueue([track(2)], 0, [100]);
  request.resolve([track(3)]);
  await pending;
  assert.deepEqual(ids(), ["2"]);
  assert.equal(state().radioActive, false);
});

test("choosing another queued entry cancels a pending radio start", async (t) => {
  state().playQueue([track(1), track(2)]);
  const request = deferred();
  t.mock.method(api, "radio", () => request.promise);
  const pending = startTrackRadio(track(3));
  state().jumpTo(1);
  request.resolve([track(4)]);
  await pending;
  assert.deepEqual(ids(), ["1", "2"]);
  assert.equal(state().index, 1);
  assert.equal(state().radioActive, false);
});

test("advancing within an active station keeps its top-up session valid", () => {
  state().playQueue([track(1), track(2)]);
  state().setRadioActive(true);
  const session = state().radioSession;
  state().next();
  assert.equal(state().index, 1);
  assert.equal(state().radioSession, session);
  assert.equal(state().radioActive, true);
});

test("radio start reports the upstream cause and rejects instead of succeeding silently", async (t) => {
  t.mock.method(api, "radio", async () => { throw new Error("Deezer unavailable"); });
  await assert.rejects(startTrackRadio(track(1)), /Deezer unavailable/);
  assert.match(useToastStore.getState().toasts.at(-1).message, /Deezer unavailable/);
  assert.equal(state().radioActive, false);
});

test("party queue index shifts preserve the active entry's clock and pending seek", () => {
  state().setPartyQueue([track(1), track(2)], 1, [100, 101]);
  state().seek(48);
  state().setPartyQueue([track(2)], 0, [101]);
  assert.equal(state().index, 0);
  assert.equal(state().currentTime, 48);
  assert.equal(state().seekTo, 48);
});

test("different party entries of the same song restart playback", () => {
  state().setPartyQueue([track(1), track(1)], 0, [100, 101]);
  state()._clearSeek();
  state()._setCurrentTime(48);
  state().setPartyQueue([track(1), track(1)], 1, [100, 101]);
  assert.equal(state().currentTime, 0);
  assert.equal(state().seekTo, 0);
});

test("invalid party snapshots fail before changing the player", () => {
  state().playTrack(track(1));
  assert.throws(() => state().setPartyQueue([track(2)], 0, []), /entry IDs/);
  assert.throws(() => state().setPartyQueue([track(2)], 2, [100]), /index/);
  assert.deepEqual(ids(), ["1"]);
});
