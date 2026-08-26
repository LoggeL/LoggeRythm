"""Song-radio endpoint: a "track mix" of similar songs.

Primary similarity source is Last.fm (track.getSimilar) — its collaborative
data gives genuinely similar songs across artists; each is resolved to a
playable Deezer track. Falls back to Deezer's own artist radio + related
artists' top tracks, then to the seed album's genre charts, then to charts.

Each tier only runs when the previous ones failed to deliver enough tracks by
*other* artists: for a long-tail artist Last.fm knows nothing, and Deezer's
artist radio degrades to "that artist's own three songs" with an empty related
list — which used to make song radio a single-artist loop.
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
# Below this many usable non-seed-artist slots, the mix is not a radio station
# yet and the next fallback tier runs. Each artist contributes at most
# `_MAX_PER_ARTIST` slots.
_MIN_OTHER_ARTIST_SLOTS = 12
# No single artist may own the station — including the seed artist.
_MAX_PER_ARTIST = 2
# Only below this does the per-artist cap get relaxed to keep the queue usable.
_MIN_MIX_SIZE = 20
_LASTFM = "https://ws.audioscrobbler.com/2.0/"


class _RadioSourceError(RuntimeError):
    """A non-Deezer recommendation source failed."""


def _seed_meta(deezer_id: str) -> dict:
    track = dc._public_get(f"/track/{deezer_id}")
    if not isinstance(track, dict):
        raise dc.DeezerClientError(
            f"Deezer track {deezer_id} returned an invalid metadata payload"
        )
    return track


def _lastfm_similar(artist: str, title: str) -> list[dict]:
    """Ask Last.fm for similar tracks; resolve each to a playable Deezer track."""
    if not LASTFM_API_KEY:
        return []
    if not artist or not title:
        raise _RadioSourceError(
            "Cannot query Last.fm recommendations: seed track has no artist or title"
        )
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
        payload = resp.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        raise _RadioSourceError(
            f"Last.fm recommendations failed for {artist!r} - {title!r}: {e}"
        ) from e
    if not isinstance(payload, dict):
        raise _RadioSourceError(
            f"Last.fm returned an invalid recommendation payload for {artist!r} - {title!r}"
        )
    if payload.get("error"):
        raise _RadioSourceError(
            f"Last.fm recommendations failed for {artist!r} - {title!r}: "
            f"{payload.get('message') or payload['error']}"
        )
    similar = payload.get("similartracks") or {}
    if not isinstance(similar, dict):
        raise _RadioSourceError(
            f"Last.fm returned invalid similar tracks for {artist!r} - {title!r}"
        )
    sims = similar.get("track") or []

    queries = [
        f"{(s.get('artist') or {}).get('name', '')} {s.get('name', '')}".strip()
        for s in sims
    ]
    queries = [q for q in queries if q][:30]
    if not queries:
        return []

    def _resolve(q: str) -> dict | None:
        try:
            hits = dc.search_tracks_public(q, limit=1)
        except dc.DeezerClientError as e:
            raise type(e)(
                f"Could not resolve Last.fm recommendation {q!r}: {e}"
            ) from e
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
                pool.append(t)

    if artist_id:
        add(dc._public_get(f"/artist/{artist_id}/radio").get("data"))
        related = dc._public_get(f"/artist/{artist_id}/related?limit=6").get("data") or []
        for r in related[:6]:
            rid = r.get("id")
            if rid:
                add(dc._public_get(f"/artist/{rid}/top?limit=5").get("data"))
    return dc.normalize_public_tracks(pool)


def _genre_charts(album_id) -> list[dict]:
    """Fallback: charts of the seed album's genres.

    The safety net for long-tail artists that neither Last.fm nor Deezer's
    related-artist graph knows — at least the mix stays in the right corner of
    music instead of collapsing onto the seed artist.
    """
    if not album_id:
        return []
    album = dc._public_get(f"/album/{album_id}")
    genre_ids = [
        g.get("id")
        for g in ((album.get("genres") or {}).get("data") or [])
        if g.get("id")
    ]
    if not genre_ids and album.get("genre_id", -1) not in (None, -1):
        genre_ids = [album["genre_id"]]

    raw: list[dict] = []
    seen: set[str] = set()
    for gid in genre_ids[:3]:
        items = dc._public_get(f"/chart/{gid}/tracks?limit=30").get("data") or []
        for t in items:
            tid = str(t.get("id", ""))
            if tid and tid not in seen:
                seen.add(tid)
                raw.append(t)

    # Chart entries carry no inline contributors, so normalizing costs one
    # Deezer request per track — trim to the mix size before paying for it.
    random.shuffle(raw)
    return dc.normalize_public_tracks(raw[:_MIX_SIZE])


def _merge(pool: list[dict], extra: list[dict], seen: set[str]) -> list[dict]:
    """Append `extra` to `pool`, skipping ids already taken (or the seed)."""
    for t in extra:
        tid = str(t.get("id", ""))
        if tid and tid not in seen:
            seen.add(tid)
            pool.append(t)
    return pool


def _other_artist_slots(pool: list[dict], artist_id) -> int:
    """Count non-seed tracks that survive the per-artist diversity cap."""
    seed = str(artist_id or "")
    per_artist: dict[str, int] = {}
    for track in pool:
        artist = str(track.get("artist_id", "")) or track.get("artist", "")
        if artist == seed:
            continue
        per_artist[artist] = per_artist.get(artist, 0) + 1
    return sum(min(count, _MAX_PER_ARTIST) for count in per_artist.values())


def _diversify(pool: list[dict]) -> list[dict]:
    """Take at most `_MAX_PER_ARTIST` per artist, overflow only as padding.

    The held-back tracks are used solely to reach `_MIN_MIX_SIZE` — a short but
    varied station beats a long one padded out with the same artist again.
    """
    per_artist: dict[str, int] = {}
    picked: list[dict] = []
    overflow: list[dict] = []
    for t in pool:
        key = str(t.get("artist_id", "")) or t.get("artist", "")
        if per_artist.get(key, 0) < _MAX_PER_ARTIST:
            per_artist[key] = per_artist.get(key, 0) + 1
            picked.append(t)
        else:
            overflow.append(t)
    mix = picked[:_MIX_SIZE]
    if len(mix) < _MIN_MIX_SIZE:
        mix = (mix + overflow)[:_MIN_MIX_SIZE]
    return mix


def _radio(deezer_id: str) -> list[dict]:
    seed = _seed_meta(deezer_id)
    seed_artist = seed.get("artist")
    seed_album = seed.get("album")
    title = seed.get("title")
    if not isinstance(seed_artist, dict) or not seed_artist.get("id"):
        raise dc.DeezerClientError(
            f"Deezer track {deezer_id} has no valid primary artist metadata"
        )
    if not isinstance(seed_album, dict):
        raise dc.DeezerClientError(
            f"Deezer track {deezer_id} has no valid album metadata"
        )
    if not isinstance(title, str) or not title:
        raise dc.DeezerClientError(f"Deezer track {deezer_id} has no valid title")
    artist = str(seed_artist.get("name") or "")
    artist_id = seed_artist["id"]
    album_id = seed_album.get("id")

    pool: list[dict] = []
    seen: set[str] = {str(deezer_id)}

    # 1) External similarity (Last.fm) → Deezer-playable.
    _merge(pool, _lastfm_similar(artist, title), seen)
    # 2) Deezer's own mix — artist radio + related artists.
    if _other_artist_slots(pool, artist_id) < _MIN_OTHER_ARTIST_SLOTS:
        _merge(pool, _deezer_mix(deezer_id, artist_id), seen)
    # 3) Genre charts of the seed album.
    if _other_artist_slots(pool, artist_id) < _MIN_OTHER_ARTIST_SLOTS:
        _merge(pool, _genre_charts(album_id), seen)
    # 4) Last resort: global charts.
    if _other_artist_slots(pool, artist_id) < _MIN_OTHER_ARTIST_SLOTS:
        _merge(pool, dc.charts(), seen)
    if not pool:
        raise dc.DeezerClientError(
            f"All radio recommendation sources returned no tracks for seed {deezer_id}"
        )

    random.shuffle(pool)
    return _diversify(pool)


@router.get("/radio/{deezer_id}", response_model=list[Track])
async def radio(deezer_id: str) -> list[dict]:
    try:
        return await run_in_threadpool(_radio, deezer_id)
    except (dc.DeezerClientError, _RadioSourceError) as e:
        raise to_http(e)
