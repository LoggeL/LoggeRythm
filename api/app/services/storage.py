"""Track storage with a play-based retention window.

Each Deezer track is downloaded + decrypted exactly once via MelodAI's deezer.py
and stored on disk. A StoredTrack DB row mirrors each file and carries a
``last_accessed`` timestamp that is bumped on every play. A periodic cleanup
evicts tracks not played within ``STORAGE_RETENTION_DAYS`` days.

Correctness guarantees:
- per-track lock -> no concurrent double-download of the same id
- atomic rename (.part -> final) -> never serve a half-written file
"""
import json
import os
import threading
from datetime import datetime, timedelta, timezone

from ..config import STORAGE_RETENTION_DAYS
from ..db.models import StoredTrack
from ..db.session import SessionLocal
from . import deezer

_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _upsert_record(deezer_id: str, song: dict, final: str) -> None:
    """Create/refresh the StoredTrack DB row for a freshly stored file."""
    try:
        with SessionLocal() as db:
            row = db.get(StoredTrack, deezer_id)
            cover = (
                f"https://e-cdns-images.dzcdn.net/images/cover/{song['ALB_PICTURE']}/500x500.jpg"
                if song.get("ALB_PICTURE")
                else ""
            )
            size = os.path.getsize(final)
            if row is None:
                db.add(
                    StoredTrack(
                        deezer_id=deezer_id,
                        file_path=final,
                        title=song.get("SNG_TITLE", "") or "",
                        artist=song.get("ART_NAME", "") or "",
                        album=song.get("ALB_TITLE", "") or "",
                        cover_url=cover or None,
                        duration_sec=int(song.get("DURATION", 0) or 0),
                        size_bytes=size,
                        status="ready",
                        last_accessed=_now(),
                    )
                )
            else:
                row.file_path = final
                row.size_bytes = size
                row.last_accessed = _now()
            db.commit()
    except Exception as exc:
        raise RuntimeError(
            f"Could not record stored track {deezer_id}: {exc}"
        ) from exc


def _row_from_disk(deezer_id: str, when: datetime) -> StoredTrack | None:
    """Build a StoredTrack from the on-disk file + sidecar (for backfill)."""
    final = path_for(deezer_id)
    if not os.path.exists(final):
        return None
    meta = get_meta(deezer_id) or {}
    return StoredTrack(
        deezer_id=deezer_id,
        file_path=final,
        title=meta.get("title", "") or "",
        artist=meta.get("artist", "") or "",
        album=meta.get("album", "") or "",
        cover_url=meta.get("cover") or None,
        duration_sec=int(meta.get("duration_sec", 0) or 0),
        size_bytes=os.path.getsize(final),
        status="ready",
        last_accessed=when,
    )


def _touch_record(deezer_id: str) -> None:
    """Update retention while the caller holds this track's lock."""
    try:
        with SessionLocal() as db:
            row = db.get(StoredTrack, deezer_id)
            if row is not None:
                row.last_accessed = _now()
            else:
                new = _row_from_disk(deezer_id, _now())
                if new is None:
                    raise FileNotFoundError(
                        f"Stored audio for track {deezer_id} is missing"
                    )
                db.add(new)
            db.commit()
    except Exception as exc:
        raise RuntimeError(
            f"Could not reset retention for stored track {deezer_id}: {exc}"
        ) from exc


def touch(deezer_id: str) -> None:
    """Mark a stored track as played now; backfill a DB row if missing."""
    with _lock_for(deezer_id):
        _touch_record(deezer_id)


def reconcile() -> int:
    """Ensure every stored .mp3 has a DB row (uses file mtime as last access).

    One-time backfill for files materialized before DB tracking existed.
    """
    created = 0
    d = _storage_dir()
    with SessionLocal() as db:
        existing = {r.deezer_id for r in db.query(StoredTrack.deezer_id).all()}
        for fname in os.listdir(d):
            if not fname.endswith(".mp3"):
                continue
            did = fname[:-4]
            if did in existing:
                continue
            mtime = datetime.fromtimestamp(
                os.path.getmtime(os.path.join(d, fname)), tz=timezone.utc
            )
            new = _row_from_disk(did, mtime)
            if new is not None:
                db.add(new)
                created += 1
        db.commit()
    return created


def _lock_for(deezer_id: str) -> threading.Lock:
    with _locks_guard:
        lock = _locks.get(deezer_id)
        if lock is None:
            lock = threading.Lock()
            _locks[deezer_id] = lock
        return lock


def _storage_dir() -> str:
    d = os.getenv("STORAGE_DIR", "storage")
    os.makedirs(d, exist_ok=True)
    return d


def path_for(deezer_id: str) -> str:
    return os.path.join(_storage_dir(), f"{deezer_id}.mp3")


def meta_path_for(deezer_id: str) -> str:
    return os.path.join(_storage_dir(), f"{deezer_id}.json")


def is_ready(deezer_id: str) -> bool:
    return os.path.exists(path_for(deezer_id))


def cached_ids() -> list[str]:
    """All track ids currently stored on the server (ready to stream without
    re-fetching from Deezer)."""
    with SessionLocal() as db:
        rows = db.query(StoredTrack.deezer_id).filter(
            StoredTrack.status == "ready"
        ).all()
        return [r[0] for r in rows]


def get_meta(deezer_id: str) -> dict | None:
    p = meta_path_for(deezer_id)
    if not os.path.exists(p):
        return None
    with open(p, "r", encoding="utf-8") as f:
        try:
            meta = json.load(f)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Invalid metadata JSON for stored track {deezer_id}: {exc}"
            ) from exc
    if not isinstance(meta, dict):
        raise ValueError(
            f"Metadata for stored track {deezer_id} must be a JSON object"
        )
    return meta


def materialize(deezer_id: str) -> str:
    """Download + decrypt the track if not already stored. Returns the file path.

    Blocking (network + decrypt) -> call via run_in_threadpool from async code.
    """
    final = path_for(deezer_id)
    lock = _lock_for(deezer_id)
    with lock:
        # Cleanup uses the same lock, so it cannot evict this track between the
        # existence check and the retention update.
        if os.path.exists(final):
            _touch_record(deezer_id)
            return final

        song = deezer.get_song_infos_from_deezer_website(deezer.TYPE_TRACK, deezer_id)
        if not isinstance(song, dict):
            raise ValueError(f"Deezer returned invalid metadata for track {deezer_id}")
        tmp = final + ".part"
        sidecar = meta_path_for(deezer_id)
        tmp_meta = sidecar + ".part"
        try:
            deezer.download_song(song, tmp)
            size = os.path.getsize(tmp)
            if size == 0:
                raise RuntimeError(f"Deezer downloaded empty audio for track {deezer_id}")
            meta = {
                "deezer_id": deezer_id,
                "title": song.get("SNG_TITLE", ""),
                "artist": song.get("ART_NAME", ""),
                "album": song.get("ALB_TITLE", ""),
                "cover": (
                    f"https://e-cdns-images.dzcdn.net/images/cover/{song['ALB_PICTURE']}/500x500.jpg"
                    if song.get("ALB_PICTURE")
                    else ""
                ),
                "duration_sec": int(song.get("DURATION", 0) or 0),
                "size_bytes": size,
            }
            with open(tmp_meta, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False)
            # Publish the complete sidecar before making the audio available.
            os.replace(tmp_meta, sidecar)
            os.replace(tmp, final)
        finally:
            # Include metadata/promotion failures and cancellations, not only
            # download errors. A retry must never reuse an abandoned partial.
            _remove_paths(deezer_id, (tmp, tmp_meta))
        _upsert_record(deezer_id, song, final)
        return final


def _remove_paths(deezer_id: str, paths: tuple[str, ...]) -> int:
    """Delete existing files, surfacing every failure. Returns bytes freed."""
    freed = 0
    failures = []
    for p in paths:
        try:
            size = os.path.getsize(p)
            os.remove(p)
            freed += size
        except FileNotFoundError:
            # Already absent files need no deletion, including completed .part
            # renames and a retry after a partially failed cleanup.
            continue
        except OSError as exc:
            failures.append(exc)
    if failures:
        detail = "; ".join(str(exc) for exc in failures)
        raise ExceptionGroup(
            f"Could not remove files for stored track {deezer_id}: {detail}", failures
        )
    return freed


def _remove_files(deezer_id: str) -> int:
    """Delete a track's audio + sidecar. Returns bytes freed."""
    return _remove_paths(deezer_id, (path_for(deezer_id), meta_path_for(deezer_id)))


def cleanup_old(days: int | None = None) -> dict:
    """Evict tracks not played within the retention window. Returns a summary."""
    retention = STORAGE_RETENTION_DAYS if days is None else days
    if retention < 0:
        raise ValueError("Storage retention days must be zero or positive")
    if retention == 0:
        return {"removed": 0, "freed_bytes": 0}  # 0 = keep forever
    cutoff = _now() - timedelta(days=retention)
    removed = 0
    freed = 0
    with SessionLocal() as db:
        candidates = (
            db.query(StoredTrack.deezer_id)
            .filter(StoredTrack.last_accessed < cutoff)
            .all()
        )
    failures = []
    for (deezer_id,) in candidates:
        try:
            with _lock_for(deezer_id), SessionLocal() as db:
                # A play may have refreshed retention since the candidate scan.
                row = db.query(StoredTrack).filter(
                    StoredTrack.deezer_id == deezer_id,
                    StoredTrack.last_accessed < cutoff,
                ).first()
                if row is None:
                    continue
                track_freed = _remove_files(deezer_id)
                db.delete(row)
                db.commit()
                freed += track_freed
                removed += 1
        except Exception as exc:
            failures.append(RuntimeError(f"Track {deezer_id}: {exc}"))
            failures[-1].__cause__ = exc
    if failures:
        detail = "; ".join(str(exc) for exc in failures)
        raise ExceptionGroup(
            f"Storage cleanup failed for {len(failures)} track(s): {detail}", failures
        )
    return {"removed": removed, "freed_bytes": freed}
