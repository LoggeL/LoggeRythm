"""Schema for resolving an external (Spotify) link into playable tracks."""
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .track import Track


class UnmatchedTrack(BaseModel):
    title: str = ""
    artist: str = ""


class ResolveResult(BaseModel):
    type: str  # playlist | album | track
    name: str = ""
    image: str = ""
    total: int = 0  # tracks actually processed (after dedupe + cap)
    source_total: int = 0  # full playlist size on Spotify
    matched: int = 0
    tracks: list[Track] = Field(default_factory=list)
    unmatched: list[UnmatchedTrack] = Field(default_factory=list)


class ImportJobCreate(BaseModel):
    url: str = Field(..., min_length=1, max_length=2000, description="Spotify playlist/album/track link")
    target_playlist_id: int | None = Field(
        default=None,
        description="Optional existing playlist ID to append matched tracks into automatically.",
    )
    create_playlist_name: str | None = Field(
        default=None,
        max_length=200,
        description="Optional new playlist name to create and populate automatically when matching finishes.",
    )


class ImportJobStatus(BaseModel):
    """Progress of a background Spotify import, without the matched tracks."""

    id: str
    url: str
    status: Literal["queued", "running", "done", "failed"]
    type: str = ""  # playlist | album | track, once Spotify answered
    name: str = ""
    image: str = ""
    total: int = 0  # tracks to match (after dedupe + cap)
    source_total: int = 0  # full playlist size on Spotify
    processed: int = 0
    matched: int = 0
    # Deezer lookups that raised; those tracks are listed as unmatched.
    failed_lookups: int = 0
    lookup_error: str | None = None  # first such failure
    error: str | None = None  # why a failed job ended
    target_playlist_id: int | None = None
    create_playlist_name: str | None = None
    created_playlist_id: int | None = None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None = None

    @field_validator("created_at", "updated_at", "finished_at")
    @classmethod
    def _assume_utc(cls, value: datetime | None) -> datetime | None:
        # SQLite hands back naive datetimes for values written as UTC.
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class ImportJobDetail(ImportJobStatus):
    result: ResolveResult | None = None  # set once status is "done"
