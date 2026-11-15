import assert from "node:assert/strict";
import test from "node:test";
import { isCollectionQueue } from "../src/app/playlist/_components/collectionPlayback.ts";

const track = (id) => ({ id: String(id), title: `Track ${id}` });
const album = [track(1), track(2), track(3)];
const player = (tracks, origins = tracks.map(() => "context"), queueContext = "Weezer", index = 0) => ({ index, queue: tracks, origins, queueContext });

test("a queue started from the collection is recognised, also when reordered or trimmed", () => {
  assert.equal(isCollectionQueue(player(album), "Weezer", album), true);
  assert.equal(isCollectionQueue(player([track(3), track(1)]), "Weezer", album), true);
  assert.equal(isCollectionQueue(player([{ id: 2 }]), "Weezer", album), true);
});

test("a same-named collection with other tracks is not the one playing", () => {
  // Album "Weezer" is playing; the artist page "Weezer" lists other top tracks.
  const topTracks = [track(2), track(8), track(9)];
  assert.equal(isCollectionQueue(player(album), "Weezer", topTracks), false);
  assert.equal(isCollectionQueue(player(album), "Weezer", []), false);
});

test("manually queued extras do not disown the collection, but a foreign label or idle player does", () => {
  const withExtra = player([track(1), track(99), track(2)], ["context", "manual", "context"]);
  assert.equal(isCollectionQueue(withExtra, "Weezer", album), true);
  assert.equal(isCollectionQueue(player(album, undefined, "Pinkerton"), "Weezer", album), false);
  assert.equal(isCollectionQueue(player(album, undefined, null), "Weezer", album), false);
  assert.equal(isCollectionQueue(player(album, undefined, "Weezer", -1), "Weezer", album), false);
  // Only manual entries left: nothing in the queue came from this collection.
  assert.equal(isCollectionQueue(player([track(1)], ["manual"]), "Weezer", album), false);
});
