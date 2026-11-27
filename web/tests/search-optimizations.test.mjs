import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  formatRateLimitNotice,
  isRateLimitError,
  partitionRateLimitFailures,
  retryAfterSeconds,
  shouldRetryQuery,
  subscribeCountdown,
} from "../src/lib/rateLimit.ts";
import { compileSource } from "./support/compile.mjs";

const { needsTrackCreditsHydration, mergeHydratedTrack, reportTrackHydrationError, useHydratedTrack } = await import(
  await compileSource(
    "src/hooks/useHydratedTrack.ts",
    {
      react: import.meta.resolve("react"),
      "@tanstack/react-query": import.meta.resolve("@tanstack/react-query"),
      "@/lib/api": `data:text/javascript,export const api = { track(id) { globalThis.__hydrateTrackCalls.push(id); return Promise.resolve({ id, title: "Get Lucky", artist: "Daft Punk", artists: [{ id: "27", name: "Daft Punk" }, { id: "1306", name: "Pharrell Williams" }], album: "", cover: "", duration_sec: 248 }); } };`,
    },
    "hook",
  ),
);
globalThis.__hydrateTrackCalls = [];

const searchFieldFixture = { hooks: [], cursor: 0, effects: [], listeners: new Map() };
globalThis.__searchFieldRaceFixture = searchFieldFixture;
const searchFieldReactStub = `data:text/javascript;base64,${Buffer.from(`
  export function useRef(initial) { const f = globalThis.__searchFieldRaceFixture; const i = f.cursor++; return f.hooks[i] ??= { current: initial }; }
  export function useEffectEvent(fn) { return (...args) => fn(...args); }
  export function useEffect(cb) { globalThis.__searchFieldRaceFixture.effects.push(cb); }
  export function useImperativeHandle() {}
`).toString("base64")}`;
const { default: SearchField } = await import(
  await compileSource(
    "src/components/SearchField.tsx",
    {
      react: searchFieldReactStub,
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
      "@/components/icons": `data:text/javascript,export const SearchIcon = () => null; export const CloseIcon = () => null;`,
    },
    "component",
  ),
);

const playsFixture = { calls: [] };
globalThis.__playsHookFixture = playsFixture;
const { useTrackPlays } = await import(
  await compileSource(
    "src/hooks/usePlays.ts",
    {
      "@tanstack/react-query": import.meta.resolve("@tanstack/react-query"),
      "@/lib/api": `data:text/javascript,export const api = { trackPlays(items, signal) { globalThis.__playsHookFixture.calls.push({ items, hasSignal: Boolean(signal) }); return Promise.resolve({}); } };`,
    },
    "hook",
  ),
);

test("shouldRetryQuery skips HTTP 429 and 4xx while allowing one retry for transient failures", () => {
  assert.equal(shouldRetryQuery(0, { status: 429 }), false);
  assert.equal(shouldRetryQuery(0, { status: 400 }), false);
  assert.equal(shouldRetryQuery(0, { status: 404 }), false);
  assert.equal(shouldRetryQuery(0, { status: 502 }), true);
  assert.equal(shouldRetryQuery(1, { status: 502 }), false);
  assert.equal(shouldRetryQuery(0, new Error("Network failure")), true);
  assert.equal(shouldRetryQuery(1, new Error("Network failure")), false);
});

test("rate-limit helpers compute countdowns, format German notices, and partition failures cleanly", () => {
  const now = 1_700_000_000_000;
  const err429A = Object.assign(new Error("limit"), { status: 429, retryAfterSec: 4, retryAfterAt: now + 3_200 });
  const err429B = Object.assign(new Error("limit"), { status: 429, retryAfterSec: 9, retryAfterAt: now + 8_500 });
  const err503 = Object.assign(new Error("HTTP 503"), { status: 503 });

  assert.equal(isRateLimitError(err429A), true);
  assert.equal(isRateLimitError(err503), false);
  assert.equal(retryAfterSeconds(err429A, now), 4);
  assert.equal(retryAfterSeconds(err429A, now + 5_000), 0);
  assert.equal(retryAfterSeconds({ status: 429 }, now), null);

  assert.match(formatRateLimitNotice(["Titel"], 1), /1 Sekunde erneut versuchen/);
  assert.match(formatRateLimitNotice(["Titel", "Alben"], 5), /Titel und Alben: Anfragelimit erreicht – bitte in 5 Sekunden/);
  assert.match(formatRateLimitNotice(["Titel"], 120), /bitte in 120 Sekunden/, "explicit upstream Retry-After is never clamped");
  assert.match(formatRateLimitNotice(["Titel", "Alben", "Künstler"], 0), /Titel, Alben und Künstler: Anfragelimit war vorübergehend erreicht/);
  assert.match(formatRateLimitNotice(["Titel"], null), /bitte kurz warten/);

  const retried = [];
  const grouped = partitionRateLimitFailures([
    { label: "Titel", result: { error: err429A, isFetching: false, refetch: async () => retried.push("track") } },
    { label: "Alben", result: { error: err503, isFetching: false, refetch: async () => retried.push("album") } },
    { label: "Künstler", result: { error: err429B, isFetching: true, refetch: async () => retried.push("artist") } },
  ]);
  assert.deepEqual(grouped.rateLimit.labels, ["Titel", "Künstler"]);
  assert.equal(grouped.rateLimit.retryAfterSec, 9);
  assert.equal(grouped.rateLimit.retryAfterAt, now + 8_500);
  assert.equal(grouped.rateLimit.isFetching, true);
  assert.deepEqual(grouped.other.map((entry) => entry.label), ["Alben"]);
});

test("subscribeCountdown ticks once per second and stops once retryAfterAt passes", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 10_000 });
  let ticks = 0;
  const unsub = subscribeCountdown(12_500, () => {
    ticks += 1;
  });
  t.mock.timers.tick(1_000);
  assert.equal(ticks, 1);
  t.mock.timers.tick(1_000);
  assert.equal(ticks, 2);
  t.mock.timers.tick(1_000);
  assert.equal(ticks, 3);
  t.mock.timers.tick(5_000);
  assert.equal(ticks, 3, "interval self-stops once deadline passes");
  unsub();
});

test("lazy track-credits hydration targets single-artist numeric tracks and merges non-destructively", () => {
  const singleSearchTrack = {
    id: "3135556",
    title: "Get Lucky",
    artist: "Daft Punk",
    artist_id: "27",
    artists: [{ id: "27", name: "Daft Punk" }],
    album: "Random Access Memories",
    cover: "",
    duration_sec: 248,
    isrc: "USQX91300108",
  };
  const multiArtistTrack = {
    ...singleSearchTrack,
    artists: [
      { id: "27", name: "Daft Punk" },
      { id: "1306", name: "Pharrell Williams" },
    ],
  };

  assert.equal(needsTrackCreditsHydration(null), false);
  assert.equal(needsTrackCreditsHydration({ ...singleSearchTrack, id: "invalid" }), false);
  assert.equal(needsTrackCreditsHydration(singleSearchTrack), true);
  assert.equal(needsTrackCreditsHydration(multiArtistTrack), false);

  const hydrated = mergeHydratedTrack(singleSearchTrack, {
    ...multiArtistTrack,
    loudness_gain_db: -6.4,
  });
  assert.deepEqual(hydrated.artists, multiArtistTrack.artists);
  assert.equal(hydrated.loudness_gain_db, -6.4);
  assert.equal(hydrated.isrc, "USQX91300108");
  assert.equal(mergeHydratedTrack(singleSearchTrack, { ...multiArtistTrack, id: "999" }), singleSearchTrack);
});

test("useTrackPlays uses a sort-invariant cache key, disables retries, and forwards AbortSignal", async () => {
  const client = new QueryClient();
  const trackA = { id: "10", title: "Alpha", artist: "Band", album: "", cover: "", duration_sec: 100 };
  const trackB = { id: "20", title: "Zulu", artist: "Band", album: "", cover: "", duration_sec: 200 };

  function Probe({ tracks }) {
    useTrackPlays(tracks);
    return null;
  }

  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe, { tracks: [trackA, trackB] })));
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe, { tracks: [trackB, trackA] })));

  const cachedQueries = client.getQueryCache().getAll();
  assert.equal(cachedQueries.length, 1, "reordering the same tracks reuses one cache entry");
  assert.deepEqual(cachedQueries[0].queryKey, ["track-plays", "10,20"]);
  assert.equal(cachedQueries[0].options.retry, false);

  playsFixture.calls = [];
  await client.fetchQuery({
    queryKey: cachedQueries[0].queryKey,
    queryFn: cachedQueries[0].options.queryFn,
  });
  assert.equal(playsFixture.calls.length, 1);
  assert.equal(playsFixture.calls[0].hasSignal, true);
  client.clear();
});

test("reportTrackHydrationError logs loudly and useHydratedTrack stays idle when disabled (offlineOnly)", (t) => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  reportTrackHydrationError("3135556", new Error("API /tracks/3135556: HTTP 429"));
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /3135556.*HTTP 429/);

  const client = new QueryClient();
  globalThis.__hydrateTrackCalls = [];
  const singleSearchTrack = {
    id: "3135556",
    title: "Get Lucky",
    artist: "Daft Punk",
    artist_id: "27",
    artists: [{ id: "27", name: "Daft Punk" }],
    album: "Random Access Memories",
    cover: "",
    duration_sec: 248,
  };
  function Probe({ enabled }) {
    useHydratedTrack(singleSearchTrack, enabled);
    return null;
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe, { enabled: false })));
  assert.equal(globalThis.__hydrateTrackCalls.length, 0);
  const queries = client.getQueryCache().getAll();
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].queryKey, ["track", ""]);
  assert.equal(queries[0].options.enabled, false);
  client.clear();
});

test("SearchField captures native window input events for its own input even without React onChange, without double-firing", () => {
  const prevWindow = globalThis.window;
  const listeners = [];
  globalThis.window = {
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture) {
      const idx = listeners.findIndex((item) => item.type === type && item.fn === fn && item.capture === capture);
      if (idx !== -1) listeners.splice(idx, 1);
    },
  };
  try {
    searchFieldFixture.hooks = [];
    searchFieldFixture.cursor = 0;
    searchFieldFixture.effects = [];
    const changes = [];
    const submits = [];
    let cleared = 0;
    const tree = SearchField({
      value: "Search fixture 71",
      onValueChange: (val) => changes.push(val),
      onSubmit: () => submits.push("submit"),
      onClear: () => { cleared += 1; },
    });
    const inputEl = tree.props.children.find((child) => child && child.type === "input");
    const clearBtn = tree.props.children.find((child) => child && child.type === "button");
    const domInput = { value: "Search fixture 72", dataset: {}, focus() {} };
    inputEl.props.ref.current = domInput;

    assert.equal(searchFieldFixture.effects.length, 1);
    const cleanup = searchFieldFixture.effects[0]();
    assert.equal(listeners.length, 1);
    assert.equal(listeners[0].type, "input");
    assert.equal(listeners[0].capture, true);

    // Unrelated target is ignored.
    listeners[0].fn({ target: { value: "other" } });
    assert.deepEqual(changes, []);

    // Native input event for this input fires onValueChange (even if React dropped onChange).
    listeners[0].fn({ target: domInput });
    // React's controlled no-op onChange does NOT double-forward.
    inputEl.props.onChange({ target: domInput });
    assert.deepEqual(changes, ["Search fixture 72"]);

    // IME composition blocks submit; ending composition allows submit; Clear still works.
    inputEl.props.onCompositionStart({ currentTarget: domInput });
    tree.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(submits, []);
    inputEl.props.onCompositionEnd({ currentTarget: domInput });
    tree.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(submits, ["submit"]);
    clearBtn.props.onClick();
    assert.equal(cleared, 1);

    cleanup();
    assert.equal(listeners.length, 0);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});
