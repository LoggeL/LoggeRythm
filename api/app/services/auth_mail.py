"""Mail content and delivery for account flows (password reset, admin notices)."""
from __future__ import annotations

from html import escape

from ..db.models import User
from . import mail

RESET_LINK_VALID_MINUTES = 60


def _html(heading: str, paragraphs: list[str], button_label: str, button_url: str) -> str:
    body = "".join(
        f'<p style="margin:0 0 16px;line-height:1.5">{escape(p)}</p>' for p in paragraphs
    )
    return (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;'
        'margin:0 auto;padding:24px;color:#111">'
        f'<h1 style="font-size:20px;margin:0 0 16px">{escape(heading)}</h1>'
        f"{body}"
        f'<p style="margin:24px 0"><a href="{escape(button_url, quote=True)}" '
        'style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;'
        f'text-decoration:none;display:inline-block">{escape(button_label)}</a></p>'
        f'<p style="font-size:12px;color:#666;word-break:break-all">{escape(button_url)}</p>'
        "</div>"
    )


def send_password_reset(user: User, token: str) -> None:
    url = mail.app_url(f"/reset-password?token={token}")
    name = user.display_name or user.email
    paragraphs = [
        f"Hallo {name},",
        "jemand hat für dein LoggeRythm-Konto ein neues Passwort angefordert. "
        f"Über den Link kannst du es in den nächsten {RESET_LINK_VALID_MINUTES} Minuten "
        "einmalig neu setzen.",
        "Wenn du das nicht warst, ignoriere diese Mail. Dein Passwort bleibt dann unverändert.",
    ]
    mail.send(
        to=[user.email],
        subject="Dein LoggeRythm-Passwort zurücksetzen",
        text="\n\n".join(paragraphs) + f"\n\n{url}\n",
        html=_html("Passwort zurücksetzen", paragraphs, "Neues Passwort setzen", url),
    )


def send_pending_registration_notice(admin_emails: list[str], new_user_email: str) -> None:
    """Tell admins that a registration is waiting for approval."""
    url = mail.app_url("/account?tab=admin")
    paragraphs = [
        f"{new_user_email} hat sich bei LoggeRythm registriert und wartet auf Freigabe.",
    ]
    mail.send(
        to=admin_emails,
        subject=f"Neue Registrierung: {new_user_email}",
        text="\n\n".join(paragraphs) + f"\n\n{url}\n",
        html=_html("Neue Registrierung", paragraphs, "In der Verwaltung freigeben", url),
    )
