import assert from "node:assert/strict";
import test from "node:test";
import {
  artistSongQuery,
  isArtistTrack,
} from "../src/components/artistSearchModel.ts";

test("artist song query uses literal quoted terms and trims their outer whitespace", () => {
  assert.equal(artistSongQuery("  Queen  ", "  Radio Ga Ga  "), '"Queen" "Radio Ga Ga"');
});

test("quotes and backslashes cannot escape artist or song search terms", () => {
  assert.equal(
    artistSongQuery('Artist\\" OR artist:"Other', 'Song\\" OR track:"Other'),
    '"Artist\\\\\\" OR artist:\\"Other" "Song\\\\\\" OR track:\\"Other"',
  );
});

test("Portishead Roads uses the query proven against real public provider data", () => {
  assert.equal(artistSongQuery("Portishead", "Roads"), '"Portishead" "Roads"');
  assert.equal(artistSongQuery("Guns N' Roses", "Sweet Child"), '"Guns N\' Roses" "Sweet Child"');
  assert.equal(isArtistTrack({artist: "Portishead", artist_id: "1069"}, "1069", "Portishead"), true);
  assert.equal(isArtistTrack({artist: "Mike Batt", artist_id: "159687"}, "1069", "Portishead"), false);
});

test("artist song query rejects empty required search values", () => {
  assert.throws(() => artistSongQuery(" \t ", "Song"), /Artist name must not be empty/);
  assert.throws(() => artistSongQuery("Artist", " \n "), /Song query must not be empty/);
});

test("primary and credited performer IDs match after string normalization", () => {
  assert.equal(isArtistTrack({ artist: "Primary", artist_id: 27 }, " 27 ", "Other name"), true);
  assert.equal(isArtistTrack({ artist: "Primary", artist_id: "1", artists: [{ id: " 27 ", name: "Guest" }] }, 27, "Guest"), true);
});

test("a known different ID rejects a same-name result", () => {
  assert.equal(isArtistTrack({ artist: "Queen", artist_id: "1" }, "2", "Queen"), false);
  assert.equal(isArtistTrack({ artist: "Queen", artists: [{ id: "1", name: "Queen" }] }, "2", "Queen"), false);
  assert.equal(isArtistTrack({ artist: "Queen", artist_id: "1", artists: [{ id: "", name: "Queen" }] }, "2", "Queen"), false);
});

test("an invalid target ID cannot trigger name matching against known IDs", () => {
  assert.equal(isArtistTrack({ artist: "Queen", artist_id: "1" }, "", "Queen"), false);
  assert.equal(isArtistTrack({ artist: "Queen", artist_id: "1" }, 0, "Queen"), false);
});

test("legacy performer names match exactly with Unicode normalization and case folding", () => {
  assert.equal(isArtistTrack({ artist: "  QUEEN  " }, "27", " Queen "), true);
  assert.equal(isArtistTrack({ artist: "Beyonce\u0301" }, "27", "BEYONCÉ"), true);
  assert.equal(isArtistTrack({ artist: "ＱＵＥＥＮ" }, "27", "Queen"), true);
  assert.equal(isArtistTrack({ artist: "Primary", artists: [{ id: "", name: "Queen" }] }, "27", "queen"), true);
});

test("artist names never match another performer's substring", () => {
  assert.equal(isArtistTrack({ artist: "Queen Bee" }, "27", "Queen"), false);
  assert.equal(isArtistTrack({ artist: "The Queen" }, "27", "Queen"), false);
  assert.equal(isArtistTrack({ artist: "", artists: [{ id: "", name: "Queen Bee" }] }, "27", "Queen"), false);
});

test("missing, zero, non-finite and empty IDs allow exact legacy name matching", () => {
  for (const id of [undefined, "", " \t ", "0", 0, -1, Infinity, NaN]) {
    assert.equal(isArtistTrack({ artist: "Queen", artist_id: id }, "27", "Queen"), true);
  }
});

test("name-only metadata requires a nonempty target artist name", () => {
  assert.throws(() => isArtistTrack({ artist: "Queen" }, "27", " \t "), /Artist name must not be empty/);
  assert.equal(isArtistTrack({ artist: "Queen", artist_id: "27" }, "27", ""), true);
});
