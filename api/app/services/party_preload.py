"""Background pre-caching of party queue tracks, with a live per-track status.

A party plays one track after another for everybody. Each upcoming track is
materialized into the server cache in the background through the very path a
play uses (``storage.materialize``: same per-track lock, files and DB row), so
the next song starts without a Deezer round trip.

The party view shows, per track, whether it is already loaded, loading right
now, waiting for its turn, or failed (with the cause). :func:`load_state`
answers that for the state frame; whenever a track finishes (either way) every
party that contains it gets a fresh frame through ``on_track_settled``.

All state is in-process, like the per-track locks in ``storage``: the API runs
as a single uvicorn process (docker/start.sh).
"""
from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Iterable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Literal

from . import storage

logger = logging.getLogger(__name__)

# ready: in the server cache · loading: downloading now · queued: waiting for
# the preload worker · failed: last attempt failed · idle: not cached and not
# scheduled (already played, or too far beyond the playhead).
LoadState = Literal["ready", "loading", "queued", "failed", "idle"]

# How far ahead of the playing track the queue is kept warm. A stored track is
# ~8.6 MB at MP3_320, so 15 tracks are ~130 MB per party.
PARTY_PRELOAD_AHEAD = 15

# One download at a time for all parties: each costs a Deezer page fetch, a
# media-URL request and a CDN download decrypted in this very process.
PARTY_PRELOAD_WORKERS = 1

# A failed track is not retried before this, so an unavailable track (region,
# rights, expired ARL) does not hammer Deezer on every queue change.
PARTY_PRELOAD_RETRY_AFTER_SEC = 10 * 60


@dataclass(frozen=True)
class _Failure:
    cause: str
    failed_at: float


_lock = threading.Lock()
_queued: set[str] = set()
_loading: set[str] = set()
_failed: dict[str, _Failure] = {}
_executor = ThreadPoolExecutor(
    max_workers=PARTY_PRELOAD_WORKERS, thread_name_prefix="party-preload"
)

# Set by the party router: publishes a fresh frame to every party containing
# the track. Kept as a hook so this module does not import the router.
_on_track_settled: Callable[[str], None] | None = None


def set_settled_listener(listener: Callable[[str], None]) -> None:
    global _on_track_settled
    _on_track_settled = listener


def load_state(deezer_id: str) -> tuple[LoadState, str | None]:
    """Current load state of one track and, when it failed, why."""
    if storage.is_ready(deezer_id):
        return "ready", None
    with _lock:
        if deezer_id in _loading:
            return "loading", None
        if deezer_id in _queued:
            return "queued", None
        failure = _failed.get(deezer_id)
    if failure is not None:
        return "failed", failure.cause
    return "idle", None


def upcoming(deezer_ids: list[str], current_index: int) -> list[str]:
    """Tracks worth loading: the playing one first, then the next ones."""
    start = max(current_index, 0)
    seen: set[str] = set()
    picked: list[str] = []
    for deezer_id in deezer_ids[start:]:
        if deezer_id in seen:
            continue
        seen.add(deezer_id)
        picked.append(deezer_id)
        if len(picked) >= PARTY_PRELOAD_AHEAD:
            break
    return picked


def schedule(
    deezer_ids: Iterable[str],
    *,
    user_ids_by_track: Mapping[str, int | None] | None = None,
) -> list[str]:
    """Queue the given tracks for background loading, in order.

    Skips tracks that are cached, already queued/loading, or failed recently.
    Returns the ids actually queued.
    """
    now = time.monotonic()
    accepted: list[str] = []
    with _lock:
        for deezer_id in deezer_ids:
            if not deezer_id.isdigit():
                raise ValueError(f"Party track id must be a numeric Deezer id, got {deezer_id!r}")
            if deezer_id in _queued or deezer_id in _loading:
                continue
            failure = _failed.get(deezer_id)
            if failure is not None and now - failure.failed_at < PARTY_PRELOAD_RETRY_AFTER_SEC:
                continue
            if storage.is_ready(deezer_id):
                continue
            _failed.pop(deezer_id, None)
            _queued.add(deezer_id)
            accepted.append(deezer_id)
    for deezer_id in accepted:
        requested_by = user_ids_by_track.get(deezer_id) if user_ids_by_track else None
        _executor.submit(_load, deezer_id, requested_by)
    return accepted


def _load(deezer_id: str, requested_by_user_id: int | None = None) -> None:
    with _lock:
        _queued.discard(deezer_id)
        _loading.add(deezer_id)
    _notify(deezer_id)
    try:
        storage.materialize(
            deezer_id,
            requested_by_user_id=requested_by_user_id,
            source="party_preload",
        )
    except Exception as exc:  # noqa: BLE001 — recorded and shown per track
        logger.exception("Party preload of track %s failed", deezer_id)
        with _lock:
            _failed[deezer_id] = _Failure(
                cause=f"{type(exc).__name__}: {exc}", failed_at=time.monotonic()
            )
    finally:
        with _lock:
            _loading.discard(deezer_id)
    _notify(deezer_id)


def _notify(deezer_id: str) -> None:
    listener = _on_track_settled
    if listener is None:
        raise RuntimeError("Party preload has no listener to publish track state to")
    try:
        listener(deezer_id)
    except Exception:  # noqa: BLE001 — a worker thread has nobody to raise to
        logger.exception(
            "Publishing party load state for track %s failed; clients see it on the next update",
            deezer_id,
        )


def reset_for_tests() -> None:
    with _lock:
        _queued.clear()
        _loading.clear()
        _failed.clear()
