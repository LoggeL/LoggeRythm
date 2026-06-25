"""Playlist request/response schemas."""
from pydantic import BaseModel

from .track import Track


class PlaylistCreate(BaseModel):
    name: str
    description: str | None = None


class PlaylistUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class PlaylistReorder(BaseModel):
    deezer_ids: list[str]


class PlaylistSummary(BaseModel):
    id: int
    name: str
    description: str | None = None
    cover_url: str | None = None
    track_count: int
    is_public: bool = False
    owner_name: str | None = None


class PlaylistDetail(BaseModel):
    id: int
    name: str
    description: str | None = None
    cover_url: str | None = None
    is_public: bool = False
    is_owner: bool = False
    owner_name: str | None = None
    tracks: list[Track]
