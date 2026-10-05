import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";
import { readLocalJsonSnapshot, writeLocalJsonValue } from "../src/hooks/useLocalJson.ts";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { assertDownloadEntries, cachePlaylistTracks, clearOfflineCaches, removePlaylistAudio, resolveLegacyDownloadEntries } = await import("../src/lib/offlineDownloads.ts");
const { useDownloadedTracks, reportTrackCacheFailure } = await import("../src/store/downloads.ts");
const { api } = await import("../src/lib/api.ts");
const { useToastStore } = await import("../src/store/toast.ts");
resolver.deregister();

const saved = new Map();
const events = [];
globalThis.window = {
  localStorage: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  },
  dispatchEvent: (event) => events.push(event.type),
  setTimeout: () => 0,
};

beforeEach(() => {
  saved.clear();
  events.length = 0;
  useDownloadedTracks.setState(useDownloadedTracks.getInitialState(), true);
  useToastStore.setState({ toasts: [] });
});

test("missing local JSON is initial state; malformed stored JSON identifies the key", () => {
  const initial = [];
  assert.equal(readLocalJsonSnapshot("missing", initial), initial);
  saved.set("broken-json", "{");
  assert.throws(() => readLocalJsonSnapshot("broken-json", initial), /broken-json.*als JSON gelesen/);
  saved.set("empty-json", "");
  assert.throws(() => readLocalJsonSnapshot("empty-json", initial), /empty-json.*als JSON gelesen/);
});

test("successful local writes are reactive and stable; failed writes publish no change", (t) => {
  writeLocalJsonValue("reactive-json", [{ id: "1" }]);
  const first = readLocalJsonSnapshot("reactive-json", []);
  assert.equal(readLocalJsonSnapshot("reactive-json", []), first);
  assert.deepEqual(events, ["local-json:reactive-json"]);
  t.mock.method(window.localStorage, "setItem", () => { throw new Error("QuotaExceededError"); });
  assert.throws(() => writeLocalJsonValue("reactive-json", [{ id: "2" }]), /reactive-json.*QuotaExceededError/);
  assert.deepEqual(readLocalJsonSnapshot("reactive-json", []), [{ id: "1" }]);
  assert.equal(events.length, 1);
});

test("local read permissions and non-JSON values fail with storage context", (t) => {
  t.mock.method(window.localStorage, "getItem", () => { throw new Error("SecurityError"); });
  assert.throws(() => readLocalJsonSnapshot("protected-json", []), /protected-json.*SecurityError/);
  assert.throws(() => writeLocalJsonValue("undefined-json", undefined), /undefined-json.*nicht als JSON speicherbar/);
  assert.equal(events.length, 0);
});

function cacheFixture() {
  const audio = new Map();
  const images = new Map();
  const deleted = [];
  const handles = {
    "sf-audio": {
      match: async (url) => audio.get(url),
      put: async (url, response) => audio.set(url, response),
      delete: async (url) => { deleted.push(url); return audio.delete(url); },
      keys: async () => [...audio.keys()].map((url) => ({ url })),
    },
    "sf-img": {
      match: async (url) => images.get(url),
      put: async (url, response) => images.set(url, response),
    },
  };
  globalThis.caches = { open: async (name) => handles[name] };
  return { audio, images, deleted, handles };
}

const track = (id, cover = "") => ({ id, title: `Track ${id}`, cover });

test("offline retries reuse completed audio and covers instead of fetching them again", async (t) => {
  const cached = cacheFixture();
  const urls = [];
  const progress = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return new Response("audio or artwork");
  });
  assert.deepEqual(await cachePlaylistTracks([track("1", "/cover-1.jpg"), track("1", "/cover-1.jpg")], (done) => progress.push(done)), ["1", "1"]);
  assert.deepEqual(urls, ["/api/tracks/1/stream", "/cover-1.jpg"]);
  assert.deepEqual(progress, [1, 2]);
  await cachePlaylistTracks([track("1", "/cover-1.jpg")], () => {});
  assert.equal(urls.length, 2);
  assert.equal(cached.audio.size, 1);
  assert.equal(cached.images.size, 1);
});

test("offline failures preserve every track cause and expose failed cover requests", async (t) => {
  cacheFixture();
  const progress = [];
  t.mock.method(globalThis, "fetch", async (url) => url.includes("/tracks/1/")
    ? new Response("unavailable", { status: 503 })
    : url === "/cover-2.jpg" ? Promise.reject(new Error("Cover connection lost")) : new Response("audio"));
  await assert.rejects(cachePlaylistTracks([track("1"), track("2", "/cover-2.jpg")], (done) => progress.push(done)), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /Track 1.*HTTP 503/);
    assert.match(error.message, /Track 2.*Cover connection lost/);
    return true;
  });
  assert.deepEqual(progress, [1, 2]);
});

test("offline removal needs no network and keeps tracks shared with another playlist", async (t) => {
  const cached = cacheFixture();
  cached.audio.set("/api/tracks/1/stream", "one");
  cached.audio.set("/api/tracks/2/stream", "two");
  t.mock.method(globalThis, "fetch", () => { throw new Error("Removal must work offline"); });
  await removePlaylistAudio("a", {
    a: { name: "First", total: 2, trackIds: ["1", "2"] },
    b: { name: "Second", total: 1, trackIds: ["2"] },
  });
  assert.deepEqual(cached.deleted, ["/api/tracks/1/stream"]);
  assert.equal(cached.audio.get("/api/tracks/2/stream"), "two");
});

test("two legacy offline entries can resolve their indexes before safe individual removal", async () => {
  const cached = cacheFixture();
  cached.audio.set("/api/tracks/1/stream", new Response("one"));
  cached.audio.set("/api/tracks/2/stream", new Response("two"));
  const original = { a: { name: "First", total: 2 }, b: { name: "Second", total: 1 } };
  const calls = [];
  const indexed = await resolveLegacyDownloadEntries(original, async (id) => {
    calls.push(id);
    return id === "a" ? [track("1"), track("2")] : [track("2")];
  });
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(original.a.trackIds, undefined);
  await removePlaylistAudio("a", indexed);
  assert.equal(cached.audio.has("/api/tracks/1/stream"), false);
  assert.equal(cached.audio.has("/api/tracks/2/stream"), true);
  assert.equal(await resolveLegacyDownloadEntries(indexed, async () => { throw new Error("No network for indexed entries"); }), indexed);
});

test("lost legacy sources report all names and the available total cleanup action", async () => {
  await assert.rejects(resolveLegacyDownloadEntries({ a: { name: "Deleted", total: 1 }, b: { name: "Changed", total: 2 } }, async (id) => {
    if (id === "a") throw new Error("HTTP 404");
    return [track("2")];
  }), (error) => {
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /Deleted.*a.*HTTP 404/);
    assert.match(error.message, /Changed.*b.*Titelliste hat sich geändert/);
    assert.match(error.message, /Alle Offline-Downloads löschen/);
    return true;
  });
});

test("total offline cleanup clears indexes only after audio deletion and reports retained covers", async () => {
  const calls = [];
  let indexRemoved = false;
  globalThis.caches = { delete: async (name) => { calls.push(name); throw new Error("Deletion denied"); } };
  await assert.rejects(clearOfflineCaches(() => { indexRemoved = true; }), /Offline-Audio.*Deletion denied/);
  assert.equal(indexRemoved, false);
  assert.deepEqual(calls, ["sf-audio"]);
  globalThis.caches = { delete: async (name) => {
    if (name === "sf-audio") return true;
    assert.equal(indexRemoved, true);
    throw new Error("Cover deletion denied");
  } };
  await assert.rejects(clearOfflineCaches(() => { indexRemoved = true; }), /Audio-Downloads wurden entfernt.*Cover deletion denied/);
  assert.equal(indexRemoved, true);
});

test("offline removal rejects cache failures before callers remove playlist metadata", async (t) => {
  const cached = cacheFixture();
  t.mock.method(cached.handles["sf-audio"], "delete", async () => { throw new Error("Cache deletion denied"); });
  await assert.rejects(removePlaylistAudio("a", { a: { name: "First", total: 1, trackIds: ["1"] } }), /First.*Cache deletion denied/);
  await assert.rejects(removePlaylistAudio("a", {
    a: { name: "First", total: 1, trackIds: ["1"] },
    legacy: { name: "Legacy", total: 1 },
  }), /Legacy.*keine gespeicherten Titel-IDs/);
  assert.throws(() => assertDownloadEntries({ a: { name: "First", total: 1, trackIds: "1" } }), /sf_downloads.*ungültiges Format/);
});

test("a failed offline removal restores deletions that already succeeded", async (t) => {
  const cached = cacheFixture();
  const first = new Response("first audio");
  const second = new Response("second audio");
  cached.audio.set("/api/tracks/1/stream", first);
  cached.audio.set("/api/tracks/2/stream", second);
  t.mock.method(cached.handles["sf-audio"], "delete", async (url) => {
    if (url === "/api/tracks/2/stream") throw new Error("Second deletion denied");
    return cached.audio.delete(url);
  });
  await assert.rejects(removePlaylistAudio("a", { a: { name: "First", total: 2, trackIds: ["1", "2"] } }), /Second deletion denied/);
  assert.equal(cached.audio.get("/api/tracks/1/stream"), first);
  assert.equal(cached.audio.get("/api/tracks/2/stream"), second);
});

test("shared cache status failures remain errors and explicit refresh can recover", async (t) => {
  cacheFixture();
  t.mock.method(caches, "open", async () => { throw new Error("Cache access denied"); });
  const state = useDownloadedTracks.getState();
  const first = state.refresh();
  assert.equal(state.refresh(), first);
  await assert.rejects(first, /Offline-Cache.*Cache access denied/);
  assert.equal(useDownloadedTracks.getState().loaded, false);
  const failure = useDownloadedTracks.getState().error;
  reportTrackCacheFailure(failure);
  reportTrackCacheFailure(failure);
  assert.equal(useToastStore.getState().toasts.length, 1);
  caches.open.mock.mockImplementation(async () => ({ keys: async () => [{ url: "https://local.test/api/tracks/12/stream" }] }));
  await state.refresh();
  assert.equal(useDownloadedTracks.getState().loaded, true);
  assert.equal(useDownloadedTracks.getState().error, null);
  assert.deepEqual([...useDownloadedTracks.getState().ids], ["12"]);
});

test("malformed server cache status cannot become a successful empty collection", async (t) => {
  t.mock.method(api, "cachedTracks", async () => ({ ids: null }));
  await assert.rejects(useDownloadedTracks.getState().refreshServer(), /Server-Cache.*gültiger Titel-IDs/);
  assert.equal(useDownloadedTracks.getState().serverLoaded, false);
  assert.ok(useDownloadedTracks.getState().serverError);
  api.cachedTracks.mock.mockImplementation(async () => ({ ids: ["12"] }));
  await useDownloadedTracks.getState().refreshServer();
  assert.equal(useDownloadedTracks.getState().serverError, null);
  assert.deepEqual([...useDownloadedTracks.getState().serverIds], ["12"]);
});
