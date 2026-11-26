"""DJ transition orchestration: analysis cache, clip cache and the background job queue.

The API process only reads JSON and serves files. Downloads run through
``storage.materialize``; analysis and rendering run in a worker subprocess (see
``worker.py``) on one background thread, so at most one heavy job runs at a time.
The queue serves the most recently requested job first: the client polls the pair it
is about to play, so that pair must not wait behind pairs the listener skipped. Jobs
nobody asked for within ``STALE_JOB_SEC`` are dropped (logged) and resubmitted if the
client asks again.

A request that needs work not done yet gets ``status: "pending"`` and the reason;
the client asks again. A job that failed is remembered for ``FAILURE_TTL_SEC`` and
reported as an error (never as a plain crossfade) until then.
"""
from __future__ import annotations

import glob
import hashlib
import json
import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

from .. import storage
from . import analysis, planner, render

logger = logging.getLogger(__name__)

ANALYSIS_TIMEOUT_SEC = 600
RENDER_TIMEOUT_SEC = 180
FAILURE_TTL_SEC = 600
CLIP_MAX_AGE_SEC = 3 * 24 * 3600
RETRY_AFTER_SEC = 5
STALE_JOB_SEC = 60  # the client polls every RETRY_AFTER_SEC while the pair is current

_API_ROOT = Path(__file__).resolve().parents[3]  # .../api (contains the app package)

_lock = threading.Lock()
_wake = threading.Condition(_lock)
_queued: dict[str, tuple[Callable[[], None], float]] = {}  # key -> (job, last requested)
_running: str | None = None
_worker_thread: threading.Thread | None = None
_failures: dict[str, tuple[float, str]] = {}


class DjTransitionError(RuntimeError):
    """A download, analysis or render job for this transition failed."""


class DjWorkerError(DjTransitionError):
    """The worker subprocess exited non-zero or timed out."""


# --------------------------------------------------------------------------- paths


def _dj_dir(*parts: str) -> str:
    d = os.path.join(storage.storage_dir(), "dj", *parts)
    os.makedirs(d, exist_ok=True)
    return d


def analysis_path(deezer_id: str, quality: str) -> str:
    return os.path.join(_dj_dir("analysis"), f"{deezer_id}.{quality}.json")


def clip_paths(clip_id: str) -> tuple[str, str]:
    if len(clip_id) != 32 or any(c not in "0123456789abcdef" for c in clip_id):
        raise ValueError(f"invalid clip id {clip_id!r}")
    d = _dj_dir("clips")
    return os.path.join(d, f"{clip_id}.flac"), os.path.join(d, f"{clip_id}.json")


def _binding(audio_path: str) -> dict[str, int]:
    st = os.stat(audio_path)
    return {"size": st.st_size, "mtime_ns": st.st_mtime_ns}


# --------------------------------------------------------------------------- jobs


def _run_worker(args: list[str], timeout: int) -> None:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(_API_ROOT) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "app.services.dj.worker", *args],
            cwd=str(_API_ROOT), env=env, capture_output=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise DjWorkerError(f"DJ worker {args[0]} timed out after {timeout}s") from exc
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace").strip().splitlines()[-12:]
        raise DjWorkerError(f"DJ worker {args[0]} exited {proc.returncode}: " + " | ".join(tail))


def _submit(key: str, job: Callable[[], None]) -> None:
    """Queue ``job`` under ``key`` (or mark an already queued one as requested again)."""
    global _worker_thread
    with _wake:
        if key == _running:
            return
        _queued[key] = (job, time.monotonic())
        if _worker_thread is None or not _worker_thread.is_alive():
            _worker_thread = threading.Thread(target=_worker_loop, name="dj-worker", daemon=True)
            _worker_thread.start()
        _wake.notify()


def _next_job() -> tuple[str, Callable[[], None]]:
    global _running
    with _wake:
        while True:
            now = time.monotonic()
            for key, (_job, requested) in list(_queued.items()):
                if now - requested > STALE_JOB_SEC:
                    del _queued[key]
                    logger.info("DJ job %s dropped: not requested for %.0fs", key, now - requested)
            if _queued:
                key = max(_queued, key=lambda k: _queued[k][1])
                job, _requested = _queued.pop(key)
                _running = key
                return key, job
            _wake.wait()


def _run_job(key: str, job: Callable[[], None]) -> None:
    global _running
    try:
        job()
        with _lock:
            _failures.pop(key, None)
    except Exception as exc:  # recorded and surfaced to the next request
        logger.exception("DJ job %s failed", key)
        with _lock:
            _failures[key] = (time.monotonic(), f"{type(exc).__name__}: {exc}")
    finally:
        with _lock:
            _running = None


def _worker_loop() -> None:
    while True:
        _run_job(*_next_job())


def _raise_if_failed(key: str, what: str) -> None:
    with _lock:
        entry = _failures.get(key)
        if entry is None:
            return
        if time.monotonic() - entry[0] > FAILURE_TTL_SEC:
            del _failures[key]
            return
    raise DjTransitionError(f"{what} failed: {entry[1]}")


# --------------------------------------------------------------------------- analysis


def _load_analysis(deezer_id: str, quality: str, audio_path: str) -> dict | None:
    """Cached analysis for exactly this audio file, or None when absent/stale."""
    path = analysis_path(deezer_id, quality)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        try:
            data = json.load(fh)
        except json.JSONDecodeError as exc:
            raise DjTransitionError(f"corrupt DJ analysis {path}: {exc}") from exc
    if data.get("analysis_version") != analysis.ANALYSIS_VERSION:
        return None
    if data.get("file") != _binding(audio_path):
        return None
    return data


def _analysis_job(deezer_id: str, quality: str, user_id: int) -> Callable[[], None]:
    def job() -> None:
        audio_path = storage.materialize(
            deezer_id, requested_by_user_id=user_id, source="preload", quality=quality
        )
        out = analysis_path(deezer_id, quality)
        binding = _binding(audio_path)
        _run_worker(["analyze", audio_path, out], ANALYSIS_TIMEOUT_SEC)
        with open(out, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        data["file"] = binding
        tmp = out + ".part"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
        os.replace(tmp, out)
        logger.info("DJ analysis %s.%s: %s in %ss", deezer_id, quality, data["status"], data.get("elapsed_s"))

    return job


def _render_job(a_path: str, b_path: str, plan: dict, a_gain: float, b_gain: float,
                clip_id: str) -> Callable[[], None]:
    def job() -> None:
        _prune_clips()
        flac, meta = clip_paths(clip_id)
        plan_file = meta + ".plan"
        with open(plan_file, "w", encoding="utf-8") as fh:
            json.dump(plan, fh)
        try:
            _run_worker(
                ["render", a_path, b_path, plan_file, repr(a_gain), repr(b_gain), flac, meta],
                RENDER_TIMEOUT_SEC,
            )
        finally:
            os.remove(plan_file)

    return job


def _prune_clips() -> None:
    """Drop clips (audio + metadata together) not used for ``CLIP_MAX_AGE_SEC``.

    Usage is the newest mtime of the pair; ``get_transition`` touches both on every hit.
    """
    cutoff = time.time() - CLIP_MAX_AGE_SEC
    groups: dict[str, list[str]] = {}
    for path in glob.glob(os.path.join(_dj_dir("clips"), "*")):
        if path.endswith(".plan") or path.endswith(".part"):
            continue  # owned by a running render job
        groups.setdefault(os.path.basename(path).split(".", 1)[0], []).append(path)
    with _lock:  # get_transition reads and touches a clip under the same lock
        for files in groups.values():
            if max(os.path.getmtime(f) for f in files) < cutoff:
                for f in files:
                    os.remove(f)


# --------------------------------------------------------------------------- entry


def _pending(reason: str) -> dict[str, Any]:
    return {"status": "pending", "reason": reason, "retry_after_s": RETRY_AFTER_SEC}


def get_transition(
    from_id: str, to_id: str, quality: str, a_gain: float, b_gain: float, user_id: int
) -> dict[str, Any]:
    if not (from_id.isdigit() and to_id.isdigit()):
        raise ValueError("track ids must be numeric")
    if from_id == to_id:
        raise ValueError("a transition needs two different tracks")
    storage.validate_quality(quality)
    for name, g in (("a_gain", a_gain), ("b_gain", b_gain)):
        if not 0.0 < g <= 1.0:
            raise ValueError(f"{name} must be in (0, 1], got {g}")
    a_gain, b_gain = round(a_gain, 3), round(b_gain, 3)

    records: list[dict] = []
    paths: list[str] = []
    waiting = None
    for deezer_id in (from_id, to_id):
        key = f"analysis:{deezer_id}:{quality}"
        _raise_if_failed(key, f"preparing track {deezer_id} ({quality})")
        audio_path = storage.path_for_quality(deezer_id, quality)
        data = _load_analysis(deezer_id, quality, audio_path) if os.path.exists(audio_path) else None
        if data is None:
            _submit(key, _analysis_job(deezer_id, quality, user_id))
            waiting = "ANALYSING"
            continue
        records.append(data)
        paths.append(audio_path)
    if waiting:
        return _pending(waiting)

    plan = planner.plan(records[0], records[1])
    if plan["kind"] != "beatmatch":
        return {"status": "ready", "kind": plan["kind"], "reason": plan["reason"], "detail": plan["detail"]}

    fingerprint = json.dumps(
        [from_id, to_id, quality, a_gain, b_gain, records[0]["file"], records[1]["file"],
         analysis.ANALYSIS_VERSION, render.RENDER_VERSION],
        separators=(",", ":"),
    )
    clip_id = hashlib.sha256(fingerprint.encode()).hexdigest()[:32]
    render_key = f"render:{clip_id}"
    _raise_if_failed(render_key, f"rendering transition {from_id} -> {to_id}")
    flac, meta = clip_paths(clip_id)
    with _lock:  # _prune_clips() cannot delete the pair between the read and the touch
        if not os.path.exists(meta):
            timeline = None
        else:
            with open(meta, "r", encoding="utf-8") as fh:
                timeline = json.load(fh)
            os.utime(meta)  # recently used decisions/clips survive pruning
            if timeline.get("status") != "unsuitable":
                if not os.path.exists(flac):
                    raise DjTransitionError(f"DJ clip {clip_id} has metadata but no audio file {flac}")
                os.utime(flac)
    if timeline is None:
        _submit(render_key, _render_job(paths[0], paths[1], plan, a_gain, b_gain, clip_id))
        return _pending("RENDERING")
    if timeline.get("status") == "unsuitable":
        return {"status": "ready", "kind": "crossfade", "reason": "RENDER_UNSUITABLE",
                "detail": timeline["detail"]}
    return {
        "status": "ready", "kind": "beatmatch", "reason": plan["reason"], "detail": plan["detail"],
        "clip": {"id": clip_id, **timeline},
    }
