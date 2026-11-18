"""Validated Last.fm discovery resolved to distinct playable Deezer tracks.

Unconfigured Last.fm and real empty provider collections are explicit empty
results. Once configured, provider failures are raised and never cached as
successful recommendations.
"""
from __future__ import annotations

import hashlib
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


# A seeded draw reads one larger Last.fm page per tag and resolves only the
# names it drew, so its Deezer cost stays at the level of `tag_top_tracks`.
TAG_DRAW_POOL_SIZE = 200
# Extra names a draw may resolve to replace Deezer misses and duplicate hits.
# Hard cap on Deezer searches per tag: limit + TAG_DRAW_SPARE_RESOLVES.
TAG_DRAW_SPARE_RESOLVES = 10


def _draw_order(queries: list[str], seed: str) -> list[str]:
    """The distinct `queries` in an order that depends only on `seed`.

    Every name is ranked by its own keyed digest instead of by a position in a
    shuffled list. One `seed` therefore yields the same order in every process,
    and a name entering or leaving the pool moves only itself: the rest of a
    draw survives when Last.fm's chart shifts between two builds.
    """
    unique = list(dict.fromkeys(queries))
    return sorted(
        unique,
        key=lambda query: (
            hashlib.sha256(f"{seed}\x00{query}".encode("utf-8")).digest(),
            query,
        ),
    )


def tag_track_draw(
    tags: list[str],
    limit: int = 30,
    *,
    seed: str,
    pool_size: int = TAG_DRAW_POOL_SIZE,
    spare_resolves: int = TAG_DRAW_SPARE_RESOLVES,
) -> list[dict]:
    """Up to `limit` playable tracks drawn by `seed` from a tag's top tracks.

    Like `tag_top_tracks`, the first tag with real playable results wins and an
    unconfigured Last.fm is an explicit empty result. Unlike it, the tracks are
    not the top `limit` of the tag: one request reads the tag's top `pool_size`
    names, `seed` fixes their draw order, and only the drawn names are resolved
    on Deezer. Names that resolve to nothing or to an already drawn track are
    replaced by the next names in draw order, with at most
    `limit + spare_resolves` Deezer searches per tag. The result keeps draw
    order and can be shorter than `limit` when the pool or the cap runs out.
    """
    if not seed.strip():
        raise ValueError("A tag track draw requires a non-empty seed")
    if limit < 1 or pool_size < limit or spare_resolves < 0:
        raise ValueError(
            f"Invalid tag track draw bounds: limit={limit}, pool_size={pool_size}, "
            f"spare_resolves={spare_resolves}"
        )
    if not LASTFM_API_KEY:
        return []
    max_resolves = limit + spare_resolves
    for tag in tags:
        data = _lastfm_get({"method": "tag.gettoptracks", "tag": tag, "limit": pool_size})
        if data is None:
            raise LastfmError(f"Tag {tag!r}: configured Last.fm returned no response")
        pool = _track_queries(data, "tracks", context=f"Tag {tag!r}")[:pool_size]
        candidates = _draw_order(pool, seed)[:max_resolves]
        drawn: list[dict] = []
        seen: set[str] = set()
        attempted = 0
        while len(drawn) < limit and attempted < len(candidates):
            # Resolve exactly as many names as tracks are still missing, so a
            # draw without misses costs `limit` searches and never overshoots.
            batch = candidates[attempted:attempted + limit - len(drawn)]
            attempted += len(batch)
            for hit in _resolve_queries(batch, len(batch)):
                if hit["id"] not in seen:
                    seen.add(hit["id"])
                    drawn.append(hit)
        if drawn:
            return drawn
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
