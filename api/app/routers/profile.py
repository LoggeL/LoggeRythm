"""User profile: avatar upload/serving and public profile pages."""
import glob
import os
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user, hash_password
from ..config import STORAGE_DIR
from ..db.models import FollowedArtist, Playlist, PlaylistTrack, User
from ..db.session import get_db
from ..schemas.auth import UserOut
from ..schemas.playlist import PlaylistSummary
from ..schemas.track import ArtistSummary

router = APIRouter(prefix="/api", tags=["profile"])

_AVATARS_DIR = os.path.join(STORAGE_DIR, "avatars")
_EXT_BY_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


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


def _user_out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        email=u.email,
        display_name=u.display_name,
        avatar_url=u.avatar_url,
        is_admin=u.is_admin,
        is_approved=u.is_approved,
    )


def _remove_avatar_files(user_id: int) -> None:
    for f in glob.glob(os.path.join(_AVATARS_DIR, f"{user_id}.*")):
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
    ext = _EXT_BY_TYPE.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(
            status_code=400, detail="Nur Bilddateien (JPG, PNG, WEBP, GIF)."
        )
    os.makedirs(_AVATARS_DIR, exist_ok=True)
    _remove_avatar_files(user.id)
    path = os.path.join(_AVATARS_DIR, f"{user.id}{ext}")
    with open(path, "wb") as out:
        shutil.copyfileobj(file.file, out)
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
