"""Playlist request/response schemas."""
from typing import Annotated

from pydantic import BaseModel, Field

from .track import Track


class PlaylistCreate(BaseModel):
    name: str
    description: str | None = None


class PlaylistUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


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
    tracks: list[PlaylistTrackEntry]
