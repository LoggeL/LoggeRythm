"""Permanent track storage (NOT a cache).

Each Deezer track is downloaded + decrypted exactly once via MelodAI's deezer.py
and stored permanently on disk. No TTL, no eviction. Once materialized, a track
stays playable forever (even if the ARL later expires).

Correctness guarantees:
- per-track lock -> no concurrent double-download of the same id
- atomic rename (.part -> final) -> never serve a half-written file
"""
import json
import os
import threading

from . import deezer

_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


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


def get_meta(deezer_id: str) -> dict | None:
    p = meta_path_for(deezer_id)
    if not os.path.exists(p):
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def materialize(deezer_id: str) -> str:
    """Download + decrypt the track if not already stored. Returns the file path.

    Blocking (network + decrypt) -> call via run_in_threadpool from async code.
    """
    final = path_for(deezer_id)
    if os.path.exists(final):
        return final

    lock = _lock_for(deezer_id)
    with lock:
        # Re-check inside the lock: another thread may have just finished.
        if os.path.exists(final):
            return final

        song = deezer.get_song_infos_from_deezer_website(deezer.TYPE_TRACK, deezer_id)
        tmp = final + ".part"
        deezer.download_song(song, tmp)
        os.replace(tmp, final)  # atomic on same filesystem

        # Sidecar metadata for the UI (later replaced by the StoredTrack DB row).
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
            "size_bytes": os.path.getsize(final),
        }
        with open(meta_path_for(deezer_id), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
        return final
