"""Who is acting on a party: an approved account or an anonymous guest.

Anonymous guests join with a nickname only. Their identity is a random token
in the ``sf_party_guest`` cookie, scoped to ``/api/party/<CODE>`` so it is sent
only to that one party's endpoints and never reaches the rest of the API. The
database keeps just the token's SHA-256.
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Response, Security, status
from fastapi.security import APIKeyCookie
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import _decode_user_id, _session_cookie_scheme
from .config import COOKIE_MAX_AGE, COOKIE_SAMESITE, COOKIE_SECURE
from .db.models import PartyGuest, User
from .db.session import get_db

PARTY_GUEST_COOKIE = "sf_party_guest"

_guest_cookie_scheme = APIKeyCookie(
    name=PARTY_GUEST_COOKIE,
    scheme_name=PARTY_GUEST_COOKIE,
    description=(
        "HttpOnly party-guest token set by POST /api/party/{code}/guest. Scoped "
        "to that party's API path; identifies an anonymous guest by nickname."
    ),
    auto_error=False,
)


@dataclass(frozen=True)
class PartyActor:
    """Exactly one of ``user`` / ``guest`` is set."""

    user: User | None = None
    guest: PartyGuest | None = None

    def __post_init__(self) -> None:
        if (self.user is None) == (self.guest is None):
            raise ValueError("A party actor is either an account or a guest, never both or neither")

    @property
    def key(self) -> str:
        """Stable member key, also stored on the tracks this actor adds."""
        if self.user is not None:
            return f"u:{self.user.id}"
        assert self.guest is not None
        return f"g:{self.guest.id}"

    @property
    def display_name(self) -> str:
        if self.user is not None:
            return self.user.display_name or self.user.email
        assert self.guest is not None
        return self.guest.nickname

    @property
    def is_guest(self) -> bool:
        return self.guest is not None


def guest_cookie_path(code: str) -> str:
    return f"/api/party/{code}"


def hash_guest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_guest_token() -> str:
    return secrets.token_urlsafe(32)


def set_guest_cookie(response: Response, code: str, token: str) -> None:
    response.set_cookie(
        key=PARTY_GUEST_COOKIE,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path=guest_cookie_path(code),
    )


def clear_guest_cookie(response: Response, code: str) -> None:
    response.delete_cookie(
        key=PARTY_GUEST_COOKIE,
        path=guest_cookie_path(code),
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )


def _guest_for(db: Session, code: str, token: str) -> PartyGuest | None:
    return db.scalar(
        select(PartyGuest).where(
            PartyGuest.token_hash == hash_guest_token(token),
            PartyGuest.session_code == code,
        )
    )


def get_party_actor(
    code: str,
    sf_session: str | None = Security(_session_cookie_scheme),
    sf_party_guest: str | None = Security(_guest_cookie_scheme),
    db: Session = Depends(get_db),
) -> PartyActor:
    """Resolve the caller of a ``/api/party/{code}/...`` route.

    An approved account wins. Otherwise a valid guest token for *this* party
    identifies an anonymous guest. A pending account without a guest token
    gets the usual 403; nobody at all gets 401.
    """
    user_id = _decode_user_id(sf_session) if sf_session else None
    user = db.get(User, user_id) if user_id is not None else None
    if user is not None and (user.is_approved or user.is_admin):
        return PartyActor(user=user)
    if sf_party_guest:
        guest = _guest_for(db, code, sf_party_guest)
        if guest is not None:
            return PartyActor(guest=guest)
    if user is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dein Konto wartet noch auf Freigabe durch einen Admin.",
        )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated: sign in or join this party as a guest with a nickname",
    )
