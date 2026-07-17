import assert from "node:assert/strict";
import test from "node:test";
import {
  trackArtistCredits,
  trackArtistLabel,
} from "../src/lib/trackArtists.ts";

test("artist display preserves every ordered performer credit", () => {
  const track = {
    artist: "Primary",
    artist_id: "1",
    artists: [
      { id: "1", name: "Primary" },
      { id: "2", name: "Guest" },
      { id: "3", name: "Producer" },
    ],
  };

  assert.equal(trackArtistCredits(track), track.artists);
  assert.equal(trackArtistLabel(track), "Primary, Guest, Producer");
});

test("legacy empty credit lists use the explicit primary performer", () => {
  const track = { artist: "Primary", artist_id: "1", artists: [] };

  assert.deepEqual(trackArtistCredits(track), [
    { id: "1", name: "Primary" },
  ]);
  assert.equal(trackArtistLabel(track), "Primary");
});
