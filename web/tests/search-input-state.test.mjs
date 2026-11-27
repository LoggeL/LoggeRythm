import assert from "node:assert/strict";
import test from "node:test";
import { createSearchInput, searchInputReducer as reduce } from "../src/lib/searchInputModel.ts";
import { readSearchLocation, searchHref } from "../src/lib/searchState.ts";

test("typed drafts cannot activate results belonging to the previous term", () => {
  let state = createSearchInput("Portishead");
  state = reduce(state, { type: "input", value: "Massive Attack" });
  assert.equal(state.query, "Portishead");
  assert.notEqual(state.input.trim(), state.query);
  state = reduce(state, { type: "debounce", expected: "Massive Attack" });
  assert.equal(state.query, "Massive Attack");
});

test("an old debounce cannot resurrect a cleared or newer query", () => {
  let state = reduce(createSearchInput(""), { type: "input", value: "Portishead" });
  state = reduce(state, { type: "clear" });
  state = reduce(state, { type: "debounce", expected: "Portishead" });
  assert.equal(state.query, "");
  state = reduce(state, { type: "input", value: "Roads" });
  assert.equal(reduce(state, { type: "debounce", expected: "Portishead" }), state);
});

test("Enter commits current text immediately, preserving the draft spelling", () => {
  let state = reduce(createSearchInput(""), { type: "input", value: "  AC/DC & Friends  " });
  state = reduce(state, { type: "submit" });
  assert.equal(state.query, "AC/DC & Friends");
  assert.equal(state.input, "  AC/DC & Friends  ");
});

test("URL acknowledgement preserves typing newer than the committed query", () => {
  let state = createSearchInput("Portishead", "/search");
  state = reduce(state, { type: "input", value: "Road" });
  state = reduce(state, { type: "submit" });
  state = reduce(state, { type: "input", value: "Roads" });
  state = reduce(state, { type: "source", source: "Road", scope: "/search" });
  assert.equal(state.input, "Roads");
  assert.equal(state.query, "Road");
  assert.equal(state.source, "Road");
});

test("Back to another search restores its query instead of retaining a draft", () => {
  let state = reduce(createSearchInput("Roads", "/search"), { type: "input", value: "unfinished" });
  state = reduce(state, { type: "source", source: "Portishead", scope: "/search" });
  assert.equal(state.input, "Portishead");
  assert.equal(state.query, "Portishead");
});

test("entering search acknowledges the committed term without losing newer typing", () => {
  let state = reduce(createSearchInput("", "/"), { type: "input", value: "Road" });
  state = reduce(state, { type: "submit" });
  state = reduce(state, { type: "input", value: "Roads" });
  state = reduce(state, { type: "source", source: "Road", scope: "/search" });
  assert.equal(state.input, "Roads");
  assert.equal(state.query, "Road");
  assert.equal(state.scope, "/search");
});

test("leaving the search scope discards pending input even for an empty URL query", () => {
  let state = reduce(createSearchInput("", "/search"), { type: "input", value: "unfinished" });
  state = reduce(state, { type: "source", source: "", scope: "/artist/1069" });
  assert.equal(state.input, "");
  state = reduce(state, { type: "debounce", expected: "unfinished" });
  assert.equal(state.query, "");
});

test("IME composition prevents partial search requests until composition ends", () => {
  let state = reduce(createSearchInput(""), { type: "composing", value: true });
  state = reduce(state, { type: "input", value: "東京" });
  assert.equal(reduce(state, { type: "debounce", expected: "東京" }), state);
  state = reduce(state, { type: "composing", value: false });
  state = reduce(state, { type: "debounce", expected: "東京" });
  assert.equal(state.query, "東京");
});

test("search URLs roundtrip special characters, entity and track sorting", () => {
  const state = { query: "AC/DC & Björk + 東京", tab: "track", sort: "dur-desc" };
  const href = searchHref(state);
  assert.equal(href.startsWith("/search?q="), true);
  assert.deepEqual(readSearchLocation(new URL(href, "https://example.test").searchParams), state);
  assert.equal(searchHref({ query: "  " }), "/search");
});

test("unknown URL filters use the visible default controls", () => {
  assert.deepEqual(readSearchLocation(new URLSearchParams("q=Roads&type=unknown&sort=unknown")), {
    query: "Roads", tab: "all", sort: "relevance",
  });
});

test("stale internal URL acknowledgement (63 -> 71 -> 72) never clobbers newer draft or newer commit", () => {
  // Case A: URL=63 -> debounce 71 -> user types 72 (uncommitted) -> async URL ack 71 arrives.
  let state = createSearchInput("Search fixture 63", "/search");
  state = reduce(state, { type: "input", value: "Search fixture 71" });
  state = reduce(state, { type: "debounce", expected: "Search fixture 71" });
  state = reduce(state, { type: "input", value: "Search fixture 72" });
  state = reduce(state, { type: "source", source: "Search fixture 71", scope: "/search" });
  assert.equal(state.input, "Search fixture 72");
  assert.equal(state.query, "Search fixture 71");
  assert.equal(state.source, "Search fixture 71");
  state = reduce(state, { type: "debounce", expected: "Search fixture 72" });
  assert.equal(state.query, "Search fixture 72");

  // Case B: URL=63 -> commit 71 -> user types AND commits 72 before async URL ack 71 arrives.
  let fast = createSearchInput("Search fixture 63", "/search");
  fast = reduce(fast, { type: "input", value: "Search fixture 71" });
  fast = reduce(fast, { type: "debounce", expected: "Search fixture 71" });
  fast = reduce(fast, { type: "input", value: "Search fixture 72" });
  fast = reduce(fast, { type: "submit" });
  assert.equal(fast.query, "Search fixture 72");
  // Delayed URL ack for 71 arrives after 72 already committed.
  fast = reduce(fast, { type: "source", source: "Search fixture 71", scope: "/search" });
  assert.equal(fast.input, "Search fixture 72");
  assert.equal(fast.query, "Search fixture 72");
  assert.equal(fast.source, "Search fixture 71");
  // Final URL ack for 72 arrives and drains pending acks.
  fast = reduce(fast, { type: "source", source: "Search fixture 72", scope: "/search" });
  assert.equal(fast.input, "Search fixture 72");
  assert.equal(fast.query, "Search fixture 72");
  assert.deepEqual(fast.pending, []);

  // Once acks are drained, a genuine external navigation to an older term still replaces a draft.
  fast = reduce(fast, { type: "input", value: "unfinished draft" });
  fast = reduce(fast, { type: "source", source: "Search fixture 71", scope: "/search" });
  assert.equal(fast.input, "Search fixture 71");
  assert.equal(fast.query, "Search fixture 71");
});
