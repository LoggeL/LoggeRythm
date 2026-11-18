import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { compileSource } from "./support/compile.mjs";

const fixture = { likes: { data: undefined } };
globalThis.__libraryTracksFixture = fixture;
const { cachedOwnPlaylists, ownPlaylistStore, useLibraryTracks } = await import(
  await compileSource("src/hooks/useLibraryTracks.ts", {
    react: import.meta.resolve("react"),
    "@tanstack/react-query": import.meta.resolve("@tanstack/react-query"),
    "@/hooks/useLibrary": `data:text/javascript,export const useLikes = () => globalThis.__libraryTracksFixture.likes;`,
    "@/lib/libraryMatch": new URL("../src/lib/libraryMatch.ts", import.meta.url).href,
  }, "hook"),
);

const song = (id, title) => ({ id, title, artist: "Artist", album: "Album", cover: "", duration_sec: 100 });

test("only the user's own playlists that are already loaded count as library", () => {
  const client = new QueryClient();
  const own = { id: 1, name: "Mine", is_owner: true, tracks: [song("a", "Alpha")] };
  client.setQueryData(["playlist", "1"], own);
  client.setQueryData(["playlist", "2"], { id: 2, name: "Followed", is_owner: false, tracks: [song("b", "Beta")] });
  client.setQueryData(["playlists"], [{ id: 3, name: "Not loaded", track_count: 4 }]);
  client.setQueryData(["deezer-playlist", "4"], { id: 4, name: "Catalog", tracks: [song("c", "Gamma")] });
  // An observed but never fetched playlist has no data and must not be requested.
  client.getQueryCache().build(client, { queryKey: ["playlist", "5"] });
  assert.deepEqual(cachedOwnPlaylists(client.getQueryCache()), [own]);
  assert.equal(client.isFetching(), 0);
});

test("the playlist store keeps its snapshot until an own playlist changes and reports cache changes", async () => {
  const client = new QueryClient();
  const store = ownPlaylistStore(client.getQueryCache());
  let changes = 0;
  const unsubscribe = store.subscribe(() => {
    changes += 1;
  });
  const empty = store.read();
  assert.deepEqual(empty, []);
  client.setQueryData(["search", "track", "x"], [song("s", "Search")]);
  client.setQueryData(["playlist", "2"], { id: 2, name: "Followed", is_owner: false, tracks: [] });
  await new Promise(setImmediate);
  assert.ok(changes > 0, "cache changes reach the subscriber");
  assert.equal(store.read(), empty, "unrelated cache changes keep the snapshot");
  client.setQueryData(["playlist", "1"], { id: 1, name: "Mine", is_owner: true, tracks: [song("a", "Alpha")] });
  const loaded = store.read();
  assert.deepEqual(loaded.map(({ id }) => id), [1]);
  assert.equal(store.read(), loaded);
  client.setQueryData(["playlist", "1"], { id: 1, name: "Mine", is_owner: true, tracks: [] });
  assert.notEqual(store.read(), loaded, "an edited playlist yields a new snapshot");
  client.removeQueries({ queryKey: ["playlist"] });
  assert.deepEqual(store.read(), []);
  unsubscribe();
});

test("the index lists liked songs before anything else and waits for them without inventing data", () => {
  let result;
  function Probe() {
    result = useLibraryTracks();
    return null;
  }
  const render = () => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)));
  render();
  assert.deepEqual(result.index, []);
  assert.equal(result.likes, fixture.likes);
  fixture.likes = { data: [song("x", "Liked One"), song("y", "Liked Two"), song("x", "Liked One")] };
  render();
  assert.deepEqual(result.index.map(({ track }) => track.id), ["x", "y"]);
});
