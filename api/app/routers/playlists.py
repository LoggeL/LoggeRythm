"""Playlist CRUD and track membership for the current user."""
import glob
import os

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user, get_current_user_optional
from ..config import STORAGE_DIR
from ..db.models import Playlist, PlaylistTrack, User
from ..db.session import get_db
from ..schemas.playlist import (
    PlaylistCreate,
    PlaylistDetail,
    PlaylistReorder,
    PlaylistSummary,
    PlaylistUpdate,
)
from ..schemas.track import Track, dump_artists, load_artists
from ..services.playlist_export import (
    PlaylistExportError,
    PlaylistExportTrack,
    build_playlist_archive,
)
from ..uploads import image_extension, save_image_upload

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class _VisibilityUpdate(BaseModel):
    is_public: bool

_COVERS_DIR = os.path.join(STORAGE_DIR, "covers")


def _remove_cover_files(playlist_id: int, keep_path: str | None = None) -> None:
    for f in glob.glob(os.path.join(_COVERS_DIR, f"{playlist_id}.*")):
        if keep_path is not None and os.path.abspath(f) == os.path.abspath(keep_path):
            continue
        try:
            os.remove(f)
        except OSError:
            pass


def _get_owned_playlist(db: Session, playlist_id: int, user: User) -> Playlist:
    pl = db.get(Playlist, playlist_id)
    if pl is None or pl.user_id != user.id:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return pl


def _pt_to_track(pt: PlaylistTrack) -> Track:
    artists = load_artists(pt.artists_json, pt.artist)
    return Track(
        id=pt.deezer_id,
        title=pt.title,
        artist=pt.artist,
        artist_id=artists[0].id if artists else "",
        artists=artists,
        album=pt.album,
        album_id=pt.album_id,
        cover=pt.cover_url or "",
        duration_sec=pt.duration_sec,
        preview_url=None,
    )


def _summary(
    pl: Playlist, track_count: int, owner_name: str | None = None
) -> PlaylistSummary:
    return PlaylistSummary(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        cover_url=pl.cover_url,
        track_count=track_count,
        is_public=pl.is_public,
        owner_name=owner_name,
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


@router.get("/public", response_model=list[PlaylistSummary])
def public_playlists(
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[PlaylistSummary]:
    """Public, non-empty playlists from other users — for the community shelf."""
    q = (
        select(Playlist, func.count(PlaylistTrack.id), User.display_name)
        .join(PlaylistTrack, PlaylistTrack.playlist_id == Playlist.id)
        .join(User, User.id == Playlist.user_id)
        .where(Playlist.is_public.is_(True))
        .group_by(Playlist.id)
        .order_by(Playlist.created_at.desc())
        .limit(24)
    )
    if user is not None:
        q = q.where(Playlist.user_id != user.id)
    rows = db.execute(q).all()
    return [_summary(pl, count, owner_name=owner) for pl, count, owner in rows]


@router.get("/{playlist_id}", response_model=PlaylistDetail)
def get_playlist(
    playlist_id: int,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    pl = db.get(Playlist, playlist_id)
    is_owner = pl is not None and user is not None and pl.user_id == user.id
    # Visible if it's yours or it's public; otherwise hidden.
    if pl is None or (not is_owner and not pl.is_public):
        raise HTTPException(status_code=404, detail="Playlist not found")
    owner = db.get(User, pl.user_id)
    return PlaylistDetail(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        cover_url=pl.cover_url,
        is_public=pl.is_public,
        is_owner=is_owner,
        owner_name=owner.display_name if owner else None,
        tracks=[_pt_to_track(pt) for pt in pl.tracks],
    )


@router.get("/{playlist_id}/export")
async def export_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Download all tracks in a visible playlist as an ordered MP3 ZIP."""
    pl = db.get(Playlist, playlist_id)
    if pl is None or (pl.user_id != user.id and not pl.is_public):
        raise HTTPException(status_code=404, detail="Playlist not found")

    tracks = [
        PlaylistExportTrack(
            deezer_id=track.deezer_id,
            artist=track.artist,
            title=track.title,
        )
        for track in pl.tracks
    ]
    try:
        archive_path, archive_filename = await run_in_threadpool(
            build_playlist_archive,
            pl.name,
            tracks,
        )
    except PlaylistExportError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Playlist export failed: {exc}",
        ) from exc

    return FileResponse(
        archive_path,
        filename=archive_filename,
        media_type="application/zip",
        headers={"X-Playlist-Track-Count": str(len(tracks))},
        background=BackgroundTask(os.remove, archive_path),
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


@router.patch("/{playlist_id}/visibility", response_model=PlaylistSummary)
def set_visibility(
    playlist_id: int,
    body: _VisibilityUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    pl = _get_owned_playlist(db, playlist_id, user)
    pl.is_public = body.is_public
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
    _remove_cover_files(playlist_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{playlist_id}/cover", response_model=PlaylistSummary)
def set_cover(
    playlist_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    pl = _get_owned_playlist(db, playlist_id, user)
    ext = image_extension(file.content_type)
    path = os.path.join(_COVERS_DIR, f"{playlist_id}{ext}")
    save_image_upload(file, path, ext)
    _remove_cover_files(playlist_id, keep_path=path)
    # cache-bust via file mtime so the new image replaces the cached one
    pl.cover_url = f"/api/playlists/{playlist_id}/cover?v={int(os.path.getmtime(path))}"
    db.commit()
    db.refresh(pl)
    count = db.scalar(
        select(func.count(PlaylistTrack.id)).where(
            PlaylistTrack.playlist_id == pl.id
        )
    )
    return _summary(pl, count or 0)


@router.get("/{playlist_id}/cover")
def get_cover(playlist_id: int) -> FileResponse:
    for f in glob.glob(os.path.join(_COVERS_DIR, f"{playlist_id}.*")):
        if os.path.isfile(f):
            return FileResponse(f)
    raise HTTPException(status_code=404, detail="Kein Cover")


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
            artists_json=dump_artists(track),
            album=track.album,
            album_id=str(track.album_id or ""),
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
                artists_json=dump_artists(track),
                album=track.album,
                album_id=str(track.album_id or ""),
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
