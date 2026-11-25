"""Playlist request/response schemas."""
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, EmailStr, Field

from .track import Track


class PlaylistCreate(BaseModel):
    name: str
    description: str | None = None
    is_collaborative: bool = False


class PlaylistUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class PlaylistCollaborativeUpdate(BaseModel):
    is_collaborative: bool


class PlaylistCollaboratorAdd(BaseModel):
    email: EmailStr


class PlaylistCollaboratorUser(BaseModel):
    """Public-safe user identity used for playlist owners and track attribution."""

    id: int
    display_name: str | None = None
    avatar_url: str | None = None


class PlaylistCollaboratorOut(BaseModel):
    """A non-owner collaborator on a playlist."""

    user_id: int
    display_name: str | None = None
    avatar_url: str | None = None
    role: Literal["owner", "editor"] = "editor"
    joined_at: datetime | None = None


class PlaylistInviteOut(BaseModel):
    """Active shareable invite token for a collaborative playlist."""

    token: str
    created_at: datetime
    expires_at: datetime | None = None


class PlaylistInviteStatus(BaseModel):
    """Owner-only view of the active invite link (or null if none/revoked)."""

    invite: PlaylistInviteOut | None = None


class PlaylistInvitePreview(BaseModel):
    """Metadata shown to an authenticated account before accepting an invite link."""

    playlist_id: int
    name: str
    description: str | None = None
    cover_url: str | None = None
    track_count: int = 0
    collaborator_count: int = 0
    owner: PlaylistCollaboratorUser
    is_owner: bool = False
    already_collaborator: bool = False


class PlaylistJoinResult(BaseModel):
    """Result of accepting a collaborative playlist invite link."""

    playlist_id: int
    playlist_name: str
    joined: bool
    already_member: bool = False
    role: Literal["owner", "editor"]


class PlaylistReorder(BaseModel):
    deezer_ids: list[str]


PlaylistEntryId = Annotated[int, Field(gt=0)]


class PlaylistEntryReorder(BaseModel):
    """Complete ordered playlist-entry identity snapshot.

    This deliberately does not overload ``PlaylistReorder``: v1 clients keep
    their Deezer-ID request while v2 clients can address duplicate occurrences.
    """

    entry_ids: list[PlaylistEntryId]


class PlaylistTrackEntry(Track):
    """A catalog track at one stable occurrence inside a playlist."""

    playlist_entry_id: PlaylistEntryId
    added_by: PlaylistCollaboratorUser | None = None
    added_at: datetime | None = None


class PlaylistSummary(BaseModel):
    id: int
    name: str
    description: str | None = None
    cover_url: str | None = None
    track_count: int
    is_public: bool = False
    owner_name: str | None = None
    owner_id: int | None = None
    owner_avatar_url: str | None = None
    is_collaborative: bool = False
    is_owner: bool = False
    is_collaborator: bool = False
    can_edit_tracks: bool = False
    collaborator_count: int = 0


class PlaylistDetail(BaseModel):
    id: int
    name: str
    description: str | None = None
    cover_url: str | None = None
    is_public: bool = False
    is_owner: bool = False
    owner_name: str | None = None
    owner_id: int | None = None
    owner_avatar_url: str | None = None
    is_collaborative: bool = False
    is_collaborator: bool = False
    can_edit_tracks: bool = False
    collaborators: list[PlaylistCollaboratorOut] = Field(default_factory=list)
    collaborator_count: int = 0
    revision: int = 0
    tracks: list[PlaylistTrackEntry]


class OfflineLyricsEntry(BaseModel):
    lines: list[dict[str, Any]] = Field(default_factory=list)
    synced: bool = False
    source: str = ""
    ai_generated: bool = False
    instrumental: bool = False


class PlaylistSyncTrackItem(BaseModel):
    playlist_entry_id: PlaylistEntryId
    deezer_id: str
    title: str = ""
    artist: str = ""
    duration_sec: int = 0
    is_stored: bool = False
    size_bytes: int | None = None
    audio_format: str | None = None
    loudness_gain_db: float | None = None
    loudness_lufs: float | None = None
    loudness_peak: float | None = None
    has_lyrics: bool = False


class PlaylistSyncManifest(BaseModel):
    playlist_id: int
    revision: int
    track_count: int
    stored_count: int
    total_known_bytes: int
    tracks: list[PlaylistSyncTrackItem] = Field(default_factory=list)
    lyrics: dict[str, OfflineLyricsEntry] | None = None


class PlaylistDuplicateGroup(BaseModel):
    keep_entry_id: PlaylistEntryId
    duplicate_entry_ids: list[PlaylistEntryId]
    title: str = ""
    artist: str = ""
    isrc: str = ""


class PlaylistDuplicatesOut(BaseModel):
    playlist_id: int
    total_duplicates: int
    groups: list[PlaylistDuplicateGroup] = Field(default_factory=list)


class PlaylistDeduplicateResult(BaseModel):
    playlist_id: int
    groups_merged: int
    removed_count: int
    removed_entry_ids: list[PlaylistEntryId] = Field(default_factory=list)
    revision: int


class PlaylistBlendOut(BaseModel):
    playlist: PlaylistDetail
    match_percent: int = Field(ge=0, le=100)
    shared_artists: list[str] = Field(default_factory=list)
    shared_tracks_count: int = 0
    other_user: PlaylistCollaboratorUser
