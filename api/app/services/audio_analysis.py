"""Server-side audio intelligence: waveform peaks, EBU R128 loudness & silence cues.

Uses ``ffmpeg`` on materialized audio files (MP3 or FLAC) to compute real
normalized waveform peaks (96 buckets in 0..1), true integrated loudness (LUFS),
true peak (linear ratio), and leading/trailing non-silent cue timestamps
(``intro_end_sec``, ``outro_start_sec``).

Follows AGENTS.md: fails loudly when ``ffmpeg`` is unavailable or decoding fails;
never fabricates placeholder peaks or fake loudness numbers.
"""
from __future__ import annotations

import array
import json
import logging
import math
import os
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import update

from ..db.models import Like, PlaylistTrack, StoredTrack
from ..db.session import SessionLocal

logger = logging.getLogger(__name__)

NUM_PEAKS = 96
_PCM_SAMPLE_RATE = 8000
_SILENCE_THRESHOLD_NORM = 0.0056  # ~ -45 dBFS
_TARGET_LUFS = -14.0
_FFMPEG_TIMEOUT_SEC = 45

_SUMMARY_I_RE = re.compile(r"\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS")
_SUMMARY_PEAK_RE = re.compile(r"\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS")

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="audio-analysis")
_inflight_lock = threading.Lock()
_inflight: set[str] = set()


class AudioAnalysisError(RuntimeError):
    """Raised when server-side audio analysis fails."""


class AudioAnalysisUnavailableError(AudioAnalysisError):
    """Raised when ``ffmpeg`` is not installed on the server."""


def _require_ffmpeg() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AudioAnalysisUnavailableError(
            "Audio analysis requires ffmpeg on PATH, but ffmpeg was not found."
        )
    return ffmpeg


def _compute_peaks_and_cues(
    ffmpeg: str,
    file_path: str,
    *,
    num_peaks: int = NUM_PEAKS,
) -> tuple[list[float], float, float, float]:
    """Decode audio to mono 8kHz PCM and compute normalized peaks & silence cues."""
    try:
        proc = subprocess.run(
            [
                ffmpeg,
                "-v",
                "error",
                "-i",
                file_path,
                "-ac",
                "1",
                "-ar",
                str(_PCM_SAMPLE_RATE),
                "-f",
                "s16le",
                "pipe:1",
            ],
            capture_output=True,
            timeout=_FFMPEG_TIMEOUT_SEC,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise AudioAnalysisError(
            f"ffmpeg PCM decode failed for {os.path.basename(file_path)}: {exc}"
        ) from exc

    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()[:300]
        raise AudioAnalysisError(
            f"ffmpeg PCM decode failed (exit {proc.returncode}) for "
            f"{os.path.basename(file_path)}: {err}"
        )

    raw = proc.stdout
    even_len = len(raw) - (len(raw) % 2)
    if even_len == 0:
        raise AudioAnalysisError(
            f"ffmpeg decoded zero audio samples for {os.path.basename(file_path)}"
        )

    samples = array.array("h")
    samples.frombytes(raw[:even_len])
    if sys.byteorder != "little":
        samples.byteswap()

    total_samples = len(samples)
    duration_sec = round(total_samples / _PCM_SAMPLE_RATE, 3)

    # Compute RMS per waveform bucket (smoother and truer to perceived loudness
    # than raw sample peak) and normalize by the track's own maximum bucket.
    raw_buckets: list[float] = []
    for idx in range(num_peaks):
        start = (idx * total_samples) // num_peaks
        end = ((idx + 1) * total_samples) // num_peaks
        if end <= start:
            raw_buckets.append(0.0)
            continue
        # Sample stride keeps analysis sub-20ms in pure Python for a 4-minute song.
        step = max(1, (end - start) // 256)
        acc = 0.0
        count = 0
        for i in range(start, end, step):
            val = samples[i] / 32768.0
            acc += val * val
            count += 1
        rms = math.sqrt(acc / count) if count else 0.0
        raw_buckets.append(rms)

    max_bucket = max(raw_buckets) if raw_buckets else 0.0
    if max_bucket > 0.0:
        peaks = [round(min(1.0, v / max_bucket), 3) for v in raw_buckets]
    else:
        peaks = [0.0 for _ in range(num_peaks)]

    # Leading & trailing silence boundaries in 20ms windows (160 samples @ 8kHz).
    frame_size = int(_PCM_SAMPLE_RATE * 0.02)
    threshold_i16 = int(32768 * _SILENCE_THRESHOLD_NORM)
    intro_sample = 0
    for pos in range(0, total_samples, frame_size):
        end = min(total_samples, pos + frame_size)
        peak_val = max(abs(samples[i]) for i in range(pos, end, 4))
        if peak_val >= threshold_i16:
            intro_sample = pos
            break

    outro_sample = total_samples
    for pos in range(total_samples, 0, -frame_size):
        start = max(0, pos - frame_size)
        peak_val = max(abs(samples[i]) for i in range(start, pos, 4))
        if peak_val >= threshold_i16:
            outro_sample = pos
            break

    intro_end_sec = round(intro_sample / _PCM_SAMPLE_RATE, 3)
    outro_start_sec = round(outro_sample / _PCM_SAMPLE_RATE, 3)
    if outro_start_sec < intro_end_sec:
        intro_end_sec = 0.0
        outro_start_sec = duration_sec

    return peaks, duration_sec, intro_end_sec, outro_start_sec


def _compute_ebur128(ffmpeg: str, file_path: str) -> tuple[float | None, float | None, float | None]:
    """Run ffmpeg ebur128 filter and parse integrated LUFS + true peak."""
    try:
        proc = subprocess.run(
            [
                ffmpeg,
                "-nostats",
                "-i",
                file_path,
                "-af",
                "ebur128=peak=true",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            timeout=_FFMPEG_TIMEOUT_SEC,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise AudioAnalysisError(
            f"ffmpeg ebur128 failed for {os.path.basename(file_path)}: {exc}"
        ) from exc

    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()[:300]
        raise AudioAnalysisError(
            f"ffmpeg ebur128 failed (exit {proc.returncode}) for "
            f"{os.path.basename(file_path)}: {err}"
        )

    stderr = proc.stderr.decode("utf-8", errors="replace")
    summary_idx = stderr.rfind("Summary:")
    section = stderr[summary_idx:] if summary_idx != -1 else stderr

    lufs: float | None = None
    gain_db: float | None = None
    peak_linear: float | None = None

    m_i = _SUMMARY_I_RE.search(section)
    if m_i:
        val = float(m_i.group(1))
        if math.isfinite(val) and val > -70.0:
            lufs = round(val, 2)
            gain_db = round(_TARGET_LUFS - lufs, 2)

    m_peak = _SUMMARY_PEAK_RE.search(section)
    if m_peak:
        peak_dbfs = float(m_peak.group(1))
        if math.isfinite(peak_dbfs) and peak_dbfs > -120.0:
            peak_linear = round(min(2.0, max(0.0, 10.0 ** (peak_dbfs / 20.0))), 4)

    return lufs, gain_db, peak_linear


def analyze_file(
    deezer_id: str,
    file_path: str,
    *,
    bpm: float | None = None,
) -> dict[str, Any]:
    """Analyze an audio file on disk and return the canonical audio-meta dict."""
    if not os.path.isfile(file_path):
        raise AudioAnalysisError(f"Audio file does not exist for track {deezer_id}: {file_path}")
    ffmpeg = _require_ffmpeg()
    peaks, duration_sec, intro_end_sec, outro_start_sec = _compute_peaks_and_cues(
        ffmpeg, file_path
    )
    lufs, gain_db, peak_linear = _compute_ebur128(ffmpeg, file_path)
    return {
        "deezer_id": deezer_id,
        "peaks": peaks,
        "loudness_lufs": lufs,
        "loudness_gain_db": gain_db,
        "loudness_peak": peak_linear,
        "bpm": bpm,
        "duration_sec": duration_sec,
        "intro_end_sec": intro_end_sec,
        "outro_start_sec": outro_start_sec,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


def _persist_analysis(deezer_id: str, result: dict[str, Any], sidecar_path: str) -> None:
    """Persist analysis into the track's sidecar JSON and StoredTrack/Like/PlaylistTrack.

    Serialized on the per-track storage lock so sidecar writes cannot race
    ``storage.materialize()`` or recreate an orphaned sidecar after eviction.
    """
    from . import storage

    with storage.lock_for(deezer_id):
        if storage.existing_audio_path(deezer_id) is None:
            # Track was evicted while ffmpeg ran; do not recreate an orphaned sidecar.
            return
        existing: dict[str, Any] = {}
        if os.path.exists(sidecar_path):
            with open(sidecar_path, "r", encoding="utf-8") as fh:
                parsed = json.load(fh)
                if isinstance(parsed, dict):
                    existing = parsed

        if result.get("bpm") is None and existing.get("bpm") is not None:
            result["bpm"] = existing["bpm"]
        existing["audio_analysis"] = result
        if result.get("loudness_gain_db") is not None:
            existing["loudness_gain_db"] = result["loudness_gain_db"]
        if result.get("loudness_lufs") is not None:
            existing["loudness_lufs"] = result["loudness_lufs"]
        if result.get("loudness_peak") is not None:
            existing["loudness_peak"] = result["loudness_peak"]

        tmp = sidecar_path + ".analysis.part"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(existing, fh, ensure_ascii=False)
            os.replace(tmp, sidecar_path)
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

        with SessionLocal() as db:
            row = db.get(StoredTrack, deezer_id)
            if row is not None:
                if result.get("loudness_lufs") is not None:
                    row.loudness_lufs = result["loudness_lufs"]
                if result.get("loudness_peak") is not None:
                    row.loudness_peak = result["loudness_peak"]
                if result.get("loudness_gain_db") is not None:
                    row.loudness_gain_db = result["loudness_gain_db"]
                if result.get("bpm") is not None and row.bpm is None:
                    row.bpm = result["bpm"]
            gain_db = result.get("loudness_gain_db")
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
            db.commit()


def get_or_analyze(
    deezer_id: str,
    file_path: str,
    sidecar_path: str,
    *,
    bpm: float | None = None,
) -> dict[str, Any]:
    """Return cached audio analysis from sidecar, or compute and persist it now."""
    from . import storage

    with storage.lock_for(deezer_id):
        if os.path.exists(sidecar_path):
            with open(sidecar_path, "r", encoding="utf-8") as fh:
                meta = json.load(fh)
            if isinstance(meta, dict) and isinstance(meta.get("audio_analysis"), dict):
                cached = dict(meta["audio_analysis"])
                if cached.get("peaks") and cached.get("analyzed_at"):
                    if cached.get("bpm") is None and (bpm or meta.get("bpm")):
                        cached["bpm"] = bpm or meta.get("bpm")
                    return cached
            if bpm is None and isinstance(meta, dict):
                bpm = meta.get("bpm")

    result = analyze_file(deezer_id, file_path, bpm=bpm)
    _persist_analysis(deezer_id, result, sidecar_path)
    return result


def schedule_analysis(deezer_id: str, file_path: str, sidecar_path: str) -> None:
    """Queue a single-flight background analysis pass after track materialization."""
    if not shutil.which("ffmpeg"):
        return
    with _inflight_lock:
        if deezer_id in _inflight:
            return
        _inflight.add(deezer_id)

    def _run() -> None:
        try:
            get_or_analyze(deezer_id, file_path, sidecar_path)
        except Exception as exc:  # noqa: BLE001 — background worker logs loudly
            logger.error("Background audio analysis failed for track %s: %s", deezer_id, exc)
        finally:
            with _inflight_lock:
                _inflight.discard(deezer_id)

    _executor.submit(_run)
