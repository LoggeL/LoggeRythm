import assert from "node:assert/strict";
import test from "node:test";
import { rememberSearch } from "../src/app/search/history.ts";

test("search history uses the submitted text and moves repeated terms to the front", () => {
  const history = ["old query", "artist", "album"];
  assert.deepEqual(rememberSearch(history, "  current query  "), ["current query", ...history]);
  assert.deepEqual(rememberSearch(history, " artist "), ["artist", "old query", "album"]);
  assert.deepEqual(history, ["old query", "artist", "album"]);
});

test("cleared search does not repopulate history and recent entries stay bounded", () => {
  const empty = [];
  assert.equal(rememberSearch(empty, "  "), empty);
  const history = Array.from({ length: 8 }, (_, index) => `term ${index}`);
  assert.deepEqual(rememberSearch(history, "new term"), ["new term", ...history.slice(0, 7)]);
});
