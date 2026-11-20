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
    added_by: str = ""
    # Member key of whoever added it ("u:<id>" / "g:<id>", "" if unknown);
    # compare with ``PartyState.viewer_key`` to find your own additions.
    added_by_member: str = ""
    # Server cache state of the audio: ready (loaded), loading (downloading
    # now), queued (waiting to be loaded in the background), failed, or idle
    # (not loaded and not scheduled).
    load_state: Literal["ready", "loading", "queued", "failed", "idle"] = "idle"
    # Cause of the last failed background load, only for ``failed``.
    load_error: str | None = None


class PartyMemberOut(BaseModel):
    name: str = ""
    avatar_url: str | None = None
    # Joined anonymously with a nickname (no account).
    is_guest: bool = False


class PartyGuestJoin(BaseModel):
    nickname: str = Field(min_length=1, max_length=40)


class PartyState(BaseModel):
    code: str
    name: str = ""
    host_name: str = ""
    is_host: bool = False
    current_index: int = -1
    # Host-authoritative playback state, broadcast to guests.
    is_playing: bool = False
    position_sec: float = 0.0
    # ISO-8601 timestamp of the last playback update, or None if never set.
    playback_updated_at: str | None = None
    members: list[PartyMemberOut] = Field(default_factory=list)
    tracks: list[PartyTrackOut] = Field(default_factory=list)
    # Per-viewer fields, stamped for each connection like ``is_host``.
    viewer_key: str = ""
    viewer_name: str = ""
    viewer_is_guest: bool = False
