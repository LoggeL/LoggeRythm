"""Spotify link imports as background jobs.

A big playlist takes minutes to match on Deezer, far longer than a client
wants to hold one HTTP request open. ``start`` stores a job row and hands the
work to a small worker pool; the client polls ``GET /api/resolve/jobs/{id}``
for progress, may leave in between, and fetches the stored result later.

State
- The job row (``ImportJob``) is the source of truth: status, progress, the
  final ``ResolveResult`` as JSON, or the error that ended it.
- Cancellation is in-process: deleting a running job flags it here and removes
  the row; the worker stops at its next track. The API runs as a single
  uvicorn process (docker/start.sh), like ``radar_preload``.
- A restart kills running workers. ``fail_interrupted`` marks such jobs as
  failed on startup, with that cause, instead of leaving them "running"
  forever.
"""
from __future__ import annotations

import json
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..config import SPOTIFY_IMPORT_JOB_LIMIT
from ..db.models import ImportJob, User
from ..db.session import SessionLocal
from . import spotify
from .spotify_import import ImportCancelled, SourceInfo, resolve_link

# Two imports at once for the whole server; each one already runs
# ``spotify_import.MATCH_WORKERS`` Deezer lookups in parallel.
JOB_WORKERS = 2
# Unfinished jobs one user may have at the same time.
MAX_ACTIVE_JOBS_PER_USER = 3
# Finished jobs kept per user; older ones are deleted when a new job starts.
KEEP_FINISHED_JOBS_PER_USER = 20
# Progress is written at most this often (seconds) while matching.
PROGRESS_INTERVAL = 0.75

ACTIVE_STATUSES = ("queued", "running")

INTERRUPTED_ERROR = (
    "Der Server wurde neu gestartet, bevor der Import fertig war. "
    "Starte den Import erneut."
)

_executor = ThreadPoolExecutor(max_workers=JOB_WORKERS, thread_name_prefix="spotify-import")
_cancelled: set[str] = set()
_cancel_lock = threading.Lock()


class TooManyActiveJobs(Exception):
    """The user already has ``MAX_ACTIVE_JOBS_PER_USER`` unfinished imports."""


class JobVanished(Exception):
    """The job row disappeared while the worker still ran (it was deleted)."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _is_cancelled(job_id: str) -> bool:
    with _cancel_lock:
        return job_id in _cancelled


def fail_interrupted() -> int:
    """Mark jobs a previous process left queued/running as failed. Startup only."""
    with SessionLocal() as db:
        result = db.execute(
            update(ImportJob)
            .where(ImportJob.status.in_(ACTIVE_STATUSES))
            .values(
                status="failed",
                error=INTERRUPTED_ERROR,
                updated_at=_utcnow(),
                finished_at=_utcnow(),
            )
        )
        db.commit()
        count = int(result.rowcount or 0)
    if count:
        print(f"Spotify import: marked {count} interrupted job(s) as failed.", flush=True)
    return count


def _prune_finished(db: Session, user_id: int) -> None:
    keep = list(
        db.scalars(
            select(ImportJob.id)
            .where(
                ImportJob.user_id == user_id,
                ImportJob.status.not_in(ACTIVE_STATUSES),
            )
            .order_by(ImportJob.created_at.desc())
            .limit(KEEP_FINISHED_JOBS_PER_USER)
        )
    )
    db.execute(
        delete(ImportJob).where(
            ImportJob.user_id == user_id,
            ImportJob.status.not_in(ACTIVE_STATUSES),
            ImportJob.id.not_in(keep),
        )
    )


def start(db: Session, user: User, url: str) -> ImportJob:
    """Validate ``url``, store a queued job and schedule it.

    Raises ``spotify.SpotifyBadLink``/``SpotifyNotConfigured`` up front, so a
    job that can never succeed is not created.
    """
    url = url.strip()
    spotify.parse_link(url)
    if not spotify.is_configured():
        raise spotify.SpotifyNotConfigured(
            "Spotify-Import ist nicht konfiguriert "
            "(SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET fehlen)."
        )
    active = db.scalar(
        select(func.count())
        .select_from(ImportJob)
        .where(ImportJob.user_id == user.id, ImportJob.status.in_(ACTIVE_STATUSES))
    )
    if int(active or 0) >= MAX_ACTIVE_JOBS_PER_USER:
        raise TooManyActiveJobs(
            f"Es laufen bereits {MAX_ACTIVE_JOBS_PER_USER} Importe. "
            "Warte, bis einer fertig ist, oder brich einen ab."
        )

    _prune_finished(db, user.id)
    now = _utcnow()
    job = ImportJob(
        id=uuid.uuid4().hex,
        user_id=user.id,
        url=url,
        status="queued",
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    db.commit()
    _executor.submit(_run, job.id)
    return job


def list_for(db: Session, user: User) -> list[ImportJob]:
    return list(
        db.scalars(
            select(ImportJob)
            .where(ImportJob.user_id == user.id)
            .order_by(ImportJob.created_at.desc())
        )
    )


def get_for(db: Session, user: User, job_id: str) -> ImportJob | None:
    job = db.get(ImportJob, job_id)
    if job is None or job.user_id != user.id:
        return None
    return job


def remove(db: Session, job: ImportJob) -> None:
    """Delete ``job``; a running worker stops at its next track."""
    if job.status in ACTIVE_STATUSES:
        with _cancel_lock:
            _cancelled.add(job.id)
    db.delete(job)
    db.commit()


def result_of(job: ImportJob) -> dict | None:
    if job.result_json is None:
        return None
    return json.loads(job.result_json)


# --- worker -----------------------------------------------------------------
def _write(job_id: str, **values: object) -> None:
    """Update the job row; ``JobVanished`` when it was deleted meanwhile."""
    with SessionLocal() as db:
        result = db.execute(
            update(ImportJob)
            .where(ImportJob.id == job_id)
            .values(updated_at=_utcnow(), **values)
        )
        db.commit()
    if not result.rowcount:
        raise JobVanished(job_id)


def _run(job_id: str) -> None:
    try:
        _execute(job_id)
    except (ImportCancelled, JobVanished):
        # Deleted by its owner: the row is gone, nothing left to report to.
        pass
    except BaseException:
        # A bug in the job bookkeeping itself; never let it die silently.
        print(
            f"Spotify import job {job_id} CRASHED:\n{traceback.format_exc()}",
            flush=True,
        )
        raise
    finally:
        with _cancel_lock:
            _cancelled.discard(job_id)


def _execute(job_id: str) -> None:
    if _is_cancelled(job_id):
        raise ImportCancelled(job_id)
    with SessionLocal() as db:
        job = db.get(ImportJob, job_id)
        if job is None:
            raise JobVanished(job_id)
        url = job.url
    _write(job_id, status="running")

    last_write = 0.0

    def on_source(source: SourceInfo) -> None:
        _write(
            job_id,
            type=source.type,
            name=source.name[:300],
            image=source.image[:500],
            total=source.total,
            source_total=source.source_total,
        )

    def on_progress(processed: int, matched: int) -> None:
        nonlocal last_write
        now = time.monotonic()
        if now - last_write < PROGRESS_INTERVAL:
            return
        last_write = now
        _write(job_id, processed=processed, matched=matched)

    try:
        resolved = resolve_link(
            url,
            limit=SPOTIFY_IMPORT_JOB_LIMIT,
            on_source=on_source,
            on_progress=on_progress,
            should_cancel=lambda: _is_cancelled(job_id),
        )
    except (ImportCancelled, JobVanished):
        raise
    except spotify.SpotifyError as exc:
        _write(job_id, status="failed", error=str(exc), finished_at=_utcnow())
        return
    except Exception as exc:  # noqa: BLE001 — recorded on the job and logged loudly
        print(
            f"Spotify import job {job_id} failed:\n{traceback.format_exc()}",
            flush=True,
        )
        _write(
            job_id,
            status="failed",
            error=f"Import fehlgeschlagen: {type(exc).__name__}: {exc}",
            finished_at=_utcnow(),
        )
        return

    result = resolved.as_result()
    _write(
        job_id,
        status="done",
        type=resolved.type,
        name=resolved.name[:300],
        image=resolved.image[:500],
        total=resolved.total,
        source_total=resolved.source_total,
        processed=resolved.total,
        matched=len(resolved.tracks),
        failed_lookups=resolved.lookup_failures.count,
        lookup_error=resolved.lookup_failures.first_error,
        result_json=json.dumps(result, ensure_ascii=False),
        finished_at=_utcnow(),
    )
