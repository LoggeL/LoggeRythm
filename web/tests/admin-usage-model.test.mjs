import assert from "node:assert/strict";
import test from "node:test";

import {
  AdminUsageContractError,
  computeStorageShares,
  computeUserStorageShares,
  decodeAdminUsageOverview,
  decodeAdminUserUsageDetail,
  filterAndSortUsers,
  formatBytes,
  formatDuration,
  formatRelativeTimestamp,
  parseUsageRange,
  userDisplayName,
} from "../src/lib/adminUsage.ts";

function makeUser(overrides = {}) {
  return {
    id: 1,
    email: "admin@loggerythm.test",
    display_name: "Admin",
    avatar_url: null,
    is_admin: true,
    is_approved: true,
    created_at: "2026-01-04T10:00:00Z",
    last_active_at: "2026-11-24T09:50:00Z",
    plays: 120,
    listening_sec: 28800,
    unique_tracks: 45,
    tracks_requested: 40,
    tracks_materialized: 25,
    materialized_bytes: 180_000_000,
    storage: {
      exclusive_bytes: 120_000_000,
      exclusive_tracks: 16,
      shared_bytes: 80_000_000,
      shared_tracks: 10,
      accessed_bytes: 200_000_000,
      accessed_tracks: 26,
      materialized_bytes: 150_000_000,
      materialized_tracks: 20,
      pinned_bytes: 90_000_000,
      pinned_tracks: 12,
      upload_bytes: 512_000,
    },
    library: {
      likes: 18,
      playlists: 3,
      public_playlists: 1,
      playlist_tracks: 42,
      follows: 6,
      party_tracks_added: 9,
      party_hosted: 2,
      import_jobs: 1,
      import_tracks_matched: 30,
    },
    online_devices: 1,
    is_playing_now: true,
    active_device_name: "MacBook Pro",
    active_party_code: null,
    ...overrides,
  };
}

function makeOverviewResponse(overrides = {}) {
  const user1 = makeUser();
  const user2 = makeUser({
    id: "2",
    email: "jule@loggerythm.test",
    display_name: "Jule",
    is_admin: false,
    last_active_at: null,
    plays: 30,
    listening_sec: 6000,
    unique_tracks: 14,
    tracks_requested: 10,
    tracks_materialized: 4,
    materialized_bytes: 32_000_000,
    storage: {
      exclusive_bytes: 30_000_000,
      exclusive_tracks: 4,
      shared_bytes: 80_000_000,
      shared_tracks: 10,
      accessed_bytes: 110_000_000,
      accessed_tracks: 14,
      materialized_bytes: 32_000_000,
      materialized_tracks: 4,
      pinned_bytes: 20_000_000,
      pinned_tracks: 3,
      upload_bytes: 0,
    },
    online_devices: 0,
    is_playing_now: false,
    active_device_name: null,
  });

  return {
    range: "30d",
    generated_at: "2026-11-24T10:00:00Z",
    request_tracking_since: "2026-10-01T00:00:00Z",
    overview: {
      total_users: 2,
      approved_users: 2,
      pending_users: 0,
      active_users: 2,
      total_plays: 150,
      total_listening_sec: 34800,
      unique_tracks_played: 52,
      tracks_requested: 50,
      tracks_materialized: 29,
      materialized_bytes: 212_000_000,
      online_connect_devices: 1,
      online_connect_users: 1,
      active_parties: 0,
      storage: {
        cached_tracks: 35,
        total_audio_bytes: 260_000_000,
        exclusive_audio_bytes: 150_000_000,
        exclusive_audio_tracks: 20,
        shared_audio_bytes: 80_000_000,
        shared_audio_tracks: 10,
        unattributed_audio_bytes: 30_000_000,
        unattributed_audio_tracks: 5,
        directly_attributed_tracks: 24,
        directly_attributed_bytes: 182_000_000,
        upload_bytes: 512_000,
        disk_total: 64_000_000_000,
        disk_used: 20_000_000_000,
        disk_free: 44_000_000_000,
        retention_days: 30,
      },
    },
    users: [user1, user2],
    ...overrides,
  };
}

function makeDetailResponse(overrides = {}) {
  const user = makeUser();
  return {
    range: "30d",
    generated_at: "2026-11-24T10:00:00Z",
    request_tracking_since: "2026-10-01T00:00:00Z",
    user,
    storage_breakdown: {
      ...user.storage,
      total_cache_bytes: 260_000_000,
    },
    requests_by_source: [
      { source: "stream", requests: 25, materialized: 15, materialized_bytes: 110_000_000 },
      { source: "preload", requests: 8, materialized: 5, materialized_bytes: 35_000_000 },
      { source: "playlist_export", requests: 2, materialized: 2, materialized_bytes: 14_000_000 },
      { source: "party_preload", requests: 2, materialized: 1, materialized_bytes: 7_000_000 },
      { source: "radar_preload", requests: 2, materialized: 1, materialized_bytes: 7_000_000 },
      { source: "lyrics_ai", requests: 1, materialized: 1, materialized_bytes: 7_000_000 },
    ],
    active_devices: [
      {
        device_id: "dev-1",
        name: "MacBook Pro",
        device_type: "web",
        is_active: true,
        party_code: null,
        connected_at: "2026-11-24T09:00:00Z",
        last_seen_at: "2026-11-24T09:59:00Z",
      },
    ],
    top_tracks: [
      { key: 9001, label: "Laternen", sublabel: "Nachtfalter", cover: "/api/art.svg", count: 14 },
    ],
    top_artists: [
      { key: "100", label: "Nachtfalter", sublabel: "", cover: "/api/artist.svg", count: 32 },
    ],
    recent_plays: [
      {
        id: 9001,
        title: "Laternen",
        artist: "Nachtfalter",
        album: "Neonregen",
        cover: "/api/art.svg",
        duration_sec: 215,
        played_at: "2026-11-24T09:45:00Z",
      },
    ],
    recent_requests: [
      {
        deezer_id: "9001",
        title: "Laternen",
        artist: "Nachtfalter",
        cover: "/api/art.svg",
        source: "stream",
        materialized: true,
        size_bytes: 7_200_000,
        requested_at: "2026-11-24T09:44:00Z",
        is_currently_stored: true,
      },
    ],
    ...overrides,
  };
}

test("decodeAdminUsageOverview accepts valid payload and normalizes canonical ids", () => {
  const decoded = decodeAdminUsageOverview(makeOverviewResponse());
  assert.equal(decoded.range, "30d");
  assert.equal(decoded.users.length, 2);
  assert.equal(decoded.users[0].id, "1");
  assert.equal(decoded.users[1].id, "2");
  assert.equal(decoded.users[1].last_active_at, null);
});

test("decodeAdminUsageOverview accepts null request_tracking_since and zero-cache empty state", () => {
  const payload = makeOverviewResponse({
    request_tracking_since: null,
    overview: {
      total_users: 0,
      approved_users: 0,
      pending_users: 0,
      active_users: 0,
      total_plays: 0,
      total_listening_sec: 0,
      unique_tracks_played: 0,
      tracks_requested: 0,
      tracks_materialized: 0,
      materialized_bytes: 0,
      online_connect_devices: 0,
      online_connect_users: 0,
      active_parties: 0,
      storage: {
        cached_tracks: 0,
        total_audio_bytes: 0,
        exclusive_audio_bytes: 0,
        exclusive_audio_tracks: 0,
        shared_audio_bytes: 0,
        shared_audio_tracks: 0,
        unattributed_audio_bytes: 0,
        unattributed_audio_tracks: 0,
        directly_attributed_tracks: 0,
        directly_attributed_bytes: 0,
        upload_bytes: 0,
        disk_total: 1000,
        disk_used: 100,
        disk_free: 900,
        retention_days: 0,
      },
    },
    users: [],
  });
  const decoded = decodeAdminUsageOverview(payload);
  assert.equal(decoded.request_tracking_since, null);
  assert.equal(decoded.users.length, 0);
});

test("decodeAdminUsageOverview fails loudly on contract & invariant violations", () => {
  const cases = [
    ["invalid range", (p) => { p.range = "90d"; }, /range/],
    ["invalid generated_at", (p) => { p.generated_at = "not-a-date"; }, /generated_at/],
    ["byte conservation mismatch", (p) => { p.overview.storage.total_audio_bytes += 1; }, /total_audio_bytes/],
    ["track conservation mismatch", (p) => { p.overview.storage.cached_tracks += 1; }, /cached_tracks/],
    ["disk_total zero", (p) => { p.overview.storage.disk_total = 0; }, /disk_total/],
    ["disk_used exceeds total", (p) => { p.overview.storage.disk_used = p.overview.storage.disk_total + 1; }, /disk_used/],
    ["users length mismatch", (p) => { p.overview.total_users = 3; }, /users/],
    ["exclusive bytes sum mismatch", (p) => {
      p.users[0].storage.exclusive_bytes += 10;
      p.users[0].storage.accessed_bytes += 10;
    }, /exclusive_bytes/],
    ["user accessed != exclusive + shared", (p) => { p.users[0].storage.accessed_bytes += 5; }, /accessed_bytes/],
    ["materialized > requested", (p) => { p.users[0].tracks_materialized = p.users[0].tracks_requested + 1; }, /tracks_materialized/],
    ["public_playlists > playlists", (p) => { p.users[0].library.public_playlists = p.users[0].library.playlists + 1; }, /public_playlists/],
    ["online_connect_users > devices", (p) => { p.overview.online_connect_users = 2; }, /online_connect_users/],
  ];

  for (const [label, mutate, pattern] of cases) {
    const wire = makeOverviewResponse();
    mutate(wire);
    assert.throws(
      () => decodeAdminUsageOverview(wire),
      (error) => error instanceof AdminUsageContractError && pattern.test(error.message),
      label,
    );
  }
});

test("decodeAdminUserUsageDetail accepts valid payload and rejects broken invariants", () => {
  const decoded = decodeAdminUserUsageDetail(makeDetailResponse());
  assert.equal(decoded.user.id, "1");
  assert.equal(decoded.requests_by_source.length, 6);
  assert.equal(decoded.top_tracks[0].key, "9001");
  assert.equal(decoded.recent_plays[0].id, "9001");
  assert.equal(decoded.recent_requests[0].is_currently_stored, true);

  const badSource = makeDetailResponse();
  badSource.requests_by_source[0].source = "unknown_source";
  assert.throws(() => decodeAdminUserUsageDetail(badSource), /requests_by_source\[0\]\.source/);

  const badMaterialized = makeDetailResponse();
  badMaterialized.requests_by_source[0].materialized = 999;
  assert.throws(() => decodeAdminUserUsageDetail(badMaterialized), /requests_by_source\[0\]\.materialized/);

  const badCacheBound = makeDetailResponse();
  badCacheBound.storage_breakdown.total_cache_bytes = 50_000_000;
  assert.throws(() => decodeAdminUserUsageDetail(badCacheBound), /storage_breakdown\.accessed_bytes/);

  const badDeviceType = makeDetailResponse();
  badDeviceType.active_devices[0].device_type = "toaster";
  assert.throws(() => decodeAdminUserUsageDetail(badDeviceType), /active_devices\[0\]\.device_type/);
});

test("formatBytes, formatDuration and formatRelativeTimestamp format accurately and fail loud on bad inputs", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024 * 1024 * 5), "5.0 MB");
  assert.throws(() => formatBytes(-1), /Speicherwert/);
  assert.throws(() => formatBytes(1.5), /Speicherwert/);

  assert.equal(formatDuration(0), "0 Min.");
  assert.equal(formatDuration(45), "< 1 Min.");
  assert.equal(formatDuration(1800), "30 Min.");
  assert.equal(formatDuration(3660), "1 Std. 1 Min.");
  assert.equal(formatDuration(3600 * 50), "2 T. 2 Std.");
  assert.throws(() => formatDuration(-10), /Hörzeit/);

  const now = Date.parse("2026-11-24T10:00:00Z");
  assert.equal(formatRelativeTimestamp(null, now), "Nie");
  assert.equal(formatRelativeTimestamp("2026-11-24T09:59:40Z", now), "gerade eben");
  assert.equal(formatRelativeTimestamp("2026-11-24T09:48:00Z", now), "vor 12 Min.");
  assert.equal(formatRelativeTimestamp("2026-11-24T07:00:00Z", now), "vor 3 Std.");
  assert.equal(formatRelativeTimestamp("2026-11-23T08:00:00Z", now), "gestern");
  assert.equal(formatRelativeTimestamp("2026-11-20T10:00:00Z", now), "vor 4 Tagen");
  assert.equal(formatRelativeTimestamp("2026-11-10T10:00:00Z", now), "vor 2 Wochen");
  assert.throws(() => formatRelativeTimestamp("invalid-iso", now), /Zeitstempel/);
});

test("decodeAdminUsageOverview accepts null display_name and created_at while still rejecting bad types", () => {
  const payload = makeOverviewResponse();
  payload.users[1].display_name = null;
  payload.users[1].created_at = null;
  const decoded = decodeAdminUsageOverview(payload);
  assert.equal(decoded.users[1].display_name, null);
  assert.equal(decoded.users[1].created_at, null);
  assert.equal(userDisplayName(decoded.users[1]), "jule@loggerythm.test");

  // Blank display_name normalizes to null so UI displays email cleanly.
  const blankPayload = makeOverviewResponse();
  blankPayload.users[1].display_name = "   ";
  assert.equal(decodeAdminUsageOverview(blankPayload).users[1].display_name, null);

  // Filter and tiebreaker sort still work when display_name is null.
  const matched = filterAndSortUsers(decoded.users, "jule@", "plays", "desc");
  assert.deepEqual(matched.map((u) => u.id), ["2"]);

  const badName = makeOverviewResponse();
  badName.users[0].display_name = 42;
  assert.throws(() => decodeAdminUsageOverview(badName), /users\[0\]\.display_name/);

  const badCreated = makeOverviewResponse();
  badCreated.users[0].created_at = "not-a-date";
  assert.throws(() => decodeAdminUsageOverview(badCreated), /users\[0\]\.created_at/);
});

test("decodeAdminUserUsageDetail accepts empty top_artists key and null user metadata while rejecting invalid keys", () => {
  const payload = makeDetailResponse();
  payload.user.display_name = null;
  payload.user.created_at = null;
  payload.top_artists.push({
    key: "",
    label: "Unbekannter Künstler",
    sublabel: "",
    cover: "",
    count: 5,
  });
  const decoded = decodeAdminUserUsageDetail(payload);
  assert.equal(decoded.user.display_name, null);
  assert.equal(decoded.user.created_at, null);
  assert.equal(decoded.top_artists[1].key, "");

  const badArtistKey = makeDetailResponse();
  badArtistKey.top_artists[0].key = null;
  assert.throws(() => decodeAdminUserUsageDetail(badArtistKey), /top_artists\[0\]\.key/);

  const badTrackKey = makeDetailResponse();
  badTrackKey.top_tracks[0].key = "";
  assert.throws(() => decodeAdminUserUsageDetail(badTrackKey), /top_tracks\[0\]\.key/);
});

test("parseUsageRange, storage share math and filterAndSortUsers behave predictably", () => {
  assert.equal(parseUsageRange("7d"), "7d");
  assert.equal(parseUsageRange("30d"), "30d");
  assert.equal(parseUsageRange("all"), "all");
  assert.equal(parseUsageRange(null), "all");
  assert.equal(parseUsageRange("invalid"), "all");

  const overview = decodeAdminUsageOverview(makeOverviewResponse());
  const shares = computeStorageShares(overview.overview.storage);
  assert.equal(Math.round(shares.exclusivePct + shares.sharedPct + shares.unattributedPct), 100);
  const userShares = computeUserStorageShares(overview.users[0].storage, overview.overview.storage.total_audio_bytes);
  assert.ok(userShares.exclusivePct < userShares.accessedPct);

  const byEmail = filterAndSortUsers(overview.users, "JULE@", "plays", "desc");
  assert.deepEqual(byEmail.map((u) => u.id), ["2"]);

  const ascPlays = filterAndSortUsers(overview.users, "", "plays", "asc");
  assert.deepEqual(ascPlays.map((u) => u.id), ["2", "1"]);

  // Never-active user stays at the bottom for both asc and desc last_active_at sorts.
  const activeDesc = filterAndSortUsers(overview.users, "", "last_active_at", "desc");
  const activeAsc = filterAndSortUsers(overview.users, "", "last_active_at", "asc");
  assert.deepEqual(activeDesc.map((u) => u.id), ["1", "2"]);
  assert.deepEqual(activeAsc.map((u) => u.id), ["1", "2"]);
});
