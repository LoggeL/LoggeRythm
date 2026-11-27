"""Personal listening statistics for the current user."""
from datetime import date, datetime, timedelta, timezone
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status
from pydantic import BeforeValidator, WithJsonSchema
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from ..auth import get_current_user
from ..db.models import Play, User
from ..db.session import get_db
from ..schemas.stats import (
    MAX_SAFE_WIRE_INTEGER,
    InsightsRange,
    RecentPlay,
    StatEntry,
    TimestampedPlay,
    UserStats,
    UserStatsInsights,
)
from ..schemas.track import Track, album_cover_url, dump_artists, load_artists
from ..schemas.wrapped import (
    WrappedCardFormat,
    WrappedCardTemplate,
    WrappedCardTheme,
    WrappedReport,
)
from ..services.wrapped import (
    INSIGHTS_RANGE_DAYS as _INSIGHTS_RANGE_DAYS,
    as_utc as _as_utc,
    build_wrapped_report,
    compute_streaks as _compute_streaks,
    load_wrapped_artwork,
    render_wrapped_card_svg,
)

router = APIRouter(prefix="/api/me", tags=["stats"])

_CANONICAL_UUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_CANONICAL_UUID = re.compile(_CANONICAL_UUID_PATTERN)


def _parse_canonical_uuid(value: object) -> UUID:
    """Accept only the standard hyphenated UUID wire representation."""
    if isinstance(value, UUID):
        return value
    if not isinstance(value, str) or _CANONICAL_UUID.fullmatch(value) is None:
        raise ValueError("must be a canonical hyphenated UUID")
    return UUID(value)


PlayIdempotencyKey = Annotated[
    UUID,
    BeforeValidator(_parse_canonical_uuid),
    WithJsonSchema(
        {
            "type": "string",
            "format": "uuid",
            "pattern": _CANONICAL_UUID_PATTERN,
        }
    ),
]


def _top_tracks(db: Session, where: ColumnElement[bool]) -> list[StatEntry]:
    count = func.count().label("count")
    rows = db.execute(
        select(
            Play.deezer_id,
            func.max(Play.title).label("title"),
            func.max(Play.artist).label("artist"),
            func.max(Play.cover_url).label("cover_url"),
            count,
        )
        .where(where)
        .group_by(Play.deezer_id)
        .order_by(count.desc())
        .limit(10)
    ).all()
    return [
        StatEntry(
            key=r.deezer_id,
            label=r.title or "",
            sublabel=r.artist or "",
            cover=r.cover_url or "",
            count=r.count,
        )
        for r in rows
    ]


def _top_artists(db: Session, where: ColumnElement[bool]) -> list[StatEntry]:
    count = func.count().label("count")
    rows = db.execute(
        select(
            Play.artist,
            Play.artist_id,
            count,
        )
        .where(where)
        .group_by(Play.artist, Play.artist_id)
        .order_by(count.desc())
        .limit(10)
    ).all()
    return [
        StatEntry(
            key=r.artist_id or "",
            label=r.artist or "",
            count=r.count,
        )
        for r in rows
    ]


@router.post("/plays", status_code=status.HTTP_204_NO_CONTENT)
def record_play(
    track: Track,
    idempotency_key: Annotated[
        # Deliberately keep the wire annotation non-null while using ``None`` as
        # FastAPI's default for an omitted header. A present HTTP header is
        # always a string; this prevents OpenAPI and generated clients from
        # advertising an impossible nullable wire value.
        PlayIdempotencyKey,
        Header(
            alias="Idempotency-Key",
            description=(
                "Optional canonical UUID that makes this play event idempotent "
                "for the authenticated user."
            ),
        ),
    ] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    db.add(
        Play(
            user_id=user.id,
            event_id=idempotency_key,
            deezer_id=track.id,
            title=track.title,
            artist=track.artist,
            artist_id=str(track.artist_id or ""),
            artists_json=dump_artists(track),
            album=track.album,
            album_id=str(track.album_id or ""),
            cover_url=track.cover or album_cover_url(track.album_id),
            duration_sec=track.duration_sec,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key is None:
            raise
        existing_id = db.scalar(
            select(Play.id)
            .where(
                Play.user_id == user.id,
                Play.event_id == idempotency_key,
            )
            .limit(1)
        )
        if existing_id is None:
            raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stats", response_model=UserStats)
def get_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserStats:
    total_plays = db.scalar(
        select(func.count()).select_from(Play).where(Play.user_id == user.id)
    ) or 0

    all_time = Play.user_id == user.id
    top_tracks = _top_tracks(db, all_time)
    top_artists = _top_artists(db, all_time)

    # Last-30-days view (purely additive).
    month_cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    month_where = (Play.user_id == user.id) & (Play.played_at >= month_cutoff)
    total_plays_month = db.scalar(
        select(func.count()).select_from(Play).where(month_where)
    ) or 0
    top_tracks_month = _top_tracks(db, month_where)
    top_artists_month = _top_artists(db, month_where)

    recent_rows = db.scalars(
        select(Play)
        .where(Play.user_id == user.id)
        .order_by(Play.played_at.desc())
        .limit(20)
    ).all()
    recent = [
        RecentPlay(
            id=p.deezer_id,
            title=p.title,
            artist=p.artist,
            artist_id=p.artist_id,
            artists=[
                a.model_dump()
                for a in load_artists(p.artists_json, p.artist, p.artist_id)
            ][:100],
            album=p.album,
            album_id=p.album_id,
            cover=p.cover_url or "",
            # Stored rows predate the strict response contract. Preserve the
            # history item without letting a legacy negative or JavaScript-
            # unsafe duration turn the complete stats endpoint into a
            # response-validation 500.
            duration_sec=min(
                max(p.duration_sec or 0, 0),
                MAX_SAFE_WIRE_INTEGER,
            ),
        )
        for p in recent_rows
    ]

    return UserStats(
        total_plays=total_plays,
        top_tracks=top_tracks,
        top_artists=top_artists,
        recent=recent,
        total_plays_month=total_plays_month,
        top_tracks_month=top_tracks_month,
        top_artists_month=top_artists_month,
    )


@router.get("/stats/insights", response_model=UserStatsInsights)
def get_stats_insights(
    range: InsightsRange = Query(default="30d"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserStatsInsights:
    """Rich personal listening insights (hours, top albums, streaks, heatmaps, discovery)."""
    now = datetime.now(timezone.utc)
    days = _INSIGHTS_RANGE_DAYS[range]
    cutoff = (now - timedelta(days=days)).replace(tzinfo=None) if days is not None else None

    where: ColumnElement[bool] = Play.user_id == user.id
    if cutoff is not None:
        where = where & (Play.played_at >= cutoff)

    dur_expr = case((Play.duration_sec > 0, Play.duration_sec), else_=0)
    summary = db.execute(
        select(
            func.count(Play.id).label("play_count"),
            func.coalesce(func.sum(dur_expr), 0).label("listening_sec"),
            func.count(func.distinct(Play.deezer_id)).label("unique_tracks"),
            func.count(func.distinct(Play.artist)).label("unique_artists"),
        ).where(where)
    ).one()

    play_count = int(summary.play_count or 0)
    listening_sec = min(int(summary.listening_sec or 0), MAX_SAFE_WIRE_INTEGER)
    unique_tracks = int(summary.unique_tracks or 0)
    unique_artists = int(summary.unique_artists or 0)

    count_col = func.count().label("count")
    top_tracks_rows = db.execute(
        select(
            Play.deezer_id,
            func.max(Play.title).label("title"),
            func.max(Play.artist).label("artist"),
            func.max(Play.cover_url).label("cover_url"),
            count_col,
        )
        .where(where)
        .group_by(Play.deezer_id)
        .order_by(count_col.desc())
        .limit(15)
    ).all()
    top_tracks = [
        StatEntry(
            key=r.deezer_id,
            label=r.title or "",
            sublabel=r.artist or "",
            cover=r.cover_url or "",
            count=r.count,
        )
        for r in top_tracks_rows
    ]

    top_artists_rows = db.execute(
        select(
            Play.artist,
            Play.artist_id,
            func.max(Play.cover_url).label("cover_url"),
            count_col,
        )
        .where(where, Play.artist != "")
        .group_by(Play.artist, Play.artist_id)
        .order_by(count_col.desc())
        .limit(15)
    ).all()
    top_artists = [
        StatEntry(
            key=r.artist_id or "",
            label=r.artist or "",
            cover=r.cover_url or "",
            count=r.count,
        )
        for r in top_artists_rows
    ]

    top_albums_rows = db.execute(
        select(
            Play.album_id,
            Play.album,
            func.max(Play.artist).label("artist"),
            func.max(Play.cover_url).label("cover_url"),
            count_col,
        )
        .where(where, Play.album != "")
        .group_by(Play.album_id, Play.album)
        .order_by(count_col.desc())
        .limit(10)
    ).all()
    top_albums = [
        StatEntry(
            key=r.album_id or "",
            label=r.album or "",
            sublabel=r.artist or "",
            cover=r.cover_url or "",
            count=r.count,
        )
        for r in top_albums_rows
    ]

    timestamps = db.scalars(select(Play.played_at).where(where)).all()
    hourly = [0] * 24
    weekday = [0] * 7
    play_dates: set[date] = set()
    for ts in timestamps:
        if ts is None:
            continue
        utc_ts = _as_utc(ts)
        hourly[utc_ts.hour] += 1
        weekday[utc_ts.weekday()] += 1
        play_dates.add(utc_ts.date())

    current_streak, longest_streak = _compute_streaks(play_dates, now.date())

    if cutoff is None:
        new_artists_count = unique_artists
    else:
        first_plays = db.execute(
            select(Play.artist, func.min(Play.played_at).label("first_at"))
            .where(Play.user_id == user.id, Play.artist != "")
            .group_by(Play.artist)
        ).all()
        cutoff_utc = _as_utc(cutoff)
        new_artists_count = sum(
            1 for r in first_plays if r.first_at is not None and _as_utc(r.first_at) >= cutoff_utc
        )

    recent_rows = db.scalars(
        select(Play).where(where).order_by(Play.played_at.desc()).limit(50)
    ).all()
    recent_plays = [
        TimestampedPlay(
            id=p.deezer_id,
            title=p.title,
            artist=p.artist,
            artist_id=p.artist_id,
            artists=[
                a.model_dump()
                for a in load_artists(p.artists_json, p.artist, p.artist_id)
            ][:100],
            album=p.album,
            album_id=p.album_id,
            cover=p.cover_url or "",
            duration_sec=min(max(p.duration_sec or 0, 0), MAX_SAFE_WIRE_INTEGER),
            played_at=_as_utc(p.played_at),
        )
        for p in recent_rows
    ]

    return UserStatsInsights(
        range=range,
        listening_sec=listening_sec,
        play_count=play_count,
        unique_tracks=unique_tracks,
        unique_artists=unique_artists,
        top_tracks=top_tracks,
        top_artists=top_artists,
        top_albums=top_albums,
        current_streak_days=current_streak,
        longest_streak_days=longest_streak,
        hourly_distribution=hourly,
        weekday_distribution=weekday,
        new_artists_count=new_artists_count,
        recent_plays=recent_plays,
    )


@router.get("/stats/wrapped", response_model=WrappedReport)
def get_stats_wrapped(
    range: InsightsRange = Query(default="30d"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WrappedReport:
    """Rich LoggeRythm Wrapped report for interactive stories and share cards."""
    return build_wrapped_report(db, user, range)


@router.get(
    "/stats/wrapped/artwork",
    response_class=Response,
    description=(
        "Same-origin allowlisted image proxy for Canvas share-card rendering. "
        "Only serves URLs present in the authenticated user's play covers or avatar."
    ),
    responses={
        200: {
            "description": "Allowlisted cover or avatar image bytes.",
            "content": {
                "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                "image/png": {"schema": {"type": "string", "format": "binary"}},
                "image/webp": {"schema": {"type": "string", "format": "binary"}},
                "image/gif": {"schema": {"type": "string", "format": "binary"}},
            },
            "headers": {
                "Cache-Control": {"schema": {"type": "string"}},
            },
        },
        403: {
            "description": (
                "The authenticated account is pending approval or the requested artwork "
                "URL is not allowlisted for this user."
            ),
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/AuthError"},
                }
            },
        },
        404: {
            "description": "Allowlisted local artwork file does not exist on disk.",
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {"detail": {"type": "string"}},
                        "required": ["detail"],
                    }
                }
            },
        },
        502: {
            "description": "Upstream artwork fetch failed, returned non-image content, or exceeded 5 MB.",
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {"detail": {"type": "string"}},
                        "required": ["detail"],
                    }
                }
            },
        },
    },
)
def get_wrapped_artwork(
    url: str = Query(..., min_length=1, max_length=1000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Proxy allowlisted cover or avatar artwork with private caching."""
    data, media_type = load_wrapped_artwork(db, user, url)
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get(
    "/stats/wrapped/card.svg",
    response_class=Response,
    description="Server-rendered pure-Python SVG Wrapped share card (1080x1920 or 1080x1080).",
    responses={
        200: {
            "description": "Rendered SVG share card.",
            "content": {
                "image/svg+xml": {"schema": {"type": "string"}},
            },
            "headers": {
                "Cache-Control": {"schema": {"type": "string"}},
                "Content-Disposition": {"schema": {"type": "string"}},
            },
        },
        409: {
            "description": "No plays available in the selected range.",
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {"detail": {"type": "string"}},
                        "required": ["detail"],
                    }
                }
            },
        },
    },
)
def get_wrapped_card_svg(
    range: InsightsRange = Query(default="30d"),
    template: WrappedCardTemplate = Query(default="summary"),
    theme: WrappedCardTheme = Query(default="signal"),
    format: WrappedCardFormat = Query(default="story"),
    show_user: bool = Query(default=True),
    show_counts: bool = Query(default=True),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Render and return a pure-Python SVG Wrapped share card."""
    report = build_wrapped_report(db, user, range)
    svg = render_wrapped_card_svg(
        report,
        template,
        theme,
        format,
        show_user=show_user,
        show_counts=show_counts,
    )
    filename = f"loggerythm-wrapped-{range}-{template}-{format}.svg"
    return Response(
        content=svg.encode("utf-8"),
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )
