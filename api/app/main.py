"""Spotifrei API — clean REST backend.

Wires together browse/stream/auth/likes/playlists routers, the SQLAlchemy DB,
cookie-based JWT auth and the Deezer adapter. The audio stream/Range logic
lives in routers/stream.py and is preserved verbatim from the verified spike.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from sqlalchemy import select

from .config import CORS_ORIGINS
from .db.models import User
from .db.session import SessionLocal, engine, init_db
from .routers import (
    admin,
    auth,
    browse,
    follows,
    likes,
    lyrics,
    party,
    playlists,
    profile,
    radio,
    resolve,
    stats,
    stream,
)
from .services import deezer_client

app = FastAPI(title="Spotifrei API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


def _migrate_user_columns() -> None:
    """Lightweight SQLite migration: add is_admin/is_approved if missing.

    The existing `users` table predates these columns. Idempotent and
    sqlite-only; wrapped so it never crashes startup.
    """
    if engine.dialect.name != "sqlite":
        return
    try:
        with engine.begin() as conn:
            cols = {
                row[1]
                for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()
            }
            if "is_admin" not in cols:
                conn.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"
                )
            if "is_approved" not in cols:
                conn.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT 0"
                )
            if "avatar_url" not in cols:
                conn.exec_driver_sql("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500)")
            pcols = {
                row[1]
                for row in conn.exec_driver_sql(
                    "PRAGMA table_info(playlists)"
                ).fetchall()
            }
            if "is_public" not in pcols:
                conn.exec_driver_sql(
                    "ALTER TABLE playlists ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT 0"
                )
    except Exception as exc:  # pragma: no cover — never crash startup
        print(f"User column migration skipped: {exc!r}")


def _bootstrap_admin() -> None:
    """Promote the lowest-id user to admin if no admin exists yet."""
    try:
        with SessionLocal() as db:
            has_admin = db.scalar(
                select(User).where(User.is_admin.is_(True)).limit(1)
            )
            if has_admin is not None:
                return
            first = db.scalar(select(User).order_by(User.id).limit(1))
            if first is not None:
                first.is_admin = True
                first.is_approved = True
                db.commit()
                print(f"Bootstrapped admin: user id={first.id} ({first.email}).")
    except Exception as exc:  # pragma: no cover — never crash startup
        print(f"Admin bootstrap skipped: {exc!r}")


@app.on_event("startup")
def _startup() -> None:
    init_db()
    _migrate_user_columns()
    _bootstrap_admin()
    deezer_client.init_session()
    print("Spotifrei API started: DB ready, Deezer session initialized.")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(_STATIC_DIR, "test.html"))


app.include_router(browse.router)
app.include_router(stream.router)
app.include_router(auth.router)
app.include_router(likes.router)
app.include_router(playlists.router)
app.include_router(follows.router)
app.include_router(resolve.router)
app.include_router(lyrics.router)
app.include_router(admin.router)
app.include_router(party.router)
app.include_router(profile.router)
app.include_router(radio.router)
app.include_router(stats.router)
