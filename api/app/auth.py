"""Authentication: argon2 password hashing, JWT in an httpOnly cookie."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Response, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import (
    COOKIE_MAX_AGE,
    COOKIE_SAMESITE,
    COOKIE_SECURE,
    JWT_ALGORITHM,
    JWT_EXPIRE_DAYS,
    JWT_SECRET,
    SESSION_COOKIE,
)
from .db.models import User
from .db.session import get_db

_pwd = CryptContext(schemes=["argon2"], deprecated="auto")


# --- password hashing -----------------------------------------------------
def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd.verify(password, password_hash)


# --- JWT ------------------------------------------------------------------
def create_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_user_id(token: str) -> int | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        sub = payload.get("sub")
        return int(sub) if sub is not None else None
    except (JWTError, ValueError):
        return None


# --- cookie helpers -------------------------------------------------------
def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    # Mirror secure/samesite so the browser matches and actually clears it.
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )


# --- dependencies ---------------------------------------------------------
def get_current_user_optional(
    sf_session: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    """Return the authenticated user or None (anonymous browse allowed)."""
    if not sf_session:
        return None
    user_id = _decode_user_id(sf_session)
    if user_id is None:
        return None
    return db.get(User, user_id)


def get_current_user(
    user: User | None = Depends(get_current_user_optional),
) -> User:
    """Return an approved authenticated user or raise 401/403."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    if not user.is_approved and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dein Konto wartet noch auf Freigabe durch einen Admin.",
        )
    return user


def get_current_session_user(
    user: User | None = Depends(get_current_user_optional),
) -> User:
    """Return the cookie user, including pending accounts, or raise 401."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return user
