"""Pydantic v2 wire schemas for LoggeRythm Wrapped & Share Cards."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .stats import (
    InsightsRange,
    NonNegativeCount,
    PositiveCount,
)

WrappedChronotype = Literal[
    "night_owl",
    "early_bird",
    "day_cruiser",
    "evening_viber",
]

WrappedEmblemId = Literal[
    "moon_wave",
    "infinite_vinyl",
    "compass_radar",
    "tonearm_disc",
    "strobe_bars",
    "sunrise_pulse",
    "flame_metro",
    "prism_beat",
]

WrappedEquivalentIcon = Literal[
    "vinyl",
    "movie",
    "flight",
    "marathon",
    "concert",
]

WrappedCardTemplate = Literal[
    "summary",
    "persona",
    "receipt",
    "festival",
    "obsession",
    "aura",
    "peak",
]

WrappedCardTheme = Literal[
    "signal",
    "cover",
    "vinyl",
    "neon",
    "paper",
]

WrappedCardFormat = Literal[
    "story",
    "square",
]

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class WrappedUser(BaseModel):
    display_name: str
    avatar_url: str


class WrappedTotals(BaseModel):
    play_count: NonNegativeCount
    listening_sec: NonNegativeCount
    unique_tracks: NonNegativeCount
    unique_artists: NonNegativeCount
    unique_albums: NonNegativeCount
    new_artists_count: NonNegativeCount
    active_days: NonNegativeCount
    total_days: NonNegativeCount
    avg_daily_sec: NonNegativeCount
    current_streak_days: NonNegativeCount
    longest_streak_days: NonNegativeCount


class WrappedPersona(BaseModel):
    id: str
    title: str
    subtitle: str
    tagline: str
    emblem: WrappedEmblemId
    traits: list[str] = Field(min_length=3, max_length=3)


class WrappedAura(BaseModel):
    id: str
    title: str
    description: str
    colors: list[str] = Field(min_length=3, max_length=3)
    mood_tags: list[str] = Field(min_length=3, max_length=3)

    @field_validator("colors")
    @classmethod
    def validate_hex_colors(cls, value: list[str]) -> list[str]:
        for idx, color in enumerate(value):
            if _HEX_COLOR_RE.fullmatch(color) is None:
                raise ValueError(f"aura.colors[{idx}] must be a #RRGGBB hex color, got {color!r}")
        return value


class WrappedRhythm(BaseModel):
    chronotype: WrappedChronotype
    chronotype_label: str
    peak_hour: int = Field(ge=0, le=23)
    peak_weekday: int = Field(ge=0, le=6)
    weekend_share_pct: int = Field(ge=0, le=100)
    discovery_score_pct: int = Field(ge=0, le=100)
    repeat_score_pct: int = Field(ge=0, le=100)
    hourly_distribution: list[NonNegativeCount] = Field(min_length=24, max_length=24)
    weekday_distribution: list[NonNegativeCount] = Field(min_length=7, max_length=7)


class WrappedObsession(BaseModel):
    track_key: str
    title: str
    artist: str
    album: str
    cover: str
    play_count: NonNegativeCount
    listening_sec: NonNegativeCount
    share_pct: int = Field(ge=0, le=100)
    peak_day_date: str | None
    peak_day_plays: NonNegativeCount


class WrappedPeakDay(BaseModel):
    date: str
    weekday: int = Field(ge=0, le=6)
    play_count: NonNegativeCount
    listening_sec: NonNegativeCount
    top_track_title: str
    top_track_artist: str
    top_track_cover: str


class WrappedTempo(BaseModel):
    avg_bpm: PositiveCount
    min_bpm: PositiveCount
    max_bpm: PositiveCount
    analyzed_plays: NonNegativeCount
    vibe_label: str


class WrappedEquivalent(BaseModel):
    icon: WrappedEquivalentIcon
    value: str
    label: str


class WrappedRankedItem(BaseModel):
    rank: int = Field(ge=1, le=10)
    key: str
    label: str
    sublabel: str
    cover: str
    count: PositiveCount
    listening_sec: NonNegativeCount
    share_pct: int = Field(ge=0, le=100)


class WrappedReport(BaseModel):
    range: InsightsRange
    generated_at: datetime
    period_start: datetime | None
    period_end: datetime
    user: WrappedUser
    totals: WrappedTotals
    persona: WrappedPersona | None
    aura: WrappedAura | None
    rhythm: WrappedRhythm
    obsession: WrappedObsession | None
    peak_day: WrappedPeakDay | None
    tempo: WrappedTempo | None
    equivalents: list[WrappedEquivalent]
    top_tracks: list[WrappedRankedItem] = Field(max_length=10)
    top_artists: list[WrappedRankedItem] = Field(max_length=10)
    top_albums: list[WrappedRankedItem] = Field(max_length=10)
