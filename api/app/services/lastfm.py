"""Last.fm play-count lookups with an in-memory TTL cache.

Last.fm is the only available source of real listen/play numbers (Deezer only
exposes a popularity ``rank``). Each ``track.getInfo`` call covers one track, so
lookups are batched, parallelised and cached aggressively to stay well under the
public API's rate limits.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from ..config import LASTFM_API_KEY

_LASTFM = "https://ws.audioscrobbler.com/2.0/"
_CACHE_TTL = 60 * 60 * 24  # 24h — play counts barely move day to day
_MAX_WORKERS = 6  # keep bursts under Last.fm's per-key rate limit

# key "artist\ttitle" -> (fetched_at, {plays, listeners} | None)
_cache: dict[str, tuple[float, dict | None]] = {}
_lock = threading.Lock()


def _now() -> float:
    return time.monotonic()


def _key(artist: str, title: str) -> str:
    return f"{artist.strip().lower()}\t{title.strip().lower()}"


def _get(params: dict) -> dict | None:
    if not LASTFM_API_KEY:
        return None
    try:
        resp = requests.get(
            _LASTFM,
            params={**params, "api_key": LASTFM_API_KEY, "format": "json"},
            timeout=8,
        )
        resp.raise_for_status()
        return resp.json()
    except (requests.exceptions.RequestException, ValueError):
        return None


def _fetch_one(artist: str, title: str) -> dict | None:
    data = _get(
        {
            "method": "track.getInfo",
            "artist": artist,
            "track": title,
            "autocorrect": 1,
        }
    )
    track = (data or {}).get("track") or {}
    if not track:
        return None
    try:
        plays = int(track.get("playcount") or 0)
        listeners = int(track.get("listeners") or 0)
    except (TypeError, ValueError):
        return None
    if plays <= 0 and listeners <= 0:
        return None
    return {"plays": plays, "listeners": listeners}


def plays_for(items: list[dict]) -> dict[str, dict]:
    """Resolve play counts for ``[{id, artist, title}]`` → ``{id: {plays, listeners}}``.

    Results are cached by artist+title, so the same track requested from several
    views (or repeated searches) only ever hits Last.fm once per TTL window.
    """
    now = _now()
    out: dict[str, dict] = {}
    todo: list[dict] = []  # uncached unique (artist,title) with one representative id

    seen_keys: dict[str, list[str]] = {}  # cache key -> ids sharing it
    for it in items:
        artist = (it.get("artist") or "").strip()
        title = (it.get("title") or "").strip()
        tid = str(it.get("id") or "")
        if not artist or not title or not tid:
            continue
        k = _key(artist, title)
        seen_keys.setdefault(k, []).append(tid)
        with _lock:
            ent = _cache.get(k)
        if ent and now - ent[0] < _CACHE_TTL:
            if ent[1] is not None:
                out[tid] = ent[1]
        elif k not in {t["_k"] for t in todo}:
            todo.append({"_k": k, "artist": artist, "title": title})

    if todo and LASTFM_API_KEY:
        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            results = list(
                pool.map(lambda t: (t["_k"], _fetch_one(t["artist"], t["title"])), todo)
            )
        with _lock:
            for k, res in results:
                _cache[k] = (now, res)
        for k, res in results:
            if res is not None:
                for tid in seen_keys.get(k, []):
                    out[tid] = res
    return out


# artist name (lowercased) -> (fetched_at, info | None)
_artist_cache: dict[str, tuple[float, dict | None]] = {}


def _clean_bio(raw: str) -> str:
    """Strip Last.fm's trailing "Read more on Last.fm" link/markup from a bio."""
    text = raw or ""
    marker = "<a href"
    idx = text.find(marker)
    if idx != -1:
        text = text[:idx]
    return text.strip()


def artist_info(name: str) -> dict | None:
    """Last.fm ``artist.getInfo`` → ``{bio, listeners, playcount, tags}``.

    Cached 24h per artist name; returns ``None`` when no key is configured or
    the artist is unknown.
    """
    name = (name or "").strip()
    if not name:
        return None
    key = name.lower()
    now = _now()
    with _lock:
        ent = _artist_cache.get(key)
    if ent and now - ent[0] < _CACHE_TTL:
        return ent[1]

    data = _get({"method": "artist.getInfo", "artist": name, "autocorrect": 1})
    artist = (data or {}).get("artist") or {}
    info: dict | None = None
    if artist:
        stats = artist.get("stats") or {}
        bio = (artist.get("bio") or {}).get("summary") or ""
        tags = [
            t.get("name", "")
            for t in ((artist.get("tags") or {}).get("tag") or [])
            if t.get("name")
        ]
        try:
            listeners = int(stats.get("listeners") or 0)
            playcount = int(stats.get("playcount") or 0)
        except (TypeError, ValueError):
            listeners = playcount = 0
        info = {
            "bio": _clean_bio(bio),
            "listeners": listeners,
            "playcount": playcount,
            "tags": tags[:5],
        }
    with _lock:
        _artist_cache[key] = (now, info)
    return info
