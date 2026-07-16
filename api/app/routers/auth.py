"""Auth endpoints: register, login, logout, me."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import (
    clear_session_cookie,
    create_token,
    get_current_session_user,
    hash_password,
    set_session_cookie,
    verify_password,
)
from ..db.models import InviteCode, User
from ..db.session import get_db
from datetime import datetime, timezone
from ..schemas.auth import LoginRequest, RegisterRequest, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        is_approved=user.is_approved,
        avatar_url=user.avatar_url,
    )


@router.post("/register", response_model=UserOut)
def register(
    body: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> UserOut:
    existing = db.scalar(select(User).where(User.email == body.email))
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")
    # The first user to register becomes the admin and is auto-approved.
    user_count = db.scalar(select(func.count()).select_from(User)) or 0
    is_first = user_count == 0
    # A valid, unused invite code auto-approves a non-first user.
    invite: InviteCode | None = None
    if not is_first and body.invite:
        invite = db.scalar(
            select(InviteCode).where(
                InviteCode.code == body.invite, InviteCode.used_by.is_(None)
            )
        )
    is_approved = is_first or invite is not None
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        is_admin=is_first,
        is_approved=is_approved,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    if invite is not None:
        invite.used_by = user.id
        invite.used_at = datetime.now(timezone.utc)
        db.commit()
    set_session_cookie(response, create_token(user.id))
    return _user_out(user)


@router.post("/login", response_model=UserOut)
def login(
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> UserOut:
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    set_session_cookie(response, create_token(user.id))
    return _user_out(user)


@router.post("/logout")
def logout(response: Response) -> dict:
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_session_user)) -> UserOut:
    return _user_out(user)
