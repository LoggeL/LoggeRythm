"""Schemas for collaborative party sessions."""
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


class PartyMemberOut(BaseModel):
    name: str = ""
    avatar_url: str | None = None


class PartyState(BaseModel):
    code: str
    name: str = ""
    host_name: str = ""
    is_host: bool = False
    current_index: int = -1
    members: list[PartyMemberOut] = Field(default_factory=list)
    tracks: list[PartyTrackOut] = Field(default_factory=list)
