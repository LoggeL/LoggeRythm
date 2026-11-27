"""Auth endpoints: register, login, logout, me, password reset, and Google OAuth."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..auth import (
    clear_session_cookie,
    create_token,
    get_current_session_user,
    has_password,
    hash_password,
    set_session_cookie,
    verify_password,
)
from ..config import COOKIE_SECURE
from ..db.models import InviteCode, OAuthExchangeCode, OAuthState, PasswordResetToken, User
from ..db.session import get_db
from ..email_identity import find_user_by_email, normalize_email
from ..schemas.auth import (
    AuthProvidersOut,
    GoogleMobileExchangeRequest,
    GoogleMobileStartOut,
    GoogleMobileStartRequest,
    LoginRequest,
    PasswordForgotRequest,
    PasswordResetRequest,
    RegisterRequest,
    UserOut,
)
from ..services import auth_mail, google_oauth, mail

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        is_approved=user.is_approved,
        avatar_url=user.avatar_url,
        has_password=has_password(user.password_hash),
        google_linked=bool(user.google_sub),
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


# --- Google OAuth 2.0 -----------------------------------------------------
_OAUTH_STATE_COOKIE_PATH = "/api/auth/google/callback"
_MOBILE_EXCHANGE_INVALID = "Der Google-Anmeldecode ist ungültig oder abgelaufen."


def _normalize_invite(raw: str | None) -> str | None:
    if raw is None:
        return None
    cleaned = raw.strip()
    return cleaned or None


def _web_error_url(
    origin_path: str,
    error_code: str,
    *,
    next_path: str | None = None,
    invite: str | None = None,
) -> str:
    params: list[tuple[str, str]] = [("oauth_error", error_code)]
    if next_path and next_path != "/":
        params.append(("next", next_path))
    if invite and origin_path == "/register":
        params.append(("invite", invite))
    return f"{origin_path}?{urlencode(params)}"


def _set_oauth_state_cookie(response: Response, browser_token: str) -> None:
    response.set_cookie(
        key=google_oauth.STATE_COOKIE,
        value=browser_token,
        max_age=int(google_oauth.STATE_TTL.total_seconds()),
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path=_OAUTH_STATE_COOKIE_PATH,
    )


def _clear_oauth_state_cookie(response: Response) -> None:
    response.delete_cookie(
        key=google_oauth.STATE_COOKIE,
        path=_OAUTH_STATE_COOKIE_PATH,
        secure=COOKIE_SECURE,
        samesite="lax",
    )


def _purge_expired_oauth_rows(db: Session, now: datetime) -> None:
    cutoff = now - timedelta(hours=1)
    db.execute(delete(OAuthState).where(OAuthState.expires_at < cutoff))
    db.execute(delete(OAuthExchangeCode).where(OAuthExchangeCode.expires_at < cutoff))


def _resolve_or_create_google_user(
    db: Session,
    identity: google_oauth.GoogleIdentity,
    invite_code: str | None,
    background_tasks: BackgroundTasks,
) -> User:
    by_sub = db.scalar(select(User).where(User.google_sub == identity.sub))
    if by_sub is not None:
        return by_sub

    existing = find_user_by_email(db, identity.email)
    if existing is not None:
        if existing.google_sub is not None and existing.google_sub != identity.sub:
            raise google_oauth.GoogleOAuthError(
                "google_account_conflict",
                f"Email {identity.email!r} is already linked to a different Google account.",
            )
        existing.google_sub = identity.sub
        if not existing.display_name and identity.display_name:
            existing.display_name = identity.display_name
        db.commit()
        db.refresh(existing)
        return existing

    user_count = db.scalar(select(func.count()).select_from(User)) or 0
    is_first = user_count == 0
    invite: InviteCode | None = None
    if not is_first and invite_code:
        invite = db.scalar(
            select(InviteCode).where(
                InviteCode.code == invite_code, InviteCode.used_by.is_(None)
            )
        )
        if invite is None:
            raise google_oauth.GoogleOAuthError(
                "invalid_invite",
                "Invalid or already used invite code.",
            )

    is_approved = is_first or invite is not None
    display_name = identity.display_name or identity.email.split("@", 1)[0][:120]
    user = User(
        email=identity.email,
        password_hash="",
        google_sub=identity.sub,
        display_name=display_name,
        is_admin=is_first,
        is_approved=is_approved,
    )
    db.add(user)
    db.flush()
    if invite is not None:
        claimed = db.execute(
            update(InviteCode)
            .where(InviteCode.code == invite.code, InviteCode.used_by.is_(None))
            .values(used_by=user.id, used_at=datetime.now(timezone.utc))
        )
        if claimed.rowcount != 1:
            db.rollback()
            raise google_oauth.GoogleOAuthError(
                "invalid_invite",
                "Invalid or already used invite code.",
            )
    db.commit()
    db.refresh(user)
    if not user.is_approved and mail.configured():
        admin_emails = list(db.scalars(select(User.email).where(User.is_admin.is_(True))))
        if not admin_emails:
            raise RuntimeError("A registration awaits approval but no admin account exists")
        background_tasks.add_task(
            auth_mail.send_pending_registration_notice, admin_emails, user.email
        )
    return user


@router.get("/providers", response_model=AuthProvidersOut)
def auth_providers(response: Response) -> AuthProvidersOut:
    """Report which optional authentication providers are configured on this server."""
    response.headers["Cache-Control"] = "no-store"
    return AuthProvidersOut(google=google_oauth.configured())


@router.get("/google/start", include_in_schema=False)
def google_web_start(
    next: str | None = None,
    invite: str | None = None,
    origin: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Begin the browser Google OAuth 2.0 + PKCE login flow."""
    safe_origin = google_oauth.sanitize_origin_path(origin)
    safe_next = google_oauth.sanitize_next_path(next)
    clean_invite = _normalize_invite(invite)
    if clean_invite and len(clean_invite) > 64:
        resp = RedirectResponse(
            _web_error_url(safe_origin, "invalid_invite", next_path=safe_next),
            status_code=302,
        )
        resp.headers["Cache-Control"] = "no-store"
        return resp
    if not google_oauth.configured():
        resp = RedirectResponse(
            _web_error_url(
                safe_origin, "not_configured", next_path=safe_next, invite=clean_invite
            ),
            status_code=302,
        )
        resp.headers["Cache-Control"] = "no-store"
        return resp

    now = _utcnow_naive()
    _purge_expired_oauth_rows(db, now)
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(48)
    nonce = secrets.token_urlsafe(32)
    browser_token = secrets.token_urlsafe(32)

    db.add(
        OAuthState(
            state_hash=google_oauth.hash_secret(state),
            flow="web",
            code_verifier=code_verifier,
            nonce=nonce,
            binding_hash=google_oauth.hash_secret(browser_token),
            next_path=safe_next,
            origin_path=safe_origin,
            invite_code=clean_invite,
            created_at=now,
            expires_at=now + google_oauth.STATE_TTL,
        )
    )
    db.commit()

    auth_url = google_oauth.build_authorization_url(
        state=state,
        code_challenge=google_oauth.pkce_challenge(code_verifier),
        nonce=nonce,
    )
    resp = RedirectResponse(auth_url, status_code=302)
    resp.headers["Cache-Control"] = "no-store"
    _set_oauth_state_cookie(resp, browser_token)
    return resp


@router.post(
    "/google/mobile/start",
    response_model=GoogleMobileStartOut,
    responses={503: {"description": "Google OAuth is not configured on this server."}},
)
def google_mobile_start(
    body: GoogleMobileStartRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> GoogleMobileStartOut:
    """Create a mobile Google OAuth flow and return the Google auth URL + handoff secret."""
    if not google_oauth.configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google-Anmeldung ist auf diesem Server nicht eingerichtet.",
        )

    now = _utcnow_naive()
    _purge_expired_oauth_rows(db, now)
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(48)
    nonce = secrets.token_urlsafe(32)
    handoff_secret = secrets.token_urlsafe(32)

    db.add(
        OAuthState(
            state_hash=google_oauth.hash_secret(state),
            flow="mobile",
            code_verifier=code_verifier,
            nonce=nonce,
            binding_hash=google_oauth.hash_secret(handoff_secret),
            next_path=None,
            origin_path="/login",
            invite_code=_normalize_invite(body.invite),
            created_at=now,
            expires_at=now + google_oauth.STATE_TTL,
        )
    )
    db.commit()

    auth_url = google_oauth.build_authorization_url(
        state=state,
        code_challenge=google_oauth.pkce_challenge(code_verifier),
        nonce=nonce,
    )
    response.headers["Cache-Control"] = "no-store"
    return GoogleMobileStartOut(
        auth_url=auth_url,
        handoff_secret=handoff_secret,
        expires_in_sec=int(google_oauth.STATE_TTL.total_seconds()),
    )


@router.get("/google/callback", include_in_schema=False)
def google_callback(
    background_tasks: BackgroundTasks,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    sf_oauth_state: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> Response:
    """Handle Google's redirect back for both web and mobile OAuth flows."""
    now = _utcnow_naive()
    row: OAuthState | None = None
    if state:
        row = db.scalar(
            select(OAuthState).where(
                OAuthState.state_hash == google_oauth.hash_secret(state)
            )
        )
    if (
        row is None
        or row.used_at is not None
        or _as_naive_utc(row.expires_at) <= now
    ):
        resp = RedirectResponse("/login?oauth_error=invalid_state", status_code=303)
        resp.headers["Cache-Control"] = "no-store"
        _clear_oauth_state_cookie(resp)
        return resp

    claimed = db.execute(
        update(OAuthState)
        .where(OAuthState.id == row.id, OAuthState.used_at.is_(None))
        .values(used_at=now)
    )
    if claimed.rowcount != 1:
        db.rollback()
        resp = RedirectResponse("/login?oauth_error=invalid_state", status_code=303)
        resp.headers["Cache-Control"] = "no-store"
        _clear_oauth_state_cookie(resp)
        return resp
    db.commit()

    def fail_redirect(err_code: str) -> RedirectResponse:
        if row.flow == "mobile":
            target = f"{google_oauth.MOBILE_CALLBACK_URI}?error={quote(err_code, safe='')}"
            resp = RedirectResponse(target, status_code=303)
            resp.headers["Cache-Control"] = "no-store"
            return resp
        target = _web_error_url(
            row.origin_path,
            err_code,
            next_path=row.next_path,
            invite=row.invite_code,
        )
        resp = RedirectResponse(target, status_code=303)
        resp.headers["Cache-Control"] = "no-store"
        _clear_oauth_state_cookie(resp)
        return resp

    if row.flow == "web" and (
        not sf_oauth_state
        or not hmac.compare_digest(
            google_oauth.hash_secret(sf_oauth_state), row.binding_hash
        )
    ):
        return fail_redirect("invalid_state")

    if error:
        return fail_redirect("access_denied" if error == "access_denied" else "google_auth_failed")

    if not code:
        return fail_redirect("google_exchange_failed")

    if not google_oauth.configured():
        return fail_redirect("not_configured")

    try:
        id_token = google_oauth.exchange_code_for_id_token(code, row.code_verifier)
        identity = google_oauth.verify_id_token(id_token, expected_nonce=row.nonce)
        user = _resolve_or_create_google_user(
            db, identity, row.invite_code, background_tasks
        )
    except google_oauth.GoogleOAuthError as exc:
        print(f"Google OAuth callback failed [{exc.code}]: {exc}", flush=True)
        db.rollback()
        return fail_redirect(exc.code)

    if row.flow == "web":
        resp = RedirectResponse(row.next_path or "/", status_code=303)
        resp.headers["Cache-Control"] = "no-store"
        _clear_oauth_state_cookie(resp)
        set_session_cookie(resp, create_token(user.id))
        return resp

    _purge_expired_oauth_rows(db, now)
    exchange_code = secrets.token_urlsafe(32)
    db.add(
        OAuthExchangeCode(
            code_hash=google_oauth.hash_secret(exchange_code),
            user_id=user.id,
            verifier_hash=row.binding_hash,
            created_at=now,
            expires_at=now + google_oauth.MOBILE_EXCHANGE_TTL,
        )
    )
    db.commit()
    target = f"{google_oauth.MOBILE_CALLBACK_URI}?code={quote(exchange_code, safe='')}"
    resp = RedirectResponse(target, status_code=303)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@router.post("/google/mobile/exchange", response_model=UserOut)
def google_mobile_exchange(
    body: GoogleMobileExchangeRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> UserOut:
    """Exchange a single-use mobile OAuth callback code + handoff secret for a session cookie."""
    row = db.scalar(
        select(OAuthExchangeCode).where(
            OAuthExchangeCode.code_hash == google_oauth.hash_secret(body.code)
        )
    )
    now = _utcnow_naive()
    if (
        row is None
        or row.used_at is not None
        or _as_naive_utc(row.expires_at) <= now
        or not hmac.compare_digest(
            google_oauth.hash_secret(body.handoff_secret), row.verifier_hash
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_MOBILE_EXCHANGE_INVALID,
        )

    claimed = db.execute(
        update(OAuthExchangeCode)
        .where(OAuthExchangeCode.id == row.id, OAuthExchangeCode.used_at.is_(None))
        .values(used_at=now)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_MOBILE_EXCHANGE_INVALID,
        )

    user = db.get(User, row.user_id)
    if user is None:
        db.rollback()
        raise RuntimeError(
            f"OAuth exchange code {row.id} points to missing user {row.user_id}"
        )
    db.commit()
    db.refresh(user)
    set_session_cookie(response, create_token(user.id))
    return _user_out(user)
