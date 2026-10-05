import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/api") {
      return nextResolve(new URL("../src/lib/api.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const {
  catalogSearchKey,
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
