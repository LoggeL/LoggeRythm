import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";
import vm from "node:vm";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const saved = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  },
};

const {
  DOWNLOADS_STORAGE_KEY,
  assertDownloadEntries,
  hasOfflineDownloadsSnapshot,
} = await import("../src/lib/offlineDownloads.ts");
resolver.deregister();

const swSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function bootServiceWorker({ fetchImpl }) {
  const cacheMap = new Map();
  const getStore = (name) => {
    if (!cacheMap.has(name)) cacheMap.set(name, new Map());
    const store = cacheMap.get(name);
    const keyOf = (req) => (typeof req === "string" ? req : req.url);
    return {
      async match(req) {
        const hit = store.get(keyOf(req));
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) {
        store.set(keyOf(req), res.clone());
      },
      async delete(req) {
        return store.delete(keyOf(req));
      },
      _store: store,
    };
  };

  const listeners = new Map();
  const self = {
    location: { origin: "https://music.example" },
    skipWaiting() {},
    clients: { async claim() {} },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
  };
  const caches = {
    async open(name) {
      return getStore(name);
    },
    async keys() {
      return [...cacheMap.keys()];
    },
    async delete(name) {
      return cacheMap.delete(name);
    },
  };

  const sandbox = {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    Response,
    Request,
    Headers,
    Uint8Array,
    ArrayBuffer,
  };
  vm.runInNewContext(swSource, sandbox, { filename: "public/sw.js" });

  async function dispatchFetch(request) {
    let responsePromise = null;
    const event = {
      request,
      respondWith(promise) {
        responsePromise = promise;
      },
    };
    listeners.get("fetch")(event);
    return responsePromise ? await responsePromise : null;
  }

  return { caches, cacheMap, dispatchFetch };
}

beforeEach(() => {
  saved.clear();
});

test("assertDownloadEntries accepts v2 snapshots with kind/cover/tracks and rejects malformed entries", () => {
  const valid = {
    liked: {
      name: "Gelikte Titel",
      total: 1,
      kind: "liked",
      cover: "https://cdn.example/c.jpg",
      trackIds: ["101"],
      tracks: [
        {
          id: "101",
          title: "Signal",
          artist: "Logge",
          album: "Ink",
          cover: "https://cdn.example/c.jpg",
          duration_sec: 195,
        },
      ],
    },
  };
  assert.doesNotThrow(() => assertDownloadEntries(valid));

  assert.throws(
    () => assertDownloadEntries({ bad: { name: "X", total: 1, kind: "podcast" } }),
    /sf_downloads/,
  );
  assert.throws(
    () => assertDownloadEntries({ bad: { name: "X", total: 1, tracks: [{ id: "" }] } }),
    /sf_downloads/,
  );
});

test("hasOfflineDownloadsSnapshot reports local availability and fails loud on corrupt storage", () => {
  assert.equal(hasOfflineDownloadsSnapshot(), false);
  saved.set(DOWNLOADS_STORAGE_KEY, JSON.stringify({}));
  assert.equal(hasOfflineDownloadsSnapshot(), false);
  saved.set(
    DOWNLOADS_STORAGE_KEY,
    JSON.stringify({ "album:5": { name: "Discovery", total: 14, kind: "album", trackIds: ["1"] } }),
  );
  assert.equal(hasOfflineDownloadsSnapshot(), true);

  saved.set(DOWNLOADS_STORAGE_KEY, "{not-json");
  assert.throws(() => hasOfflineDownloadsSnapshot(), SyntaxError);
  saved.set(DOWNLOADS_STORAGE_KEY, JSON.stringify({ broken: { name: "X", total: -2 } }));
  assert.throws(() => hasOfflineDownloadsSnapshot(), /sf_downloads/);
});

test("sw.js rangeFrom preserves original Content-Type (e.g. audio/flac) for 200, 206, and 416 responses", async () => {
  const sw = bootServiceWorker({
    fetchImpl: async () => {
      throw new Error("should serve cached audio without hitting network");
    },
  });
  const audioCache = await sw.caches.open("sf-audio");
  const payload = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
  await audioCache.put(
    "https://music.example/api/tracks/77/stream",
    new Response(payload, { status: 200, headers: { "content-type": "audio/flac" } }),
  );

  // Full 200 response preserves audio/flac.
  const fullRes = await sw.dispatchFetch(
    new Request("https://music.example/api/tracks/77/stream", { method: "GET" }),
  );
  assert.equal(fullRes.status, 200);
  assert.equal(fullRes.headers.get("content-type"), "audio/flac");
  assert.equal(fullRes.headers.get("content-length"), "10");

  // Partial 206 Range response preserves audio/flac and byte slice.
  const rangeRes = await sw.dispatchFetch(
    new Request("https://music.example/api/tracks/77/stream", {
      method: "GET",
      headers: { range: "bytes=0-3" },
    }),
  );
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get("content-type"), "audio/flac");
  assert.equal(rangeRes.headers.get("content-range"), "bytes 0-3/10");
  assert.deepEqual(new Uint8Array(await rangeRes.arrayBuffer()), new Uint8Array([0x66, 0x4c, 0x61, 0x43]));

  // Out-of-bounds range returns 416.
  const oobRes = await sw.dispatchFetch(
    new Request("https://music.example/api/tracks/77/stream", {
      method: "GET",
      headers: { range: "bytes=99-120" },
    }),
  );
  assert.equal(oobRes.status, 416);
  assert.equal(oobRes.headers.get("content-range"), "bytes */10");
});

test("sw.js networkFirstNav caches per-route shells without clobbering '/' and falls back offline", async () => {
  let online = true;
  const sw = bootServiceWorker({
    fetchImpl: async (req) => {
      if (!online) throw new TypeError("Failed to fetch");
      const path = new URL(req.url).pathname;
      return new Response(`<html>page:${path}</html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });

  const navReq = (url) => ({
    url,
    method: "GET",
    mode: "navigate",
    headers: new Headers(),
  });

  // Visit root "/" then subroute "/library".
  const rootOnline = await sw.dispatchFetch(navReq("https://music.example/"));
  assert.equal(await rootOnline.text(), "<html>page:/</html>");

  const libOnline = await sw.dispatchFetch(navReq("https://music.example/library"));
  assert.equal(await libOnline.text(), "<html>page:/library</html>");

  // Go offline: "/" must STILL return the root shell (NOT overwritten by /library!),
  // "/library" returns its own cached shell, and an unvisited route falls back to "/".
  online = false;
  const rootOffline = await sw.dispatchFetch(navReq("https://music.example/"));
  assert.equal(await rootOffline.text(), "<html>page:/</html>");

  const libOffline = await sw.dispatchFetch(navReq("https://music.example/library"));
  assert.equal(await libOffline.text(), "<html>page:/library</html>");

  const otherOffline = await sw.dispatchFetch(navReq("https://music.example/album/123"));
  assert.equal(await otherOffline.text(), "<html>page:/</html>");
});
