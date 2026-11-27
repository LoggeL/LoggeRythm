import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/api") {
      return nextResolve(new URL("../src/lib/api.ts", import.meta.url).href, context);
    }
    if (specifier === "@/lib/searchDecoders") {
      return nextResolve(new URL("../src/lib/searchDecoders.ts", import.meta.url).href, context);
    }
    if (specifier === "@/lib/releaseRadar") {
      return nextResolve(new URL("../src/lib/releaseRadar.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const {
  catalogSearchKey,
  normalizeCatalogQuery,
  SEARCH_DEBOUNCE_MS,
  SEARCH_STALE_TIME,
  searchTracksOptions,
  searchAlbumsOptions,
  searchArtistsOptions,
  searchPlaylistsOptions,
} = await import("../src/lib/catalogQueries.ts");
resolver.deregister();

test("route and palette share one in-flight request and reuse its fresh result", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const urls = [];
  let finish;
  t.mock.method(globalThis, "fetch", (url) => {
    urls.push(url);
    return new Promise((resolve) => { finish = resolve; });
  });
  const route = client.fetchQuery(searchTracksOptions("  Massive Attack "));
  const palette = client.fetchQuery(searchTracksOptions("Massive Attack"));
  assert.deepEqual(urls, ["/api/search?q=Massive%20Attack&type=track"]);
  finish(Response.json([{ id: "1", title: "Teardrop" }]));
  assert.deepEqual(await route, await palette);
  assert.deepEqual(await client.fetchQuery(searchTracksOptions("Massive Attack  ")), [{ id: "1", title: "Teardrop" }]);
  assert.equal(urls.length, 1);

  await client.invalidateQueries({ queryKey: catalogSearchKey("track", "Massive Attack"), refetchType: "none" });
  const refresh = client.fetchQuery(searchTracksOptions("Massive Attack"));
  assert.equal(urls.length, 2);
  finish(Response.json([{ id: "2", title: "Angel" }]));
  assert.deepEqual(await refresh, [{ id: "2", title: "Angel" }]);
});

test("search entities have separate keys and send their canonical text", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return Response.json([]);
  });
  await Promise.all([
    client.fetchQuery(searchTracksOptions("  Portishead  ")),
    client.fetchQuery(searchAlbumsOptions("  Portishead  ")),
    client.fetchQuery(searchArtistsOptions("  Portishead  ")),
    client.fetchQuery(searchPlaylistsOptions("  Portishead  ")),
  ]);
  assert.deepEqual(urls, [
    "/api/search?q=Portishead&type=track",
    "/api/search?q=Portishead&type=album",
    "/api/search/artist?q=Portishead",
    "/api/search/playlist?q=Portishead",
  ]);
  assert.equal(client.getQueryCache().getAll().length, 4);
});

test("closing one shared search observer keeps the other request alive", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  let signal;
  let count = 0;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal;
    count++;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const route = new QueryObserver(client, searchTracksOptions("Björk"));
  const palette = new QueryObserver(client, searchTracksOptions(" Björk "));
  const closeRoute = route.subscribe(() => {});
  const closePalette = palette.subscribe(() => {});
  assert.equal(count, 1);
  closePalette();
  assert.equal(signal.aborted, false);
  closeRoute();
  assert.equal(signal.aborted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.getQueryState(catalogSearchKey("track", "Björk")).fetchStatus, "idle");
});

test("search errors are exposed after one attempt and an explicit retry can recover", async (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 4, retryDelay: 0 } } });
  t.after(() => client.clear());
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return Response.json({ detail: "Catalog unavailable" }, { status: 503 });
  });
  await assert.rejects(client.fetchQuery(searchArtistsOptions("Tricky")), /Catalog unavailable/);
  assert.equal(count, 1);
  const state = client.getQueryState(catalogSearchKey("artist", "Tricky"));
  assert.equal(state.status, "error");
  assert.equal(state.data, undefined);
  globalThis.fetch.mock.mockImplementation(async () => {
    count++;
    return Response.json([{ id: 1, name: "Tricky" }]);
  });
  assert.deepEqual(await client.fetchQuery(searchArtistsOptions("Tricky")), [{ id: 1, name: "Tricky" }]);
  assert.equal(count, 2);
});

test("catalog normalization trims outer whitespace only and preserves case and internal spaces", () => {
  assert.equal(SEARCH_DEBOUNCE_MS, 250);
  assert.equal(SEARCH_STALE_TIME, 5 * 60_000);
  assert.equal(normalizeCatalogQuery("  Daft   Punk  "), "Daft   Punk");
  assert.deepEqual(catalogSearchKey("track", "  Daft Punk "), catalogSearchKey("track", "Daft Punk"));
  assert.notDeepEqual(catalogSearchKey("track", "Duet"), catalogSearchKey("track", "duet"));
  assert.notDeepEqual(catalogSearchKey("track", "Daft  Punk"), catalogSearchKey("track", "Daft Punk"));
});

test("switching an observer to empty key on preparing/tab-switch aborts unshared in-flight search immediately", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const observer = new QueryObserver(client, { ...searchTracksOptions("Queen"), enabled: true });
  const unsub = observer.subscribe(() => {});
  assert.equal(signal.aborted, false);
  // Mirrors SearchPage / CommandPalette / PlaylistQuickAdd / PartySearch detaching on preparing or tab switch.
  observer.setOptions({ ...searchTracksOptions(""), enabled: false });
  assert.equal(signal.aborted, true);
  unsub();
});

test("HTTP 429 search errors are never auto-retried and preserve Retry-After metadata", async (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
  t.after(() => client.clear());
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count += 1;
    return Response.json(
      { detail: "Deezer rate limit reached. Retry after 6s." },
      { status: 429, headers: { "Retry-After": "6" } },
    );
  });
  await assert.rejects(client.fetchQuery(searchTracksOptions("Queen")), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSec, 6);
    return true;
  });
  assert.equal(count, 1);
});
