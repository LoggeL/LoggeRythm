"""Normalized Track shape used across the whole API (in and out)."""
import json

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
    fans: int = 0
    albums_count: int = 0
    top: list[Track] = Field(default_factory=list)
    albums: list[AlbumSummary] = Field(default_factory=list)
    related: list[ArtistSummary] = Field(default_factory=list)
