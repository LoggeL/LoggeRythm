import assert from "node:assert/strict";
import test from "node:test";
import {
  findLikedTrack,
  getLikedTrackIndex,
  isSameRecording,
  isTrackLiked,
  normalizeIsrc,
  trackLikeIdentityKey,
} from "../src/lib/trackIdentity.ts";
import { indexLibraryTracks, withoutTracks } from "../src/lib/libraryMatch.ts";

test("normalizeIsrc strips punctuation, uppercases, and rejects placeholders", () => {
  assert.equal(normalizeIsrc("us-wb1-24-03464"), "USWB12403464");
  assert.equal(normalizeIsrc("  gbdhc2017801 "), "GBDHC2017801");
  assert.equal(normalizeIsrc(""), "");
  assert.equal(normalizeIsrc(null), "");
  assert.equal(normalizeIsrc("000000000000"), "");
});

test("cross-release like matching shares heart state across Single, EP, and Album via ISRC", () => {
  const albumTrack = {
    id: "3068802261",
    title: "The Emptiness Machine",
    artist: "Linkin Park",
    album: "From Zero",
    duration_sec: 190,
    isrc: "USWB12403464",
  };
  const singleTrack = {
    id: "2978105041",
    title: "The Emptiness Machine",
    artist: "Linkin Park",
    album: "The Emptiness Machine",
    duration_sec: 190,
    isrc: "us-wb1-24-03464",
  };
  const liveTrack = {
    id: "4175528112",
    title: "The Emptiness Machine (Live)",
    artist: "Linkin Park",
    album: "Live",
    duration_sec: 195,
    isrc: "USWB12601056",
  };

  const likes = [albumTrack];
  const index = getLikedTrackIndex(likes);
  assert.equal(getLikedTrackIndex(likes), index, "WeakMap caches one index per array");
  assert.equal(isTrackLiked(index, singleTrack), true);
  assert.equal(findLikedTrack(index, singleTrack), albumTrack);
  assert.equal(isTrackLiked(index, liveTrack), false);
  assert.equal(trackLikeIdentityKey(singleTrack), trackLikeIdentityKey(albumTrack));
  assert.notEqual(trackLikeIdentityKey(liveTrack), trackLikeIdentityKey(albumTrack));
});

test("ISRC-less fallback matches folded artist+title within 3s and never bridges distinct ISRCs", () => {
  const legacyLike = {
    id: "100",
    title: "Über den Wolken",
    artist: "Reinhard Mey",
    duration_sec: 210,
    isrc: "",
  };
  const albumCopy = {
    id: "200",
    title: "Uber den Wolken!",
    artist: "reinhard mey",
    duration_sec: 212,
    isrc: "",
  };
  const longLive = {
    id: "300",
    title: "Über den Wolken",
    artist: "Reinhard Mey",
    duration_sec: 260,
    isrc: "",
  };
  const distinctIsrcA = { ...legacyLike, id: "400", isrc: "DE1111111111" };
  const distinctIsrcB = { ...albumCopy, id: "500", isrc: "DE2222222222" };

  assert.equal(isSameRecording(legacyLike, albumCopy), true);
  assert.equal(isSameRecording(legacyLike, longLive), false);
  assert.equal(isSameRecording(distinctIsrcA, distinctIsrcB), false);
});

test("library search index and catalog subtraction deduplicate cross-release ISRCs", () => {
  const likedAlbum = {
    id: "3068802261",
    title: "The Emptiness Machine",
    artist: "Linkin Park",
    album: "From Zero",
    isrc: "USWB12403464",
  };
  const playlistSingle = {
    id: "2978105041",
    title: "The Emptiness Machine",
    artist: "Linkin Park",
    album: "The Emptiness Machine",
    isrc: "USWB12403464",
  };
  const liveTrack = {
    id: "4175528112",
    title: "The Emptiness Machine (Live)",
    artist: "Linkin Park",
    album: "Live",
    isrc: "USWB12601056",
  };

  const entries = indexLibraryTracks([likedAlbum, playlistSingle, liveTrack]);
  assert.deepEqual(entries.map((entry) => entry.track.id), ["3068802261", "4175528112"]);

  const filtered = withoutTracks([playlistSingle, liveTrack], [likedAlbum]);
  assert.deepEqual(filtered.map((track) => track.id), ["4175528112"]);
});
