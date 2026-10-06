import assert from "node:assert/strict";
import test from "node:test";
import { movePaletteSelection, paletteRows, paletteRowKey, paletteSelectedIndex } from "../src/components/commandPaletteModel.ts";

test("quick search orders all four entities and keeps compact limits", () => {
  const tracks = Array.from({ length: 10 }, (_, index) => ({ id: String(index) }));
  const artists = Array.from({ length: 5 }, (_, index) => ({ id: String(index) }));
  const albums = Array.from({ length: 5 }, (_, index) => ({ id: String(index), album_id: `album-${index}` }));
  const playlists = Array.from({ length: 5 }, (_, index) => ({ id: String(index) }));
  const rows = paletteRows({ tracks, artists, albums, playlists });
  assert.deepEqual(rows.map((row) => row.kind), [
    ...Array(6).fill("track"), ...Array(3).fill("artist"), ...Array(3).fill("album"), ...Array(3).fill("playlist"),
  ]);
  assert.equal(new Set(rows.map(paletteRowKey)).size, 15);
  assert.equal(paletteRowKey(rows[9]), "album-album-0");
});

test("late source responses preserve the selected entity ID instead of its index", () => {
  const artists = [{ id: "Queen", name: "Queen" }];
  const first = paletteRows({ artists });
  const selected = paletteRowKey(first[0]);
  const later = paletteRows({ tracks: [{ id: "song" }], artists });
  assert.equal(paletteSelectedIndex(later, selected), 1);
  assert.equal(paletteSelectedIndex(later, "artist-vanished"), -1);
});

test("arrows are bounded and an obsolete selection resumes at the next list edge", () => {
  const rows = paletteRows({ tracks: [{ id: "one" }, { id: "two" }] });
  assert.equal(movePaletteSelection([], null, 1), null);
  assert.equal(movePaletteSelection(rows, null, 1), "track-two");
  assert.equal(movePaletteSelection(rows, "track-one", -1), "track-one");
  assert.equal(movePaletteSelection(rows, "track-two", 1), "track-two");
  assert.equal(movePaletteSelection(rows, "track-missing", -1), "track-two");
  assert.equal(movePaletteSelection(rows, "track-missing", 1), "track-one");
});

test("duplicate projections never render duplicate option IDs", () => {
  const rows = paletteRows({ tracks: [{ id: "one" }, { id: "one" }], albums: [{ id: "projection-one", album_id: "album" }, { id: "projection-two", album_id: "album" }] });
  assert.deepEqual(rows.map(paletteRowKey), ["track-one", "album-album"]);
});
