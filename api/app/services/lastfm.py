"""Last.fm metadata with bounded caches that share successful concurrent loads."""
from __future__ import annotations

from ..config import LASTFM_API_KEY
from .discovery import run_jobs
from .lastfm_client import LastfmError, count_field, get_json, list_objects, object_field
from .singleflight_cache import SingleFlightTtlCache

_CACHE_TTL = 60 * 60 * 24
_MAX_WORKERS = 6
_track_cache = SingleFlightTtlCache[str, dict | None](
    ttl_seconds=_CACHE_TTL, max_entries=4096, max_inflight=_MAX_WORKERS,
)
_artist_cache = SingleFlightTtlCache[str, dict | None](
    ttl_seconds=_CACHE_TTL, max_entries=1024, max_inflight=_MAX_WORKERS,
)


def _key(artist: str, title: str) -> str:
    return f"{artist.strip().casefold()}\t{title.strip().casefold()}"


def _get(params: dict) -> dict | None:
    seed = " / ".join(str(params[key]) for key in ("artist", "track") if key in params)
    return get_json(
        params, api_key=LASTFM_API_KEY, timeout=8,
        context=f"Metadata ({params['method']}) for {seed!r}", allow_not_found=True,
    )


def _fetch_one(artist: str, title: str) -> dict | None:
    data = _get({
        "method": "track.getInfo", "artist": artist,
        "track": title, "autocorrect": 1,
    })
    if data is None:
        return None
    context = f"Play counts for {artist!r} / {title!r}"
    track = object_field(data, "track", context=context)
    plays = count_field(track, "playcount", context=context)
    listeners = count_field(track, "listeners", context=context)
    return {"plays": plays, "listeners": listeners} if plays or listeners else None


def plays_for(items: list[dict]) -> dict[str, dict]:
    """Read unique artist/title keys once and fan each result out to all IDs."""
    if not LASTFM_API_KEY:
        return {}
    seeds: dict[str, tuple[str, str]] = {}
    ids: dict[str, list[str]] = {}
    for item in items:
        artist, title = item.get("artist"), item.get("title")
        tid = str(item.get("id") or "")
        # Public requests may omit metadata for tracks not yet resolved. These
        # are explicitly ineligible for this optional metadata enrichment.
        if not artist or not title or not tid:
            continue
        if not isinstance(artist, str) or not isinstance(title, str):
            raise ValueError(f"Play-count track {tid!r} requires text artist and title")
        artist, title = artist.strip(), title.strip()
        if not artist or not title:
            continue
        key = _key(artist, title)
        seeds.setdefault(key, (artist, title))
        ids.setdefault(key, []).append(tid)

    def lookup(key: str) -> dict | None:
        artist, title = seeds[key]
        return _track_cache.get(key, lambda: _fetch_one(artist, title))

    results = run_jobs({key: lambda key=key: lookup(key) for key in seeds}, max_workers=_MAX_WORKERS)
    return {tid: value for key, value in results.items() if value is not None for tid in ids[key]}


def _clean_bio(raw: str) -> str:
    marker = raw.find("<a href")
    return (raw[:marker] if marker != -1 else raw).strip()


def _fetch_artist(name: str) -> dict | None:
    data = _get({"method": "artist.getInfo", "artist": name, "autocorrect": 1})
    if data is None:
        return None
    context = f"Artist metadata for {name!r}"
    artist = object_field(data, "artist", context=context)
    stats = object_field(artist, "stats", context=context)
    bio = object_field(artist, "bio", context=context).get("summary")
    if not isinstance(bio, str):
        raise LastfmError(f"{context}: Last.fm has no valid bio.summary text")
    tags = list_objects(artist, "tags", "tag", context=context)
    names: list[str] = []
    for tag in tags:
        value = tag.get("name")
        if not isinstance(value, str) or not value.strip():
            raise LastfmError(f"{context}: Last.fm tag has no valid name")
        names.append(value.strip())
    return {
        "bio": _clean_bio(bio),
        "listeners": count_field(stats, "listeners", context=context),
        "playcount": count_field(stats, "playcount", context=context),
        "tags": names[:5],
    }


def artist_info(name: str) -> dict | None:
    """Unknown artists and disabled Last.fm are explicit missing enrichment."""
    if not LASTFM_API_KEY:
        return None
    name = name.strip()
    if not name:
        return None
    return _artist_cache.get(name.casefold(), lambda: _fetch_artist(name))
