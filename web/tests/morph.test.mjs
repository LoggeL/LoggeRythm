import assert from "node:assert/strict";
import test from "node:test";
import { compileSource } from "./support/compile.mjs";

// The module keeps one ticket per page load, so every test imports a fresh copy.
const source = await compileSource("src/lib/morph.ts", {}, "morph");
let copy = 0;
const load = () => import(`${source}#${copy++}`);

const seed = { title: "Neonregen", cover: "neon.jpg" };

test("a card's name is fixed by the page it opens and the list it sits in", async () => {
  const { morphName } = await load();
  const name = morphName("art", "/album/5000", "Neue Alben");

  assert.match(name, /^[A-Za-z][A-Za-z0-9_-]*$/, "usable as a CSS identifier");
  assert.equal(morphName("art", "/album/5000?from=home#top", "Neue Alben"), name);
  assert.equal(morphName("art", "/album/5000/", "Neue Alben"), name);
  // The same album in a second shelf, another album and the title each get their own name.
  assert.notEqual(morphName("art", "/album/5000", "Diskografie"), name);
  assert.notEqual(morphName("art", "/album/5001", "Neue Alben"), name);
  assert.notEqual(morphName("title", "/album/5000", "Neue Alben"), name);
  // Characters that are replaced must not make two different pages collide.
  assert.notEqual(morphName("art", "/mix/a b", ""), morphName("art", "/mix/a_b", ""));
});

test("the hero takes the opening card's name only while its page is being opened", async () => {
  const { armMorph, morphName, morphSeedFor, morphTargetName, settleMorph } = await load();
  settleMorph("/genre");
  assert.equal(morphTargetName("art", "/album/5000"), null, "not opened from a card");

  armMorph("/album/5000", "Neue Alben", "/genre", seed);
  assert.equal(morphTargetName("art", "/album/5000"), morphName("art", "/album/5000", "Neue Alben"));
  assert.equal(morphTargetName("title", "/album/5000"), morphName("title", "/album/5000", "Neue Alben"));
  assert.equal(morphTargetName("art", "/album/5001"), null);
  assert.equal(morphSeedFor("/album/5000"), seed);
  assert.equal(morphSeedFor("/album/5001"), null);

  // An effect of the page the card is on may still run before the navigation shows.
  settleMorph("/genre");
  assert.equal(morphTargetName("art", "/album/5000"), morphName("art", "/album/5000", "Neue Alben"));

  // Shown: a hero mounted from now on (the loaded page replacing its
  // placeholder) is unnamed, but the placeholder can still draw the seed.
  settleMorph("/album/5000");
  assert.equal(morphTargetName("art", "/album/5000"), null);
  assert.equal(morphSeedFor("/album/5000"), seed);
});

test("the ticket ends once the visitor is somewhere else", async () => {
  const { armMorph, morphSeedFor, settleMorph, subscribeMorph } = await load();
  let notifications = 0;
  const unsubscribe = subscribeMorph(() => notifications++);

  armMorph("/album/5000", "", "/genre", seed);
  settleMorph("/album/5000");
  settleMorph("/genre");
  assert.equal(morphSeedFor("/album/5000"), seed, "kept on the page it was issued on");

  const before = notifications;
  settleMorph("/library");
  assert.equal(morphSeedFor("/album/5000"), null);
  assert.equal(notifications, before + 1, "subscribers learn that the seed is gone");

  unsubscribe();
  armMorph("/album/5000", "", "/genre", seed);
  assert.equal(notifications, before + 1, "no notification after unsubscribing");
});

test("a page reached with Back or Forward is marked until the next navigation", async () => {
  const { isTraversal, noteTraversal, settleMorph } = await load();
  settleMorph("/album/5000");

  noteTraversal("/genre");
  assert.equal(isTraversal("/genre"), true);
  assert.equal(isTraversal("/album/5000"), false);
  settleMorph("/genre");
  assert.equal(isTraversal("/genre"), true, "still the page that was traversed to");

  settleMorph("/library");
  assert.equal(isTraversal("/genre"), false, "a link navigation ends it");

  // Moving through the history of one page (search or library tabs) replaces nothing.
  noteTraversal("/library");
  assert.equal(isTraversal("/library"), false);
});
