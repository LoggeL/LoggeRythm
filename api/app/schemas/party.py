"""Schemas for collaborative party sessions."""
from typing import Literal

from pydantic import BaseModel, Field

from .track import ArtistRef


class PartyTrackOut(BaseModel):
    id: int
    deezer_id: str
    title: str = ""
    artist: str = ""
    artist_id: str = ""
    artists: list[ArtistRef] = Field(default_factory=list)
    album: str = ""
    album_id: str = ""
    cover: str = ""
    duration_sec: int = 0
    loudness_gain_db: float | None = None
    added_by: str = ""
    # Member key of whoever added it ("u:<id>" / "g:<id>", "" if unknown);
    # compare with ``PartyState.viewer_key`` to find your own additions.
    added_by_member: str = ""
    added_by_avatar_url: str | None = None
    # Authoritative server-cache availability (matches normal stored/downloaded
    # track icons for both signed-in members and anonymous guests).
    is_stored: bool = False
    # Server cache state of the audio: ready (loaded), loading (downloading
    # now), queued (waiting to be loaded in the background), failed, or idle
    # (not loaded and not scheduled).
    load_state: Literal["ready", "loading", "queued", "failed", "idle"] = "idle"
    # Cause of the last failed background load, only for ``failed``.
    load_error: str | None = None


class PartyMemberOut(BaseModel):
    key: str = ""
    name: str = ""
    avatar_url: str | None = None
    # Joined anonymously with a nickname (no account).
    is_guest: bool = False
    is_host: bool = False


class PartyGuestJoin(BaseModel):
    nickname: str = Field(min_length=1, max_length=40)


class PartySettingsUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    guests_can_control: bool | None = None
    auto_dj: bool | None = None


class PartyCachedTracks(BaseModel):
    ids: list[str] = Field(default_factory=list)


class PartyReactionOut(BaseModel):
    id: str
    emoji: str
    member_key: str
    member_name: str
    created_at: str


class PartyReactIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class PartySavePlaylistIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    collaborative: bool = False


class PartyHostTransferIn(BaseModel):
    member_key: str = Field(min_length=3, max_length=24)


class PartyState(BaseModel):
    code: str
    name: str = ""
    host_name: str = ""
    is_host: bool = False
    guests_can_control: bool = False
    auto_dj: bool = False
    current_index: int = -1
    # Host-authoritative (or shared-control) playback state, broadcast via SSE.
    is_playing: bool = False
    position_sec: float = 0.0
    # ISO-8601 timestamp of the last playback update, or None if never set.
    playback_updated_at: str | None = None
    # Member key ("u:<id>" / "g:<id>") of whoever last mutated playback/current.
    playback_changed_by: str = ""
    # Monotonic counter bumped on explicit playback/current mutations.
    playback_revision: int = 0
    # Ephemeral live Party Jam 2.0 state (skip votes + latest emoji reaction burst).
    skip_votes: list[str] = Field(default_factory=list)
    skip_votes_needed: int = 1
    latest_reaction: PartyReactionOut | None = None
    # True on the terminal SSE frame broadcast when the host ends the Jam.
    ended: bool = False
    # Server UTC timestamp (ISO-8601) when this state snapshot was emitted.
    server_time: str = ""
    members: list[PartyMemberOut] = Field(default_factory=list)
    tracks: list[PartyTrackOut] = Field(default_factory=list)
    # Per-viewer fields, stamped for each connection like ``is_host``.
    viewer_key: str = ""
    viewer_name: str = ""
    viewer_is_guest: bool = False


class PartyVoteSkipOut(BaseModel):
    code: str
    track_item_id: int
    votes: list[str] = Field(default_factory=list)
    votes_needed: int
    skipped: bool = False
    state: PartyState
