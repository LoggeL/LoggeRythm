import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/searchDecoders") {
      return nextResolve(new URL("../src/lib/searchDecoders.ts", import.meta.url).href, context);
    }
    if (specifier === "@/lib/releaseRadar") {
      return nextResolve(new URL("../src/lib/releaseRadar.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { api, ApiError, parseRetryAfterHeader, parseRetryAfterBody } = await import("../src/lib/api.ts");
resolver.deregister();

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

test("proxy HTML error pages become a short message and keep the page on body", async (t) => {
  const page = "<!DOCTYPE html>\n<html><head><title>logge.top | 502: Bad gateway</title></head><body>…</body></html>";
  for (const headers of [{ "content-type": "text/html; charset=UTF-8" }, {}]) {
    t.mock.method(globalThis, "fetch", async () => new Response(page, { status: 502, headers }));
    await assert.rejects(api.me(), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      assert.equal(error.message, "API /auth/me: HTTP 502 – der Server antwortete mit einer HTML-Fehlerseite statt einer API-Antwort.");
      assert.equal(error.body, page);
      return true;
    });
    globalThis.fetch.mock.restore();
  }
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

test("HTTP 429 parses Retry-After headers (delta-seconds and HTTP-date) and JSON fallback onto ApiError", async (t) => {
  const fixedNow = Date.UTC(2026, 10, 27, 12, 0, 0);
  assert.equal(parseRetryAfterHeader("7", fixedNow), 7);
  assert.equal(parseRetryAfterHeader("180", fixedNow), 180);
  assert.equal(parseRetryAfterHeader("2.2", fixedNow), 3);
  assert.equal(parseRetryAfterHeader("0", fixedNow), 0);
  assert.equal(parseRetryAfterHeader("Fri, 27 Nov 2026 12:00:12 GMT", fixedNow), 12);
  assert.equal(parseRetryAfterHeader("Fri, 27 Nov 2026 12:02:00 GMT", fixedNow), 120);
  assert.equal(parseRetryAfterHeader("Fri, 27 Nov 2026 11:59:50 GMT", fixedNow), 0);
  assert.equal(parseRetryAfterHeader("not-a-date", fixedNow), null);
  assert.equal(parseRetryAfterHeader(null, fixedNow), null);
  assert.equal(parseRetryAfterBody({ retry_after: 9 }), 9);
  assert.equal(parseRetryAfterBody({ retry_after_sec: 4.1 }), 5);
  assert.equal(parseRetryAfterBody({ detail: "limit" }), null);

  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { detail: "Deezer rate limit reached. Retry after 8s." },
      { status: 429, headers: { "Retry-After": "8" } },
    ),
  );
  await assert.rejects(api.search("Queen", "track"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSec, 8);
    assert.equal(typeof error.retryAfterAt, "number");
    assert.ok(error.retryAfterAt > Date.now());
    assert.match(error.message, /Retry after 8s/);
    return true;
  });

  globalThis.fetch.mock.mockImplementation(async () =>
    Response.json({ detail: "Quota exceeded", retry_after: 5 }, { status: 429 }),
  );
  await assert.rejects(api.searchArtists("Queen"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSec, 5);
    return true;
  });
});

test("track detail and play-count requests forward AbortSignal", async (t) => {
  const trackAbort = new AbortController();
  const playsAbort = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const trackRejection = assert.rejects(api.track("42", trackAbort.signal), { name: "AbortError" });
  const playsRejection = assert.rejects(
    api.trackPlays([{ id: "42", artist: "Queen", title: "Bohemian" }], playsAbort.signal),
    { name: "AbortError" },
  );
  trackAbort.abort();
  playsAbort.abort();
  await Promise.all([trackRejection, playsRejection]);
});
