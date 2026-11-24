"""Background pre-caching of new Release Radar tracks into the server cache.

A brand-new radar track is, by definition, one nobody has played yet, so it is
not in the storage cache: it starts slowly and clients show it as not cached.
After a radar is computed, the newest of its tracks are therefore materialized
in the background through the very same path a play or a client preload uses
(``storage.materialize``: same per-track lock, same files, same DB row). The
radar response never waits for a download.

Bounds
- Which tracks: the ``RADAR_PRELOAD_MAX_TRACKS`` newest radar tracks released
  within the last ``max_age_days()`` days. Already cached tracks cost one
  ``os.path.exists`` and are not touched.
- Concurrency: ``RADAR_PRELOAD_WORKERS`` download at a time for the whole
  server, however many users load their radar.
- No duplicate work: a track that is queued, downloading, or failed recently
  is never queued again, and ``storage.materialize`` single-flights against
  interactive plays of the same track.

Retention
A preloaded track is an ordinary stored track whose ``last_accessed`` is its
download time, so the existing cleanup evicts it ``STORAGE_RETENTION_DAYS``
after the preload unless it was played, liked or put into a playlist — no
special protection and no schema change. Because only releases younger than
the retention window are preloaded (see ``max_age_days``) and cached tracks
are never touched, an evicted track is already too old to be preloaded again:
the radar neither keeps a file alive nor re-downloads it.

All state is in-process, like the per-track locks in ``storage``: the API
runs as a single uvicorn process (docker/start.sh).
"""
from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from ..config import STORAGE_RETENTION_DAYS
from . import storage

logger = logging.getLogger(__name__)

# How many radar tracks are kept warm per radar (the newest ones). A stored
# track is ~8.6 MB at MP3_320 (40 kB/s x ~3.5 min + embedded 1200px cover),
# ~3.5 MB at MP3_128 and ~25-30 MB as FLAC. The full radar (100 tracks) would
# be ~0.9 GB per user at MP3_320; 20 tracks bound one radar to ~170 MB
# (MP3_320), ~70 MB (MP3_128) or ~0.6 GB (FLAC), and to 20 sequential
# downloads against Deezer.
RADAR_PRELOAD_MAX_TRACKS = 20

# Only releases this recent count as "new". The radar itself reaches back 90
# days; a release that is weeks old and still unplayed is not worth disk space.
RADAR_PRELOAD_MAX_AGE_DAYS = 14

# One background download at a time: each one costs a Deezer page fetch, a
# media-URL request, a cover fetch and a CDN download that is decrypted in
# Python on the same process that serves interactive streams.
RADAR_PRELOAD_WORKERS = 1

# A track whose preload failed is left alone for this long, so a track that is
# unavailable (region, rights, expired ARL) is not re-requested from Deezer on
# every radar load.
RADAR_PRELOAD_RETRY_AFTER_SEC = 6 * 3600


def max_age_days() -> int:
    """Oldest release age (in days) that is still preloaded.

    Kept strictly below the storage retention window: a preloaded track that
    cleanup evicts after ``STORAGE_RETENTION_DAYS`` unplayed days must by then
    be too old to qualify again, or the radar would re-download what cleanup
    just removed. Retention 0 means "keep forever", so nothing is evicted.
    """
    if STORAGE_RETENTION_DAYS == 0:
        return RADAR_PRELOAD_MAX_AGE_DAYS
    return min(RADAR_PRELOAD_MAX_AGE_DAYS, STORAGE_RETENTION_DAYS - 1)


def preload_candidates(radar: list[dict], today: date) -> list[str]:
    """Ids of the radar tracks worth pre-caching, newest release first.

    The newest ``RADAR_PRELOAD_MAX_TRACKS`` tracks released within the last
    ``max_age_days()`` days. Tracks without a release date are not candidates:
    without it they cannot be told apart from old releases.
    """
    oldest = (today - timedelta(days=max_age_days())).isoformat()
    newest = today.isoformat()
    recent: list[tuple[str, str]] = []
    seen: set[str] = set()
    for track in radar:
        track_id = str(track.get("id") or "")
        release_date = str(track.get("release_date") or "")
        if not track_id or track_id in seen or not oldest <= release_date <= newest:
            continue
        seen.add(track_id)
        recent.append((release_date, track_id))
    # Stable: tracks released on the same day keep their radar order.
    recent.sort(key=lambda item: item[0], reverse=True)
    return [track_id for _, track_id in recent[:RADAR_PRELOAD_MAX_TRACKS]]


@dataclass(frozen=True)
class PreloadFailure:
    track_id: str
    cause: str
    failed_at: datetime


@dataclass(frozen=True)
class PreloadRun:
    """What one background run (the tracks queued by one radar) did."""

    track_ids: tuple[str, ...]
    downloaded: tuple[str, ...]
    # Became cached between scheduling and the run (e.g. the user played it).
    already_cached: tuple[str, ...]
    failures: tuple[PreloadFailure, ...]
    # Left over because the server was shutting down.
    not_attempted: tuple[str, ...]


class RadarPreloader:
    """Queues radar tracks for download on a small background pool."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._guard = threading.Lock()
        self._executor: ThreadPoolExecutor | None = None
        self._stopping = threading.Event()
        # Queued or downloading right now.
        self._pending: set[str] = set()
        # track id -> (clock time of the failure, the failure)
        self._failed: dict[str, tuple[float, PreloadFailure]] = {}

    def start(self) -> None:
        with self._guard:
            if self._executor is not None:
                raise RuntimeError("Release Radar preloader is already running")
            self._stopping = threading.Event()
            self._executor = ThreadPoolExecutor(
                max_workers=RADAR_PRELOAD_WORKERS,
                thread_name_prefix="radar-preload",
            )

    def stop(self) -> None:
        """Drop queued runs and let the download in flight finish its track."""
        with self._guard:
            executor = self._executor
            if executor is None:
                raise RuntimeError("Release Radar preloader is not running")
            self._executor = None
            self._stopping.set()
            self._pending.clear()
        executor.shutdown(wait=False, cancel_futures=True)

    def schedule(
        self,
        radar: list[dict],
        *,
        user_id: int | None = None,
    ) -> Future[PreloadRun] | None:
        """Queue the radar's new, uncached tracks; returns without downloading.

        Returns the background run, or None when there is nothing to do. The
        run reports its own failures (see ``_run``); callers need not wait.
        """
        candidates = preload_candidates(radar, date.today())
        # One short critical section (at most RADAR_PRELOAD_MAX_TRACKS file
        # stats), so concurrent radars can never queue the same track twice.
        with self._guard:
            if self._executor is None:
                raise RuntimeError(
                    "Release Radar preloader is not running: radar_preload.start() "
                    "must be called at API startup before a radar is served"
                )
            now = self._clock()
            self._failed = {
                track_id: entry
                for track_id, entry in self._failed.items()
                if now - entry[0] < RADAR_PRELOAD_RETRY_AFTER_SEC
            }
            queued = tuple(
                track_id
                for track_id in candidates
                if track_id not in self._pending
                and track_id not in self._failed
                and not storage.is_ready(track_id)
            )
            if not queued:
                return None
            run = self._executor.submit(self._run_reported, queued, user_id)
            self._pending.update(queued)
            return run

    def failures(self) -> list[PreloadFailure]:
        """Failed preloads that are still inside their retry pause."""
        with self._guard:
            now = self._clock()
            return [
                failure
                for failed_at, failure in self._failed.values()
                if now - failed_at < RADAR_PRELOAD_RETRY_AFTER_SEC
            ]

    def _run_reported(
        self,
        track_ids: tuple[str, ...],
        user_id: int | None = None,
    ) -> PreloadRun:
        """Nobody awaits the run's future, so a crash must be logged here."""
        try:
            return self._run(track_ids, user_id=user_id)
        except BaseException:
            logger.critical(
                "Release Radar preload run crashed (tracks %s)",
                ", ".join(track_ids),
                exc_info=True,
            )
            raise
        finally:
            with self._guard:
                self._pending.difference_update(track_ids)

    def _run(
        self,
        track_ids: tuple[str, ...],
        *,
        user_id: int | None = None,
    ) -> PreloadRun:
        stopping = self._stopping
        downloaded: list[str] = []
        already_cached: list[str] = []
        failures: list[PreloadFailure] = []
        not_attempted: tuple[str, ...] = ()
        for index, track_id in enumerate(track_ids):
            if stopping.is_set():
                not_attempted = track_ids[index:]
                break
            try:
                # Checked first so a track cached meanwhile is left untouched:
                # materialize() would reset its retention as if it were played.
                if storage.is_ready(track_id):
                    already_cached.append(track_id)
                else:
                    storage.materialize(
                        track_id,
                        requested_by_user_id=user_id,
                        source="radar_preload",
                    )
                    downloaded.append(track_id)
            except Exception as exc:  # noqa: BLE001 — logged, recorded, summarized
                failure = PreloadFailure(
                    track_id=track_id,
                    cause=f"{type(exc).__name__}: {exc}",
                    failed_at=datetime.now(timezone.utc),
                )
                failures.append(failure)
                with self._guard:
                    self._failed[track_id] = (self._clock(), failure)
                logger.error(
                    "Release Radar preload FAILED for track %s: %s",
                    track_id,
                    failure.cause,
                    exc_info=exc,
                )
            finally:
                with self._guard:
                    self._pending.discard(track_id)

        run = PreloadRun(
            track_ids=track_ids,
            downloaded=tuple(downloaded),
            already_cached=tuple(already_cached),
            failures=tuple(failures),
            not_attempted=not_attempted,
        )
        _report(run)
        return run


def _report(run: PreloadRun) -> None:
    counts = (
        f"{len(run.downloaded)} downloaded, "
        f"{len(run.already_cached)} already cached, "
        f"{len(run.not_attempted)} not attempted (server stopping)"
    )
    if run.failures:
        details = "; ".join(
            f"track {failure.track_id}: {failure.cause}" for failure in run.failures
        )
        logger.error(
            "Release Radar preload: %d of %d track(s) FAILED (%s). No retry for "
            "%d h. Failures: %s",
            len(run.failures),
            len(run.track_ids),
            counts,
            RADAR_PRELOAD_RETRY_AFTER_SEC // 3600,
            details,
        )
    elif run.downloaded or run.not_attempted:
        # Same channel as the other storage notices (see main._cleanup_loop).
        print(f"Release Radar preload: {counts}.", flush=True)


# The process-wide preloader: started and stopped with the API (app.main).
_preloader = RadarPreloader()


def start() -> None:
    _preloader.start()


def stop() -> None:
    _preloader.stop()


def schedule(
    radar: list[dict],
    *,
    user_id: int | None = None,
) -> Future[PreloadRun] | None:
    return _preloader.schedule(radar, user_id=user_id)


def failures() -> list[PreloadFailure]:
    return _preloader.failures()
