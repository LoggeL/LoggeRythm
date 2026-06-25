"""Personal listening statistics for the current user."""
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db.models import Play, User
from ..db.session import get_db
from ..schemas.track import Track

router = APIRouter(prefix="/api/me", tags=["stats"])


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

    count = func.count().label("count")

    top_tracks_rows = db.execute(
        select(
            Play.deezer_id,
            func.max(Play.title).label("title"),
            func.max(Play.artist).label("artist"),
            func.max(Play.cover_url).label("cover_url"),
            count,
        )
        .where(Play.user_id == user.id)
        .group_by(Play.deezer_id)
        .order_by(count.desc())
        .limit(10)
    ).all()
    top_tracks = [
        {
            "key": r.deezer_id,
            "label": r.title or "",
            "sublabel": r.artist or "",
            "cover": r.cover_url or "",
            "count": r.count,
        }
        for r in top_tracks_rows
    ]

    top_artists_rows = db.execute(
        select(
            Play.artist,
            Play.artist_id,
            count,
        )
        .where(Play.user_id == user.id)
        .group_by(Play.artist, Play.artist_id)
        .order_by(count.desc())
        .limit(10)
    ).all()
    top_artists = [
        {
            "key": r.artist_id or "",
            "label": r.artist or "",
            "sublabel": "",
            "cover": "",
            "count": r.count,
        }
        for r in top_artists_rows
    ]

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
    }
