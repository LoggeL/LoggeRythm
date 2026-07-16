import assert from "node:assert/strict";
import test from "node:test";

import {
  countUnseenRadarTracks,
  mergeSeenRadarTrackIds,
  radarTrackIds,
} from "../src/lib/releaseRadar.ts";
import {
  isPersistedQueryKey,
  keepLastGoodQueryData,
  shouldRemoveQueryForUserChange,
} from "../src/lib/queryPersistence.ts";

test("radar ignores ordering, removals, and duplicate track ids", () => {
  assert.equal(countUnseenRadarTracks(["2", "1", "1"], ["1", "2"]), 0);
  assert.equal(countUnseenRadarTracks(["1"], ["1", "2"]), 0);
});

test("radar counts each newly added track once", () => {
  assert.equal(countUnseenRadarTracks(["1", "2", "3", "3"], ["1", "2"]), 1);
  assert.equal(countUnseenRadarTracks(["1", "2"], []), 2);
});

test("acknowledging radar tracks keeps a cumulative id set", () => {
  const afterFirstVisit = mergeSeenRadarTrackIds(["1", "2"], ["2", "3"]);
  assert.deepEqual(afterFirstVisit, ["1", "2", "3"]);

  const afterPartialResponse = mergeSeenRadarTrackIds(afterFirstVisit, ["1"]);
  assert.deepEqual(afterPartialResponse, ["1", "2", "3"]);
  assert.equal(countUnseenRadarTracks(["2", "3"], afterPartialResponse), 0);
});

test("radar track ids are normalized and must be present", () => {
  assert.deepEqual(radarTrackIds([{ id: 12 }, { id: "12" }, { id: "13" }]), [
    "12",
    "13",
  ]);
  assert.throws(
    () => radarTrackIds([{ id: "" }]),
    /ohne Track-ID/,
  );
});

test("only allowlisted content queries are persisted", () => {
  assert.equal(isPersistedQueryKey(["genres"]), true);
  assert.equal(isPersistedQueryKey(["album", "42"]), true);
  assert.equal(isPersistedQueryKey(["me"]), false);
  assert.equal(isPersistedQueryKey(["admin-users"]), false);
  assert.equal(isPersistedQueryKey(["party", "ABCD"]), false);
});

test("personalized discovery queries require a user scope", () => {
  assert.equal(isPersistedQueryKey(["home-mixes", "user-a"]), true);
  assert.equal(isPersistedQueryKey(["release-radar", "user-b"]), true);
  assert.equal(isPersistedQueryKey(["because-you-listened", "user-a"]), true);
  assert.equal(isPersistedQueryKey(["home-mixes"]), false);
  assert.equal(isPersistedQueryKey(["release-radar", null]), false);
  assert.equal(isPersistedQueryKey(["release-radar", ""]), false);
});

test("a failed refresh persists the last good data as a reusable snapshot", () => {
  const cached = keepLastGoodQueryData({
    timestamp: 1,
    buster: "test",
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ["home-mixes", "user-a"],
          queryHash: "mixes",
          state: {
            data: [{ title: "last good" }],
            dataUpdateCount: 1,
            dataUpdatedAt: 1,
            error: new Error("refresh failed"),
            errorUpdateCount: 1,
            errorUpdatedAt: 2,
            fetchFailureCount: 1,
            fetchFailureReason: new Error("refresh failed"),
            fetchMeta: null,
            isInvalidated: false,
            status: "error",
            fetchStatus: "idle",
          },
        },
      ],
    },
  });

  assert.equal(cached.clientState.queries[0].state.status, "success");
  assert.equal(cached.clientState.queries[0].state.error, null);
  assert.equal(cached.clientState.queries[0].state.fetchFailureCount, 0);
  assert.deepEqual(cached.clientState.queries[0].state.data, [
    { title: "last good" },
  ]);
});

test("an account change removes private and wrong-user cached queries", () => {
  assert.equal(shouldRemoveQueryForUserChange(["likes"], "user-b"), true);
  assert.equal(
    shouldRemoveQueryForUserChange(["release-radar", "user-a"], "user-b"),
    true,
  );
  assert.equal(
    shouldRemoveQueryForUserChange(["release-radar", "user-b"], "user-b"),
    false,
  );
  assert.equal(shouldRemoveQueryForUserChange(["genres"], "user-b"), false);
  assert.equal(
    shouldRemoveQueryForUserChange(["home-mixes", "user-a"]),
    true,
  );
});
