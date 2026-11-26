"""Track storage with a play-based retention window.

Each Deezer track is downloaded + decrypted exactly once via MelodAI's deezer.py
and stored on disk. A StoredTrack DB row mirrors each file and carries a
``last_accessed`` timestamp that is bumped on every play. A periodic cleanup
evicts tracks not played within ``STORAGE_RETENTION_DAYS`` days, except tracks
that any user has liked or put into a playlist.

Correctness guarantees:
- per-track lock -> no concurrent double-download of the same id
- atomic rename (.part -> final) -> never serve a half-written file
"""
import glob
import json
import logging
import math
import os
import threading
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, select, update

from ..config import STORAGE_RETENTION_DAYS
from ..db.models import Like, PlaylistTrack, StoredTrack, TrackRequest
from ..db.session import SessionLocal
from . import audio_analysis, deezer

logger = logging.getLogger(__name__)

VALID_QUALITIES = ("lossless", "high", "saver")
_QUALITY_TO_DEEZER_FORMAT = {
    "lossless": "FLAC",
    "high": "MP3_320",
    "saver": "MP3_128",
}
_QUALITY_RANK = {
    "saver": 1,
    "high": 2,
    "lossless": 3,
}


def _quality_rank_for_path(path: str) -> int:
    lower = (path or "").lower()
    if lower.endswith(".flac"):
        return _QUALITY_RANK["lossless"]
    if lower.endswith(".saver.mp3"):
        return _QUALITY_RANK["saver"]
    return _QUALITY_RANK["high"]

VALID_REQUEST_SOURCES = frozenset(
    {
        "stream",
        "preload",
        "playlist_export",
        "party_preload",
        "radar_preload",
        "lyrics_ai",
    }
)
# Browsers often issue a byte-0 probe (e.g. bytes=0-1) immediately followed by
# bytes=0- when starting playback; deduplicate cache-hit stream logs in this window.
_STREAM_HIT_DEDUP_SEC = 30

_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}

_preload_lock = threading.Lock()
_preload_inflight: set[str] = set()
_preload_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="track-preload")

# Set once when the periodic cleanup daemon dies, so admins see that automatic
# eviction has stopped until the next restart (the thread does not retry).
_daemon_failure_guard = threading.Lock()
_daemon_failure: tuple[datetime, str] | None = None


def record_cleanup_daemon_failure(exc: BaseException) -> None:
    """Remember why the periodic cleanup daemon stopped."""
    global _daemon_failure
    with _daemon_failure_guard:
        _daemon_failure = (_now(), f"{type(exc).__name__}: {exc}")


def cleanup_daemon_failure() -> tuple[datetime, str] | None:
    """When and why the periodic cleanup daemon stopped, or None if running."""
    with _daemon_failure_guard:
        return _daemon_failure


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _validate_request_source(source: str | None) -> None:
    if source is not None and source not in VALID_REQUEST_SOURCES:
        raise ValueError(
            f"Unsupported track request source {source!r}; expected one of "
            f"{sorted(VALID_REQUEST_SOURCES)}"
        )


def _record_track_request(
    db,
    *,
    user_id: int | None,
    deezer_id: str,
    source: str,
    materialized: bool,
    size_bytes: int,
    title: str,
    artist: str,
    cover_url: str | None,
    now: datetime,
) -> None:
    _validate_request_source(source)
    if source == "stream" and not materialized:
        cutoff = now - timedelta(seconds=_STREAM_HIT_DEDUP_SEC)
        user_filter = (
            TrackRequest.user_id.is_(None)
            if user_id is None
            else TrackRequest.user_id == user_id
        )
        recent = db.scalar(
            select(TrackRequest.id)
            .where(
                user_filter,
                TrackRequest.deezer_id == deezer_id,
                TrackRequest.source == "stream",
                TrackRequest.requested_at >= cutoff,
            )
            .limit(1)
        )
        if recent is not None:
            return
    db.add(
        TrackRequest(
            user_id=user_id,
            deezer_id=deezer_id,
            source=source,
            materialized=materialized,
            size_bytes=size_bytes,
            title=title,
            artist=artist,
            cover_url=cover_url or None,
            requested_at=now,
        )
    )


def _optional_float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _looks_like_real_audio(path: str, size: int) -> bool:
    if size < 1024:
        return False
    try:
        with open(path, "rb") as fh:
            head = fh.read(4)
    except OSError:
        return False
    if head[:3] == b"ID3" or head[:4] == b"fLaC":
        return True
    return len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0


def media_type_for_path(path: str) -> str:
    """Return authoritative audio MIME type by inspecting file header bytes."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(4)
        if head == b"fLaC":
            return "audio/flac"
    except OSError:
        pass
    return "audio/flac" if path.lower().endswith(".flac") else "audio/mpeg"


def validate_quality(quality: str) -> str:
    if quality not in VALID_QUALITIES:
        raise ValueError(
            f"Unsupported audio quality {quality!r}; expected one of {VALID_QUALITIES}"
        )
    return quality


def path_for_quality(deezer_id: str, quality: str = "high") -> str:
    validate_quality(quality)
    if quality == "high":
        return path_for(deezer_id)
    if quality == "lossless":
        return os.path.join(_storage_dir(), f"{deezer_id}.flac")
    return os.path.join(_storage_dir(), f"{deezer_id}.saver.mp3")


def existing_audio_path(deezer_id: str) -> str | None:
    """Return any cached audio path on disk for ``deezer_id``, preferring best quality."""
    for quality in ("lossless", "high", "saver"):
        candidate = path_for_quality(deezer_id, quality)
        if os.path.exists(candidate):
            return candidate
    return None


def _upsert_record(
    deezer_id: str,
    song: dict,
    final: str,
    *,
    requested_by_user_id: int | None = None,
    request_source: str | None = None,
    audio_format: str = "mp3",
    quality: str = "high",
) -> None:
    """Create/refresh the StoredTrack DB row for a freshly stored file."""
    _validate_request_source(request_source)
    gain_db = _optional_float(song.get("GAIN"))
    raw_bpm = _optional_float(song.get("BPM"))
    bpm = round(raw_bpm, 2) if raw_bpm is not None and raw_bpm > 0 else None
    try:
        now = _now()
        with SessionLocal() as db:
            row = db.get(StoredTrack, deezer_id)
            cover = (
                f"https://e-cdns-images.dzcdn.net/images/cover/{song['ALB_PICTURE']}/500x500.jpg"
                if song.get("ALB_PICTURE")
                else ""
            )
            title = song.get("SNG_TITLE", "") or ""
            artist = song.get("ART_NAME", "") or ""
            size = os.path.getsize(final)
            if row is None:
                db.add(
                    StoredTrack(
                        deezer_id=deezer_id,
                        file_path=final,
                        title=title,
                        artist=artist,
                        album=song.get("ALB_TITLE", "") or "",
                        cover_url=cover or None,
                        duration_sec=int(song.get("DURATION", 0) or 0),
                        size_bytes=size,
                        status="ready",
                        audio_format=audio_format,
                        loudness_gain_db=gain_db,
                        bpm=bpm,
                        requested_by_user_id=requested_by_user_id,
                        request_source=request_source,
                        last_accessed=now,
                    )
                )
            else:
                incoming_rank = _QUALITY_RANK.get(quality, _QUALITY_RANK["high"])
                existing_rank = _quality_rank_for_path(row.file_path)
                if not os.path.exists(row.file_path) or incoming_rank >= existing_rank:
                    row.file_path = final
                    row.size_bytes = size
                    row.audio_format = audio_format
                row.last_accessed = now
                if gain_db is not None and row.loudness_gain_db is None:
                    row.loudness_gain_db = gain_db
                if bpm is not None and row.bpm is None:
                    row.bpm = bpm
                if row.requested_by_user_id is None and requested_by_user_id is not None:
                    row.requested_by_user_id = requested_by_user_id
                    row.request_source = request_source
            if gain_db is not None:
                db.execute(
                    update(Like)
                    .where(Like.deezer_id == deezer_id, Like.loudness_gain_db.is_(None))
                    .values(loudness_gain_db=gain_db)
                )
                db.execute(
                    update(PlaylistTrack)
                    .where(
                        PlaylistTrack.deezer_id == deezer_id,
                        PlaylistTrack.loudness_gain_db.is_(None),
                    )
                    .values(loudness_gain_db=gain_db)
                )
            if request_source is not None:
                _record_track_request(
                    db,
                    user_id=requested_by_user_id,
                    deezer_id=deezer_id,
                    source=request_source,
                    materialized=True,
                    size_bytes=size,
                    title=title,
                    artist=artist,
                    cover_url=cover or None,
                    now=now,
                )
            db.commit()
    except Exception as exc:
        raise RuntimeError(
            f"Could not record stored track {deezer_id}: {exc}"
        ) from exc


def _row_from_disk(deezer_id: str, when: datetime) -> StoredTrack | None:
    """Build a StoredTrack from the best on-disk audio variant + sidecar."""
    final = existing_audio_path(deezer_id)
    if final is None:
        return None
    meta = get_meta(deezer_id) or {}
    audio_format = "flac" if media_type_for_path(final) == "audio/flac" else "mp3"
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
        audio_format=audio_format,
        loudness_gain_db=_optional_float(meta.get("loudness_gain_db")),
        loudness_lufs=_optional_float(meta.get("loudness_lufs")),
        loudness_peak=_optional_float(meta.get("loudness_peak")),
        bpm=_optional_float(meta.get("bpm")),
        last_accessed=when,
    )


def _touch_record(
    deezer_id: str,
    *,
    requested_by_user_id: int | None = None,
    request_source: str | None = None,
    record_request: bool = True,
) -> None:
    """Update retention while the caller holds this track's lock."""
    _validate_request_source(request_source)
    try:
        now = _now()
        with SessionLocal() as db:
            row = db.get(StoredTrack, deezer_id)
            if row is not None:
                row.last_accessed = now
            else:
                new = _row_from_disk(deezer_id, now)
                if new is None:
                    raise FileNotFoundError(
                        f"Stored audio for track {deezer_id} is missing"
                    )
                db.add(new)
                row = new
            if request_source is not None and record_request:
                _record_track_request(
                    db,
                    user_id=requested_by_user_id,
                    deezer_id=deezer_id,
                    source=request_source,
                    materialized=False,
                    size_bytes=row.size_bytes,
                    title=row.title,
                    artist=row.artist,
                    cover_url=row.cover_url,
                    now=now,
                )
            db.commit()
    except Exception as exc:
        raise RuntimeError(
            f"Could not reset retention for stored track {deezer_id}: {exc}"
        ) from exc


def touch(deezer_id: str) -> None:
    """Mark a stored track as played now; backfill a DB row if missing."""
    with _lock_for(deezer_id):
        _touch_record(deezer_id)


def _deezer_id_from_audio_filename(fname: str) -> str | None:
    """Extract numeric Deezer ID from a stored audio variant filename, or None."""
    if fname.endswith(".saver.mp3"):
        stem = fname[:-10]
    elif fname.endswith(".mp3"):
        stem = fname[:-4]
    elif fname.endswith(".flac"):
        stem = fname[:-5]
    else:
        return None
    return stem if stem.isdigit() else None


def reconcile() -> int:
    """Ensure every stored audio track (.mp3/.saver.mp3/.flac) has a DB row.

    One-time backfill for files materialized before DB tracking existed.
    """
    created = 0
    d = _storage_dir()
    by_id_mtime: dict[str, float] = {}
    for fname in os.listdir(d):
        did = _deezer_id_from_audio_filename(fname)
        if did is None:
            continue
        mtime_ts = os.path.getmtime(os.path.join(d, fname))
        prev = by_id_mtime.get(did)
        if prev is None or mtime_ts > prev:
            by_id_mtime[did] = mtime_ts

    with SessionLocal() as db:
        existing = {r.deezer_id for r in db.query(StoredTrack.deezer_id).all()}
        for did, mtime_ts in by_id_mtime.items():
            if did in existing:
                continue
            mtime = datetime.fromtimestamp(mtime_ts, tz=timezone.utc)
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


def lock_for(deezer_id: str) -> threading.Lock:
    """Public per-track lock serializing audio variants, sidecar writes, and eviction."""
    return _lock_for(deezer_id)


def _storage_dir() -> str:
    d = os.getenv("STORAGE_DIR", "storage")
    os.makedirs(d, exist_ok=True)
    return d


def storage_dir() -> str:
    """Return the active storage directory (creating it if needed)."""
    return _storage_dir()


def path_for(deezer_id: str) -> str:
    return os.path.join(_storage_dir(), f"{deezer_id}.mp3")


def meta_path_for(deezer_id: str) -> str:
    return os.path.join(_storage_dir(), f"{deezer_id}.json")


def is_ready(deezer_id: str, quality: str | None = None) -> bool:
    if quality is not None:
        return os.path.exists(path_for_quality(deezer_id, quality))
    return existing_audio_path(deezer_id) is not None


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


def materialize(
    deezer_id: str,
    *,
    requested_by_user_id: int | None = None,
    source: str | None = None,
    record_cache_hit: bool = True,
    quality: str = "high",
) -> str:
    """Download + decrypt the track if not already stored. Returns the file path.

    Blocking (network + decrypt) -> call via run_in_threadpool from async code.
    """
    _validate_request_source(source)
    validate_quality(quality)
    final = path_for_quality(deezer_id, quality)
    # Serialize all quality variants, sidecar updates, and cleanup_old eviction
    # on a single per-track lock so concurrent quality downloads cannot clobber
    # each other's .json.part or race eviction.
    lock = _lock_for(deezer_id)
    with lock:
        # Cleanup uses the same lock, so it cannot evict this track between the
        # existence check and the retention update.
        if os.path.exists(final):
            _touch_record(
                deezer_id,
                requested_by_user_id=requested_by_user_id,
                request_source=source,
                record_request=record_cache_hit,
            )
            return final

        song = deezer.get_song_infos_from_deezer_website(deezer.TYPE_TRACK, deezer_id)
        if not isinstance(song, dict):
            raise ValueError(f"Deezer returned invalid metadata for track {deezer_id}")
        tmp = final + ".part"
        sidecar = meta_path_for(deezer_id)
        tmp_meta = sidecar + ".part"
        try:
            if quality == "high":
                deezer.download_song(song, tmp)
            else:
                deezer.download_song(
                    song, tmp, fmt_override=_QUALITY_TO_DEEZER_FORMAT[quality]
                )
            size = os.path.getsize(tmp)
            if size == 0:
                raise RuntimeError(f"Deezer downloaded empty audio for track {deezer_id}")
            detected_mime = media_type_for_path(tmp)
            detected_format = "flac" if detected_mime == "audio/flac" else "mp3"
            gain_db = _optional_float(song.get("GAIN"))
            raw_bpm = _optional_float(song.get("BPM"))
            bpm = round(raw_bpm, 2) if raw_bpm is not None and raw_bpm > 0 else None
            existing_meta = get_meta(deezer_id) if os.path.exists(sidecar) else None
            meta = dict(existing_meta) if isinstance(existing_meta, dict) else {}
            meta.update(
                {
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
                    "audio_format": detected_format,
                }
            )
            if gain_db is not None:
                meta["loudness_gain_db"] = gain_db
            if bpm is not None:
                meta["bpm"] = bpm
            with open(tmp_meta, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False)
            # Publish the complete sidecar before making the audio available.
            os.replace(tmp_meta, sidecar)
            os.replace(tmp, final)
        finally:
            # Include metadata/promotion failures and cancellations, not only
            # download errors. A retry must never reuse an abandoned partial.
            _remove_paths(deezer_id, (tmp, tmp_meta))
        _upsert_record(
            deezer_id,
            song,
            final,
            requested_by_user_id=requested_by_user_id,
            request_source=source,
            audio_format=detected_format,
            quality=quality,
        )
        if _looks_like_real_audio(final, size):
            audio_analysis.schedule_analysis(deezer_id, final, sidecar)
        return final


def schedule_preload(
    deezer_ids: Iterable[str],
    *,
    user_id: int | None = None,
    source: str = "preload",
) -> tuple[list[str], list[str]]:
    """Queue numeric track IDs for background materialization.

    Returns ``(queued_ids, already_cached_ids)``.
    """
    _validate_request_source(source)
    queued: list[str] = []
    already_cached: list[str] = []
    seen: set[str] = set()
    to_submit: list[str] = []
    for raw_id in deezer_ids:
        tid = str(raw_id or "").strip()
        if not tid or not tid.isdigit() or tid in seen:
            continue
        seen.add(tid)
        if is_ready(tid, "high"):
            already_cached.append(tid)
            continue
        with _preload_lock:
            if tid in _preload_inflight:
                queued.append(tid)
                continue
            _preload_inflight.add(tid)
        queued.append(tid)
        to_submit.append(tid)

    for tid in to_submit:
        def _worker(track_id: str = tid) -> None:
            try:
                if not is_ready(track_id, "high"):
                    materialize(
                        track_id,
                        requested_by_user_id=user_id,
                        source=source,
                    )
            except Exception as exc:  # noqa: BLE001 — background worker logs loudly
                logger.error("Background preload failed for track %s: %s", track_id, exc)
            finally:
                with _preload_lock:
                    _preload_inflight.discard(track_id)

        _preload_executor.submit(_worker)

    return queued, already_cached


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
    """Delete a track's audio variants, sidecar and DJ analyses. Returns bytes freed."""
    dj_analyses = glob.glob(
        os.path.join(_storage_dir(), "dj", "analysis", f"{glob.escape(deezer_id)}.*.json")
    )
    return _remove_paths(
        deezer_id,
        (
            path_for(deezer_id),
            path_for_quality(deezer_id, "lossless"),
            path_for_quality(deezer_id, "saver"),
            meta_path_for(deezer_id),
            *dj_analyses,
        ),
    )


def _evictable(cutoff: datetime) -> tuple:
    """Filter for stored tracks that may be evicted: stale and neither liked
    nor in any playlist."""
    return (
        StoredTrack.last_accessed < cutoff,
        ~exists().where(Like.deezer_id == StoredTrack.deezer_id),
        ~exists().where(PlaylistTrack.deezer_id == StoredTrack.deezer_id),
    )


def cleanup_old(days: int | None = None) -> dict:
    """Evict tracks not played within the retention window that are neither
    liked nor in a playlist. Returns a summary."""
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
            .filter(*_evictable(cutoff))
            .all()
        )
    failures = []
    for (deezer_id,) in candidates:
        try:
            with _lock_for(deezer_id), SessionLocal() as db:
                # A play, like or playlist add may have happened since the
                # candidate scan.
                row = db.query(StoredTrack).filter(
                    StoredTrack.deezer_id == deezer_id,
                    *_evictable(cutoff),
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
