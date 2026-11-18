import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/components/artistSearchModel") {
      return nextResolve(new URL("../src/components/artistSearchModel.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { LIKED_BY_ARTIST_PREVIEW, likedTracksByArtist } = await import("../src/lib/likedByArtist.ts");
resolver.deregister();

const track = (id, artist, artist_id, artists) => ({ id, title: `Song ${id}`, artist, artist_id, artists });
const ids = (tracks) => tracks.map((entry) => entry.id);

test("liked tracks match the primary performer and every credited performer", () => {
  const likes = [
    track("a", "Queen", "27"),
    track("b", "David Bowie", "9", [{ id: "9", name: "David Bowie" }, { id: "27", name: "Queen" }]),
    track("c", "Other", "5", [{ id: "5", name: "Other" }, { id: "6", name: "Guest" }]),
    track("d", "Queen", "27", [{ id: "27", name: "Queen" }]),
  ];

  assert.deepEqual(ids(likedTracksByArtist(likes, "27", "Queen")), ["a", "b", "d"]);
});

test("artist IDs compare as strings whether they arrive as numbers or strings", () => {
  const likes = [
    track("a", "Queen", 27),
    track("b", "Guest", "1", [{ id: "1", name: "Guest" }, { id: 27, name: "Queen" }]),
    track("c", "Other", 270),
  ];

  assert.deepEqual(ids(likedTracksByArtist(likes, 27, "Queen")), ["a", "b"]);
  assert.deepEqual(ids(likedTracksByArtist(likes, "27", "Queen")), ["a", "b"]);
});

test("the likes order is kept, so the most recently liked song stays first", () => {
  const likes = [track("newest", "Queen", "27"), track("skip", "Other", "5"), track("middle", "Queen", "27"), track("oldest", "Queen", "27")];
  const liked = likedTracksByArtist(likes, "27", "Queen");

  assert.deepEqual(ids(liked), ["newest", "middle", "oldest"]);
  assert.equal(liked[0], likes[0], "tracks are passed through, not copied");
  assert.deepEqual(ids(likes), ["newest", "skip", "middle", "oldest"], "the likes list is not mutated");
});

test("a same-name artist with a different known ID is not this artist", () => {
  const likes = [track("a", "Queen", "1"), track("b", "Queen", "", [{ id: "1", name: "Queen" }])];

  assert.deepEqual(likedTracksByArtist(likes, "27", "Queen"), []);
});

test("likes stored without any performer ID match by exact name", () => {
  const likes = [track("legacy", "  QUEEN ", "", [{ id: "", name: "Queen" }]), track("other", "Queens of the Stone Age", "")];

  assert.deepEqual(ids(likedTracksByArtist(likes, "27", "Queen")), ["legacy"]);
});

test("no likes and no matches both give an empty list", () => {
  assert.deepEqual(likedTracksByArtist([], "27", "Queen"), []);
  assert.deepEqual(likedTracksByArtist([track("a", "Other", "5")], "27", "Queen"), []);
});

test("an empty artist id is rejected instead of matching nothing", () => {
  assert.throws(() => likedTracksByArtist([track("a", "Queen", "27")], "", "Queen"), /Artist id must not be empty/);
  assert.throws(() => likedTracksByArtist([], "  ", "Queen"), /Artist id must not be empty/);
});

test("the collapsed block previews five songs", () => {
  assert.equal(LIKED_BY_ARTIST_PREVIEW, 5);
});
