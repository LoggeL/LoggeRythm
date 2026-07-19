"""Recommendation helpers built on Last.fm + Deezer.

Last.fm supplies collaborative similarity/tag data; each suggested track is
resolved to a playable Deezer track via the public API. All functions are
blocking (network) and return Track-shaped dicts (see deezer_client.normalize_*).
They never raise — on any failure they return an empty list so callers can fall
back gracefully.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import requests

from ..config import LASTFM_API_KEY
from . import deezer_client as dc

_LASTFM = "https://ws.audioscrobbler.com/2.0/"


def _lastfm_get(params: dict) -> dict | None:
    if not LASTFM_API_KEY:
        return None
    try:
        resp = requests.get(
            _LASTFM,
            params={**params, "api_key": LASTFM_API_KEY, "format": "json"},
            timeout=12,
        )
        resp.raise_for_status()
        return resp.json()
    except (requests.exceptions.RequestException, ValueError):
        return None


def _resolve_queries(queries: list[str], limit: int) -> list[dict]:
    """Resolve "artist title" strings to distinct playable Deezer tracks."""
    queries = [q for q in queries if q][:limit]
    if not queries:
        return []

    def _resolve(q: str) -> dict | None:
        try:
            hits = dc.search_tracks_public(q, limit=1)
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


def resolve_queries(queries: list[str], limit: int = 24) -> list[dict]:
    """Public: resolve free-text "artist [title]" queries to Deezer tracks."""
    return _resolve_queries(queries, limit)


def tag_top_tracks(tags: list[str], limit: int = 30) -> list[dict]:
    """Top tracks for the first tag that yields results (mood shelves)."""
    for tag in tags:
        data = _lastfm_get(
            {"method": "tag.gettoptracks", "tag": tag, "limit": limit}
        )
        if not data:
            continue
        tracks = (data.get("tracks") or {}).get("track") or []
        queries = [
            f"{(t.get('artist') or {}).get('name', '')} {t.get('name', '')}".strip()
            for t in tracks
        ]
        resolved = _resolve_queries(queries, limit)
        if resolved:
            return resolved
    return []


def similar_tracks(artist: str, title: str, limit: int = 20) -> list[dict]:
    """Tracks similar to a seed track (track.getsimilar)."""
    if not artist or not title:
        return []
    data = _lastfm_get(
        {
            "method": "track.getsimilar",
            "artist": artist,
            "track": title,
            "limit": limit,
            "autocorrect": 1,
        }
    )
    if not data:
        return []
    sims = (data.get("similartracks") or {}).get("track") or []
    queries = [
        f"{(s.get('artist') or {}).get('name', '')} {s.get('name', '')}".strip()
        for s in sims
    ]
    return _resolve_queries(queries, limit)


def similar_artists(artist: str, limit: int = 8) -> list[str]:
    """Names of artists similar to the seed (artist.getsimilar)."""
    if not artist:
        return []
    data = _lastfm_get(
        {
            "method": "artist.getsimilar",
            "artist": artist,
            "limit": limit,
            "autocorrect": 1,
        }
    )
    if not data:
        return []
    arts = (data.get("similarartists") or {}).get("artist") or []
    return [a.get("name", "") for a in arts if a.get("name")]
