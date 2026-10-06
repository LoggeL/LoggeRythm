import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { decodeSearchArtists, decodeSearchPlaylists, decodeSearchTracks } from "../src/lib/searchDecoders.ts";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/searchDecoders") {
      return nextResolve(new URL("../src/lib/searchDecoders.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { api, ApiError } = await import("../src/lib/api.ts");
resolver.deregister();

test("search decoders retain real album projection, optional metadata and provider order", () => {
  const albums = [
    { id: "109301", title: "Dummy", album: "Dummy", album_id: 109301, artist: "Portishead", cover: "", duration_sec: 0, preview_url: null },
    { id: "109457", title: "Portishead", album: "Portishead", album_id: "109457", artist: "Portishead", cover: "https://example.test/cover.jpg", duration_sec: 0, preview_url: null },
  ];
  assert.equal(decodeSearchTracks(albums), albums);
  const tracks = [{ id: "1", title: "Teardrop", artist_id: "", album_id: "", artists: [{ id: "", name: "Guest" }, { name: "Unnamed ID" }], loudness_gain_db: null }];
  assert.equal(decodeSearchTracks(tracks), tracks);
  const artists = [{ id: 1069, name: "Portishead" }];
  assert.equal(decodeSearchArtists(artists), artists);
  const playlists = [{ id: "10872088202", title: "100% Portishead", track_count: 0 }];
  assert.equal(decodeSearchPlaylists(playlists), playlists);
});

test("a genuine empty result remains a valid response for each search type", () => {
  for (const decode of [decodeSearchTracks, decodeSearchArtists, decodeSearchPlaylists]) {
    assert.deepEqual(decode([]), []);
  }
});

test("malformed containers and entities fail at their exact result path", () => {
  for (const decode of [decodeSearchTracks, decodeSearchArtists, decodeSearchPlaylists]) {
    for (const payload of [null, {}, { data: [] }, "", 3]) {
      assert.throws(() => decode(payload), /results muss eine Liste/);
    }
    for (const payload of [[null], [[]], ["broken"]]) {
      assert.throws(() => decode(payload), /results\[0\] muss ein Objekt/);
    }
  }
});

test("required search identities and labels are never accepted as placeholders", () => {
  for (const id of [undefined, null, "", "abc", "0", "-1", " 42 ", true, 0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => decodeSearchArtists([{ id, name: "Portishead" }]), /results\[0\]\.id/);
  }
  assert.throws(() => decodeSearchTracks([{ id: 42, title: "Song" }]), /results\[0\]\.id/);
  for (const title of [undefined, null, 7, "", " \t "]) {
    assert.throws(() => decodeSearchTracks([{ id: "1", title }]), /results\[0\]\.title/);
    assert.throws(() => decodeSearchPlaylists([{ id: 1, title }]), /results\[0\]\.title/);
    assert.throws(() => decodeSearchArtists([{ id: 1, name: title }]), /results\[0\]\.name/);
  }
});

test("supplied search metadata and performer credits are validated", () => {
  for (const [field, value] of [
    ["artist", {}], ["album", null], ["cover", 9], ["release_date", false],
    ["artist_id", "broken"], ["album_id", null], ["duration_sec", -1],
    ["rank", 1.5], ["preview_url", {}], ["loudness_gain_db", Infinity],
    ["artists", null], ["artists", [{ id: 1, name: null }]],
    ["artists", [{ id: "invalid", name: "Name" }]],
  ]) {
    assert.throws(() => decodeSearchTracks([{ id: "1", title: "Song", [field]: value }]), new RegExp(`results\\[0\\]\\.${field}`));
  }
  assert.throws(() => decodeSearchArtists([{ id: 1, name: "Artist", picture: false }]), /\.picture/);
  for (const track_count of [undefined, -1, 1.5, "2", true, NaN]) {
    assert.throws(() => decodeSearchPlaylists([{ id: 1, title: "Playlist", track_count }]), /\.track_count/);
  }
});

test("API search rejects malformed success JSON with endpoint context and cause", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [] }));
  await assert.rejects(api.search("Portishead", "album"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.match(error.message, /API \/search\?q=Portishead&type=album: Ungültige Suchantwort: results/);
    assert.match(error.cause.message, /results muss eine Liste/);
    return true;
  });
  globalThis.fetch.mock.mockImplementation(async () => Response.json([{ id: "1", name: "Artist", picture: null }]));
  await assert.rejects(api.searchArtists("Portishead"), /\/search\/artist.*results\[0\]\.picture/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json([{ id: "1", title: "Playlist", track_count: "40" }]));
  await assert.rejects(api.searchPlaylists("Portishead"), /\/search\/playlist.*results\[0\]\.track_count/);
});

test("API validation preserves HTTP provider errors and search cancellation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: "Public Deezer album search: invalid data" }, { status: 502 }));
  await assert.rejects(api.search("Portishead", "album"), (error) => error instanceof ApiError && error.status === 502 && /invalid data/.test(error.message));
  const controller = new AbortController();
  globalThis.fetch.mock.mockImplementation(async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const rejection = assert.rejects(api.searchArtists("Portishead", controller.signal), { name: "AbortError" });
  controller.abort();
  await rejection;
});
