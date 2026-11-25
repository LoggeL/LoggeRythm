"""Cross-release Like deduplication and existing-library backfill/merge worker.

Prevents users from liking the same studio recording twice across Single, EP,
Album, and Deluxe releases, and merges pre-existing duplicate likes in the
database (keeping Album > EP > Single, tiebreaking by Deezer popularity rank).
"""
from __future__ import annotations

import threading
from collections import defaultdict
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db.models import Like, PlaylistTrack
from ..db.session import SessionLocal
from ..schemas.track import Track, dump_artists
from . import deezer_client as dc
from .track_identity import (
    TrackDescriptor,
    descriptor_from_mapping,
    group_duplicates,
    normalize_isrc,
    pick_preferred_entry,
    release_priority,
    resolve_record_types_for_groups,
    same_recording,
)

_BACKFILL_WORKERS = 4
_BACKFILL_BATCH_SIZE = 20

_merge_lock = threading.Lock()
_stop_event = threading.Event()
_worker_thread: threading.Thread | None = None
_last_failure_lock = threading.Lock()
_last_failure: str | None = None


@dataclass
class DeduplicationReport:
    """Outcome summary of a library ISRC backfill and duplicate-likes merge."""

    users_processed: int = 0
    likes_scanned: int = 0
    isrc_backfilled: int = 0
    duplicate_groups_merged: int = 0
    likes_removed: int = 0
    playlist_tracks_backfilled: int = 0
    unresolved_tracks: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def last_background_failure() -> str | None:
    with _last_failure_lock:
        return _last_failure


def like_descriptor(
    like: Like,
    *,
    isrc_override: str | None = None,
    album_id_override: str | None = None,
    rank: int = 0,
) -> TrackDescriptor:
    return TrackDescriptor(
        deezer_id=str(like.deezer_id or "").strip(),
        isrc=normalize_isrc(like.isrc if isrc_override is None else isrc_override),
        title=like.title or "",
        artist=like.artist or "",
        duration_sec=max(int(like.duration_sec or 0), 0),
        album_id=str(
            (like.album_id if album_id_override is None else album_id_override) or ""
        ).strip(),
        rank=max(int(rank or 0), 0),
    )


def track_descriptor(
    deezer_id: str,
    track: Track,
    *,
    isrc_override: str | None = None,
) -> TrackDescriptor:
    return TrackDescriptor(
        deezer_id=str(deezer_id or track.id or "").strip(),
        isrc=normalize_isrc(track.isrc if isrc_override is None else isrc_override),
        title=track.title or "",
        artist=track.artist or "",
        duration_sec=max(int(track.duration_sec or 0), 0),
        album_id=str(track.album_id or "").strip(),
        rank=max(int(track.rank or 0), 0),
    )


def find_matching_likes(
    db: Session,
    user_id: int,
    target: TrackDescriptor,
) -> list[Like]:
    """Find every ``Like`` row for ``user_id`` representing the same recording."""
    matches: dict[int, Like] = {}

    clauses = []
    if target.deezer_id:
        clauses.append(Like.deezer_id == target.deezer_id)
    if target.isrc:
        clauses.append(Like.isrc == target.isrc)
    if clauses:
        direct = db.scalars(
            select(Like).where(Like.user_id == user_id, or_(*clauses))
        ).all()
        for row in direct:
            matches[row.id] = row

    # Fallback check:
    # - When target has no ISRC, any existing like (even one with an ISRC) may
    #   still match by folded artist+title+duration.
    # - When target HAS an ISRC, only legacy ISRC-less likes can match by fallback.
    fallback_query = select(Like).where(Like.user_id == user_id)
    if target.isrc:
        fallback_query = fallback_query.where(Like.isrc == "")
    for row in db.scalars(fallback_query).all():
        if row.id in matches:
            continue
        if same_recording(like_descriptor(row), target):
            matches[row.id] = row

    return sorted(
        matches.values(),
        key=lambda row: (row.created_at or datetime.min, row.id),
        reverse=True,
    )


def _apply_track_to_like(like: Like, deezer_id: str, track: Track, isrc: str) -> None:
    like.deezer_id = deezer_id
    like.isrc = isrc
    like.title = track.title
    like.artist = track.artist
    like.artists_json = dump_artists(track)
    like.album = track.album
    like.album_id = str(track.album_id or "")
    like.cover_url = track.cover or None
    like.duration_sec = track.duration_sec


def _prefer_incoming_over_existing(
    existing: Like,
    incoming_desc: TrackDescriptor,
    *,
    resolve_record_type: Callable[[str], str],
    resolve_track: Callable[[str], dict],
) -> bool:
    """Whether ``incoming_desc`` should replace ``existing``'s release metadata."""
    if existing.deezer_id == incoming_desc.deezer_id:
        return True

    existing_album = str(existing.album_id or "").strip()
    incoming_album = incoming_desc.album_id
    if existing_album == incoming_album:
        return False

    existing_type = resolve_record_type(existing_album) if existing_album.isdigit() else ""
    incoming_type = resolve_record_type(incoming_album) if incoming_album.isdigit() else ""
    existing_prio = release_priority(existing_type)
    incoming_prio = release_priority(incoming_type)
    if incoming_prio != existing_prio:
        return incoming_prio > existing_prio

    if incoming_desc.rank <= 0:
        return False

    existing_rank = 0
    if existing.deezer_id and existing.deezer_id.isdigit():
        try:
            meta = resolve_track(existing.deezer_id)
            existing_rank = int(meta.get("rank") or 0)
        except dc.TrackUnavailable:
            existing_rank = 0
    return incoming_desc.rank > existing_rank


def _resolve_incoming_isrc(
    deezer_id: str,
    provided_isrc: str,
    resolve_isrc: Callable[[str], str],
) -> str:
    isrc = normalize_isrc(provided_isrc)
    if isrc or not deezer_id.isdigit():
        return isrc
    try:
        return normalize_isrc(resolve_isrc(deezer_id))
    except dc.TrackUnavailable:
        return ""


def upsert_deduped_like(
    db: Session,
    user_id: int,
    deezer_id: str,
    track: Track,
    *,
    resolve_isrc: Callable[[str], str] = dc.track_isrc,
    resolve_record_type: Callable[[str], str] = dc.album_record_type,
    resolve_track: Callable[[str], dict] = dc.track_public,
) -> Like:
    """Insert or merge a like so the same recording can never be liked twice."""
    isrc = _resolve_incoming_isrc(deezer_id, track.isrc, resolve_isrc)
    target = track_descriptor(deezer_id, track, isrc_override=isrc)

    for attempt in range(2):
        matches = find_matching_likes(db, user_id, target)
        if not matches:
            new_like = Like(
                user_id=user_id,
                deezer_id=deezer_id,
                isrc=isrc,
                title=track.title,
                artist=track.artist,
                artists_json=dump_artists(track),
                album=track.album,
                album_id=str(track.album_id or ""),
                cover_url=track.cover or None,
                duration_sec=track.duration_sec,
            )
            db.add(new_like)
            try:
                db.commit()
                return new_like
            except IntegrityError:
                db.rollback()
                if attempt == 0:
                    continue
                raise

        # Collapse any pre-existing duplicate rows into one survivor first.
        if len(matches) == 1:
            survivor = matches[0]
        else:
            groups = group_duplicates(matches, lambda row: like_descriptor(row))
            record_types = resolve_record_types_for_groups(groups, resolve_record_type)
            _, survivor, _ = pick_preferred_entry(groups[0], record_types)

        best_created_at = max(
            (row.created_at for row in matches if row.created_at is not None),
            default=survivor.created_at,
        )
        merged_isrc = isrc or next(
            (normalize_isrc(row.isrc) for row in matches if normalize_isrc(row.isrc)),
            "",
        )

        replace_with_incoming = _prefer_incoming_over_existing(
            survivor,
            target,
            resolve_record_type=resolve_record_type,
            resolve_track=resolve_track,
        )

        # Delete losers BEFORE updating survivor.deezer_id / survivor.isrc so
        # SQLite/PostgreSQL unique constraints never trip during the flush.
        for row in matches:
            if row.id != survivor.id:
                db.delete(row)
        db.flush()

        if replace_with_incoming:
            _apply_track_to_like(survivor, deezer_id, track, merged_isrc)
        elif merged_isrc and survivor.isrc != merged_isrc:
            survivor.isrc = merged_isrc
        if best_created_at is not None:
            survivor.created_at = best_created_at

        try:
            db.commit()
            return survivor
        except IntegrityError:
            db.rollback()
            if attempt == 0:
                continue
            raise

    raise RuntimeError(f"Could not save deduplicated like for user {user_id}, track {deezer_id}")


def remove_deduped_like(
    db: Session,
    user_id: int,
    deezer_id: str,
    *,
    resolve_track: Callable[[str], dict] = dc.track_public,
) -> int:
    """Unlike a track by its Deezer ID or any alternate release of the same recording."""
    direct = db.scalars(
        select(Like).where(Like.user_id == user_id, Like.deezer_id == deezer_id)
    ).all()
    if direct:
        to_delete: dict[int, Like] = {row.id: row for row in direct}
        for row in direct:
            for alias in find_matching_likes(db, user_id, like_descriptor(row)):
                to_delete[alias.id] = alias
        for row in to_delete.values():
            db.delete(row)
        db.commit()
        return len(to_delete)

    has_any_like = db.scalar(
        select(Like.id).where(Like.user_id == user_id).limit(1)
    )
    if has_any_like is None or not deezer_id.isdigit():
        return 0

    try:
        meta = resolve_track(deezer_id)
    except dc.TrackUnavailable:
        return 0

    matches = find_matching_likes(db, user_id, descriptor_from_mapping(meta))
    if not matches:
        return 0
    for row in matches:
        db.delete(row)
    db.commit()
    return len(matches)


def likes_contains_deduped(
    db: Session,
    user_id: int,
    wanted_ids: list[str],
    *,
    resolve_isrc: Callable[[str], str] = dc.track_isrc,
    resolve_track: Callable[[str], dict] = dc.track_public,
) -> dict[str, bool]:
    """Return ``{id: bool}`` matching direct IDs and alternate releases of liked recordings."""
    if not wanted_ids:
        return {}

    user_likes = db.scalars(select(Like).where(Like.user_id == user_id)).all()
    if not user_likes:
        return {tid: False for tid in wanted_ids}

    liked_ids = {row.deezer_id for row in user_likes}
    liked_isrcs = {
        normalize_isrc(row.isrc) for row in user_likes if normalize_isrc(row.isrc)
    }
    like_descs = [like_descriptor(row) for row in user_likes]
    has_isrc_less_likes = any(not desc.isrc for desc in like_descs)

    result: dict[str, bool] = {}
    unresolved: list[str] = []
    seen_unresolved: set[str] = set()
    for tid in wanted_ids:
        if tid in liked_ids:
            result[tid] = True
        elif tid.isdigit() and (liked_isrcs or has_isrc_less_likes):
            result[tid] = False
            if tid not in seen_unresolved:
                seen_unresolved.add(tid)
                unresolved.append(tid)
        else:
            result[tid] = False

    if not unresolved:
        return result

    def lookup_isrc(tid: str) -> tuple[str, str | None]:
        try:
            return tid, normalize_isrc(resolve_isrc(tid))
        except dc.TrackUnavailable:
            return tid, None

    if len(unresolved) == 1:
        isrc_results = [lookup_isrc(unresolved[0])]
    else:
        with ThreadPoolExecutor(max_workers=min(4, len(unresolved))) as pool:
            isrc_results = list(pool.map(lookup_isrc, unresolved))

    fallback_candidates: list[str] = []
    for tid, isrc in isrc_results:
        if isrc is None:
            continue
        if isrc and isrc in liked_isrcs:
            result[tid] = True
        elif not isrc or has_isrc_less_likes:
            fallback_candidates.append(tid)

    for tid in fallback_candidates:
        try:
            meta = resolve_track(tid)
        except dc.TrackUnavailable:
            continue
        desc = descriptor_from_mapping(meta)
        if any(same_recording(existing, desc) for existing in like_descs):
            result[tid] = True

    return result


def _fetch_track_metadata_batch(
    track_ids: Iterable[str],
    *,
    resolve_track: Callable[[str], dict],
    stop_event: threading.Event | None,
) -> tuple[dict[str, dict], list[str], list[str]]:
    """Fetch public track metadata for unique numeric IDs with bounded concurrency."""
    unique_ids = list(dict.fromkeys(tid for tid in track_ids if tid and tid.isdigit()))
    fetched: dict[str, dict] = {}
    unresolved: list[str] = []
    errors: list[str] = []

    def fetch_one(tid: str) -> tuple[str, dict | None, str | None, bool]:
        try:
            return tid, resolve_track(tid), None, False
        except dc.TrackUnavailable as exc:
            return tid, None, f"track {tid}: {exc}", True
        except Exception as exc:  # noqa: BLE001 — collected and reported loudly
            return tid, None, f"track {tid}: {type(exc).__name__}: {exc}", False

    for start_idx in range(0, len(unique_ids), _BACKFILL_BATCH_SIZE):
        if stop_event is not None and stop_event.is_set():
            break
        batch = unique_ids[start_idx : start_idx + _BACKFILL_BATCH_SIZE]
        workers = min(_BACKFILL_WORKERS, len(batch))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for tid, meta, err, is_unavailable in pool.map(fetch_one, batch):
                if meta is not None:
                    fetched[tid] = meta
                elif is_unavailable and err is not None:
                    unresolved.append(err)
                elif err is not None:
                    errors.append(err)
    return fetched, unresolved, errors


def _has_pending_work(db: Session) -> bool:
    if db.scalar(select(Like.id).where(Like.isrc == "").limit(1)) is not None:
        return True
    if db.scalar(select(PlaylistTrack.id).where(PlaylistTrack.isrc == "").limit(1)) is not None:
        return True
    dup_isrc = db.scalar(
        select(Like.user_id)
        .where(Like.isrc != "")
        .group_by(Like.user_id, Like.isrc)
        .having(func.count(Like.id) > 1)
        .limit(1)
    )
    if dup_isrc is not None:
        return True
    # Check for duplicate fallback likes among users with multiple likes.
    rows = db.scalars(select(Like).order_by(Like.user_id, Like.id)).all()
    by_user: dict[int, list[Like]] = defaultdict(list)
    for row in rows:
        by_user[row.user_id].append(row)
    for user_rows in by_user.values():
        if len(user_rows) < 2:
            continue
        groups = group_duplicates(user_rows, lambda row: like_descriptor(row))
        if any(len(group.items) > 1 for group in groups):
            return True
    return False


def merge_existing_library_duplicates(
    session_factory: Callable[[], Session] = SessionLocal,
    *,
    resolve_track: Callable[[str], dict] = dc.track_public,
    resolve_record_type: Callable[[str], str] = dc.album_record_type,
    stop_event: threading.Event | None = None,
) -> DeduplicationReport:
    """Backfill ISRCs on existing likes/playlist tracks and merge duplicate likes.

    Winner rule per duplicate group: ``album`` > ``ep`` > ``single`` >
    ``compile``, tiebreak by highest Deezer popularity ``rank``, preserving the
    most recent ``created_at`` timestamp across the merged rows.
    """
    report = DeduplicationReport()
    with _merge_lock:
        with session_factory() as db:
            all_likes = db.scalars(
                select(Like).order_by(Like.user_id, Like.created_at.desc(), Like.id.desc())
            ).all()
            report.likes_scanned = len(all_likes)
            missing_like_ids = [
                row.deezer_id for row in all_likes if not normalize_isrc(row.isrc)
            ]

        meta_cache, unresolved, errors = _fetch_track_metadata_batch(
            missing_like_ids,
            resolve_track=resolve_track,
            stop_event=stop_event,
        )
        report.unresolved_tracks.extend(unresolved)
        report.errors.extend(errors)

        if stop_event is not None and stop_event.is_set():
            return report

        # Group and merge likes per user atomically.
        with session_factory() as db:
            user_ids = list(
                db.scalars(select(Like.user_id).distinct().order_by(Like.user_id)).all()
            )
            for user_id in user_ids:
                if stop_event is not None and stop_event.is_set():
                    break
                report.users_processed += 1
                user_likes = list(
                    db.scalars(
                        select(Like)
                        .where(Like.user_id == user_id)
                        .order_by(Like.created_at.desc(), Like.id.desc())
                    ).all()
                )
                if not user_likes:
                    continue

                def describe_like(row: Like) -> TrackDescriptor:
                    meta = meta_cache.get(row.deezer_id)
                    resolved_isrc = normalize_isrc(row.isrc) or normalize_isrc(
                        meta.get("isrc") if meta else ""
                    )
                    resolved_album_id = str(
                        row.album_id or (meta.get("album_id") if meta else "") or ""
                    )
                    resolved_rank = int(meta.get("rank") or 0) if meta else 0
                    return like_descriptor(
                        row,
                        isrc_override=resolved_isrc,
                        album_id_override=resolved_album_id,
                        rank=resolved_rank,
                    )

                groups = group_duplicates(user_likes, describe_like)

                # For duplicate groups, ensure we have rank & album_id for every
                # member (including rows that already had ISRC stored earlier).
                dup_missing_meta = [
                    row.deezer_id
                    for group in groups
                    if len(group.items) >= 2
                    for _, row, _ in group.items
                    if row.deezer_id not in meta_cache and row.deezer_id.isdigit()
                ]
                if dup_missing_meta:
                    extra_meta, extra_unres, extra_err = _fetch_track_metadata_batch(
                        dup_missing_meta,
                        resolve_track=resolve_track,
                        stop_event=stop_event,
                    )
                    meta_cache.update(extra_meta)
                    report.unresolved_tracks.extend(extra_unres)
                    report.errors.extend(extra_err)
                    groups = group_duplicates(user_likes, describe_like)

                def safe_record_type(album_id: str) -> str:
                    try:
                        return resolve_record_type(album_id)
                    except dc.TrackUnavailable as exc:
                        report.unresolved_tracks.append(f"album {album_id}: {exc}")
                        return ""
                    except Exception as exc:  # noqa: BLE001 — collected loudly
                        report.errors.append(
                            f"album {album_id}: {type(exc).__name__}: {exc}"
                        )
                        return ""

                record_types = resolve_record_types_for_groups(groups, safe_record_type)

                changed = False
                for group in groups:
                    if len(group.items) == 1:
                        _, row, desc = group.items[0]
                        if desc.isrc and row.isrc != desc.isrc:
                            row.isrc = desc.isrc
                            report.isrc_backfilled += 1
                            changed = True
                        if desc.album_id and not row.album_id:
                            row.album_id = desc.album_id
                            changed = True
                        continue

                    _, winner, winner_desc = pick_preferred_entry(group, record_types)
                    best_created_at = max(
                        (
                            item_row.created_at
                            for _, item_row, _ in group.items
                            if item_row.created_at is not None
                        ),
                        default=winner.created_at,
                    )
                    merged_isrc = winner_desc.isrc or group.isrc

                    for _, item_row, _ in group.items:
                        if item_row.id != winner.id:
                            db.delete(item_row)
                            report.likes_removed += 1
                    db.flush()

                    if merged_isrc and winner.isrc != merged_isrc:
                        winner.isrc = merged_isrc
                        report.isrc_backfilled += 1
                    if winner_desc.album_id and not winner.album_id:
                        winner.album_id = winner_desc.album_id
                    if best_created_at is not None:
                        winner.created_at = best_created_at
                    report.duplicate_groups_merged += 1
                    changed = True

                if changed:
                    db.commit()

        if stop_event is not None and stop_event.is_set():
            return report

        # Backfill missing ISRCs on existing PlaylistTrack rows so hearts inside
        # existing playlists match likes across Singles / EPs / Albums immediately.
        with session_factory() as db:
            missing_pt_ids = [
                did
                for (did,) in db.query(PlaylistTrack.deezer_id)
                .filter(PlaylistTrack.isrc == "")
                .distinct()
                .all()
                if did and did.isdigit() and did not in meta_cache
            ]
        if missing_pt_ids:
            pt_meta, pt_unres, pt_err = _fetch_track_metadata_batch(
                missing_pt_ids,
                resolve_track=resolve_track,
                stop_event=stop_event,
            )
            meta_cache.update(pt_meta)
            report.unresolved_tracks.extend(pt_unres)
            report.errors.extend(pt_err)

        if stop_event is not None and stop_event.is_set():
            return report

        with session_factory() as db:
            pt_rows = db.scalars(
                select(PlaylistTrack).where(PlaylistTrack.isrc == "")
            ).all()
            updated_pt = 0
            for pt in pt_rows:
                meta = meta_cache.get(pt.deezer_id)
                if not meta:
                    continue
                isrc = normalize_isrc(meta.get("isrc"))
                if isrc:
                    pt.isrc = isrc
                    updated_pt += 1
            if updated_pt:
                db.commit()
                report.playlist_tracks_backfilled = updated_pt

    return report


def _run_startup_worker() -> None:
    global _last_failure
    try:
        report = merge_existing_library_duplicates(stop_event=_stop_event)
    except BaseException as exc:
        with _last_failure_lock:
            _last_failure = f"{type(exc).__name__}: {exc}"
        print(
            f"Likes deduplication startup worker FAILED: {type(exc).__name__}: {exc}",
            flush=True,
        )
        raise

    if (
        report.isrc_backfilled
        or report.duplicate_groups_merged
        or report.playlist_tracks_backfilled
        or report.unresolved_tracks
        or report.errors
    ):
        print(
            "Likes deduplication finished: "
            f"{report.duplicate_groups_merged} duplicate group(s) merged "
            f"({report.likes_removed} duplicate like(s) removed), "
            f"{report.isrc_backfilled} like ISRC(s) backfilled, "
            f"{report.playlist_tracks_backfilled} playlist track ISRC(s) backfilled, "
            f"{len(report.unresolved_tracks)} unavailable track(s), "
            f"{len(report.errors)} error(s).",
            flush=True,
        )
    if report.errors:
        with _last_failure_lock:
            _last_failure = "; ".join(report.errors[:5])
        print(
            f"Likes deduplication reported {len(report.errors)} error(s): "
            f"{'; '.join(report.errors[:5])}",
            flush=True,
        )


def start() -> None:
    """Start the non-blocking startup migration/merge worker when DB work exists."""
    global _worker_thread
    _stop_event.clear()
    with SessionLocal() as db:
        if not _has_pending_work(db):
            return
    _worker_thread = threading.Thread(
        target=_run_startup_worker,
        name="likes-dedup",
        daemon=True,
    )
    _worker_thread.start()


def stop() -> None:
    """Signal the startup worker to stop cleanly on shutdown."""
    _stop_event.set()
