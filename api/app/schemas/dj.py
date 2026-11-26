from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class DjTransitionClip(BaseModel):
    """Server-rendered transition clip and its timeline (clip seconds).

    A media time = ``a_start_s + t`` for ``t <= cue_s``; B media time = ``t + b_offset_s``.
    """

    id: str = Field(description="Clip id for GET /api/dj/clips/{clip_id}")
    render_version: int
    duration_s: float
    a_start_s: float
    b_offset_s: float
    cue_s: float
    deck_start_s: float
    join_in_s: float
    primary_seek_s: float
    mix_start_s: float
    bass_swap_s: float
    mix_end_s: float
    join_out_s: float
    a_speed: float
    limiter_reduction_db: float
    a_start_skip_s: float = Field(
        description="Seconds ffmpeg dropped at the start of A's file (LAME delay + 529 samples for tagged MP3, else 0); "
        "the player maps its own position onto the clip's timeline with it",
    )
    b_start_skip_s: float = Field(description="Same for B")


class DjTransition(BaseModel):
    status: Literal["ready", "pending"]
    kind: Literal["beatmatch", "crossfade"] | None = None
    reason: str = Field(description="OK, a crossfade reason code, or what a pending request waits for")
    detail: str | None = None
    retry_after_s: int | None = None
    clip: DjTransitionClip | None = None
