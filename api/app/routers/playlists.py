"""Playlist CRUD and track membership for the current user."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db.models import Playlist, PlaylistTrack, User
from ..db.session import get_db
from ..schemas.playlist import (
    PlaylistCreate,
    PlaylistDetail,
    PlaylistReorder,
    PlaylistSummary,
    PlaylistUpdate,
)
from ..schemas.track import Track

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


def _get_owned_playlist(db: Session, playlist_id: int, user: User) -> Playlist:
    pl = db.get(Playlist, playlist_id)
    if pl is None or pl.user_id != user.id:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return pl


def _pt_to_track(pt: PlaylistTrack) -> Track:
    return Track(
        id=pt.deezer_id,
        title=pt.title,
        artist=pt.artist,
        album=pt.album,
        album_id="",
        cover=pt.cover_url or "",
        duration_sec=pt.duration_sec,
        preview_url=None,
    )


def _summary(pl: Playlist, track_count: int) -> PlaylistSummary:
    return PlaylistSummary(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        cover_url=pl.cover_url,
        track_count=track_count,
    )


@router.get("", response_model=list[PlaylistSummary])
def list_playlists(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PlaylistSummary]:
    rows = db.execute(
        select(Playlist, func.count(PlaylistTrack.id))
        .outerjoin(PlaylistTrack, PlaylistTrack.playlist_id == Playlist.id)
        .where(Playlist.user_id == user.id)
        .group_by(Playlist.id)
        .order_by(Playlist.created_at.desc())
    ).all()
    return [_summary(pl, count) for pl, count in rows]


@router.post("", response_model=PlaylistSummary, status_code=status.HTTP_201_CREATED)
def create_playlist(
    body: PlaylistCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    pl = Playlist(user_id=user.id, name=body.name, description=body.description)
    db.add(pl)
    db.commit()
    db.refresh(pl)
    return _summary(pl, 0)


@router.get("/{playlist_id}", response_model=PlaylistDetail)
def get_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    pl = _get_owned_playlist(db, playlist_id, user)
    return PlaylistDetail(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        cover_url=pl.cover_url,
        tracks=[_pt_to_track(pt) for pt in pl.tracks],
    )


@router.patch("/{playlist_id}", response_model=PlaylistSummary)
def update_playlist(
    playlist_id: int,
    body: PlaylistUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    pl = _get_owned_playlist(db, playlist_id, user)
    if body.name is not None:
        pl.name = body.name
    if body.description is not None:
        pl.description = body.description
    db.commit()
    db.refresh(pl)
    count = db.scalar(
        select(func.count(PlaylistTrack.id)).where(
            PlaylistTrack.playlist_id == pl.id
        )
    )
    return _summary(pl, count or 0)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _get_owned_playlist(db, playlist_id, user)
    db.delete(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{playlist_id}/tracks", status_code=status.HTTP_204_NO_CONTENT)
def add_track(
    playlist_id: int,
    track: Track,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _get_owned_playlist(db, playlist_id, user)
    # Idempotent: skip if the track is already in the playlist.
    exists = db.scalar(
        select(PlaylistTrack.id).where(
            PlaylistTrack.playlist_id == pl.id,
            PlaylistTrack.deezer_id == track.id,
        )
    )
    if exists is not None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    next_pos = db.scalar(
        select(func.coalesce(func.max(PlaylistTrack.position), -1)).where(
            PlaylistTrack.playlist_id == pl.id
        )
    )
    db.add(
        PlaylistTrack(
            playlist_id=pl.id,
            deezer_id=track.id,
            title=track.title,
            artist=track.artist,
            album=track.album,
            cover_url=track.cover or None,
            duration_sec=track.duration_sec,
            position=(next_pos or -1) + 1,
        )
    )
    # Set a cover from the first added track if the playlist has none.
    if not pl.cover_url and track.cover:
        pl.cover_url = track.cover
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{playlist_id}/tracks/bulk")
def add_tracks_bulk(
    playlist_id: int,
    tracks: list[Track],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    pl = _get_owned_playlist(db, playlist_id, user)
    existing = set(
        db.scalars(
            select(PlaylistTrack.deezer_id).where(PlaylistTrack.playlist_id == pl.id)
        ).all()
    )
    pos = db.scalar(
        select(func.coalesce(func.max(PlaylistTrack.position), -1)).where(
            PlaylistTrack.playlist_id == pl.id
        )
    )
    pos = pos if pos is not None else -1
    added = 0
    for track in tracks:
        if track.id in existing:
            continue
        existing.add(track.id)
        pos += 1
        db.add(
            PlaylistTrack(
                playlist_id=pl.id,
                deezer_id=track.id,
                title=track.title,
                artist=track.artist,
                album=track.album,
                cover_url=track.cover or None,
                duration_sec=track.duration_sec,
                position=pos,
            )
        )
        if not pl.cover_url and track.cover:
            pl.cover_url = track.cover
        added += 1
    db.commit()
    return {"added": added}


@router.patch("/{playlist_id}/tracks/order", status_code=status.HTTP_204_NO_CONTENT)
def reorder_tracks(
    playlist_id: int,
    body: PlaylistReorder,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _get_owned_playlist(db, playlist_id, user)
    position_of = {deezer_id: i for i, deezer_id in enumerate(body.deezer_ids)}
    for pt in pl.tracks:
        if pt.deezer_id in position_of:
            pt.position = position_of[pt.deezer_id]
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{playlist_id}/tracks/{deezer_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_track(
    playlist_id: int,
    deezer_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _get_owned_playlist(db, playlist_id, user)
    db.execute(
        delete(PlaylistTrack).where(
            PlaylistTrack.playlist_id == pl.id,
            PlaylistTrack.deezer_id == deezer_id,
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
