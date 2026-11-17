"""Transactional mail via the Resend HTTP API (https://resend.com/docs/api-reference)."""
from __future__ import annotations

import requests

from .. import config as cfg

_SEND_URL = "https://api.resend.com/emails"
_TIMEOUT_SEC = 15


class MailNotConfiguredError(RuntimeError):
    """Raised when a mail feature is used without RESEND_API_KEY."""


class MailDeliveryError(RuntimeError):
    """Raised when Resend rejects or cannot accept a message."""


def configured() -> bool:
    return bool(cfg.RESEND_API_KEY)


def app_url(path: str) -> str:
    """Absolute link into the web app for use inside a mail."""
    if not path.startswith("/"):
        raise ValueError(f"Mail link path must start with '/', got {path!r}")
    return f"{cfg.PUBLIC_APP_URL}{path}"


def send(*, to: list[str], subject: str, text: str, html: str) -> str:
    """Send one message and return Resend's message id. Raises on any failure."""
    if not configured():
        raise MailNotConfiguredError(
            "Mail is not configured: set RESEND_API_KEY, MAIL_FROM and PUBLIC_APP_URL."
        )
    if not to:
        raise ValueError("Mail needs at least one recipient")
    try:
        response = requests.post(
            _SEND_URL,
            headers={"Authorization": f"Bearer {cfg.RESEND_API_KEY}"},
            json={
                "from": cfg.MAIL_FROM,
                "to": to,
                "subject": subject,
                "text": text,
                "html": html,
            },
            timeout=_TIMEOUT_SEC,
        )
    except requests.RequestException as exc:
        raise MailDeliveryError(f"Resend request failed: {exc}") from exc
    if response.status_code != 200:
        raise MailDeliveryError(
            f"Resend rejected the mail with HTTP {response.status_code}: {response.text[:500]}"
        )
    try:
        message_id = response.json()["id"]
    except (ValueError, KeyError, TypeError) as exc:
        raise MailDeliveryError(
            f"Resend returned no message id: {response.text[:500]}"
        ) from exc
    if not isinstance(message_id, str) or not message_id:
        raise MailDeliveryError(f"Resend returned an invalid message id: {message_id!r}")
    return message_id
