import assert from "node:assert/strict";
import test from "node:test";
import { foldSearchText, indexLibraryTracks, matchLibraryTracks, withoutTracks } from "../src/lib/libraryMatch.ts";

const track = (id, title, artist, album = "", artists) => ({ id, title, artist, album, ...(artists ? { artists } : {}) });
const ids = (tracks) => tracks.map(({ id }) => id);
const search = (tracks, input) => ids(matchLibraryTracks(indexLibraryTracks(tracks), input));

test("text is compared without case, diacritics, apostrophes or punctuation", () => {
  assert.equal(foldSearchText("  Beyoncé — DÉJÀ  Vu "), "beyonce deja vu");
  assert.equal(foldSearchText("Straße / Søren Æbler"), "strasse soren aebler");
  assert.equal(foldSearchText("Don’t Stop (Live)"), "dont stop live");
  assert.equal(foldSearchText("AC/DC"), "ac dc");
  assert.equal(foldSearchText("…?!"), "");
});

test("a saved song is found by title, any credited artist or album, whatever the spelling", () => {
  const library = [
    track("1", "Déjà Vu", "Beyoncé", "B’Day", [{ id: 1, name: "Beyoncé" }, { id: 2, name: "JAY-Z" }]),
    track("2", "Über den Wolken", "Reinhard Mey", "Wie vor Jahr und Tag"),
    track("3", "Don't Stop Me Now", "Queen", "Jazz"),
  ];
  assert.deepEqual(search(library, "deja vu"), ["1"]);
  assert.deepEqual(search(library, "DÉJÀ"), ["1"]);
  assert.deepEqual(search(library, "jay z"), ["1"], "a featured artist counts");
  assert.deepEqual(search(library, "bday"), ["1"], "the album counts");
  assert.deepEqual(search(library, "uber wolken"), ["2"]);
  assert.deepEqual(search(library, "dont stop"), ["3"]);
  assert.deepEqual(search(library, "  queen   jazz "), ["3"], "words may come from different fields");
});

test("every word of the input has to occur", () => {
  const library = [track("1", "Teardrop", "Massive Attack", "Mezzanine"), track("2", "Angel", "Massive Attack", "Mezzanine")];
  assert.deepEqual(search(library, "massive tear"), ["1"]);
  assert.deepEqual(search(library, "massive portishead"), []);
  assert.deepEqual(search(library, "attack mezz"), ["1", "2"]);
});

test("input without a letter or digit matches nothing", () => {
  const library = [track("1", "Teardrop", "Massive Attack")];
  for (const input of ["", "   ", "’", "?!"]) assert.deepEqual(search(library, input), []);
});

test("exact titles lead, then title prefixes, title words, other title hits, artists and the rest", () => {
  const library = [
    track("album", "Intro", "Someone", "Queen of the Night"),
    track("artist", "Bohemian Rhapsody", "Queen"),
    track("inside", "Mcqueen", "Other"),
    track("word", "Killer Queen", "Other"),
    track("prefix", "Queen of Hearts", "Other"),
    track("exact", "Queen", "Other"),
  ];
  assert.deepEqual(search(library, "queen"), ["exact", "prefix", "word", "inside", "artist", "album"]);
});

test("equally good matches keep the order of the library", () => {
  const library = [track("b", "Blue Monday", "New Order"), track("a", "Blue in Green", "Miles Davis"), track("c", "Blue Train", "John Coltrane")];
  assert.deepEqual(search(library, "blue"), ["b", "a", "c"]);
  assert.deepEqual(search(library, "blue t"), ["c"]);
});

test("a song saved in several places is indexed once, at its first position", () => {
  const liked = track("7", "Roads", "Portishead", "Dummy");
  const fromPlaylist = track(7, "Roads", "Portishead", "Dummy");
  const index = indexLibraryTracks([liked, track("8", "Glory Box", "Portishead", "Dummy"), fromPlaylist]);
  assert.equal(index.length, 2);
  const matches = matchLibraryTracks(index, "portishead");
  assert.deepEqual(ids(matches), ["7", "8"]);
  assert.equal(matches[0], liked, "matches are the original track objects");
});

test("tracks shown in the library are removed from catalog results without reordering the rest", () => {
  const catalog = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];
  assert.deepEqual(ids(withoutTracks(catalog, [{ id: 3 }, { id: "1" }])), ["2", "4"]);
  assert.equal(withoutTracks(catalog, []), catalog);
  assert.equal(withoutTracks(catalog, [{ id: "9" }]), catalog, "nothing removed keeps the same list");
  assert.deepEqual(ids(catalog), ["1", "2", "3", "4"]);
});
