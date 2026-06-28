"""Admin endpoints: user approval and management (admin-only)."""
import os
import secrets
import shutil
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from .. import config as cfg
from ..config import STORAGE_DIR, STORAGE_RETENTION_DAYS
from ..db.models import (
    FollowedArtist,
    InviteCode,
    Like,
    PartySession,
    Play,
    Playlist,
    StoredLyrics,
    StoredTrack,
    User,
)
from ..db.session import engine, get_db
from ..services import deezer_client, storage

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminUser(BaseModel):
    id: int
    email: str
    display_name: str | None = None
    avatar_url: str | None = None
    is_admin: bool
    is_approved: bool
    created_at: datetime | None = None


class StorageItem(BaseModel):
    deezer_id: str
    title: str
    artist: str
    size_bytes: int
    last_accessed: datetime | None = None


class StorageInfo(BaseModel):
    track_count: int
    total_bytes: int
    disk_total: int
    disk_used: int
    disk_free: int
    retention_days: int
    tracks: list[StorageItem]


class InviteInfo(BaseModel):
    code: str
    url: str
    used_by_name: str | None = None
    created_at: datetime


class DeezerStatus(BaseModel):
    arl_configured: bool
    arl_ok: bool
    quality: str


class StorageStatus(BaseModel):
    track_count: int
    total_bytes: int
    disk_total: int
    disk_used: int
    disk_free: int
    retention_days: int


class UsersStatus(BaseModel):
    total: int
    approved: int
    pending: int
    admins: int


class ContentStatus(BaseModel):
    playlists: int
    likes: int
    follows: int
    plays: int
    stored_lyrics: int
    parties: int
    invites_total: int
    invites_used: int


class IntegrationsStatus(BaseModel):
    spotify_configured: bool
    lastfm_configured: bool


class SystemStatus(BaseModel):
    app_env: str
    database: str
    jwt_secure: bool
    cookie_secure: bool


class StatusInfo(BaseModel):
    deezer: DeezerStatus
    storage: StorageStatus
    users: UsersStatus
    content: ContentStatus
    integrations: IntegrationsStatus
    system: SystemStatus


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Allow only admins through; raise 403 otherwise."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Adminrechte erforderlich"
        )
    return user


@router.get("/users", response_model=list[AdminUser])
def list_users(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[AdminUser]:
    users = db.scalars(select(User).order_by(User.id)).all()
    return [
        AdminUser(
            id=u.id,
            email=u.email,
            display_name=u.display_name,
            avatar_url=u.avatar_url,
            is_admin=u.is_admin,
            is_approved=u.is_approved,
            created_at=u.created_at,
        )
        for u in users
    ]


@router.put("/users/{user_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
def approve_user(
    user_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_approved = True
    db.commit()


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(
            status_code=400, detail="Du kannst dich nicht selbst löschen"
        )
    if user.is_admin:
        raise HTTPException(
            status_code=400, detail="Du kannst keinen anderen Admin löschen"
        )
    db.delete(user)
    db.commit()


@router.get("/storage", response_model=StorageInfo)
def storage_info(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StorageInfo:
    track_count = db.scalar(select(func.count()).select_from(StoredTrack)) or 0
    total_bytes = db.scalar(select(func.coalesce(func.sum(StoredTrack.size_bytes), 0))) or 0
    # Free/total space on the filesystem holding the storage directory.
    os.makedirs(STORAGE_DIR, exist_ok=True)
    usage = shutil.disk_usage(STORAGE_DIR)
    rows = db.scalars(
        select(StoredTrack).order_by(StoredTrack.last_accessed.desc()).limit(200)
    ).all()
    return StorageInfo(
        track_count=track_count,
        total_bytes=total_bytes,
        disk_total=usage.total,
        disk_used=usage.used,
        disk_free=usage.free,
        retention_days=STORAGE_RETENTION_DAYS,
        tracks=[
            StorageItem(
                deezer_id=t.deezer_id,
                title=t.title,
                artist=t.artist,
                size_bytes=t.size_bytes,
                last_accessed=t.last_accessed,
            )
            for t in rows
        ],
    )


@router.post("/storage/cleanup")
def storage_cleanup(_admin: User = Depends(require_admin)) -> dict:
    """Evict stored tracks that are past the retention window now."""
    return storage.cleanup_old()


@router.get("/status", response_model=StatusInfo)
def system_status(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StatusInfo:
    """Aggregate health/diagnostics for admins: Deezer auth, storage, users, …"""

    def count(model) -> int:
        return db.scalar(select(func.count()).select_from(model)) or 0

    # Deezer: report configured + live login health. The health probe hits the
    # network; it runs in FastAPI's threadpool since this route is sync.
    arl_configured = bool(cfg.DEEZER_ARL)
    arl_ok = deezer_client.health() if arl_configured else False

    os.makedirs(STORAGE_DIR, exist_ok=True)
    usage = shutil.disk_usage(STORAGE_DIR)
    total_bytes = (
        db.scalar(select(func.coalesce(func.sum(StoredTrack.size_bytes), 0))) or 0
    )

    invites_total = count(InviteCode)
    invites_used = db.scalar(
        select(func.count()).select_from(InviteCode).where(InviteCode.used_by.isnot(None))
    ) or 0

    total_users = count(User)
    approved_users = db.scalar(
        select(func.count()).select_from(User).where(User.is_approved.is_(True))
    ) or 0
    admin_users = db.scalar(
        select(func.count()).select_from(User).where(User.is_admin.is_(True))
    ) or 0

    return StatusInfo(
        deezer=DeezerStatus(
            arl_configured=arl_configured,
            arl_ok=arl_ok,
            quality=cfg.DEEZER_QUALITY,
        ),
        storage=StorageStatus(
            track_count=count(StoredTrack),
            total_bytes=total_bytes,
            disk_total=usage.total,
            disk_used=usage.used,
            disk_free=usage.free,
            retention_days=STORAGE_RETENTION_DAYS,
        ),
        users=UsersStatus(
            total=total_users,
            approved=approved_users,
            pending=total_users - approved_users,
            admins=admin_users,
        ),
        content=ContentStatus(
            playlists=count(Playlist),
            likes=count(Like),
            follows=count(FollowedArtist),
            plays=count(Play),
            stored_lyrics=count(StoredLyrics),
            parties=count(PartySession),
            invites_total=invites_total,
            invites_used=invites_used,
        ),
        integrations=IntegrationsStatus(
            spotify_configured=bool(
                cfg.SPOTIFY_CLIENT_ID and cfg.SPOTIFY_CLIENT_SECRET
            ),
            lastfm_configured=bool(cfg.LASTFM_API_KEY),
        ),
        system=SystemStatus(
            app_env=cfg.APP_ENV,
            database=engine.dialect.name,
            jwt_secure=cfg.JWT_SECRET not in cfg._DEV_JWT_SECRETS,
            cookie_secure=cfg.COOKIE_SECURE,
        ),
    )


@router.post("/invites", response_model=InviteInfo)
def create_invite(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> InviteInfo:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    code = "".join(secrets.choice(alphabet) for _ in range(8))
    invite = InviteCode(code=code, created_by=admin.id)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return InviteInfo(
        code=invite.code,
        url="",
        used_by_name=None,
        created_at=invite.created_at,
    )


@router.get("/invites", response_model=list[InviteInfo])
def list_invites(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[InviteInfo]:
    invites = db.scalars(
        select(InviteCode).order_by(InviteCode.created_at.desc())
    ).all()
    result: list[InviteInfo] = []
    for inv in invites:
        used_by_name: str | None = None
        if inv.used_by is not None:
            used_user = db.get(User, inv.used_by)
            if used_user is not None:
                used_by_name = used_user.display_name
        result.append(
            InviteInfo(
                code=inv.code,
                url="",
                used_by_name=used_by_name,
                created_at=inv.created_at,
            )
        )
    return result
