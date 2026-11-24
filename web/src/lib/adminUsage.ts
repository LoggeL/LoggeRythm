import type {
  AdminConnectDevice,
  AdminOverviewStorage,
  AdminRecentPlay,
  AdminRecentTrackRequest,
  AdminRequestSourceStat,
  AdminUsageOverview,
  AdminUsageOverviewResponse,
  AdminUsageRange,
  AdminUserLibrary,
  AdminUserStorage,
  AdminUserStorageBreakdown,
  AdminUserUsageDetailResponse,
  AdminUserUsageSummary,
  DeviceType,
  StatEntry,
  TrackRequestSource,
} from "@/types";

export const USAGE_RANGES: readonly AdminUsageRange[] = ["7d", "30d", "all"];

export const USAGE_RANGE_LABELS: Record<AdminUsageRange, string> = {
  "7d": "7 Tage",
  "30d": "30 Tage",
  all: "Gesamt",
};

export const TRACK_REQUEST_SOURCES: readonly TrackRequestSource[] = [
  "stream",
  "preload",
  "playlist_export",
  "party_preload",
  "radar_preload",
  "lyrics_ai",
];

const TRACK_REQUEST_SOURCE_SET = new Set<string>(TRACK_REQUEST_SOURCES);

export const TRACK_REQUEST_SOURCE_LABELS: Record<TrackRequestSource, string> = {
  stream: "Stream",
  preload: "Vorladen",
  playlist_export: "Playlist-Export",
  party_preload: "Jam-Preload",
  radar_preload: "Release-Radar",
  lyrics_ai: "KI-Songtext",
};

const DEVICE_TYPES = new Set<string>([
  "web",
  "mobile",
  "tablet",
  "desktop",
  "tv",
  "speaker",
  "other",
]);

export type UsageSortKey =
  | "plays"
  | "listening_sec"
  | "tracks_requested"
  | "exclusive_bytes"
  | "accessed_bytes"
  | "last_active_at";

export type UsageSortDirection = "desc" | "asc";

export const USAGE_SORT_LABELS: Record<UsageSortKey, string> = {
  plays: "Wiedergaben",
  listening_sec: "Hörzeit",
  tracks_requested: "Angeforderte Titel",
  exclusive_bytes: "Speicher (exklusiv)",
  accessed_bytes: "Speicher (genutzt)",
  last_active_at: "Zuletzt aktiv",
};

export class AdminUsageContractError extends Error {
  readonly path: string;

  constructor(path: string, expectation: string) {
    super(`Ungültige Nutzungsdaten (${path}): ${expectation}.`);
    this.name = "AdminUsageContractError";
    this.path = path;
  }
}

type JsonObject = Record<string, unknown>;

function fail(path: string, expectation: string): never {
  throw new AdminUsageContractError(path, expectation);
}

function requireObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "muss ein Objekt sein");
  }
  return value as JsonObject;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(path, "muss eine Liste sein");
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "muss ein Wahrheitswert sein");
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail(path, "muss Text sein");
  }
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  const text = requireString(value, path).trim();
  if (text.length === 0) {
    fail(path, "muss nicht-leerer Text sein");
  }
  return text;
}

function requireNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requireString(value, path);
}

function requireCanonicalId(value: unknown, path: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) fail(path, "muss eine nicht-leere ID sein");
    return trimmed;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  fail(path, "muss ein String oder eine nicht-negative ganze Zahl sein");
}

function requireOptionalCanonicalId(value: unknown, path: string): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  fail(path, "muss ein String oder eine nicht-negative ganze Zahl sein");
}

function requireInt(value: unknown, path: string, positive = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    fail(
      path,
      positive
        ? "muss eine positive ganze Zahl sein"
        : "muss eine nicht-negative ganze Zahl sein",
    );
  }
  return value;
}

function requireIsoTimestamp(value: unknown, path: string): string {
  const text = requireNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(text))) {
    fail(path, "muss ein gültiger ISO-8601-Zeitstempel sein");
  }
  return text;
}

function requireNullableIsoTimestamp(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requireIsoTimestamp(value, path);
}

function requireRange(value: unknown, path: string): AdminUsageRange {
  if (value === "7d" || value === "30d" || value === "all") return value;
  fail(path, "muss „7d“, „30d“ oder „all“ sein");
}

function requireTrackRequestSource(value: unknown, path: string): TrackRequestSource {
  if (typeof value === "string" && TRACK_REQUEST_SOURCE_SET.has(value)) {
    return value as TrackRequestSource;
  }
  fail(path, `muss eine gültige Anfragequelle sein (${TRACK_REQUEST_SOURCES.join(", ")})`);
}

function requireDeviceType(value: unknown, path: string): DeviceType {
  if (typeof value === "string" && DEVICE_TYPES.has(value)) {
    return value as DeviceType;
  }
  fail(path, "muss ein gültiger Gerätetyp sein");
}

function decodeOverviewStorage(value: unknown, path: string): AdminOverviewStorage {
  const src = requireObject(value, path);
  const storage: AdminOverviewStorage = {
    cached_tracks: requireInt(src.cached_tracks, `${path}.cached_tracks`),
    total_audio_bytes: requireInt(src.total_audio_bytes, `${path}.total_audio_bytes`),
    exclusive_audio_bytes: requireInt(src.exclusive_audio_bytes, `${path}.exclusive_audio_bytes`),
    exclusive_audio_tracks: requireInt(src.exclusive_audio_tracks, `${path}.exclusive_audio_tracks`),
    shared_audio_bytes: requireInt(src.shared_audio_bytes, `${path}.shared_audio_bytes`),
    shared_audio_tracks: requireInt(src.shared_audio_tracks, `${path}.shared_audio_tracks`),
    unattributed_audio_bytes: requireInt(src.unattributed_audio_bytes, `${path}.unattributed_audio_bytes`),
    unattributed_audio_tracks: requireInt(src.unattributed_audio_tracks, `${path}.unattributed_audio_tracks`),
    directly_attributed_tracks: requireInt(src.directly_attributed_tracks, `${path}.directly_attributed_tracks`),
    directly_attributed_bytes: requireInt(src.directly_attributed_bytes, `${path}.directly_attributed_bytes`),
    upload_bytes: requireInt(src.upload_bytes, `${path}.upload_bytes`),
    disk_total: requireInt(src.disk_total, `${path}.disk_total`, true),
    disk_used: requireInt(src.disk_used, `${path}.disk_used`),
    disk_free: requireInt(src.disk_free, `${path}.disk_free`),
    retention_days: requireInt(src.retention_days, `${path}.retention_days`),
  };

  if (
    storage.exclusive_audio_bytes +
      storage.shared_audio_bytes +
      storage.unattributed_audio_bytes !==
    storage.total_audio_bytes
  ) {
    fail(
      `${path}.total_audio_bytes`,
      "muss der Summe aus exklusiven, geteilten und unzugeordneten Audio-Bytes entsprechen",
    );
  }
  if (
    storage.exclusive_audio_tracks +
      storage.shared_audio_tracks +
      storage.unattributed_audio_tracks !==
    storage.cached_tracks
  ) {
    fail(
      `${path}.cached_tracks`,
      "muss der Summe aus exklusiven, geteilten und unzugeordneten Titeln entsprechen",
    );
  }
  if (storage.directly_attributed_tracks > storage.cached_tracks) {
    fail(`${path}.directly_attributed_tracks`, "darf „cached_tracks“ nicht überschreiten");
  }
  if (storage.directly_attributed_bytes > storage.total_audio_bytes) {
    fail(`${path}.directly_attributed_bytes`, "darf „total_audio_bytes“ nicht überschreiten");
  }
  if (storage.disk_used > storage.disk_total) {
    fail(`${path}.disk_used`, "darf „disk_total“ nicht überschreiten");
  }

  return storage;
}

function decodeOverview(value: unknown, path: string): AdminUsageOverview {
  const src = requireObject(value, path);
  const overview: AdminUsageOverview = {
    total_users: requireInt(src.total_users, `${path}.total_users`),
    approved_users: requireInt(src.approved_users, `${path}.approved_users`),
    pending_users: requireInt(src.pending_users, `${path}.pending_users`),
    active_users: requireInt(src.active_users, `${path}.active_users`),
    total_plays: requireInt(src.total_plays, `${path}.total_plays`),
    total_listening_sec: requireInt(src.total_listening_sec, `${path}.total_listening_sec`),
    unique_tracks_played: requireInt(src.unique_tracks_played, `${path}.unique_tracks_played`),
    tracks_requested: requireInt(src.tracks_requested, `${path}.tracks_requested`),
    tracks_materialized: requireInt(src.tracks_materialized, `${path}.tracks_materialized`),
    materialized_bytes: requireInt(src.materialized_bytes, `${path}.materialized_bytes`),
    online_connect_devices: requireInt(src.online_connect_devices, `${path}.online_connect_devices`),
    online_connect_users: requireInt(src.online_connect_users, `${path}.online_connect_users`),
    active_parties: requireInt(src.active_parties, `${path}.active_parties`),
    storage: decodeOverviewStorage(src.storage, `${path}.storage`),
  };

  if (overview.approved_users > overview.total_users) {
    fail(`${path}.approved_users`, "darf „total_users“ nicht überschreiten");
  }
  if (overview.pending_users > overview.total_users) {
    fail(`${path}.pending_users`, "darf „total_users“ nicht überschreiten");
  }
  if (overview.active_users > overview.total_users) {
    fail(`${path}.active_users`, "darf „total_users“ nicht überschreiten");
  }
  if (overview.tracks_materialized > overview.tracks_requested) {
    fail(`${path}.tracks_materialized`, "darf „tracks_requested“ nicht überschreiten");
  }
  if (overview.online_connect_users > overview.total_users) {
    fail(`${path}.online_connect_users`, "darf „total_users“ nicht überschreiten");
  }
  if (overview.online_connect_users > overview.online_connect_devices) {
    fail(`${path}.online_connect_users`, "darf „online_connect_devices“ nicht überschreiten");
  }

  return overview;
}

function decodeUserStorage(value: unknown, path: string): AdminUserStorage {
  const src = requireObject(value, path);
  const storage: AdminUserStorage = {
    exclusive_bytes: requireInt(src.exclusive_bytes, `${path}.exclusive_bytes`),
    exclusive_tracks: requireInt(src.exclusive_tracks, `${path}.exclusive_tracks`),
    shared_bytes: requireInt(src.shared_bytes, `${path}.shared_bytes`),
    shared_tracks: requireInt(src.shared_tracks, `${path}.shared_tracks`),
    accessed_bytes: requireInt(src.accessed_bytes, `${path}.accessed_bytes`),
    accessed_tracks: requireInt(src.accessed_tracks, `${path}.accessed_tracks`),
    materialized_bytes: requireInt(src.materialized_bytes, `${path}.materialized_bytes`),
    materialized_tracks: requireInt(src.materialized_tracks, `${path}.materialized_tracks`),
    pinned_bytes: requireInt(src.pinned_bytes, `${path}.pinned_bytes`),
    pinned_tracks: requireInt(src.pinned_tracks, `${path}.pinned_tracks`),
    upload_bytes: requireInt(src.upload_bytes, `${path}.upload_bytes`),
  };

  if (storage.exclusive_bytes + storage.shared_bytes !== storage.accessed_bytes) {
    fail(`${path}.accessed_bytes`, "muss „exclusive_bytes + shared_bytes“ entsprechen");
  }
  if (storage.exclusive_tracks + storage.shared_tracks !== storage.accessed_tracks) {
    fail(`${path}.accessed_tracks`, "muss „exclusive_tracks + shared_tracks“ entsprechen");
  }

  return storage;
}

function decodeUserStorageBreakdown(value: unknown, path: string): AdminUserStorageBreakdown {
  const src = requireObject(value, path);
  const base = decodeUserStorage(src, path);
  const totalCacheBytes = requireInt(src.total_cache_bytes, `${path}.total_cache_bytes`);
  if (base.accessed_bytes > totalCacheBytes) {
    fail(`${path}.accessed_bytes`, "darf „total_cache_bytes“ nicht überschreiten");
  }
  if (base.materialized_bytes > totalCacheBytes) {
    fail(`${path}.materialized_bytes`, "darf „total_cache_bytes“ nicht überschreiten");
  }
  if (base.pinned_bytes > totalCacheBytes) {
    fail(`${path}.pinned_bytes`, "darf „total_cache_bytes“ nicht überschreiten");
  }
  return { ...base, total_cache_bytes: totalCacheBytes };
}

function decodeUserLibrary(value: unknown, path: string): AdminUserLibrary {
  const src = requireObject(value, path);
  const library: AdminUserLibrary = {
    likes: requireInt(src.likes, `${path}.likes`),
    playlists: requireInt(src.playlists, `${path}.playlists`),
    public_playlists: requireInt(src.public_playlists, `${path}.public_playlists`),
    playlist_tracks: requireInt(src.playlist_tracks, `${path}.playlist_tracks`),
    follows: requireInt(src.follows, `${path}.follows`),
    party_tracks_added: requireInt(src.party_tracks_added, `${path}.party_tracks_added`),
    party_hosted: requireInt(src.party_hosted, `${path}.party_hosted`),
    import_jobs: requireInt(src.import_jobs, `${path}.import_jobs`),
    import_tracks_matched: requireInt(src.import_tracks_matched, `${path}.import_tracks_matched`),
  };
  if (library.public_playlists > library.playlists) {
    fail(`${path}.public_playlists`, "darf „playlists“ nicht überschreiten");
  }
  return library;
}

function decodeUserSummary(value: unknown, path: string): AdminUserUsageSummary {
  const src = requireObject(value, path);
  const tracksRequested = requireInt(src.tracks_requested, `${path}.tracks_requested`);
  const tracksMaterialized = requireInt(src.tracks_materialized, `${path}.tracks_materialized`);
  if (tracksMaterialized > tracksRequested) {
    fail(`${path}.tracks_materialized`, "darf „tracks_requested“ nicht überschreiten");
  }

  const rawDisplayName = requireNullableString(src.display_name, `${path}.display_name`);
  const displayName = rawDisplayName === null ? null : rawDisplayName.trim() || null;

  return {
    id: requireCanonicalId(src.id, `${path}.id`),
    email: requireNonEmptyString(src.email, `${path}.email`),
    display_name: displayName,
    avatar_url: requireNullableString(src.avatar_url, `${path}.avatar_url`),
    is_admin: requireBoolean(src.is_admin, `${path}.is_admin`),
    is_approved: requireBoolean(src.is_approved, `${path}.is_approved`),
    created_at: requireNullableIsoTimestamp(src.created_at, `${path}.created_at`),
    last_active_at: requireNullableIsoTimestamp(src.last_active_at, `${path}.last_active_at`),
    plays: requireInt(src.plays, `${path}.plays`),
    listening_sec: requireInt(src.listening_sec, `${path}.listening_sec`),
    unique_tracks: requireInt(src.unique_tracks, `${path}.unique_tracks`),
    tracks_requested: tracksRequested,
    tracks_materialized: tracksMaterialized,
    materialized_bytes: requireInt(src.materialized_bytes, `${path}.materialized_bytes`),
    storage: decodeUserStorage(src.storage, `${path}.storage`),
    library: decodeUserLibrary(src.library, `${path}.library`),
    online_devices: requireInt(src.online_devices, `${path}.online_devices`),
    is_playing_now: requireBoolean(src.is_playing_now, `${path}.is_playing_now`),
    active_device_name: requireNullableString(src.active_device_name, `${path}.active_device_name`),
    active_party_code: requireNullableString(src.active_party_code, `${path}.active_party_code`),
  };
}

function decodeRequestSourceStat(value: unknown, path: string): AdminRequestSourceStat {
  const src = requireObject(value, path);
  const requests = requireInt(src.requests, `${path}.requests`);
  const materialized = requireInt(src.materialized, `${path}.materialized`);
  if (materialized > requests) {
    fail(`${path}.materialized`, "darf „requests“ nicht überschreiten");
  }
  return {
    source: requireTrackRequestSource(src.source, `${path}.source`),
    requests,
    materialized,
    materialized_bytes: requireInt(src.materialized_bytes, `${path}.materialized_bytes`),
  };
}

function decodeConnectDevice(value: unknown, path: string): AdminConnectDevice {
  const src = requireObject(value, path);
  return {
    device_id: requireNonEmptyString(src.device_id, `${path}.device_id`),
    name: requireNonEmptyString(src.name, `${path}.name`),
    device_type: requireDeviceType(src.device_type, `${path}.device_type`),
    is_active: requireBoolean(src.is_active, `${path}.is_active`),
    party_code: requireNullableString(src.party_code, `${path}.party_code`),
    connected_at: requireIsoTimestamp(src.connected_at, `${path}.connected_at`),
    last_seen_at: requireIsoTimestamp(src.last_seen_at, `${path}.last_seen_at`),
  };
}

function decodeStatEntry(
  value: unknown,
  path: string,
  allowEmptyKey = false,
): StatEntry {
  const src = requireObject(value, path);
  return {
    key: allowEmptyKey
      ? requireOptionalCanonicalId(src.key, `${path}.key`)
      : requireCanonicalId(src.key, `${path}.key`),
    label: requireString(src.label, `${path}.label`).trim(),
    sublabel: requireString(src.sublabel, `${path}.sublabel`).trim(),
    cover: requireString(src.cover, `${path}.cover`).trim(),
    count: requireInt(src.count, `${path}.count`, true),
  };
}

function decodeRecentPlay(value: unknown, path: string): AdminRecentPlay {
  const src = requireObject(value, path);
  return {
    id: requireCanonicalId(src.id, `${path}.id`),
    title: requireString(src.title, `${path}.title`).trim(),
    artist: requireString(src.artist, `${path}.artist`).trim(),
    album: requireString(src.album, `${path}.album`).trim(),
    cover: requireString(src.cover, `${path}.cover`).trim(),
    duration_sec: requireInt(src.duration_sec, `${path}.duration_sec`),
    played_at: requireIsoTimestamp(src.played_at, `${path}.played_at`),
  };
}

function decodeRecentTrackRequest(value: unknown, path: string): AdminRecentTrackRequest {
  const src = requireObject(value, path);
  return {
    deezer_id: requireCanonicalId(src.deezer_id, `${path}.deezer_id`),
    title: requireString(src.title, `${path}.title`).trim(),
    artist: requireString(src.artist, `${path}.artist`).trim(),
    cover: requireString(src.cover, `${path}.cover`).trim(),
    source: requireTrackRequestSource(src.source, `${path}.source`),
    materialized: requireBoolean(src.materialized, `${path}.materialized`),
    size_bytes: requireInt(src.size_bytes, `${path}.size_bytes`),
    requested_at: requireIsoTimestamp(src.requested_at, `${path}.requested_at`),
    is_currently_stored: requireBoolean(src.is_currently_stored, `${path}.is_currently_stored`),
  };
}

export function decodeAdminUsageOverview(value: unknown): AdminUsageOverviewResponse {
  const root = requireObject(value, "AdminUsageOverviewResponse");
  const range = requireRange(root.range, "range");
  const generatedAt = requireIsoTimestamp(root.generated_at, "generated_at");
  const trackingSince = requireNullableIsoTimestamp(
    root.request_tracking_since,
    "request_tracking_since",
  );
  const overview = decodeOverview(root.overview, "overview");
  const users = requireArray(root.users, "users").map((entry, index) =>
    decodeUserSummary(entry, `users[${index}]`),
  );

  if (users.length !== overview.total_users) {
    fail(
      "users",
      `Länge (${users.length}) muss „overview.total_users“ (${overview.total_users}) entsprechen`,
    );
  }

  const exclusiveBytesSum = users.reduce((sum, u) => sum + u.storage.exclusive_bytes, 0);
  if (exclusiveBytesSum !== overview.storage.exclusive_audio_bytes) {
    fail(
      "users.storage.exclusive_bytes",
      `Summe (${exclusiveBytesSum}) muss „overview.storage.exclusive_audio_bytes“ (${overview.storage.exclusive_audio_bytes}) entsprechen`,
    );
  }

  const exclusiveTracksSum = users.reduce((sum, u) => sum + u.storage.exclusive_tracks, 0);
  if (exclusiveTracksSum !== overview.storage.exclusive_audio_tracks) {
    fail(
      "users.storage.exclusive_tracks",
      `Summe (${exclusiveTracksSum}) muss „overview.storage.exclusive_audio_tracks“ (${overview.storage.exclusive_audio_tracks}) entsprechen`,
    );
  }

  return {
    range,
    generated_at: generatedAt,
    request_tracking_since: trackingSince,
    overview,
    users,
  };
}

export function decodeAdminUserUsageDetail(value: unknown): AdminUserUsageDetailResponse {
  const root = requireObject(value, "AdminUserUsageDetailResponse");
  const range = requireRange(root.range, "range");
  const generatedAt = requireIsoTimestamp(root.generated_at, "generated_at");
  const trackingSince = requireNullableIsoTimestamp(
    root.request_tracking_since,
    "request_tracking_since",
  );
  const user = decodeUserSummary(root.user, "user");
  const storageBreakdown = decodeUserStorageBreakdown(
    root.storage_breakdown,
    "storage_breakdown",
  );

  if (storageBreakdown.exclusive_bytes !== user.storage.exclusive_bytes) {
    fail("storage_breakdown.exclusive_bytes", "muss „user.storage.exclusive_bytes“ entsprechen");
  }
  if (storageBreakdown.accessed_bytes !== user.storage.accessed_bytes) {
    fail("storage_breakdown.accessed_bytes", "muss „user.storage.accessed_bytes“ entsprechen");
  }

  const requestsBySource = requireArray(root.requests_by_source, "requests_by_source").map(
    (entry, index) => decodeRequestSourceStat(entry, `requests_by_source[${index}]`),
  );
  const activeDevices = requireArray(root.active_devices, "active_devices").map(
    (entry, index) => decodeConnectDevice(entry, `active_devices[${index}]`),
  );
  const topTracks = requireArray(root.top_tracks, "top_tracks").map((entry, index) =>
    decodeStatEntry(entry, `top_tracks[${index}]`, false),
  );
  const topArtists = requireArray(root.top_artists, "top_artists").map((entry, index) =>
    decodeStatEntry(entry, `top_artists[${index}]`, true),
  );
  const recentPlays = requireArray(root.recent_plays, "recent_plays").map((entry, index) =>
    decodeRecentPlay(entry, `recent_plays[${index}]`),
  );
  const recentRequests = requireArray(root.recent_requests, "recent_requests").map(
    (entry, index) => decodeRecentTrackRequest(entry, `recent_requests[${index}]`),
  );

  return {
    range,
    generated_at: generatedAt,
    request_tracking_since: trackingSince,
    user,
    storage_breakdown: storageBreakdown,
    requests_by_source: requestsBySource,
    active_devices: activeDevices,
    top_tracks: topTracks,
    top_artists: topArtists,
    recent_plays: recentPlays,
    recent_requests: recentRequests,
  };
}

/** Normalize a URL query parameter into a valid timeframe range. */
export function parseUsageRange(raw: string | null | undefined): AdminUsageRange {
  if (raw === "7d" || raw === "30d" || raw === "all") return raw;
  return "all";
}

export function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    fail("Speicherwert", "muss eine nicht-negative ganze Zahl sein");
  }
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  if (index >= units.length) {
    fail("Speicherwert", "muss kleiner als 1 PB sein");
  }
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    fail("Hörzeit", "muss eine nicht-negative ganze Zahl in Sekunden sein");
  }
  if (seconds === 0) return "0 Min.";
  if (seconds < 60) return "< 1 Min.";
  const totalMinutes = Math.floor(seconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours === 0) return `${minutes} Min.`;
  if (totalHours < 48) {
    return minutes > 0 ? `${totalHours} Std. ${minutes} Min.` : `${totalHours} Std.`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days} T. ${hours} Std.` : `${days} T.`;
}

const shortDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const fullDateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatFullDateTime(iso: string | null): string | undefined {
  if (iso === null) return undefined;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    fail("Zeitstempel", "muss ein gültiger ISO-8601-Zeitstempel sein");
  }
  return fullDateTimeFormatter.format(new Date(ms));
}

export function formatRelativeTimestamp(
  iso: string | null,
  nowMs: number = Date.now(),
): string {
  if (iso === null) return "Nie";
  const thenMs = Date.parse(iso);
  if (Number.isNaN(thenMs)) {
    fail("Zeitstempel", "muss ein gültiger ISO-8601-Zeitstempel sein");
  }
  const diffSec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (diffSec < 60) return "gerade eben";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `vor ${diffHours} Std.`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "gestern";
  if (diffDays < 7) return `vor ${diffDays} Tagen`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? "vor 1 Woche" : `vor ${weeks} Wochen`;
  }
  return shortDateFormatter.format(new Date(thenMs));
}

function pct(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.min(100, (part / total) * 100);
}

export function computeStorageShares(storage: AdminOverviewStorage): {
  exclusivePct: number;
  sharedPct: number;
  unattributedPct: number;
  diskUsedPct: number;
} {
  return {
    exclusivePct: pct(storage.exclusive_audio_bytes, storage.total_audio_bytes),
    sharedPct: pct(storage.shared_audio_bytes, storage.total_audio_bytes),
    unattributedPct: pct(storage.unattributed_audio_bytes, storage.total_audio_bytes),
    diskUsedPct: pct(storage.disk_used, storage.disk_total),
  };
}

export function computeUserStorageShares(
  storage: AdminUserStorage,
  totalCacheBytes: number,
): {
  exclusivePct: number;
  sharedPct: number;
  accessedPct: number;
  materializedPct: number;
  pinnedPct: number;
} {
  return {
    exclusivePct: pct(storage.exclusive_bytes, totalCacheBytes),
    sharedPct: pct(storage.shared_bytes, totalCacheBytes),
    accessedPct: pct(storage.accessed_bytes, totalCacheBytes),
    materializedPct: pct(storage.materialized_bytes, totalCacheBytes),
    pinnedPct: pct(storage.pinned_bytes, totalCacheBytes),
  };
}

function sortNumericValue(user: AdminUserUsageSummary, key: UsageSortKey): number {
  switch (key) {
    case "plays":
      return user.plays;
    case "listening_sec":
      return user.listening_sec;
    case "tracks_requested":
      return user.tracks_requested;
    case "exclusive_bytes":
      return user.storage.exclusive_bytes;
    case "accessed_bytes":
      return user.storage.accessed_bytes;
    case "last_active_at":
      return user.last_active_at ? Date.parse(user.last_active_at) : -1;
  }
}

/** Readable label for a user whose optional display_name is null. */
export function userDisplayName(user: {
  display_name: string | null;
  email: string;
}): string {
  return user.display_name || user.email;
}

export function filterAndSortUsers(
  users: readonly AdminUserUsageSummary[],
  query: string,
  sortKey: UsageSortKey,
  sortDir: UsageSortDirection,
): AdminUserUsageSummary[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? users.filter(
        (user) =>
          (user.display_name ?? "").toLowerCase().includes(needle) ||
          user.email.toLowerCase().includes(needle),
      )
    : [...users];

  const factor = sortDir === "asc" ? 1 : -1;
  return filtered.sort((a, b) => {
    // Keep never-active users at the bottom regardless of asc/desc when sorting by last_active_at.
    if (sortKey === "last_active_at") {
      if (a.last_active_at === null && b.last_active_at !== null) return 1;
      if (a.last_active_at !== null && b.last_active_at === null) return -1;
    }
    const diff = (sortNumericValue(a, sortKey) - sortNumericValue(b, sortKey)) * factor;
    if (diff !== 0) return diff;
    return userDisplayName(a).localeCompare(userDisplayName(b), "de-DE");
  });
}
