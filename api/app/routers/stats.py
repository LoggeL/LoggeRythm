"""Personal listening statistics for the current user."""
from datetime import datetime, timedelta, timezone
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response, status
from pydantic import BeforeValidator, WithJsonSchema
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from ..auth import get_current_user
from ..db.models import Play, User
from ..db.session import get_db
from ..schemas.track import Track, dump_artists, load_artists

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


def _top_tracks(db: Session, where: ColumnElement[bool]) -> list[dict]:
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
        {
            "key": r.deezer_id,
            "label": r.title or "",
            "sublabel": r.artist or "",
            "cover": r.cover_url or "",
            "count": r.count,
        }
        for r in rows
    ]


def _top_artists(db: Session, where: ColumnElement[bool]) -> list[dict]:
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
        {
            "key": r.artist_id or "",
            "label": r.artist or "",
            "sublabel": "",
            "cover": "",
            "count": r.count,
        }
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
            cover_url=track.cover or None,
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


@router.get("/stats")
def get_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
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
        {
            "id": p.deezer_id,
            "title": p.title,
            "artist": p.artist,
            "artist_id": p.artist_id,
            "artists": [
                a.model_dump()
                for a in load_artists(p.artists_json, p.artist, p.artist_id)
            ],
            "album": p.album,
            "album_id": p.album_id,
            "cover": p.cover_url or "",
            "duration_sec": p.duration_sec,
        }
        for p in recent_rows
    ]

    return {
        "total_plays": total_plays,
        "top_tracks": top_tracks,
        "top_artists": top_artists,
        "recent": recent,
        "total_plays_month": total_plays_month,
        "top_tracks_month": top_tracks_month,
        "top_artists_month": top_artists_month,
    }
