"""LoggeRythm API — clean REST backend.

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

from .api_version import API_VERSION
from .config import APP_ENV, CORS_ORIGINS, validate_runtime_config
from .db.models import User
from .db.session import SessionLocal, engine, init_db
from .openapi_security import install_auth_openapi
from .routers import (
    admin,
    auth,
    browse,
    compatibility,
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

app = FastAPI(title="LoggeRythm API", version=API_VERSION)

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


# Declarative SQLite column migrations — a stand-in for Alembic. Each entry adds
# one column to a pre-existing table when it's missing, with an optional one-off
# backfill statement. Tables created fresh by ``create_all`` already have every
# column, so those entries are simply skipped. Append new columns here; never
# edit/remove past entries (older DBs replay the whole list on each startup).
_COLUMN_MIGRATIONS: tuple[dict[str, str], ...] = (
    {"table": "users", "column": "is_admin", "ddl": "BOOLEAN NOT NULL DEFAULT 0"},
    {"table": "users", "column": "is_approved", "ddl": "BOOLEAN NOT NULL DEFAULT 0"},
    {"table": "users", "column": "avatar_url", "ddl": "VARCHAR(500)"},
    {"table": "users", "column": "crossfade_enabled", "ddl": "BOOLEAN NOT NULL DEFAULT 0"},
    {"table": "users", "column": "crossfade_duration_sec", "ddl": "INTEGER NOT NULL DEFAULT 5"},
    {"table": "playlists", "column": "is_public", "ddl": "BOOLEAN NOT NULL DEFAULT 0"},
    {
        "table": "stored_tracks",
        "column": "last_accessed",
        "ddl": "DATETIME",
        "backfill": "UPDATE stored_tracks SET last_accessed = created_at WHERE last_accessed IS NULL",
    },
    {"table": "stored_lyrics", "column": "source", "ddl": "VARCHAR(40) NOT NULL DEFAULT 'lrclib'"},
    {"table": "stored_lyrics", "column": "ai_generated", "ddl": "BOOLEAN NOT NULL DEFAULT 0"},
    # Full performer credit list for tracks with several artists.
    {"table": "playlist_tracks", "column": "artists_json", "ddl": "TEXT NOT NULL DEFAULT '[]'"},
    {"table": "likes", "column": "artists_json", "ddl": "TEXT NOT NULL DEFAULT '[]'"},
    {"table": "plays", "column": "artists_json", "ddl": "TEXT NOT NULL DEFAULT '[]'"},
    {"table": "party_tracks", "column": "artists_json", "ddl": "TEXT NOT NULL DEFAULT '[]'"},
    # Host-authoritative playback state for real-time party mode.
    {"table": "party_sessions", "column": "is_playing", "ddl": "BOOLEAN NOT NULL DEFAULT 0"},
    {"table": "party_sessions", "column": "position_sec", "ddl": "FLOAT NOT NULL DEFAULT 0"},
    {"table": "party_sessions", "column": "playback_updated_at", "ddl": "DATETIME"},
)


def _run_column_migrations() -> None:
    """Apply the declarative column migrations above (idempotent, sqlite-only)."""
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        cache: dict[str, set[str]] = {}

        def columns(table: str) -> set[str]:
            if table not in cache:
                cache[table] = {
                    row[1]
                    for row in conn.exec_driver_sql(
                        f"PRAGMA table_info({table})"
                    ).fetchall()
                }
            return cache[table]

        for spec in _COLUMN_MIGRATIONS:
            table, column = spec["table"], spec["column"]
            cols = columns(table)
            # Empty set → table doesn't exist yet; nothing to alter.
            if not cols or column in cols:
                continue
            conn.exec_driver_sql(
                f"ALTER TABLE {table} ADD COLUMN {column} {spec['ddl']}"
            )
            cols.add(column)
            if spec.get("backfill"):
                conn.exec_driver_sql(spec["backfill"])


def _bootstrap_admin() -> None:
    """Promote the lowest-id user to admin if no admin exists yet."""
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
    _run_column_migrations()
    _bootstrap_admin()
    deezer_client.init_session()
    storage.reconcile()  # backfill DB rows for pre-existing files
    storage.cleanup_old()  # evict stale tracks on boot
    threading.Thread(target=_cleanup_loop, daemon=True).start()
    print("LoggeRythm API started: DB ready, Deezer session initialized.")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(_STATIC_DIR, "test.html"))


app.include_router(browse.router)
app.include_router(compatibility.router)
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

# Install after every router so the dependency walk sees the complete API.
install_auth_openapi(app)
