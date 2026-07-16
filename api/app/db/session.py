"""SQLAlchemy 2.0 engine, session factory, declarative base and FastAPI dependency."""
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from ..config import DATABASE_URL

# SQLite needs check_same_thread=False because FastAPI may touch a session
# from a different thread (run_in_threadpool). Harmless for other backends.
_connect_args = (
    {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)

engine = create_engine(DATABASE_URL, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def get_db() -> Iterator[Session]:
    """Yield a database session, closing it when the request completes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_columns() -> None:
    """Add columns introduced after a table was first created.

    ``create_all`` never ALTERs an existing table, so additive columns on the
    dev SQLite DB need a tiny explicit migration. Idempotent: only adds a column
    when ``PRAGMA table_info`` shows it missing.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return
    from sqlalchemy import text

    wanted = {
        "playlist_tracks": [("album_id", "VARCHAR(32) NOT NULL DEFAULT ''")],
        "likes": [("album_id", "VARCHAR(32) NOT NULL DEFAULT ''")],
    }
    with engine.begin() as conn:
        for table, cols in wanted.items():
            existing = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            for name, ddl in cols:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def init_db() -> None:
    """Create all tables (dev convenience; replace with Alembic later)."""
    from . import models  # noqa: F401 — register models on the metadata

    Base.metadata.create_all(engine)
    _ensure_columns()
