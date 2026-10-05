import assert from "node:assert/strict";
import test from "node:test";
import { rememberSearch } from "../src/app/search/history.ts";
import { sortSearchTracks } from "../src/app/search/results.ts";

test("search history uses the submitted text and moves repeated terms to the front", () => {
  const history = ["old query", "artist", "album"];
  assert.deepEqual(rememberSearch(history, "  current query  "), [
    "current query",
    ...history,
  ]);
  assert.deepEqual(rememberSearch(history, " artist "), [
    "artist",
    "old query",
    "album",
  ]);
  assert.deepEqual(history, ["old query", "artist", "album"]);
});

test("search sorting preserves the source order used by cached queries", () => {
  const tracks = [
    { id: "one", title: "Zulu", duration_sec: 300 },
    { id: "two", title: "Alpha", duration_sec: 120 },
    { id: "three", title: "Beta", duration_sec: 200 },
  ];
  assert.equal(sortSearchTracks(tracks, "relevance"), tracks);
  assert.deepEqual(
    sortSearchTracks(tracks, "title").map((track) => track.id),
    ["two", "three", "one"],
  );
  assert.deepEqual(
    sortSearchTracks(tracks, "dur-asc").map((track) => track.id),
    ["two", "three", "one"],
  );
  assert.deepEqual(
    sortSearchTracks(tracks, "dur-desc").map((track) => track.id),
    ["one", "three", "two"],
  );
  assert.deepEqual(
    tracks.map((track) => track.id),
    ["one", "two", "three"],
  );
});

test("cleared search does not repopulate history and recent entries stay bounded", () => {
  const empty = [];
  assert.equal(rememberSearch(empty, "  "), empty);
  const history = Array.from({ length: 8 }, (_, index) => `term ${index}`);
  assert.deepEqual(rememberSearch(history, "new term"), [
    "new term",
    ...history.slice(0, 7),
  ]);
});
