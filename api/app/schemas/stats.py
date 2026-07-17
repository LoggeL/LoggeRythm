"""Response schemas for personal listening statistics."""

from typing import Annotated

from pydantic import BaseModel, Field, model_validator

# Older rows and upstream catalog payloads may carry textual or numeric
# references. Text stays intentionally permissive for stored legacy values;
# numeric wire values must still be non-negative and safe to canonicalize.
MAX_SAFE_WIRE_INTEGER = 9_007_199_254_740_991
LegacyDeezerId = str | Annotated[
    int,
    Field(ge=0, le=MAX_SAFE_WIRE_INTEGER),
]
PositiveCount = Annotated[int, Field(gt=0, le=MAX_SAFE_WIRE_INTEGER)]
NonNegativeCount = Annotated[int, Field(ge=0, le=MAX_SAFE_WIRE_INTEGER)]


class StatsArtistRef(BaseModel):
    id: LegacyDeezerId = ""
    name: str = ""


class StatEntry(BaseModel):
    key: LegacyDeezerId
    label: str
    sublabel: str = ""
    # Missing artwork is a valid media state, represented consistently on the
    # API wire as the empty string used by the other catalog responses.
    cover: str = ""
    count: PositiveCount


class RecentPlay(BaseModel):
    """Exact persisted-history projection returned by ``GET /api/me/stats``."""

    id: LegacyDeezerId
    title: str
    artist: str = ""
    artist_id: LegacyDeezerId = ""
    artists: list[StatsArtistRef] = Field(default_factory=list, max_length=100)
    album: str = ""
    album_id: LegacyDeezerId = ""
    cover: str = ""
    duration_sec: NonNegativeCount = 0


class UserStats(BaseModel):
    total_plays: NonNegativeCount
    top_tracks: list[StatEntry] = Field(max_length=10)
    top_artists: list[StatEntry] = Field(max_length=10)
    recent: list[RecentPlay] = Field(max_length=20)
    total_plays_month: NonNegativeCount
    top_tracks_month: list[StatEntry] = Field(max_length=10)
    top_artists_month: list[StatEntry] = Field(max_length=10)

    @model_validator(mode="after")
    def validate_periods(self) -> "UserStats":
        if self.total_plays_month > self.total_plays:
            raise ValueError("total_plays_month must not exceed total_plays")

        self._validate_period(
            "all-time",
            self.total_plays,
            self.top_tracks,
            self.top_artists,
            require_recent=True,
        )
        self._validate_period(
            "last-30-days",
            self.total_plays_month,
            self.top_tracks_month,
            self.top_artists_month,
            require_recent=False,
        )
        if len(self.recent) > self.total_plays:
            raise ValueError("recent must not contain more rows than total_plays")
        return self

    def _validate_period(
        self,
        label: str,
        total: int,
        tracks: list[StatEntry],
        artists: list[StatEntry],
        *,
        require_recent: bool,
    ) -> None:
        collections = [tracks, artists]
        if require_recent:
            collections.append(self.recent)

        if total == 0 and any(collections):
            raise ValueError(
                f"{label} collections must be empty when the total is zero"
            )
        if total > 0 and any(not collection for collection in collections):
            raise ValueError(
                f"{label} collections must be populated when the total is positive"
            )

        for kind, entries in (("track", tracks), ("artist", artists)):
            if sum(entry.count for entry in entries) > total:
                raise ValueError(
                    f"{label} top-{kind} counts must not exceed the period total"
                )
