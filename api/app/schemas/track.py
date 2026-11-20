"""Normalized Track shape used across the whole API (in and out)."""
import json

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ArtistRef(BaseModel):
    """A single performer on a track (a track can have several)."""
    id: str | int = ""
    name: str = ""


class Track(BaseModel):
    @field_validator("loudness_gain_db", "loudness_lufs", "loudness_peak", mode="before")
    @classmethod
    def nullable_loudness_sentinel(cls, value: object) -> object:
        """Tolerate Android bridge JSON null sentinels for optional loudness fields.

        Some restored native media-item snapshots can feed the existing full-Track
        like request with the string form of a JSON null. The like endpoint does
        not persist these optional fields, so normalize only the exact sentinel
        instead of rejecting the whole track mutation.
        """
        if isinstance(value, str) and value.strip().lower() == "null":
            return None
        return value

    id: str
    title: str = ""
    # ``artist``/``artist_id`` stay the canonical *primary* performer (used for
    # lyrics/Last.fm lookups, titles, play history). ``artists`` carries the
    # full credit list when a track has more than one performer.
    artist: str = ""
    artist_id: str | int = ""
    artists: list[ArtistRef] = Field(default_factory=list)
    album: str = ""
    album_id: str | int = ""
    cover: str = ""
    duration_sec: int = 0
    preview_url: str | None = None
    # Deezer popularity rank (0–~1,000,000); 0 when unknown.
    rank: int = 0
    # Release date (YYYY-MM-DD) — populated by the release radar; "" elsewhere.
    release_date: str = ""
    # ReplayGain/R128-compatible loudness metadata, optional because most catalog
    # responses do not include it. Clients apply a bounded attenuation-only gain.
    loudness_gain_db: float | None = None
    loudness_lufs: float | None = None
    loudness_peak: float | None = None


class RadarReason(BaseModel):
    """Why a track is in the release radar.

    Names the *watched source artist* whose Deezer release list produced the
    track. That artist is not necessarily the track's primary artist: a
    watched artist's release list also contains releases they only contribute
    to, and that difference is exactly what the listener needs to see.
    """
    # "followed" wins when the source artist is both followed and played.
    kind: Literal["followed", "played"]
    artist_id: str
    # The name the user's own follow/play rows carry for that artist. "" only
    # when neither a follow row nor any play in the window stored a name (both
    # columns legitimately default to ""); a name is never invented.
    artist_name: str
    # The user's plays of the source artist in the radar window (last 90 days).
    play_count: int = Field(ge=0)


class RadarTrack(Track):
    """A release-radar track: the normal ``Track`` plus why it is there.

    Response-only. ``Track`` itself stays untouched because it is also the
    request body for likes, playlists and party queues, where a radar reason
    would be meaningless.
    """
    radar_reason: RadarReason


# --- performer-list persistence helpers -----------------------------------
# Track-bearing tables (likes, playlist_tracks, plays, party_tracks) store the
# full performer credit list as a JSON string in an ``artists_json`` column.
# These helpers are the single source of truth for that (de)serialization.

def primary_artists(track: Track) -> list[ArtistRef]:
    """The performer list to persist: the explicit ``artists`` if present,
    otherwise the single primary artist, otherwise empty."""
    if track.artists:
        return track.artists
    if track.artist:
        return [ArtistRef(id=str(track.artist_id or ""), name=track.artist)]
    return []


def dump_artists(track: Track) -> str:
    """Serialize a track's performer list to the stored JSON string."""
    return json.dumps(
        [{"id": str(a.id or ""), "name": a.name} for a in primary_artists(track)],
        ensure_ascii=False,
    )


def load_artists(
    raw: str | None, fallback_name: str = "", fallback_id: str | int = ""
) -> list[ArtistRef]:
    """Parse a stored ``artists_json`` string back into ``ArtistRef`` objects.

    Falls back to a single primary artist for rows written before the column
    existed (where ``raw`` is empty/``"[]"``).
    """
    if raw:
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            data = []
        refs = [
            ArtistRef(id=str(d.get("id", "") or ""), name=d.get("name", "") or "")
            for d in data
            if isinstance(d, dict) and d.get("name")
        ]
        if refs:
            return refs
    if fallback_name:
        return [ArtistRef(id=str(fallback_id or ""), name=fallback_name)]
    return []


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


class AlbumGenre(BaseModel):
    """A Deezer genre an album is filed under (Deezer genre id, localised name)."""

    id: str
    name: str


class AlbumDetail(BaseModel):
    id: str
    title: str = ""
    artist: str = ""
    artist_id: str | int = ""
    cover: str = ""
    release_date: str = ""
    nb_tracks: int = 0
    # Deezer's genres for the album, most specific first; empty when Deezer files
    # the album under none. Drives the fullscreen visualizer's scene choice.
    genres: list[AlbumGenre] = Field(default_factory=list)
    tracks: list[Track] = Field(default_factory=list)


class ArtistDetail(BaseModel):
    id: str
    name: str = ""
    picture: str = ""
    fans: int = 0
    albums_count: int = 0
    top: list[Track] = Field(default_factory=list)
    albums: list[AlbumSummary] = Field(default_factory=list)
    related: list[ArtistSummary] = Field(default_factory=list)
