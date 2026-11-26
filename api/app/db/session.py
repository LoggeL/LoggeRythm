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


def backfill_play_covers(db: Session) -> int:
    """Give stored plays without artwork their album cover; return the rows changed.

    Plays reported by the Android app were stored with no ``cover_url`` (its
    play journal carries no URL), so recently-heard and top lists showed
    placeholders. ``record_play`` now derives the cover from the album id;
    this repairs the rows written before that. Idempotent: rows that have a
    cover, or no Deezer album id to derive one from, are left alone.
    """
    from sqlalchemy import or_, select, update

    from ..schemas.track import album_cover_url
    from .models import Play

    missing = or_(Play.cover_url.is_(None), Play.cover_url == "")
    album_ids = db.scalars(
        select(Play.album_id).where(missing, Play.album_id != "").distinct()
    ).all()
    changed = 0
    for album_id in album_ids:
        cover = album_cover_url(album_id)
        if cover is None:
            continue
        result = db.execute(
            update(Play).where(Play.album_id == album_id, missing).values(cover_url=cover)
        )
        changed += result.rowcount
    return changed


def init_db() -> None:
    """Create all tables (dev convenience; replace with Alembic later)."""
    from . import models  # noqa: F401 — register models on the metadata

    Base.metadata.create_all(engine)
    _ensure_columns()
    with SessionLocal.begin() as db:
        backfill_play_covers(db)
