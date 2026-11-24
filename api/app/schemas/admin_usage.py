"""Response schemas for the admin usage dashboard endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from .connect import DeviceType
from .stats import StatEntry

UsageRange = Literal["7d", "30d", "all"]
TrackRequestSource = Literal[
    "stream",
    "preload",
    "playlist_export",
    "party_preload",
    "radar_preload",
    "lyrics_ai",
]


class AdminOverviewStorage(BaseModel):
    cached_tracks: int
    total_audio_bytes: int
    exclusive_audio_bytes: int
    exclusive_audio_tracks: int
    shared_audio_bytes: int
    shared_audio_tracks: int
    unattributed_audio_bytes: int
    unattributed_audio_tracks: int
    directly_attributed_tracks: int
    directly_attributed_bytes: int
    upload_bytes: int
    disk_total: int
    disk_used: int
    disk_free: int
    retention_days: int


class AdminUsageOverview(BaseModel):
    total_users: int
    approved_users: int
    pending_users: int
    active_users: int
    total_plays: int
    total_listening_sec: int
    unique_tracks_played: int
    tracks_requested: int
    tracks_materialized: int
    materialized_bytes: int
    online_connect_devices: int
    online_connect_users: int
    active_parties: int
    storage: AdminOverviewStorage


class AdminUserStorage(BaseModel):
    exclusive_bytes: int
    exclusive_tracks: int
    shared_bytes: int
    shared_tracks: int
    accessed_bytes: int
    accessed_tracks: int
    materialized_bytes: int
    materialized_tracks: int
    pinned_bytes: int
    pinned_tracks: int
    upload_bytes: int


class AdminUserStorageBreakdown(AdminUserStorage):
    total_cache_bytes: int


class AdminUserLibrary(BaseModel):
    likes: int
    playlists: int
    public_playlists: int
    playlist_tracks: int
    follows: int
    party_tracks_added: int
    party_hosted: int
    import_jobs: int
    import_tracks_matched: int


class AdminUserUsageSummary(BaseModel):
    id: int
    email: str
    display_name: str | None = None
    avatar_url: str | None = None
    is_admin: bool
    is_approved: bool
    created_at: datetime | None = None
    last_active_at: datetime | None = None
    plays: int
    listening_sec: int
    unique_tracks: int
    tracks_requested: int
    tracks_materialized: int
    materialized_bytes: int
    storage: AdminUserStorage
    library: AdminUserLibrary
    online_devices: int
    is_playing_now: bool
    active_device_name: str | None = None
    active_party_code: str | None = None


class AdminUsageOverviewResponse(BaseModel):
    range: UsageRange
    generated_at: datetime
    request_tracking_since: datetime | None = None
    overview: AdminUsageOverview
    users: list[AdminUserUsageSummary]


class AdminRequestSourceStat(BaseModel):
    source: TrackRequestSource
    requests: int
    materialized: int
    materialized_bytes: int


class AdminConnectDevice(BaseModel):
    device_id: str
    name: str
    device_type: DeviceType
    is_active: bool
    party_code: str | None = None
    connected_at: datetime
    last_seen_at: datetime


class AdminRecentPlay(BaseModel):
    id: str
    title: str
    artist: str
    album: str
    cover: str
    duration_sec: int
    played_at: datetime


class AdminRecentTrackRequest(BaseModel):
    deezer_id: str
    title: str
    artist: str
    cover: str
    source: TrackRequestSource
    materialized: bool
    size_bytes: int
    requested_at: datetime
    is_currently_stored: bool


class AdminUserUsageDetailResponse(BaseModel):
    range: UsageRange
    generated_at: datetime
    request_tracking_since: datetime | None = None
    user: AdminUserUsageSummary
    storage_breakdown: AdminUserStorageBreakdown
    requests_by_source: list[AdminRequestSourceStat]
    active_devices: list[AdminConnectDevice]
    top_tracks: list[StatEntry]
    top_artists: list[StatEntry]
    recent_plays: list[AdminRecentPlay]
    recent_requests: list[AdminRecentTrackRequest]
