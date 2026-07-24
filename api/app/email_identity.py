"""Canonical, case-insensitive email identity lookups."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db.models import User


def normalize_email(value: str) -> str:
    """Store and compare the complete validated email address in lowercase."""
    return value.strip().lower()


def find_user_by_email(
    db: Session,
    value: str,
    *,
    exclude_user_id: int | None = None,
) -> User | None:
    """Resolve exactly one account while detecting legacy case-only duplicates."""
    normalized = normalize_email(value)
    statement = select(User).where(func.lower(User.email) == normalized)
    if exclude_user_id is not None:
        statement = statement.where(User.id != exclude_user_id)
    matches = list(db.scalars(statement.limit(2)))
    if len(matches) > 1:
        raise RuntimeError(
            f"Multiple user accounts share the case-insensitive email identity {normalized!r}"
        )
    return matches[0] if matches else None
