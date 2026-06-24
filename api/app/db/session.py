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


def init_db() -> None:
    """Create all tables (dev convenience; replace with Alembic later)."""
    from . import models  # noqa: F401 — register models on the metadata

    Base.metadata.create_all(engine)
