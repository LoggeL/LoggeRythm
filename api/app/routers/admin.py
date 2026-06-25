"""Admin endpoints: user approval and management (admin-only)."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db.models import User
from ..db.session import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminUser(BaseModel):
    id: int
    email: str
    display_name: str | None = None
    is_admin: bool
    is_approved: bool
    created_at: datetime | None = None


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
