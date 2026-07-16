"""Personal listening statistics for the current user."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from ..auth import get_current_user
from ..db.models import Play, User
from ..db.session import get_db
from ..schemas.track import Track, dump_artists, load_artists

router = APIRouter(prefix="/api/me", tags=["stats"])


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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    db.add(
        Play(
            user_id=user.id,
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
    db.commit()
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
