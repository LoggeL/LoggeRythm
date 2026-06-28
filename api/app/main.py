"""Spotifrei API — clean REST backend.

Wires together browse/stream/auth/likes/playlists routers, the SQLAlchemy DB,
cookie-based JWT auth and the Deezer adapter. The audio stream/Range logic
lives in routers/stream.py and is preserved verbatim from the verified spike.
"""
import os
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from sqlalchemy import select

from .config import APP_ENV, CORS_ORIGINS, validate_runtime_config
from .db.models import User
from .db.session import SessionLocal, engine, init_db
from .routers import (
    admin,
    auth,
    browse,
    follows,
    home,
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
from .services import deezer_client, storage

app = FastAPI(title="Spotifrei API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Outside production we surface the real exception type/message (and a trimmed
# traceback) to the client instead of an opaque "Internal Server Error", which
# makes debugging from the browser far easier.
_EXPOSE_ERROR_DETAILS = APP_ENV not in {"prod", "production"}


@app.exception_handler(Exception)
async def _unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Return the real error detail to the client (verbose outside production).

    FastAPI handles ``HTTPException`` and request-validation errors itself, so
    this only fires for genuinely unexpected exceptions that would otherwise
    collapse into a detail-less 500.
    """
    tb = traceback.format_exc()
    print(f"Unhandled error on {request.method} {request.url.path}:\n{tb}")
    if _EXPOSE_ERROR_DETAILS:
        body: dict = {
            "detail": f"{type(exc).__name__}: {exc}",
            "error_type": type(exc).__name__,
            # Last frames are the most relevant for pinpointing the cause.
            "traceback": tb.rstrip().splitlines()[-15:],
        }
    else:
        body = {"detail": "Internal Server Error"}
    return JSONResponse(status_code=500, content=body)

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
            if "crossfade_enabled" not in cols:
                conn.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN crossfade_enabled BOOLEAN NOT NULL DEFAULT 0"
                )
            if "crossfade_duration_sec" not in cols:
                conn.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN crossfade_duration_sec INTEGER NOT NULL DEFAULT 5"
                )
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
            scols = {
                row[1]
                for row in conn.exec_driver_sql(
                    "PRAGMA table_info(stored_tracks)"
                ).fetchall()
            }
            if scols and "last_accessed" not in scols:
                conn.exec_driver_sql(
                    "ALTER TABLE stored_tracks ADD COLUMN last_accessed DATETIME"
                )
                conn.exec_driver_sql(
                    "UPDATE stored_tracks SET last_accessed = created_at WHERE last_accessed IS NULL"
                )
            lcols = {
                row[1]
                for row in conn.exec_driver_sql(
                    "PRAGMA table_info(stored_lyrics)"
                ).fetchall()
            }
            if lcols and "source" not in lcols:
                conn.exec_driver_sql(
                    "ALTER TABLE stored_lyrics ADD COLUMN source VARCHAR(40) NOT NULL DEFAULT 'lrclib'"
                )
            if lcols and "ai_generated" not in lcols:
                conn.exec_driver_sql(
                    "ALTER TABLE stored_lyrics ADD COLUMN ai_generated BOOLEAN NOT NULL DEFAULT 0"
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


def _cleanup_loop() -> None:
    """Daemon: evict tracks past the retention window every few hours."""
    import time

    while True:
        time.sleep(6 * 3600)
        result = storage.cleanup_old()
        if result.get("removed"):
            print(f"Storage cleanup: removed {result['removed']} stale tracks.")


@app.on_event("startup")
def _startup() -> None:
    import threading

    validate_runtime_config()
    init_db()
    _migrate_user_columns()
    _bootstrap_admin()
    deezer_client.init_session()
    storage.reconcile()  # backfill DB rows for pre-existing files
    storage.cleanup_old()  # evict stale tracks on boot
    threading.Thread(target=_cleanup_loop, daemon=True).start()
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
app.include_router(home.router)
