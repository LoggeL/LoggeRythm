"""Song-radio endpoint: a "track mix" of similar songs.

Primary similarity source is Last.fm (track.getSimilar) — its collaborative
data gives genuinely similar songs across artists; each is resolved to a
playable Deezer track. Falls back to Deezer's own artist radio + related
artists' top tracks, then to charts.
"""
import random
from concurrent.futures import ThreadPoolExecutor

import requests

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from ..config import LASTFM_API_KEY
from ..schemas.track import Track
from ..services import deezer_client as dc
from .errors import to_http

router = APIRouter(prefix="/api", tags=["radio"])

_MIX_SIZE = 40
_LASTFM = "https://ws.audioscrobbler.com/2.0/"


def _seed_meta(deezer_id: str) -> dict:
    try:
        t = dc._public_get(f"/track/{deezer_id}")
        return t if isinstance(t, dict) else {}
    except dc.DeezerClientError:
        return {}


def _lastfm_similar(artist: str, title: str) -> list[dict]:
    """Ask Last.fm for similar tracks; resolve each to a playable Deezer track."""
    if not LASTFM_API_KEY or not artist or not title:
        return []
    try:
        resp = requests.get(
            _LASTFM,
            params={
                "method": "track.getsimilar",
                "artist": artist,
                "track": title,
                "api_key": LASTFM_API_KEY,
                "format": "json",
                "limit": 40,
                "autocorrect": 1,
            },
            timeout=12,
        )
        resp.raise_for_status()
        sims = (resp.json().get("similartracks") or {}).get("track") or []
    except (requests.exceptions.RequestException, ValueError):
        return []

    queries = [
        f"{(s.get('artist') or {}).get('name', '')} {s.get('name', '')}".strip()
        for s in sims
    ]
    queries = [q for q in queries if q][:30]
    if not queries:
        return []

    def _resolve(q: str) -> dict | None:
        try:
            hits = dc.search_tracks_public(q)
        except dc.DeezerClientError:
            return None
        return hits[0] if hits else None

    out: list[dict] = []
    seen: set[str] = set()
    with ThreadPoolExecutor(max_workers=8) as pool:
        for hit in pool.map(_resolve, queries):
            if hit and hit["id"] not in seen:
                seen.add(hit["id"])
                out.append(hit)
    return out


def _deezer_mix(deezer_id: str, artist_id) -> list[dict]:
    """Fallback: seed artist radio + related artists' top tracks."""
    pool: list[dict] = []
    seen: set[str] = {str(deezer_id)}

    def add(items: list) -> None:
        for t in items or []:
            tid = str(t.get("id", ""))
            if tid and tid not in seen:
                seen.add(tid)
                pool.append(dc.normalize_public_track(t))

    if artist_id:
        try:
            add(dc._public_get(f"/artist/{artist_id}/radio").get("data"))
        except dc.DeezerClientError:
            pass
        try:
            related = dc._public_get(f"/artist/{artist_id}/related?limit=6").get("data") or []
        except dc.DeezerClientError:
            related = []
        for r in related[:6]:
            rid = r.get("id")
            if rid:
                try:
                    add(dc._public_get(f"/artist/{rid}/top?limit=5").get("data"))
                except dc.DeezerClientError:
                    pass
    return pool


def _radio(deezer_id: str) -> list[dict]:
    seed = _seed_meta(deezer_id)
    artist = (seed.get("artist") or {}).get("name", "") if isinstance(seed, dict) else ""
    title = seed.get("title", "") if isinstance(seed, dict) else ""
    artist_id = (seed.get("artist") or {}).get("id") if isinstance(seed, dict) else None

    # 1) External similarity (Last.fm) → Deezer-playable.
    pool = _lastfm_similar(artist, title)
    # 2) Fallback: Deezer's own mix.
    if not pool:
        pool = _deezer_mix(deezer_id, artist_id)
    # 3) Last resort: charts.
    if not pool:
        return dc.charts()

    random.shuffle(pool)
    return pool[:_MIX_SIZE]


@router.get("/radio/{deezer_id}", response_model=list[Track])
async def radio(deezer_id: str) -> list[dict]:
    try:
        return await run_in_threadpool(_radio, deezer_id)
    except dc.DeezerClientError as e:
        raise to_http(e)
