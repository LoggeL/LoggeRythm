"""User profile: avatar upload/serving and public profile pages."""
import glob
import os
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..auth import clear_session_cookie, get_current_user, hash_password
from ..config import STORAGE_DIR
from ..db.models import (
    FollowedArtist,
    ImportJob,
    InviteCode,
    PartyMember,
    PartySession,
    PasswordResetToken,
    Play,
    Playlist,
    PlaylistCollaborator,
    PlaylistInvite,
    PlaylistTrack,
    StoredTrack,
    TrackRequest,
    User,
    UserPlaybackState,
)
from ..db.session import get_db
from ..email_identity import find_user_by_email, normalize_email
from ..schemas.auth import UserOut
from ..schemas.playlist import PlaylistSummary
from ..schemas.track import ArtistSummary
from ..services import connect_hub, party_bus, playlist_bus, social_bus
from ..uploads import image_extension, save_image_upload
from .playlists import build_playlist_summaries

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
    preferred_quality: Literal["lossless", "high", "saver"] = "high"
    share_listening_activity: bool = False


class PlaybackSettingsUpdate(BaseModel):
    crossfade_enabled: bool | None = None
    crossfade_duration_sec: int | None = None
    preferred_quality: Literal["lossless", "high", "saver"] | None = None
    share_listening_activity: bool | None = None


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
    quality = (
        user.preferred_quality
        if user.preferred_quality in ("lossless", "high", "saver")
        else "high"
    )
    return PlaybackSettings(
        crossfade_enabled=bool(user.crossfade_enabled),
        crossfade_duration_sec=int(user.crossfade_duration_sec or 0),
        preferred_quality=quality,  # type: ignore[arg-type]
        share_listening_activity=bool(user.share_listening_activity),
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
    if body.email is not None:
        normalized_email = normalize_email(str(body.email))
        taken = find_user_by_email(
            db,
            normalized_email,
            exclude_user_id=user.id,
        )
        if taken is not None:
            raise HTTPException(status_code=409, detail="E-Mail ist bereits vergeben.")
        user.email = normalized_email
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

    purge_user_account(db, user)
    clear_session_cookie(response)


def purge_user_account(db: Session, user: User) -> None:
    """Delete a user plus all rows, files, and in-memory live state."""
    from . import party as party_router

    user_id = user.id
    owned_playlists = list(
        db.scalars(select(Playlist).where(Playlist.user_id == user_id)).all()
    )
    playlist_revs = [(pl.id, int(pl.revision or 0) + 1) for pl in owned_playlists]

    # Capture terminal SSE frames for hosted parties before removing rows.
    hosted_party_frames: list[tuple[str, party_bus.StateFrame]] = []
    for session in list(
        db.scalars(select(PartySession).where(PartySession.host_id == user_id)).all()
    ):
        party_router._touch_session(db, session)
        revision = party_bus.utc_revision(session.updated_at)
        terminal_payload = party_router._state_dict(db, session, ended=True)
        hosted_party_frames.append(
            (session.code, party_bus.StateFrame(revision, terminal_payload))
        )
        db.delete(session)

    db.execute(delete(Play).where(Play.user_id == user_id))
    db.execute(delete(TrackRequest).where(TrackRequest.user_id == user_id))
    db.execute(
        update(StoredTrack)
        .where(StoredTrack.requested_by_user_id == user_id)
        .values(requested_by_user_id=None)
    )
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user_id))
    db.execute(delete(ImportJob).where(ImportJob.user_id == user_id))
    db.execute(delete(UserPlaybackState).where(UserPlaybackState.user_id == user_id))
    db.execute(delete(PartyMember).where(PartyMember.user_id == user_id))
    db.execute(delete(PlaylistCollaborator).where(PlaylistCollaborator.user_id == user_id))
    db.execute(
        update(PlaylistCollaborator)
        .where(PlaylistCollaborator.added_by_user_id == user_id)
        .values(added_by_user_id=None)
    )
    db.execute(
        update(PlaylistTrack)
        .where(PlaylistTrack.added_by_user_id == user_id)
        .values(added_by_user_id=None)
    )
    db.execute(
        update(PlaylistInvite)
        .where(PlaylistInvite.created_by_user_id == user_id)
        .values(created_by_user_id=None)
    )
    db.execute(delete(InviteCode).where(InviteCode.created_by == user_id))
    db.execute(
        update(InviteCode)
        .where(InviteCode.used_by == user_id)
        .values(used_by=None)
    )
    db.delete(user)
    db.commit()

    # Evict live in-memory state after commit so no zombie WS/SSE state lingers.
    connect_hub.hub.evict_user(user_id)
    social_bus.notify()
    for code, terminal_frame in hosted_party_frames:
        party_bus.clear_party_ephemeral(code)
        party_bus.publish(code, terminal_frame)
    for pid, next_rev in playlist_revs:
        playlist_bus.publish_deleted(pid, next_rev)
        _remove_playlist_cover_files(pid)
    _remove_avatar_files(user_id)


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
    activity_changed = False
    if body.crossfade_duration_sec is not None:
        if body.crossfade_duration_sec < 0 or body.crossfade_duration_sec > 12:
            raise HTTPException(
                status_code=422,
                detail="Die Crossfade-Dauer muss zwischen 0 und 12 Sekunden liegen.",
            )
        user.crossfade_duration_sec = body.crossfade_duration_sec
    if body.crossfade_enabled is not None:
        user.crossfade_enabled = body.crossfade_enabled
    if body.preferred_quality is not None:
        user.preferred_quality = body.preferred_quality
    if body.share_listening_activity is not None:
        if bool(user.share_listening_activity) != body.share_listening_activity:
            activity_changed = True
        user.share_listening_activity = body.share_listening_activity
    db.commit()
    db.refresh(user)
    if activity_changed:
        social_bus.notify()
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

    public_rows = list(
        db.scalars(
            select(Playlist)
            .where(Playlist.user_id == user.id, Playlist.is_public.is_(True))
            .order_by(Playlist.created_at.desc(), Playlist.id.desc())
        ).all()
    )
    playlists = build_playlist_summaries(db, public_rows, viewer=None)

    follows = list(
        db.scalars(
            select(FollowedArtist)
            .where(FollowedArtist.user_id == user.id)
            .order_by(FollowedArtist.created_at.desc())
        ).all()
    )
    followed_pictures_by_id = {
        fa.artist_id: (fa.picture_url or "") for fa in follows if fa.artist_id
    }
    followed_pictures_by_name = {
        fa.name.casefold(): (fa.picture_url or "") for fa in follows if fa.name
    }

    play_rows = db.execute(
        select(
            Play.artist_id,
            Play.artist,
            func.max(Play.cover_url).label("cover_url"),
            func.count(Play.id).label("plays"),
        )
        .where(Play.user_id == user.id, Play.artist != "")
        .group_by(Play.artist_id, Play.artist)
        .order_by(func.count(Play.id).desc())
        .limit(10)
    ).all()

    if play_rows:
        top_artists = [
            ArtistSummary(
                id=str(r.artist_id or ""),
                name=r.artist or "",
                picture=(
                    followed_pictures_by_id.get(str(r.artist_id or ""))
                    or followed_pictures_by_name.get((r.artist or "").casefold())
                    or r.cover_url
                    or ""
                ),
            )
            for r in play_rows
        ]
    else:
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
