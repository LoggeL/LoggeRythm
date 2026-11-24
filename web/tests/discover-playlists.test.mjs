import assert from "node:assert/strict";
import test from "node:test";
import { discoverPlaylistsQuery, mergeDiscoverPlaylists } from "../src/app/genre/discoverPlaylists.ts";

const playlist = (id, overrides = {}) => ({ id, name: `Playlist ${id}`, track_count: 3, is_public: true, owner_name: null, ...overrides });
const source = (overrides = {}) => {
  const calls = [];
  return {
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: async () => calls.push("refetch"),
    calls,
    ...overrides,
  };
};
const loaded = (data) => source({ data });
const failed = (message, data) => source({ data, error: new Error(message), isError: true });

test("own playlists come first, private ones included, then the community's", () => {
  const own = [playlist(7, { is_public: false }), playlist(3)];
  const community = [playlist(11, { owner_name: "Sam" }), playlist(5, { owner_name: "Kim" })];
  const merged = mergeDiscoverPlaylists(own, community);
  assert.deepEqual(merged.map((entry) => [entry.playlist.id, entry.own]), [[7, true], [3, true], [11, false], [5, false]]);
  assert.equal(merged[0].playlist, own[0]);
  assert.equal(merged[2].playlist, community[0]);
});

test("a playlist both lists carry appears once, as the user's own, whatever type its id has", () => {
  const own = [playlist(3)];
  const merged = mergeDiscoverPlaylists(own, [playlist("3", { owner_name: "Alex" }), playlist(9, { owner_name: "Sam" })]);
  assert.deepEqual(merged.map((entry) => [entry.playlist.id, entry.own]), [[3, true], [9, false]]);
  assert.equal(merged[0].playlist, own[0]);
});

test("shared collaborative playlists in GET /playlists are not marked as own and deduplicate against community", () => {
  const library = [
    playlist(1, { is_owner: true, is_collaborative: true }),
    playlist(4, { is_owner: false, is_collaborator: true, is_collaborative: true, owner_name: "Jule" }),
  ];
  const community = [
    playlist(4, { is_owner: false, is_public: true, owner_name: "Jule" }),
    playlist(9, { is_owner: false, is_public: true, owner_name: "Sam" }),
  ];
  const merged = mergeDiscoverPlaylists(library, community);
  assert.deepEqual(
    merged.map((entry) => [entry.playlist.id, entry.own]),
    [[1, true], [4, false], [9, false]],
  );
  assert.equal(merged[1].playlist, library[1]);
});

test("one empty side leaves the other, two empty sides leave an empty row", () => {
  assert.deepEqual(mergeDiscoverPlaylists([playlist(1)], []), [{ playlist: playlist(1), own: true }]);
  assert.deepEqual(mergeDiscoverPlaylists([], [playlist(2)]), [{ playlist: playlist(2), own: false }]);
  assert.deepEqual(mergeDiscoverPlaylists([], []), []);
});

test("a list that repeats a playlist is rejected instead of quietly thinned out", () => {
  assert.throws(() => mergeDiscoverPlaylists([playlist(4), playlist(4)], []), /Eigene Playlists enthalten die Playlist 4 mehrfach/);
  assert.throws(() => mergeDiscoverPlaylists([], [playlist(6), playlist("6")]), /Community-Playlists enthalten die Playlist 6 mehrfach/);
});

test("the row has data only once both lists have loaded", () => {
  const ready = discoverPlaylistsQuery(loaded([playlist(1)]), loaded([playlist(2)]));
  assert.deepEqual(ready.data.map((entry) => entry.playlist.id), [1, 2]);
  assert.deepEqual([ready.isLoading, ready.isError, ready.error, ready.isFetching], [false, false, null, false]);

  for (const pending of [
    discoverPlaylistsQuery(source({ isLoading: true, isFetching: true }), loaded([playlist(2)])),
    discoverPlaylistsQuery(loaded([playlist(1)]), source({ isLoading: true, isFetching: true })),
  ]) {
    assert.equal(pending.data, undefined);
    assert.equal(pending.isLoading, true);
    assert.equal(pending.isFetching, true);
    assert.equal(pending.isError, false);
  }
});

test("a failure of either list is the row's failure and hides the other half", () => {
  const ownFailed = discoverPlaylistsQuery(failed("Playlists: HTTP 500"), loaded([playlist(2)]));
  assert.equal(ownFailed.isError, true);
  assert.equal(ownFailed.error.message, "Playlists: HTTP 500");
  assert.equal(ownFailed.data, undefined);

  const communityFailed = discoverPlaylistsQuery(loaded([playlist(1)]), failed("Public: HTTP 503"));
  assert.equal(communityFailed.isError, true);
  assert.equal(communityFailed.error.message, "Public: HTTP 503");
  assert.equal(communityFailed.data, undefined);
});

test("two failures are both named", () => {
  const both = discoverPlaylistsQuery(failed("HTTP 500"), failed("HTTP 503"));
  assert.equal(both.error.message, "Eigene Playlists: HTTP 500 · Community-Playlists: HTTP 503");
});

test("a failed refresh keeps the last loaded row next to its error", () => {
  const stale = discoverPlaylistsQuery(failed("HTTP 500", [playlist(1)]), loaded([playlist(2)]));
  assert.equal(stale.isError, true);
  assert.deepEqual(stale.data.map((entry) => entry.playlist.id), [1, 2]);
});

test("retry reloads only the list that failed", async () => {
  const own = failed("HTTP 500");
  const community = loaded([playlist(2)]);
  await discoverPlaylistsQuery(own, community).refetch();
  assert.deepEqual([own.calls.length, community.calls.length], [1, 0]);

  const first = loaded([playlist(1)]);
  const second = loaded([playlist(2)]);
  await discoverPlaylistsQuery(first, second).refetch();
  assert.deepEqual([first.calls.length, second.calls.length], [1, 1]);
});

test("a source that reports an error without a cause is rejected", () => {
  assert.throws(() => discoverPlaylistsQuery(source({ isError: true }), loaded([])), /Eigene Playlists melden einen Fehler ohne Ursache/);
});
