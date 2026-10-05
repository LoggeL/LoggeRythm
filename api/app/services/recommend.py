"""Validated Last.fm discovery resolved to distinct playable Deezer tracks.

Unconfigured Last.fm and real empty provider collections are explicit empty
results. Once configured, provider failures are raised and never cached as
successful recommendations.
"""
from __future__ import annotations

import threading

from ..config import LASTFM_API_KEY
from . import deezer_client as dc
from .discovery import run_jobs
from .lastfm_client import LastfmError, get_json, list_objects, object_field, text_field

_DEEZER_RESOLVE_SLOTS = threading.BoundedSemaphore(1)


def _lastfm_get(params: dict) -> dict | None:
    if not LASTFM_API_KEY:
        return None
    seed = " / ".join(str(params[key]) for key in ("artist", "track", "tag") if key in params)
    return get_json(
        params,
        api_key=LASTFM_API_KEY,
        context=f"Recommendations ({params['method']}) for {seed!r}",
        allow_not_found=params["method"] in {"track.getsimilar", "artist.getsimilar"},
    )


def _track_queries(data: dict, section: str, *, context: str) -> list[str]:
    tracks = list_objects(data, section, "track", context=context)
    queries: list[str] = []
    for index, track in enumerate(tracks):
        item_context = f"{context} track {index}"
        artist = object_field(track, "artist", context=item_context)
        queries.append(
            f"{text_field(artist, 'name', context=item_context)} "
            f"{text_field(track, 'name', context=item_context)}"
        )
    return queries


def _resolve_queries(queries: list[str], limit: int) -> list[dict]:
    """Resolve free-text seeds, keeping source order and surfacing all failures."""
    unique_queries = list(dict.fromkeys(q.strip() for q in queries if q.strip()))[:limit]
    if not unique_queries:
        return []

    def resolve(query: str) -> dict | None:
        # Each search may also fetch authoritative performer credits. Nested
        # per-shelf pools must share this limit rather than multiply bursts.
        with _DEEZER_RESOLVE_SLOTS:
            hits = dc.search_tracks_public(query, limit=1)
        return hits[0] if hits else None

    hits = run_jobs(
        {query: lambda query=query: resolve(query) for query in unique_queries},
        max_workers=8,
    )
    out: list[dict] = []
    seen: set[str] = set()
    for hit in hits.values():
        if hit is not None and hit["id"] not in seen:
            seen.add(hit["id"])
            out.append(hit)
    return out


def resolve_queries(queries: list[str], limit: int = 24) -> list[dict]:
    return _resolve_queries(queries, limit)


def tag_top_tracks(tags: list[str], limit: int = 30) -> list[dict]:
    """Top tracks from the first tag with real playable results."""
    if not LASTFM_API_KEY:
        return []
    for tag in tags:
        data = _lastfm_get({"method": "tag.gettoptracks", "tag": tag, "limit": limit})
        if data is None:
            raise LastfmError(f"Tag {tag!r}: configured Last.fm returned no response")
        queries = _track_queries(data, "tracks", context=f"Tag {tag!r}")
        resolved = _resolve_queries(queries, limit)
        if resolved:
            return resolved
    return []


def similar_tracks(
    artist: str, title: str, limit: int = 20, *, resolve_limit: int | None = None,
) -> list[dict]:
    """Tracks similar to a known seed, or empty when Last.fm does not know it."""
    if not LASTFM_API_KEY:
        return []
    if not artist.strip() or not title.strip():
        raise LastfmError("Similar-track discovery requires artist and title")
    data = _lastfm_get({
        "method": "track.getsimilar", "artist": artist, "track": title,
        "limit": limit, "autocorrect": 1,
    })
    if data is None:
        return []
    queries = _track_queries(data, "similartracks", context=f"Similar to {artist!r} / {title!r}")
    return _resolve_queries(queries, limit if resolve_limit is None else resolve_limit)


def similar_artists(artist: str, limit: int = 8) -> list[str]:
    if not LASTFM_API_KEY:
        return []
    if not artist.strip():
        raise LastfmError("Similar-artist discovery requires an artist")
    data = _lastfm_get({
        "method": "artist.getsimilar", "artist": artist,
        "limit": limit, "autocorrect": 1,
    })
    if data is None:
        return []
    context = f"Artists similar to {artist!r}"
    return [text_field(item, "name", context=context) for item in
            list_objects(data, "similarartists", "artist", context=context)]
