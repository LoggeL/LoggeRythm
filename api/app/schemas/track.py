"""Normalized Track shape used across the whole API (in and out)."""
from pydantic import BaseModel, Field


class Track(BaseModel):
    id: str
    title: str = ""
    artist: str = ""
    artist_id: str | int = ""
    album: str = ""
    album_id: str | int = ""
    cover: str = ""
    duration_sec: int = 0
    preview_url: str | None = None
    # Deezer popularity rank (0–~1,000,000); 0 when unknown.
    rank: int = 0


class AlbumSummary(BaseModel):
    id: str
    title: str = ""
    artist: str = ""
    cover: str = ""
    release_date: str = ""


class ArtistSummary(BaseModel):
    id: str
    name: str = ""
    picture: str = ""


class PlaylistSearchResult(BaseModel):
    id: str
    title: str = ""
    cover: str = ""
    track_count: int = 0


class Genre(BaseModel):
    id: str
    name: str = ""
    picture: str = ""


class GenreDetail(BaseModel):
    id: str
    name: str = ""
    picture: str = ""
    tracks: list["Track"] = Field(default_factory=list)
    albums: list["AlbumSummary"] = Field(default_factory=list)
    artists: list["ArtistSummary"] = Field(default_factory=list)


class AlbumDetail(BaseModel):
    id: str
    title: str = ""
    artist: str = ""
    artist_id: str | int = ""
    cover: str = ""
    release_date: str = ""
    nb_tracks: int = 0
    tracks: list[Track] = Field(default_factory=list)


class ArtistDetail(BaseModel):
    id: str
    name: str = ""
    picture: str = ""
    top: list[Track] = Field(default_factory=list)
    albums: list[AlbumSummary] = Field(default_factory=list)
    related: list[ArtistSummary] = Field(default_factory=list)
