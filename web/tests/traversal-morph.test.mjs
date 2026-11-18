import assert from "node:assert/strict";
import test from "node:test";
import { compileSource } from "./support/compile.mjs";

// The module keeps its bookkeeping per page load, so every test imports a fresh copy.
const morph = await compileSource("src/lib/morph.ts", {}, "traversal morph");
const source = await compileSource("src/lib/traversalMorph.ts", { "@/lib/morph": morph }, "traversal morph");
let copy = 0;
const load = () => import(`${source}#${copy++}`);

const card = { path: "/album/5000", scope: "Neue Alben" };
const home = { key: "e1", path: "/" };
const album = { key: "e2", path: "/album/5000" };

test("Back from a detail page pairs its hero with the card that opened it, Forward the other way round", async () => {
  const { armOpening, noteEntryChange, traversalPair } = await load();
  armOpening("e1", "/album/5000?from=home", "Neue Alben");
  noteEntryChange("push", "e1", "e2", "/album/5000");

  assert.deepEqual(traversalPair(album, home), { card, hero: "old" }, "Back: the hero is on the page being left");
  assert.deepEqual(traversalPair(home, album), { card, hero: "new" }, "Forward: the hero is on the page that appears");
  // The search writes its query into the URL of the entry it is on; the entry stays the same one.
  noteEntryChange("replace", "e1", "e1", "/");
  assert.deepEqual(traversalPair(album, home), { card, hero: "old" });
});

test("every history entry remembers its own card, however far the history is walked", async () => {
  const { armOpening, noteEntryChange, traversalPair } = await load();
  // Home -> album (shelf A) -> artist (card on the album page) -> Back, Back, then the same album from shelf B.
  armOpening("e1", "/album/5000", "Neue Alben");
  noteEntryChange("push", "e1", "e2", "/album/5000");
  armOpening("e2", "/artist/100", "");
  noteEntryChange("push", "e2", "e3", "/artist/100");
  const artist = { key: "e3", path: "/artist/100" };

  assert.deepEqual(traversalPair(artist, album), { card: { path: "/artist/100", scope: "" }, hero: "old" });
  assert.deepEqual(traversalPair(album, home), { card, hero: "old" });
  assert.equal(traversalPair(artist, home), null, "two steps at once: the artist was not opened from the home page");

  noteEntryChange("traverse", "e3", "e2", "/album/5000");
  noteEntryChange("traverse", "e2", "e1", "/");
  armOpening("e1", "/album/5000", "Empfohlen");
  noteEntryChange("push", "e1", "e4", "/album/5000");
  assert.deepEqual(traversalPair({ key: "e4", path: "/album/5000" }, home), { card: { path: "/album/5000", scope: "Empfohlen" }, hero: "old" });
  assert.deepEqual(traversalPair(album, home), { card, hero: "old" }, "the older entry keeps the card it was opened from");
});

test("without a matching card click there is no pair", async () => {
  const { armOpening, noteEntryChange, traversalPair } = await load();
  assert.equal(traversalPair(album, home), null, "nothing known, as after a reload");

  // The click's navigation never arrived; another link was followed instead.
  armOpening("e1", "/album/5000", "Neue Alben");
  noteEntryChange("push", "e1", "e2", "/library");
  assert.equal(traversalPair({ key: "e2", path: "/library" }, home), null);
  noteEntryChange("push", "e2", "e3", "/album/5000");
  assert.equal(traversalPair({ key: "e3", path: "/album/5000" }, { key: "e2", path: "/library" }), null, "a click is used up by the next navigation");

  // A traversal in between also ends the click.
  armOpening("e3", "/artist/100", "");
  noteEntryChange("traverse", "e3", "e2", "/library");
  noteEntryChange("push", "e2", "e5", "/artist/100");
  assert.equal(traversalPair({ key: "e5", path: "/artist/100" }, { key: "e2", path: "/library" }), null);

  // The entry now shows another page (a replace navigation): its card no longer applies.
  armOpening("e1", "/album/5000", "Neue Alben");
  noteEntryChange("push", "e1", "e6", "/album/5000");
  assert.equal(traversalPair({ key: "e6", path: "/playlist/1" }, home), null);
  assert.equal(traversalPair(home, { key: "e6", path: "/playlist/1" }), null);
});

test("a traversal is animated only when nothing speaks against it", async () => {
  const { judgeTraversal } = await load();
  const facts = {
    supported: true, reducedMotion: false, uaTransition: false, routerEntry: true,
    documentVisible: true, transitionRunning: false, pageAreaFree: true, from: "/album/5000", to: "/",
  };
  assert.equal(judgeTraversal(facts), "animate");
  assert.equal(judgeTraversal({ ...facts, supported: false }), "unsupported");
  assert.equal(judgeTraversal({ ...facts, reducedMotion: true }), "reduced-motion");
  assert.equal(judgeTraversal({ ...facts, uaTransition: true }), "ua-transition", "a swipe the browser animated itself");
  assert.equal(judgeTraversal({ ...facts, routerEntry: false }), "foreign-entry", "the router reloads or ignores such an entry");
  assert.equal(judgeTraversal({ ...facts, documentVisible: false }), "hidden");
  assert.equal(judgeTraversal({ ...facts, transitionRunning: true }), "busy");
  assert.equal(judgeTraversal({ ...facts, pageAreaFree: false }), "no-page-area");
  // Moving through the history of one page (search or library tabs) replaces nothing.
  assert.equal(judgeTraversal({ ...facts, from: "/search", to: "/search/" }), "same-page");
});

test("an element travels only if nearly all of it is on screen", async () => {
  const { visibleFraction } = await load();
  const box = { left: 100, top: 100, right: 200, bottom: 200 };
  const page = { left: 0, top: 0, right: 1000, bottom: 700 };

  assert.equal(visibleFraction(box, [page]), 1);
  assert.equal(visibleFraction(box, []), 1);
  assert.equal(visibleFraction({ ...box, top: 650, bottom: 750 }, [page]), 0.5, "half below the page area");
  assert.equal(visibleFraction({ ...box, top: 800, bottom: 900 }, [page]), 0, "below the fold");
  // Inside the page area but scrolled out of its shelf.
  assert.equal(visibleFraction(box, [{ left: 300, top: 0, right: 900, bottom: 400 }, page]), 0);
  assert.equal(visibleFraction({ left: 0, top: 0, right: 0, bottom: 50 }, [page]), 0, "no size");
});
