"""Liked tracks for the current user."""
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db.models import Like, User
from ..db.session import get_db
from ..schemas.track import Track, dump_artists, load_artists

router = APIRouter(prefix="/api/me/likes", tags=["likes"])


def _like_to_track(like: Like) -> Track:
    artists = load_artists(like.artists_json, like.artist)
    return Track(
        id=like.deezer_id,
        title=like.title,
        artist=like.artist,
        artist_id=artists[0].id if artists else "",
        artists=artists,
        album=like.album,
        album_id=like.album_id,
        cover=like.cover_url or "",
        duration_sec=like.duration_sec,
        preview_url=None,
    )


@router.get("", response_model=list[Track])
def list_likes(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Track]:
    likes = db.scalars(
        select(Like).where(Like.user_id == user.id).order_by(Like.created_at.desc())
    ).all()
    return [_like_to_track(li) for li in likes]


@router.get("/contains")
def likes_contains(
    ids: str = Query(default=""),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    wanted = [i for i in ids.split(",") if i]
    if not wanted:
        return {}
    liked = set(
        db.scalars(
            select(Like.deezer_id).where(
                Like.user_id == user.id, Like.deezer_id.in_(wanted)
            )
        ).all()
    )
    return {i: (i in liked) for i in wanted}


@router.put("/{deezer_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_like(
    deezer_id: str,
    track: Track,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    existing = db.scalar(
        select(Like).where(Like.user_id == user.id, Like.deezer_id == deezer_id)
    )
    if existing is None:
        db.add(
            Like(
                user_id=user.id,
                deezer_id=deezer_id,
                title=track.title,
                artist=track.artist,
                artists_json=dump_artists(track),
                album=track.album,
                album_id=str(track.album_id or ""),
                cover_url=track.cover or None,
                duration_sec=track.duration_sec,
            )
        )
    else:
        existing.title = track.title
        existing.artist = track.artist
        existing.artists_json = dump_artists(track)
        existing.album = track.album
        existing.album_id = str(track.album_id or "")
        existing.cover_url = track.cover or None
        existing.duration_sec = track.duration_sec
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{deezer_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_like(
    deezer_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    db.execute(
        delete(Like).where(Like.user_id == user.id, Like.deezer_id == deezer_id)
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
