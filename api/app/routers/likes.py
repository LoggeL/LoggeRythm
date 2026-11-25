"""Liked tracks for the current user."""
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db.models import Like, User
from ..db.session import get_db
from ..schemas.track import Track, load_artists
from ..services import deezer_client as dc
from ..services import likes_dedup
from .errors import to_http

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
        isrc=like.isrc or "",
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
    try:
        return likes_dedup.likes_contains_deduped(db, user.id, wanted)
    except dc.DeezerClientError as exc:
        raise to_http(exc) from exc


@router.put("/{deezer_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_like(
    deezer_id: str,
    track: Track,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        likes_dedup.upsert_deduped_like(db, user.id, deezer_id, track)
    except dc.DeezerClientError as exc:
        raise to_http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{deezer_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_like(
    deezer_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        likes_dedup.remove_deduped_like(db, user.id, deezer_id)
    except dc.DeezerClientError as exc:
        raise to_http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
