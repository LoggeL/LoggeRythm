"""Auth endpoints: register, login, logout, me, password reset."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..auth import (
    clear_session_cookie,
    create_token,
    get_current_session_user,
    hash_password,
    set_session_cookie,
    verify_password,
)
from ..db.models import InviteCode, PasswordResetToken, User
from ..db.session import get_db
from ..email_identity import find_user_by_email, normalize_email
from ..schemas.auth import (
    LoginRequest,
    PasswordForgotRequest,
    PasswordResetRequest,
    RegisterRequest,
    UserOut,
)
from ..services import auth_mail, mail

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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> UserOut:
    email = normalize_email(str(body.email))
    existing = find_user_by_email(db, email)
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
        if invite is None:
            raise HTTPException(
                status_code=400, detail="Invalid or already used invite code"
            )
    is_approved = is_first or invite is not None
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        is_admin=is_first,
        is_approved=is_approved,
    )
    db.add(user)
    db.flush()
    if invite is not None:
        # Conditional UPDATE so two concurrent registrations cannot both
        # consume the same code.
        claimed = db.execute(
            update(InviteCode)
            .where(InviteCode.code == invite.code, InviteCode.used_by.is_(None))
            .values(used_by=user.id, used_at=datetime.now(timezone.utc))
        )
        if claimed.rowcount != 1:
            db.rollback()
            raise HTTPException(
                status_code=400, detail="Invalid or already used invite code"
            )
    db.commit()
    db.refresh(user)
    if not user.is_approved and mail.configured():
        admin_emails = list(db.scalars(select(User.email).where(User.is_admin.is_(True))))
        if not admin_emails:
            raise RuntimeError("A registration awaits approval but no admin account exists")
        # After the response: a mail outage must not block sign-up, and a
        # background task failure is logged with its traceback by Starlette.
        background_tasks.add_task(
            auth_mail.send_pending_registration_notice, admin_emails, user.email
        )
    set_session_cookie(response, create_token(user.id))
    return _user_out(user)


@router.post("/login", response_model=UserOut)
def login(
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> UserOut:
    user = find_user_by_email(db, str(body.email))
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


# --- password reset -------------------------------------------------------
# Repeat requests for the same account inside this window send no new mail,
# so the endpoint cannot be used to flood someone's inbox.
_RESET_RESEND_COOLDOWN = timedelta(minutes=2)
_RESET_INVALID = "Der Link ist ungültig, abgelaufen oder wurde schon benutzt."


def _utcnow_naive() -> datetime:
    """UTC as a naive datetime, matching how the DateTime columns are stored."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_naive_utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


@router.post(
    "/password/forgot",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        502: {"description": "The mail provider rejected or could not accept the mail."},
        503: {"description": "Mail is not configured on this server."},
    },
)
def forgot_password(body: PasswordForgotRequest, db: Session = Depends(get_db)) -> Response:
    """Mail a single-use reset link. Answers 204 whether or not the account exists."""
    if not mail.configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mailversand ist auf diesem Server nicht eingerichtet.",
        )
    user = find_user_by_email(db, str(body.email))
    if user is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    now = _utcnow_naive()
    recent = db.scalar(
        select(PasswordResetToken.id).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.created_at > now - _RESET_RESEND_COOLDOWN,
        )
    )
    if recent is not None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    # Only the newest link stays valid.
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_hash_reset_token(token),
            created_at=now,
            expires_at=now + timedelta(minutes=auth_mail.RESET_LINK_VALID_MINUTES),
        )
    )
    db.flush()
    try:
        auth_mail.send_password_reset(user, token)
    except mail.MailDeliveryError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Die Mail konnte nicht verschickt werden: {exc}",
        ) from exc
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/reset", response_model=UserOut)
def reset_password(
    body: PasswordResetRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> UserOut:
    """Set a new password from a reset link and sign the user in."""
    row = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == _hash_reset_token(body.token)
        )
    )
    now = _utcnow_naive()
    if row is None or row.used_at is not None or _as_naive_utc(row.expires_at) <= now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_RESET_INVALID)
    # Conditional UPDATE so the same link cannot be redeemed twice concurrently.
    claimed = db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.id == row.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_RESET_INVALID)
    user = db.get(User, row.user_id)
    if user is None:
        raise RuntimeError(f"Password reset token {row.id} points to missing user {row.user_id}")
    user.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(user)
    set_session_cookie(response, create_token(user.id))
    return _user_out(user)
