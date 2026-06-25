"""Schema for resolving an external (Spotify) link into playable tracks."""
from pydantic import BaseModel, Field

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
