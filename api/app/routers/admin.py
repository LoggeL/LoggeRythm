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
from ..config import STORAGE_DIR, STORAGE_RETENTION_DAYS
from ..db.models import InviteCode, StoredTrack, User
from ..db.session import get_db
from ..services import storage

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
