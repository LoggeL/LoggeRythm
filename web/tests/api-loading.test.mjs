import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError } from "../src/lib/api.ts";

test("JSON endpoints reject HTML and malformed success responses", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Bad gateway</html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(api.me(), /JSON erwartet/);
  globalThis.fetch.mock.mockImplementation(async () => new Response("{", { headers: { "content-type": "application/json" } }));
  await assert.rejects(api.me(), /ungültige oder leere JSON/);
});

test("HTTP failures retain status and server detail", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: "Session expired" }, { status: 401 }));
  await assert.rejects(api.me(), (error) => error instanceof ApiError && error.status === 401 && error.message.includes("Session expired"));
});

test("successful JSON and bodyless mutations still work", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "1" }));
  assert.deepEqual(await api.me(), { id: "1" });
  globalThis.fetch.mock.mockImplementation(async () => new Response(null, { status: 204 }));
  assert.equal(await api.logout(), undefined);
});

test("stalled connections time out and abort the network request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  });
  const request = api.me();
  const rejection = assert.rejects(request, /Zeitüberschreitung nach 30 Sekunden/);
  t.mock.timers.tick(30_000);
  await rejection;
  assert.equal(signal.aborted, true);
});

test("deadline covers a stalled response body after headers arrive", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => ({
    text: () => {
      bodyStarted();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    },
  }));
  const rejection = assert.rejects(api.me(), /Zeitüberschreitung/);
  await started;
  t.mock.timers.tick(30_000);
  await rejection;
});

test("search cancellation reaches fetch and is not converted to a network failure", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  }));
  const rejection = assert.rejects(api.search("old query", "track", controller.signal), { name: "AbortError" });
  controller.abort();
  await rejection;
});

test("AI lyrics retain both the variant query and the transcription deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestedUrl;
  t.mock.method(globalThis, "fetch", async (url, { signal }) => {
    requestedUrl = url;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  });
  const rejection = assert.rejects(api.lyrics("A & B", "Song", "42", "ai"), /Zeitüberschreitung nach 300 Sekunden/);
  assert.equal(requestedUrl, "/api/lyrics?artist=A%20%26%20B&title=Song&deezer_id=42&variant=ai");
  t.mock.timers.tick(300_000);
  await rejection;
});

test("cold discovery survives the ordinary deadline and still aborts stalled requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, { signal, cache }) => {
    signals.push(signal);
    requests.push({ url, cache });
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  });
  const pending = [
    api.homeMixes(),
    api.becauseYouListened(),
    api.homeChartsCollections(),
    api.releaseRadar(true),
    api.homeMood("chill"),
    api.radio("66609426"),
  ].map((request) => assert.rejects(request, /Zeitüberschreitung nach 90 Sekunden/));
  t.mock.timers.tick(35_000);
  assert.equal(signals.length, 6);
  assert.equal(signals.every((signal) => !signal.aborted), true);
  assert.equal(requests[3].url, "/api/home/release-radar?refresh=true");
  assert.equal(requests[3].cache, "no-store");
  t.mock.timers.tick(55_000);
  await Promise.all(pending);
  assert.equal(signals.every((signal) => signal.aborted), true);
});
