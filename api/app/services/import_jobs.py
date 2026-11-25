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
from ..db.models import ImportJob, Playlist, PlaylistCollaborator, PlaylistTrack, User
from ..db.session import SessionLocal
from ..schemas.track import Track, dump_artists
from . import playlist_bus, spotify
from .spotify_import import ImportCancelled, SourceInfo, resolve_link
from .track_identity import normalize_isrc

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


class InvalidImportTarget(Exception):
    """Invalid playlist target specification on an import job."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


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


def _can_edit_playlist(db: Session, playlist: Playlist, user_id: int) -> bool:
    if playlist.user_id == user_id:
        return True
    if not playlist.is_collaborative:
        return False
    return (
        db.scalar(
            select(PlaylistCollaborator.id).where(
                PlaylistCollaborator.playlist_id == playlist.id,
                PlaylistCollaborator.user_id == user_id,
            )
        )
        is not None
    )


def start(
    db: Session,
    user: User,
    url: str,
    *,
    target_playlist_id: int | None = None,
    create_playlist_name: str | None = None,
) -> ImportJob:
    """Validate ``url`` (and optional playlist target), store a queued job and schedule it.

    Raises ``spotify.SpotifyBadLink``/``SpotifyNotConfigured``/``InvalidImportTarget``
    up front, so a job that can never succeed is not created.
    """
    url = url.strip()
    spotify.parse_link(url)
    if not spotify.is_configured():
        raise spotify.SpotifyNotConfigured(
            "Spotify-Import ist nicht konfiguriert "
            "(SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET fehlen)."
        )
    cleaned_create_name = (
        create_playlist_name.strip() if create_playlist_name is not None else None
    )
    if create_playlist_name is not None and not cleaned_create_name:
        raise InvalidImportTarget(422, "create_playlist_name darf nicht leer sein.")
    if target_playlist_id is not None and cleaned_create_name is not None:
        raise InvalidImportTarget(
            422,
            "target_playlist_id und create_playlist_name können nicht kombiniert werden.",
        )
    if target_playlist_id is not None:
        pl = db.get(Playlist, target_playlist_id)
        if pl is None:
            raise InvalidImportTarget(404, "Ziel-Playlist nicht gefunden.")
        if not _can_edit_playlist(db, pl, user.id):
            raise InvalidImportTarget(
                403, "Keine Berechtigung zum Bearbeiten der Ziel-Playlist."
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
        target_playlist_id=target_playlist_id,
        create_playlist_name=cleaned_create_name,
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


def _write_matched_to_playlist(
    *,
    user_id: int,
    target_playlist_id: int | None,
    create_playlist_name: str | None,
    fallback_name: str,
    fallback_image: str,
    matched_tracks: list[dict],
) -> int | None:
    """Persist matched import tracks straight into an existing or newly created playlist."""
    if target_playlist_id is None and not create_playlist_name:
        return None
    with SessionLocal() as db:
        if target_playlist_id is not None:
            pl = db.get(Playlist, target_playlist_id)
            if pl is None:
                raise RuntimeError(f"Ziel-Playlist {target_playlist_id} wurde gelöscht.")
            if not _can_edit_playlist(db, pl, user_id):
                raise RuntimeError(
                    f"Berechtigung für Ziel-Playlist {target_playlist_id} wurde entzogen."
                )
        else:
            pl = Playlist(
                user_id=user_id,
                name=(create_playlist_name or fallback_name or "Spotify Import")[:200],
                cover_url=fallback_image or None,
            )
            db.add(pl)
            db.flush()

        existing = set(
            db.scalars(
                select(PlaylistTrack.deezer_id).where(PlaylistTrack.playlist_id == pl.id)
            ).all()
        )
        pos = db.scalar(
            select(func.coalesce(func.max(PlaylistTrack.position), -1)).where(
                PlaylistTrack.playlist_id == pl.id
            )
        )
        pos = int(pos) if pos is not None else -1
        added = 0
        for raw in matched_tracks:
            track = Track.model_validate(raw)
            if track.id in existing:
                continue
            existing.add(track.id)
            pos += 1
            db.add(
                PlaylistTrack(
                    playlist_id=pl.id,
                    deezer_id=track.id,
                    isrc=normalize_isrc(track.isrc),
                    title=track.title,
                    artist=track.artist,
                    artists_json=dump_artists(track),
                    album=track.album,
                    album_id=str(track.album_id or ""),
                    cover_url=track.cover or None,
                    duration_sec=track.duration_sec,
                    loudness_gain_db=track.loudness_gain_db,
                    position=pos,
                    added_by_user_id=user_id,
                )
            )
            if not pl.cover_url and track.cover:
                pl.cover_url = track.cover
            added += 1
        if added > 0 or target_playlist_id is None:
            pl.revision = int(pl.revision or 0) + 1
        playlist_id = pl.id
        revision = int(pl.revision or 0)
        db.commit()
        playlist_bus.publish(playlist_id, revision)
        return playlist_id


def _execute(job_id: str) -> None:
    if _is_cancelled(job_id):
        raise ImportCancelled(job_id)
    with SessionLocal() as db:
        job = db.get(ImportJob, job_id)
        if job is None:
            raise JobVanished(job_id)
        url = job.url
        user_id = job.user_id
        target_playlist_id = job.target_playlist_id
        create_playlist_name = job.create_playlist_name
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

    created_playlist_id: int | None = None
    if target_playlist_id is not None or create_playlist_name:
        try:
            created_playlist_id = _write_matched_to_playlist(
                user_id=user_id,
                target_playlist_id=target_playlist_id,
                create_playlist_name=create_playlist_name,
                fallback_name=resolved.name,
                fallback_image=resolved.image,
                matched_tracks=resolved.tracks,
            )
        except Exception as exc:  # noqa: BLE001 — fail job loudly if playlist save fails
            _write(
                job_id,
                status="failed",
                error=f"Playlist-Speicherung fehlgeschlagen: {exc}",
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
        created_playlist_id=created_playlist_id,
        result_json=json.dumps(result, ensure_ascii=False),
        finished_at=_utcnow(),
    )
