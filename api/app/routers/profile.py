"""User profile: avatar upload/serving and public profile pages."""
import glob
import os

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..auth import clear_session_cookie, get_current_user, hash_password
from ..config import STORAGE_DIR
from ..db.models import (
    FollowedArtist,
    InviteCode,
    PartyMember,
    PartySession,
    Play,
    Playlist,
    PlaylistTrack,
    User,
)
from ..db.session import get_db
from ..schemas.auth import UserOut
from ..schemas.playlist import PlaylistSummary
from ..schemas.track import ArtistSummary
from ..uploads import image_extension, save_image_upload

router = APIRouter(prefix="/api", tags=["profile"])

_AVATARS_DIR = os.path.join(STORAGE_DIR, "avatars")


class PublicProfile(BaseModel):
    id: int
    display_name: str | None = None
    avatar_url: str | None = None
    playlists: list[PlaylistSummary]
    top_artists: list[ArtistSummary]


class MeUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class PlaybackSettings(BaseModel):
    crossfade_enabled: bool
    crossfade_duration_sec: int


class PlaybackSettingsUpdate(BaseModel):
    crossfade_enabled: bool | None = None
    crossfade_duration_sec: int | None = None


def _user_out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        email=u.email,
        display_name=u.display_name,
        avatar_url=u.avatar_url,
        is_admin=u.is_admin,
        is_approved=u.is_approved,
    )


def _playback_settings(user: User) -> PlaybackSettings:
    return PlaybackSettings(
        crossfade_enabled=bool(user.crossfade_enabled),
        crossfade_duration_sec=int(user.crossfade_duration_sec or 0),
    )


def _remove_avatar_files(user_id: int, keep_path: str | None = None) -> None:
    for f in glob.glob(os.path.join(_AVATARS_DIR, f"{user_id}.*")):
        if keep_path is not None and os.path.abspath(f) == os.path.abspath(keep_path):
            continue
        try:
            os.remove(f)
        except OSError:
            pass


@router.put("/me/avatar", response_model=UserOut)
def set_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    ext = image_extension(file.content_type)
    path = os.path.join(_AVATARS_DIR, f"{user.id}{ext}")
    save_image_upload(file, path, ext)
    _remove_avatar_files(user.id, keep_path=path)
    # cache-bust via file mtime so the new image replaces the cached one
    user.avatar_url = f"/api/users/{user.id}/avatar?v={int(os.path.getmtime(path))}"
    db.commit()
    db.refresh(user)
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        is_approved=user.is_approved,
        avatar_url=user.avatar_url,
    )


@router.patch("/me", response_model=UserOut)
def update_me(
    body: MeUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    if body.display_name is not None:
        user.display_name = body.display_name.strip() or user.display_name
    if body.email is not None and body.email != user.email:
        taken = db.scalar(
            select(User).where(User.email == body.email, User.id != user.id)
        )
        if taken is not None:
            raise HTTPException(status_code=409, detail="E-Mail ist bereits vergeben.")
        user.email = body.email
    if body.password:
        user.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete the current user's account and all of their data.

    Playlists (+tracks), likes and follows cascade via the ORM; play events,
    party memberships, hosted parties and invite codes have no ORM cascade and
    are cleaned up explicitly so no orphaned rows survive.
    """
    if user.is_admin:
        other_admin = db.scalar(
            select(User).where(User.is_admin.is_(True), User.id != user.id)
        )
        if other_admin is None:
            raise HTTPException(
                status_code=400,
                detail="Der letzte Admin kann sein Konto nicht löschen.",
            )

    user_id = user.id
    playlist_ids = list(
        db.scalars(select(Playlist.id).where(Playlist.user_id == user_id))
    )

    db.execute(delete(Play).where(Play.user_id == user_id))
    db.execute(delete(PartyMember).where(PartyMember.user_id == user_id))
    # Hosted parties die with their host (ORM cascade removes tracks/members).
    for session in db.scalars(
        select(PartySession).where(PartySession.host_id == user_id)
    ):
        db.delete(session)
    db.execute(delete(InviteCode).where(InviteCode.created_by == user_id))
    db.execute(
        update(InviteCode)
        .where(InviteCode.used_by == user_id)
        .values(used_by=None)
    )
    db.delete(user)
    db.commit()

    for pid in playlist_ids:
        _remove_playlist_cover_files(pid)
    _remove_avatar_files(user_id)
    clear_session_cookie(response)


def _remove_playlist_cover_files(playlist_id: int) -> None:
    for f in glob.glob(os.path.join(STORAGE_DIR, "covers", f"{playlist_id}.*")):
        try:
            os.remove(f)
        except OSError:
            pass


@router.get("/me/settings", response_model=PlaybackSettings)
def get_settings(user: User = Depends(get_current_user)) -> PlaybackSettings:
    return _playback_settings(user)


@router.patch("/me/settings", response_model=PlaybackSettings)
def update_settings(
    body: PlaybackSettingsUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaybackSettings:
    if body.crossfade_duration_sec is not None:
        if body.crossfade_duration_sec < 0 or body.crossfade_duration_sec > 12:
            raise HTTPException(
                status_code=422,
                detail="Die Crossfade-Dauer muss zwischen 0 und 12 Sekunden liegen.",
            )
        user.crossfade_duration_sec = body.crossfade_duration_sec
    if body.crossfade_enabled is not None:
        user.crossfade_enabled = body.crossfade_enabled
    db.commit()
    db.refresh(user)
    return _playback_settings(user)


@router.get("/users/{user_id}/avatar")
def get_avatar(user_id: int) -> FileResponse:
    for f in glob.glob(os.path.join(_AVATARS_DIR, f"{user_id}.*")):
        if os.path.isfile(f):
            return FileResponse(f)
    raise HTTPException(status_code=404, detail="Kein Avatar")


@router.get("/users/{user_id}", response_model=PublicProfile)
def public_profile(
    user_id: int,
    db: Session = Depends(get_db),
) -> PublicProfile:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    rows = db.execute(
        select(Playlist, func.count(PlaylistTrack.id))
        .outerjoin(PlaylistTrack, PlaylistTrack.playlist_id == Playlist.id)
        .where(Playlist.user_id == user.id, Playlist.is_public.is_(True))
        .group_by(Playlist.id)
        .order_by(Playlist.created_at.desc())
    ).all()
    playlists = [
        PlaylistSummary(
            id=pl.id,
            name=pl.name,
            description=pl.description,
            cover_url=pl.cover_url,
            track_count=count,
            is_public=pl.is_public,
        )
        for pl, count in rows
    ]

    follows = db.scalars(
        select(FollowedArtist)
        .where(FollowedArtist.user_id == user.id)
        .order_by(FollowedArtist.created_at.desc())
    ).all()
    top_artists = [
        ArtistSummary(
            id=fa.artist_id,
            name=fa.name,
            picture=fa.picture_url or "",
        )
        for fa in follows
    ]

    return PublicProfile(
        id=user.id,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        playlists=playlists,
        top_artists=top_artists,
    )
