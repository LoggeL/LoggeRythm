"""Google OAuth 2.0 / OIDC login helpers: PKCE, token exchange, and JWKS verification."""
from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import timedelta
import hashlib
import hmac
import re
import threading
import time
from urllib.parse import urlencode, urlsplit

from jose import JWTError, jwt
import requests

from .. import config as cfg
from ..email_identity import normalize_email

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})

STATE_COOKIE = "sf_oauth_state"
STATE_TTL = timedelta(minutes=10)
MOBILE_EXCHANGE_TTL = timedelta(seconds=60)
MOBILE_CALLBACK_URI = "loggerythm://auth/google/callback"
HTTP_TIMEOUT_SEC = 15

_AUTH_PATHS = frozenset({"/login", "/register", "/forgot-password", "/reset-password"})
_MAX_AGE_RE = re.compile(r"max-age=(\d+)", re.IGNORECASE)
_MIN_JWKS_TTL_SEC = 60
_DEFAULT_JWKS_TTL_SEC = 3600
_MAX_JWKS_TTL_SEC = 86400

_jwks_lock = threading.Lock()
_jwks_keys: dict[str, dict] = {}
_jwks_expires_at: float = 0.0


class GoogleOAuthNotConfiguredError(RuntimeError):
    """Raised when Google OAuth is invoked without complete server configuration."""


class GoogleOAuthError(RuntimeError):
    """Raised when the Google OAuth exchange, token, or identity check fails."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class GoogleIdentity:
    """Verified Google identity extracted from a signed OIDC ID token."""

    sub: str
    email: str
    display_name: str | None


def configured() -> bool:
    return bool(cfg.GOOGLE_CLIENT_ID and cfg.GOOGLE_CLIENT_SECRET and cfg.PUBLIC_APP_URL)


def redirect_uri() -> str:
    if not configured():
        raise GoogleOAuthNotConfiguredError(
            "Google OAuth is not configured: set GOOGLE_CLIENT_ID, "
            "GOOGLE_CLIENT_SECRET, and PUBLIC_APP_URL."
        )
    return f"{cfg.PUBLIC_APP_URL}/api/auth/google/callback"


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def sanitize_next_path(raw: str | None) -> str:
    """Validate a relative in-app redirect target (`?next=...`), defaulting to `/`."""
    if not raw:
        return "/"
    trimmed = raw.strip()
    if not trimmed or not trimmed.startswith("/") or trimmed.startswith("//"):
        return "/"
    if "\\" in trimmed:
        return "/"
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in trimmed):
        return "/"
    try:
        parsed = urlsplit(trimmed)
    except ValueError:
        return "/"
    if parsed.scheme or parsed.netloc:
        return "/"
    if not parsed.path.startswith("/") or parsed.path.startswith("//"):
        return "/"
    if parsed.path in _AUTH_PATHS:
        return "/"
    result = parsed.path
    if parsed.query:
        result = f"{result}?{parsed.query}"
    if parsed.fragment:
        result = f"{result}#{parsed.fragment}"
    return result


def sanitize_origin_path(raw: str | None) -> str:
    return "/register" if raw == "/register" else "/login"


def build_authorization_url(*, state: str, code_challenge: str, nonce: str) -> str:
    query = urlencode(
        {
            "client_id": cfg.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri(),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    return f"{GOOGLE_AUTH_URL}?{query}"


def exchange_code_for_id_token(code: str, code_verifier: str) -> str:
    try:
        response = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": cfg.GOOGLE_CLIENT_ID,
                "client_secret": cfg.GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri(),
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
            timeout=HTTP_TIMEOUT_SEC,
        )
    except requests.RequestException as exc:
        raise GoogleOAuthError(
            "google_exchange_failed",
            f"Google token request failed: {exc}",
        ) from exc

    if response.status_code != 200:
        raise GoogleOAuthError(
            "google_exchange_failed",
            f"Google token endpoint returned HTTP {response.status_code}: {response.text[:300]}",
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Google token endpoint returned invalid JSON: {exc}",
        ) from exc
    if not isinstance(payload, dict):
        raise GoogleOAuthError(
            "google_invalid_token",
            "Google token endpoint returned a non-object response.",
        )
    id_token = payload.get("id_token")
    if not isinstance(id_token, str) or not id_token.strip():
        raise GoogleOAuthError(
            "google_invalid_token",
            "Google token response did not include an id_token.",
        )
    return id_token


def clear_jwks_cache() -> None:
    global _jwks_keys, _jwks_expires_at
    with _jwks_lock:
        _jwks_keys = {}
        _jwks_expires_at = 0.0


def _parse_max_age(cache_control: str | None) -> int:
    if not cache_control:
        return _DEFAULT_JWKS_TTL_SEC
    match = _MAX_AGE_RE.search(cache_control)
    if not match:
        return _DEFAULT_JWKS_TTL_SEC
    seconds = int(match.group(1))
    return max(_MIN_JWKS_TTL_SEC, min(_MAX_JWKS_TTL_SEC, seconds))


def _fetch_jwks() -> tuple[dict[str, dict], int]:
    try:
        response = requests.get(GOOGLE_JWKS_URL, timeout=HTTP_TIMEOUT_SEC)
    except requests.RequestException as exc:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Failed to fetch Google JWKS: {exc}",
        ) from exc
    if response.status_code != 200:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Google JWKS endpoint returned HTTP {response.status_code}.",
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Google JWKS response was not valid JSON: {exc}",
        ) from exc
    keys_raw = payload.get("keys") if isinstance(payload, dict) else None
    if not isinstance(keys_raw, list) or not keys_raw:
        raise GoogleOAuthError(
            "google_invalid_token",
            "Google JWKS response contained no keys.",
        )
    by_kid: dict[str, dict] = {}
    for entry in keys_raw:
        if isinstance(entry, dict) and isinstance(entry.get("kid"), str) and entry["kid"]:
            by_kid[entry["kid"]] = entry
    if not by_kid:
        raise GoogleOAuthError(
            "google_invalid_token",
            "Google JWKS response contained no usable key IDs.",
        )
    ttl = _parse_max_age(response.headers.get("Cache-Control"))
    return by_kid, ttl


def _jwk_for_kid(kid: str) -> dict:
    global _jwks_keys, _jwks_expires_at
    with _jwks_lock:
        now = time.monotonic()
        if now < _jwks_expires_at and kid in _jwks_keys:
            return _jwks_keys[kid]

    # Cache miss or unknown kid (key rotation) -> refresh from Google JWKS.
    keys, ttl = _fetch_jwks()
    with _jwks_lock:
        _jwks_keys = keys
        _jwks_expires_at = time.monotonic() + ttl
        jwk_entry = _jwks_keys.get(kid)
    if jwk_entry is None:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Google JWKS did not contain signing key {kid!r}.",
        )
    return jwk_entry


def verify_id_token(id_token: str, *, expected_nonce: str) -> GoogleIdentity:
    if not configured():
        raise GoogleOAuthNotConfiguredError(
            "Google OAuth is not configured: set GOOGLE_CLIENT_ID, "
            "GOOGLE_CLIENT_SECRET, and PUBLIC_APP_URL."
        )
    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Invalid Google ID token header: {exc}",
        ) from exc
    if header.get("alg") != "RS256":
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Unsupported Google ID token algorithm: {header.get('alg')!r}.",
        )
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise GoogleOAuthError(
            "google_invalid_token",
            "Google ID token header is missing a key ID (kid).",
        )

    key = _jwk_for_kid(kid)
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            audience=cfg.GOOGLE_CLIENT_ID,
            options={"verify_at_hash": False},
        )
    except JWTError as exc:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Google ID token verification failed: {exc}",
        ) from exc

    issuer = claims.get("iss")
    if issuer not in GOOGLE_ISSUERS:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Unexpected Google ID token issuer: {issuer!r}.",
        )

    nonce = claims.get("nonce")
    if not isinstance(nonce, str) or not hmac.compare_digest(nonce, expected_nonce):
        raise GoogleOAuthError(
            "google_invalid_token",
            "Google ID token nonce did not match the login state.",
        )

    if claims.get("email_verified") is not True:
        raise GoogleOAuthError(
            "google_email_unverified",
            "Google account email address is not verified.",
        )

    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub.strip() or len(sub) > 255:
        raise GoogleOAuthError(
            "google_invalid_token",
            "Google ID token is missing a valid subject identifier.",
        )

    raw_email = claims.get("email")
    if not isinstance(raw_email, str):
        raise GoogleOAuthError(
            "google_invalid_token",
            "Google ID token is missing an email claim.",
        )
    email = normalize_email(raw_email)
    if "@" not in email or len(email) > 320:
        raise GoogleOAuthError(
            "google_invalid_token",
            f"Google ID token email claim is invalid: {raw_email!r}.",
        )

    raw_name = claims.get("name")
    display_name: str | None = None
    if isinstance(raw_name, str):
        cleaned = raw_name.strip()[:120]
        if cleaned:
            display_name = cleaned

    return GoogleIdentity(sub=sub.strip(), email=email, display_name=display_name)
