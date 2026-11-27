"""Adapter around the legacy MelodAI ``deezer.py`` module.

Provides:
- a small error taxonomy (AuthExpired, TrackUnavailable, RateLimited, DecryptFailed)
- normalization of legacy search/website dicts into the API's Track shape
- public-Deezer-API browse helpers (charts, album, artist) needing no auth

All functions here are synchronous/blocking (network + crypto). Async routes
must call them via starlette.concurrency.run_in_threadpool.
"""
from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timedelta
from http import cookiejar
from typing import TYPE_CHECKING
from urllib.parse import quote_plus

import requests
from requests.adapters import HTTPAdapter

from ..config import DEEZER_ARL, DEEZER_PUBLIC_API, DEEZER_QUALITY
from . import deezer
from .deezer_rate_limit import (
    DeezerRateLimiter,
    RateLimitBudgetExceeded,
    parse_retry_after,
)
from .singleflight_cache import SingleFlightTtlCache
from .track_identity import dedupe_tracks, normalize_isrc

if TYPE_CHECKING:
    from ..schemas.track import Track


# --- error taxonomy -------------------------------------------------------
class DeezerClientError(Exception):
    """Base error for the Deezer adapter."""


class AuthExpired(DeezerClientError):
    """The ARL/session is no longer valid (Deezer 403)."""


class TrackUnavailable(DeezerClientError):
    """The requested track/resource was not found (Deezer 404)."""


class RateLimited(DeezerClientError):
    """Deezer signalled a rate limit / quota error."""

    def __init__(self, message: str = "", *, retry_after_sec: float | None = None):
        super().__init__(message)
        self.retry_after_sec = (
            float(retry_after_sec)
            if retry_after_sec is not None
            and math.isfinite(retry_after_sec)
            and retry_after_sec > 0
            else None
        )


class DecryptFailed(DeezerClientError):
    """Download succeeded but decryption/storage failed."""


def _rewrap_deezer_error(exc: DeezerClientError, context: str) -> DeezerClientError:
    """Add context to a DeezerClientError while preserving rate-limit metadata."""
    message = f"{context}: {exc}"
    if isinstance(exc, RateLimited):
        return RateLimited(message, retry_after_sec=exc.retry_after_sec)
    return type(exc)(message)


# --- session lifecycle ----------------------------------------------------
_HEALTH_TIMEOUT = (3, 5)


def init_session() -> None:
    """Initialize the global Deezer session from env config (call on startup)."""
    # Fail loud: an empty ARL means authenticated calls will silently break
    # later (the legacy fallback warns-and-continues). Surface it here instead.
    if not DEEZER_ARL:
        raise RuntimeError(
            "DEEZER_ARL is empty — check api/.env (a UTF-8 BOM on the first line "
            "or a missing DEEZER_ARL key will blank it)."
        )
    deezer.init_deezer_session(quality=DEEZER_QUALITY, arl=DEEZER_ARL)


def health() -> bool:
    """Validate account playback rights within the web proxy's deadline.

    A particular song's page availability does not determine account health.
    Keep provider failures visible instead of reporting an ambiguous False.
    """
    try:
        deezer.get_user_data(timeout=_HEALTH_TIMEOUT)
    except deezer.Deezer403Exception as exc:
        raise AuthExpired(str(exc)) from exc
    except deezer.DeezerApiException as exc:
        raise DeezerClientError(f"Deezer account health check failed: {exc}") from exc
    return True


# --- normalization --------------------------------------------------------
def _cover_from_picture(picture_id: str | None, size: str = "500x500") -> str:
    if not picture_id:
        return ""
    return f"https://e-cdns-images.dzcdn.net/images/cover/{picture_id}/{size}.jpg"


def _optional_float(*values: object) -> float | None:
    for value in values:
        if value in (None, ""):
            continue
        try:
            parsed = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if parsed == parsed and parsed not in (float("inf"), float("-inf")):
            return parsed
    return None


def _loudness_fields(item: dict) -> dict:
    """Extract ReplayGain/R128-style fields when an upstream payload has them.

    Deezer's public ``/track/{id}`` payload exposes lowercase ``gain`` (in dB),
    while private website payloads expose uppercase ``GAIN`` / ``REPLAYGAIN_*``.
    Preserve real values without inventing defaults so clients normalize
    consistently across the catalog.
    """
    return {
        "loudness_gain_db": _optional_float(
            item.get("loudness_gain_db"),
            item.get("replaygain_track_gain_db"),
            item.get("REPLAYGAIN_TRACK_GAIN"),
            item.get("GAIN"),
            item.get("gain"),
        ),
        "loudness_lufs": _optional_float(
            item.get("loudness_lufs"),
            item.get("integrated_loudness_lufs"),
        ),
        "loudness_peak": _optional_float(
            item.get("loudness_peak"),
            item.get("replaygain_track_peak"),
            item.get("REPLAYGAIN_TRACK_PEAK"),
        ),
    }


def _optional_bool(*values: object) -> bool | None:
    for value in values:
        if value is None or value == "":
            continue
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return bool(value)
        if isinstance(value, str):
            low = value.strip().lower()
            if low in ("1", "true", "yes"):
                return True
            if low in ("0", "false", "no"):
                return False
    return None


def _extra_track_fields(item: dict) -> dict:
    """Extract optional BPM and explicit-lyrics metadata when present."""
    raw_bpm = _optional_float(item.get("bpm"), item.get("BPM"))
    bpm = round(raw_bpm, 2) if raw_bpm is not None and raw_bpm > 0 else None
    explicit = _optional_bool(
        item.get("explicit"),
        item.get("explicit_lyrics"),
        item.get("EXPLICIT_LYRICS"),
    )
    return {
        "bpm": bpm,
        "explicit": explicit,
    }


def normalize_search_item(item: dict) -> dict:
    """Map a legacy ``deezer_search`` item (img_url/...) to the Track shape."""
    return {
        "id": str(item.get("id", "")),
        "title": item.get("title", "") or "",
        "artist": item.get("artist", "") or "",
        "artist_id": item.get("artist_id", "") or "",
        "album": item.get("album", "") or "",
        "album_id": item.get("album_id", "") or "",
        "cover": item.get("img_url", "") or "",
        "duration_sec": int(item.get("duration", 0) or 0),
        "preview_url": item.get("preview_url") or None,
        "isrc": normalize_isrc(item.get("isrc")),
        **_loudness_fields(item),
        **_extra_track_fields(item),
    }


def _artist_refs(t: dict, primary: dict) -> list[dict]:
    """Build the full performer list from a track's ``contributors``.

    Falls back to the single primary artist when no contributor list is present.
    """
    refs: list[dict] = []
    seen: set[str] = set()
    for c in t.get("contributors") or []:
        name = (c.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        refs.append({"id": str(c.get("id", "") or ""), "name": name})
    if not refs and primary.get("name"):
        refs.append(
            {"id": str(primary.get("id", "") or ""), "name": primary.get("name", "")}
        )
    return refs


def normalize_public_track(t: dict) -> dict:
    """Map a public Deezer API track object to the Track shape."""
    album = t.get("album") or {}
    artist = t.get("artist") or {}
    return {
        "id": str(t.get("id", "")),
        "title": t.get("title", "") or "",
        "artist": artist.get("name", "") or "",
        "artist_id": artist.get("id", "") or "",
        "artists": _artist_refs(t, artist),
        "album": album.get("title", "") or "",
        "album_id": album.get("id", "") or "",
        "cover": album.get("cover_medium")
        or album.get("cover_big")
        or album.get("cover")
        or t.get("cover_medium", "")
        or "",
        "duration_sec": int(t.get("duration", 0) or 0),
        "preview_url": t.get("preview") or None,
        "rank": int(t.get("rank", 0) or 0),
        "release_date": str(t.get("release_date") or ""),
        "isrc": normalize_isrc(t.get("isrc")),
        **_loudness_fields(t),
        **_extra_track_fields(t),
    }


def normalize_artist_summary(a: dict) -> dict:
    """Map a public Deezer API artist object to the ArtistSummary shape."""
    return {
        "id": str(a.get("id", "")),
        "name": a.get("name", "") or "",
        "picture": a.get("picture_medium")
        or a.get("picture_big")
        or a.get("picture", "")
        or "",
    }


def normalize_album_summary(a: dict) -> dict:
    """Map a public Deezer API album object to the AlbumSummary shape."""
    artist = a.get("artist") or {}
    return {
        "id": str(a.get("id", "")),
        "title": a.get("title", "") or "",
        "artist": artist.get("name", "") or "",
        "cover": a.get("cover_medium") or a.get("cover_big") or a.get("cover", "") or "",
        "release_date": a.get("release_date") or "",
    }


# --- authenticated operations (private gw / decryption) -------------------
def search_tracks(query: str) -> list[dict]:
    try:
        items = deezer.deezer_search(query, deezer.TYPE_TRACK)
    except deezer.Deezer403Exception as e:
        raise AuthExpired(str(e)) from e
    except deezer.Deezer404Exception as e:
        raise TrackUnavailable(str(e)) from e
    except deezer.DeezerApiException as e:
        raise DeezerClientError(str(e)) from e
    return [normalize_search_item(i) for i in items]


def track_metadata(deezer_id: str) -> dict:
    """Fetch a single track's metadata (private website gw)."""
    try:
        song = deezer.get_song_infos_from_deezer_website(deezer.TYPE_TRACK, deezer_id)
    except deezer.Deezer403Exception as e:
        raise AuthExpired(str(e)) from e
    except deezer.Deezer404Exception as e:
        raise TrackUnavailable(str(e)) from e
    except deezer.DeezerApiException as e:
        raise DeezerClientError(str(e)) from e
    # The legacy gw returns None (not an exception) for an unknown track or a
    # dead session — surface that clearly instead of crashing on ``None.get``.
    if not song:
        raise TrackUnavailable(
            f"Deezer returned no metadata for track {deezer_id} "
            "(unknown track id or expired ARL session)."
        )
    return {
        "id": str(song.get("SNG_ID", deezer_id)),
        "title": song.get("SNG_TITLE", "") or "",
        "artist": song.get("ART_NAME", "") or "",
        "artist_id": str(song.get("ART_ID", "") or ""),
        "album": song.get("ALB_TITLE", "") or "",
        "album_id": song.get("ALB_ID", "") or "",
        "cover": _cover_from_picture(song.get("ALB_PICTURE")),
        "duration_sec": int(song.get("DURATION", 0) or 0),
        "preview_url": None,
        "isrc": normalize_isrc(song.get("ISRC")),
        **_loudness_fields(song),
        **_extra_track_fields(song),
    }


def track_public(deezer_id: str) -> dict:
    """Fetch a single track's metadata via the **public** Deezer API (no ARL).

    Returns the normalized Track shape including ``artist_id``, ``album_id`` and
    the full ``artists`` credit list. Raises on any failure (no silent fallback).
    """
    return normalize_public_tracks([_public_get(f"/track/{deezer_id}")])[0]


# --- public Deezer API browse (no auth) -----------------------------------
_PUBLIC_HTTP_TIMEOUT = (3.05, 8.0)
_INTERACTIVE_SEARCH_RETRIES = 1
_INTERACTIVE_MAX_WAIT_SEC = 1.5
_BULK_DEFAULT_RETRIES = 3
_BULK_MAX_WAIT_SEC = 5.0
_PUBLIC_ACCESS_SCOPE = "public"


class _RejectAllCookies(cookiejar.DefaultCookiePolicy):
    """Prevent the anonymous public API session from storing or sending cookies."""

    def set_ok(self, cookie, request):  # type: ignore[override]
        return False

    def return_ok(self, cookie, request):  # type: ignore[override]
        return False


def _build_public_session() -> requests.Session:
    """Pooled keep-alive session dedicated to unauthenticated public Deezer reads."""
    sess = requests.Session()
    sess.cookies.set_policy(_RejectAllCookies())
    sess.headers.update(
        {
            "Accept": "application/json",
            "User-Agent": deezer.USER_AGENT,
        }
    )
    adapter = HTTPAdapter(pool_connections=16, pool_maxsize=32)
    sess.mount("https://", adapter)
    sess.mount("http://", adapter)
    return sess


_public_session = _build_public_session()
_public_rate_limiter = DeezerRateLimiter()


def reset_public_rate_limiter() -> None:
    """Reset the shared public Deezer pacer and cooldown window (tests/benchmarks)."""
    _public_rate_limiter.reset()


def _extract_retry_after(resp: object) -> float | None:
    headers = getattr(resp, "headers", None)
    if headers is None:
        return None
    getter = getattr(headers, "get", None)
    if not callable(getter):
        return None
    return parse_retry_after(getter("Retry-After"))


def _public_get(
    path: str,
    _retries: int | None = None,
    *,
    interactive: bool = False,
) -> dict:
    """GET the public Deezer API with shared pacing, cooldown, and Retry-After handling.

    Interactive search calls pass ``interactive=True`` so long rate limits fail
    fast and loudly with HTTP 429 + full ``Retry-After`` instead of stalling
    users or hammering Deezer. Bulk callers retain bounded retries while
    honoring the same shared cooldown window.
    """
    retries_left = (
        _retries
        if _retries is not None
        else (_INTERACTIVE_SEARCH_RETRIES if interactive else _BULK_DEFAULT_RETRIES)
    )
    max_wait_sec = _INTERACTIVE_MAX_WAIT_SEC if interactive else _BULK_MAX_WAIT_SEC
    next_acquire_wait = max_wait_sec

    while True:
        try:
            _public_rate_limiter.acquire(max_wait_sec=next_acquire_wait)
        except RateLimitBudgetExceeded as exc:
            raise RateLimited(
                f"Public Deezer API rate limited before {path}: {exc}",
                retry_after_sec=exc.retry_after_sec,
            ) from exc
        next_acquire_wait = max_wait_sec

        try:
            resp = _public_session.get(
                f"{DEEZER_PUBLIC_API}{path}",
                timeout=_PUBLIC_HTTP_TIMEOUT,
            )
        except requests.exceptions.RequestException as e:
            err_resp = getattr(e, "response", None)
            if err_resp is not None and getattr(err_resp, "status_code", None) == 429:
                delay = _public_rate_limiter.record_rate_limit(
                    _extract_retry_after(err_resp)
                )
                if retries_left > 0 and delay <= max_wait_sec:
                    retries_left -= 1
                    next_acquire_wait = max(max_wait_sec, delay + 0.25)
                    continue
                raise RateLimited(
                    f"Public Deezer API rate limit reached (HTTP 429) for {path}",
                    retry_after_sec=delay,
                ) from e
            raise DeezerClientError(f"Public Deezer API request failed: {e}") from e

        status_code = getattr(resp, "status_code", None)
        if status_code == 429:
            delay = _public_rate_limiter.record_rate_limit(_extract_retry_after(resp))
            if retries_left > 0 and delay <= max_wait_sec:
                retries_left -= 1
                next_acquire_wait = max(max_wait_sec, delay + 0.25)
                continue
            raise RateLimited(
                f"Public Deezer API rate limit reached (HTTP 429) for {path}",
                retry_after_sec=delay,
            )
        if status_code == 404:
            raise TrackUnavailable(f"Public Deezer API returned HTTP 404 for {path}")

        try:
            resp.raise_for_status()
            data = resp.json()
        except ValueError as e:
            raise DeezerClientError(
                f"Public Deezer API returned invalid JSON for {path}: {e}"
            ) from e
        except requests.exceptions.RequestException as e:
            raise DeezerClientError(f"Public Deezer API request failed: {e}") from e

        if not isinstance(data, dict):
            raise DeezerClientError(
                f"Public Deezer API returned {type(data).__name__} for {path}; expected an object"
            )
        if "error" in data:
            err = data["error"]
            if not isinstance(err, dict):
                raise DeezerClientError(
                    f"Public Deezer API returned an invalid error object for {path}: {err!r}"
                )
            code = err.get("code")
            if code == 4:  # rate limited / quota
                delay = _public_rate_limiter.record_rate_limit(
                    _extract_retry_after(resp)
                )
                if retries_left > 0 and delay <= max_wait_sec:
                    retries_left -= 1
                    next_acquire_wait = max(max_wait_sec, delay + 0.25)
                    continue
                raise RateLimited(str(err), retry_after_sec=delay)
            if code in (800, 300):
                raise TrackUnavailable(str(err))
            raise DeezerClientError(str(err))

        _public_rate_limiter.record_success()
        return data


_TRACK_ARTISTS_TTL_SEC = 24 * 3600
_TRACK_ARTISTS_CACHE_MAX = 4096
_track_artists_flights = SingleFlightTtlCache[str, list[dict]](
    ttl_seconds=_TRACK_ARTISTS_TTL_SEC,
    max_entries=_TRACK_ARTISTS_CACHE_MAX,
    max_inflight=512,
)
# Keep these aliases for focused tests and callers that clear the cache under
# its lock. In-flight entries are removed after both success and failure.
_track_artists_cache = _track_artists_flights.cache
_track_artists_lock = _track_artists_flights.lock

_track_isrc_flights = SingleFlightTtlCache[str, str](
    ttl_seconds=_TRACK_ARTISTS_TTL_SEC,
    max_entries=_TRACK_ARTISTS_CACHE_MAX,
    max_inflight=512,
)
_track_detail_meta_flights = SingleFlightTtlCache[str, dict](
    ttl_seconds=_TRACK_ARTISTS_TTL_SEC,
    max_entries=_TRACK_ARTISTS_CACHE_MAX,
    max_inflight=512,
)
_ALBUM_RECORD_TYPE_TTL_SEC = 7 * 24 * 3600
_album_record_type_flights = SingleFlightTtlCache[str, str](
    ttl_seconds=_ALBUM_RECORD_TYPE_TTL_SEC,
    max_entries=2048,
    max_inflight=64,
)


def _cache_track_detail_meta(
    track_id: str,
    detail: dict,
    *,
    authoritative_isrc: bool = True,
) -> None:
    """Persist gain, bpm, explicit, release_date, and ISRC from /track/{id}."""
    isrc = normalize_isrc(detail.get("isrc"))
    if isrc or authoritative_isrc:
        _track_isrc_flights.put(track_id, isrc)
    meta = {
        **_loudness_fields(detail),
        **_extra_track_fields(detail),
        "release_date": str(detail.get("release_date") or ""),
    }
    _track_detail_meta_flights.put(track_id, meta)


def enrich_track_from_cache(track: Track, *, track_id: str | None = None) -> Track:
    """Merge already-cached full credits, ISRC, and loudness onto ``track`` with 0 network calls."""
    tid = str(track_id or track.id or "").strip()
    if not tid:
        return track

    updates: dict[str, object] = {}
    if len(track.artists) <= 1:
        hit, cached_refs = _track_artists_flights.peek(tid)
        if hit and cached_refs and len(cached_refs) >= len(track.artists):
            from ..schemas.track import ArtistRef

            refs = [
                ArtistRef(id=str(ref.get("id", "") or ""), name=str(ref.get("name", "") or ""))
                for ref in cached_refs
                if isinstance(ref, dict) and ref.get("name")
            ]
            if refs:
                updates["artists"] = refs

    if not normalize_isrc(track.isrc):
        hit, cached_isrc = _track_isrc_flights.peek(tid)
        if hit and cached_isrc:
            updates["isrc"] = cached_isrc

    meta_hit, cached_meta = _track_detail_meta_flights.peek(tid)
    if meta_hit and isinstance(cached_meta, dict):
        for key in ("loudness_gain_db", "loudness_lufs", "loudness_peak", "bpm", "explicit"):
            if getattr(track, key) is None and cached_meta.get(key) is not None:
                updates[key] = cached_meta[key]
        if not track.release_date and cached_meta.get("release_date"):
            updates["release_date"] = cached_meta["release_date"]

    return track.model_copy(update=updates) if updates else track


def hydrate_track_for_persistence(track: Track, *, track_id: str | None = None) -> Track:
    """Hydrate a single Deezer track on demand before persisting it to Likes/Playlists.

    - Reuses cached credits/ISRC/loudness immediately when warm (0 upstream calls).
    - When a cold single-artist search hit (``len(artists) <= 1``) is persisted
      directly without an intermediate detail fetch, loads ONLY that one track
      via singleflight ``_full_public_artist_refs(tid)`` so guest/featured
      performer credits are preserved permanently.
    - Withdrawn catalog entries (``TrackUnavailable``) keep the supplied track
      metadata; rate limits and other provider failures raise loudly.
    """
    enriched = enrich_track_from_cache(track, track_id=track_id)
    tid = str(track_id or enriched.id or "").strip()
    if not tid or not tid.isdigit() or len(enriched.artists) > 1:
        return enriched
    hit, _cached_refs = _track_artists_flights.peek(tid)
    if hit:
        return enriched
    try:
        refs = _full_public_artist_refs(tid)
    except TrackUnavailable:
        return enriched
    # Merge directly in case ``_full_public_artist_refs`` was mocked without
    # populating ``_track_artists_flights``, and still pick up any cached meta.
    hydrated = enrich_track_from_cache(enriched, track_id=tid)
    if len(hydrated.artists) <= 1 and refs:
        from ..schemas.track import ArtistRef

        parsed_refs = [
            ArtistRef(id=str(ref.get("id", "") or ""), name=str(ref.get("name", "") or ""))
            for ref in refs
            if isinstance(ref, dict) and ref.get("name")
        ]
        if parsed_refs:
            hydrated = hydrated.model_copy(update={"artists": parsed_refs})
    return hydrated


def _validated_track_detail(track_id: str, *, context: str) -> dict:
    try:
        detail = _public_get(f"/track/{track_id}")
    except DeezerClientError as e:
        raise _rewrap_deezer_error(e, context) from e

    if not isinstance(detail, dict):
        raise DeezerClientError(
            f"{context}: Deezer returned {type(detail).__name__}; expected an object"
        )
    returned_id = str(detail.get("id", "") or "")
    if returned_id != track_id:
        raise DeezerClientError(
            f"{context}: Deezer returned track {returned_id or '<missing>'}"
        )
    return detail


def _full_public_artist_refs(track_id: str) -> list[dict]:
    """Load and cache the authoritative performer credits for one track.

    Deezer's collection endpoints (including ``/search``) omit
    ``contributors`` even for collaborations. Only ``/track/{id}`` reliably
    contains the complete ordered credit list, so accepting the collection
    item's primary artist here would silently lose data.
    """
    def load() -> list[dict]:
        detail = _validated_track_detail(
            track_id,
            context=f"Could not load complete artist credits for track {track_id}",
        )
        contributors = detail.get("contributors")
        if contributors is not None and (
            not isinstance(contributors, list)
            or any(not isinstance(contributor, dict) for contributor in contributors)
        ):
            raise DeezerClientError(
                f"Deezer track {track_id} has an invalid contributor list"
            )
        refs = _artist_refs(detail, {})
        if not refs:
            raise DeezerClientError(
                f"Deezer track {track_id} has no contributor list; "
                "complete artist credits cannot be determined"
            )
        _cache_track_detail_meta(track_id, detail)
        return refs

    return _track_artists_flights.get(track_id, load)


def track_isrc(track_id: str) -> str:
    """Load and cache the normalized ISRC for one track (``""`` if Deezer has none)."""
    tid = str(track_id or "").strip()
    if not tid or not tid.isdigit():
        return ""

    def load() -> str:
        detail = _validated_track_detail(
            tid,
            context=f"Could not load ISRC for track {tid}",
        )
        refs = _artist_refs(detail, {})
        if refs:
            _track_artists_flights.put(tid, refs)
        _cache_track_detail_meta(tid, detail)
        return normalize_isrc(detail.get("isrc"))

    return _track_isrc_flights.get(tid, load)


def album_record_type(album_id: str) -> str:
    """Return Deezer's album ``record_type`` (``album``/``ep``/``single``/``compile``)."""
    aid = str(album_id or "").strip()
    if not aid or not aid.isdigit():
        return ""

    def load() -> str:
        try:
            detail = _public_get(f"/album/{aid}")
        except DeezerClientError as e:
            raise _rewrap_deezer_error(
                e, f"Could not load release type for album {aid}"
            ) from e
        if not isinstance(detail, dict):
            raise DeezerClientError(
                f"Could not load release type for album {aid}: "
                f"Deezer returned {type(detail).__name__}; expected an object"
            )
        return str(detail.get("record_type") or "").strip().lower()

    return _album_record_type_flights.get(aid, load)


def _peek_album_record_type(album_id: str) -> str:
    """Return cached album ``record_type`` without contacting Deezer."""
    aid = str(album_id or "").strip()
    if not aid or not aid.isdigit():
        return ""
    hit, record_type = _album_record_type_flights.peek(aid)
    return record_type if hit and record_type else ""


def dedupe_public_tracks(
    tracks: list[dict],
    *,
    preserve_fields: tuple[str, ...] = (),
    fetch_record_types: bool = True,
) -> list[dict]:
    """Merge duplicate recordings across Singles/EPs/Albums (Album > EP > Single).

    When ``fetch_record_types`` is False (fast search path), uses only already
    cached album ``record_type`` values and falls back to Deezer popularity
    ``rank`` without blocking on ``/album/{id}`` requests.
    """
    return dedupe_tracks(
        tracks,
        resolve_record_type=album_record_type if fetch_record_types else _peek_album_record_type,
        preserve_fields=preserve_fields,
    )


def normalize_public_tracks(
    items: list[dict],
    *,
    require_isrc: bool = False,
    enrich_missing_details: bool = True,
) -> list[dict]:
    """Normalize track summaries while preserving performer credits and metadata.

    Inline ``contributors`` and already-cached per-track credits/metadata are
    always reused with zero extra upstream requests. When
    ``enrich_missing_details`` is True (detail/browse/discovery/import paths),
    tracks missing ``contributors`` (or ``isrc`` when ``require_isrc=True``)
    are enriched concurrently from ``/track/{id}`` and errors abort loudly.
    When ``enrich_missing_details`` is False (interactive ``/search`` path),
    no secondary ``/track/{id}`` requests are fired; tracks use their primary
    artist plus any already-cached full credits/metadata.
    """
    if not items:
        return []

    inline_refs: dict[str, list[dict]] = {}
    inline_isrcs: dict[str, str] = {}
    missing_ids: list[str] = []
    seen_missing: set[str] = set()
    missing_isrc_ids: list[str] = []
    seen_missing_isrc: set[str] = set()

    for item in items:
        if not isinstance(item, dict):
            raise DeezerClientError(
                f"Cannot normalize public track list: expected object, got {type(item).__name__}"
            )
        track_id = str(item.get("id", "") or "")
        if not track_id:
            raise DeezerClientError(
                "Cannot normalize public track list: an item has no track id"
            )
        raw_artist = item.get("artist")
        if raw_artist is not None and not isinstance(raw_artist, dict):
            raise DeezerClientError(
                f"Deezer track {track_id} has an invalid artist object"
            )
        raw_album = item.get("album")
        if raw_album is not None and not isinstance(raw_album, dict):
            raise DeezerClientError(
                f"Deezer track {track_id} has an invalid album object"
            )
        contributors = item.get("contributors")
        if contributors is not None and (
            not isinstance(contributors, list)
            or any(not isinstance(contributor, dict) for contributor in contributors)
        ):
            raise DeezerClientError(
                f"Deezer track {track_id} has an invalid contributor list"
            )

        isrc = normalize_isrc(item.get("isrc"))
        if isrc:
            inline_isrcs[track_id] = isrc
            _track_isrc_flights.put(track_id, isrc)

        refs = _artist_refs(item, {})
        if refs:
            inline_refs[track_id] = refs
            _track_artists_flights.put(track_id, refs)
            if any(
                item.get(field) not in (None, "")
                for field in (
                    "gain",
                    "GAIN",
                    "loudness_gain_db",
                    "bpm",
                    "BPM",
                    "release_date",
                )
            ):
                _cache_track_detail_meta(
                    track_id, item, authoritative_isrc=bool(isrc)
                )
            if (
                enrich_missing_details
                and require_isrc
                and not isrc
                and track_id not in seen_missing_isrc
            ):
                hit, cached_isrc = _track_isrc_flights.peek(track_id)
                if hit and cached_isrc is not None:
                    inline_isrcs[track_id] = cached_isrc
                else:
                    seen_missing_isrc.add(track_id)
                    missing_isrc_ids.append(track_id)
        else:
            hit, cached_refs = _track_artists_flights.peek(track_id)
            if hit and cached_refs:
                inline_refs[track_id] = cached_refs
                if (
                    enrich_missing_details
                    and require_isrc
                    and not isrc
                    and track_id not in seen_missing_isrc
                ):
                    isrc_hit, cached_isrc = _track_isrc_flights.peek(track_id)
                    if isrc_hit and cached_isrc is not None:
                        inline_isrcs[track_id] = cached_isrc
                    else:
                        seen_missing_isrc.add(track_id)
                        missing_isrc_ids.append(track_id)
            elif enrich_missing_details and track_id not in seen_missing:
                seen_missing.add(track_id)
                missing_ids.append(track_id)

    fetched_refs: dict[str, list[dict]] = {}
    if missing_ids:
        worker_count = min(8, len(missing_ids))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            for track_id, refs in zip(
                missing_ids,
                pool.map(_full_public_artist_refs, missing_ids),
                strict=True,
            ):
                fetched_refs[track_id] = refs

    fetched_isrcs: dict[str, str] = {}
    if missing_isrc_ids:
        worker_count = min(8, len(missing_isrc_ids))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            for track_id, isrc in zip(
                missing_isrc_ids,
                pool.map(track_isrc, missing_isrc_ids),
                strict=True,
            ):
                fetched_isrcs[track_id] = isrc

    normalized: list[dict] = []
    for item in items:
        track_id = str(item["id"])
        enriched = dict(item)
        resolved_refs = inline_refs.get(track_id) or fetched_refs.get(track_id)
        if resolved_refs:
            enriched["contributors"] = resolved_refs
        resolved_isrc = inline_isrcs.get(track_id) or fetched_isrcs.get(track_id, "")
        if not resolved_isrc:
            hit, cached_isrc = _track_isrc_flights.peek(track_id)
            if hit and cached_isrc:
                resolved_isrc = cached_isrc
        if resolved_isrc:
            enriched["isrc"] = resolved_isrc
        meta_hit, cached_meta = _track_detail_meta_flights.peek(track_id)
        if meta_hit and isinstance(cached_meta, dict):
            for key in (
                "loudness_gain_db",
                "loudness_lufs",
                "loudness_peak",
                "bpm",
                "explicit",
            ):
                if enriched.get(key) is None and cached_meta.get(key) is not None:
                    enriched[key] = cached_meta[key]
            if not enriched.get("release_date") and cached_meta.get("release_date"):
                enriched["release_date"] = cached_meta["release_date"]
        normalized.append(normalize_public_track(enriched))
    return normalized


_SEARCH_CACHE_TTL_SEC = 60
_SEARCH_CACHE_MAX_ENTRIES = 512
_SEARCH_CACHE_MAX_INFLIGHT = 64
# Keep alias for existing tests that inspect the track search TTL constant.
_SEARCH_TRACKS_TTL_SEC = _SEARCH_CACHE_TTL_SEC

SearchCacheKey = tuple[str, str, str, int, bool]

_search_tracks_flights = SingleFlightTtlCache[SearchCacheKey, list[dict]](
    ttl_seconds=_SEARCH_CACHE_TTL_SEC,
    max_entries=_SEARCH_CACHE_MAX_ENTRIES,
    max_inflight=_SEARCH_CACHE_MAX_INFLIGHT,
)
_search_albums_flights = SingleFlightTtlCache[SearchCacheKey, list[dict]](
    ttl_seconds=_SEARCH_CACHE_TTL_SEC,
    max_entries=_SEARCH_CACHE_MAX_ENTRIES,
    max_inflight=_SEARCH_CACHE_MAX_INFLIGHT,
)
_search_artists_flights = SingleFlightTtlCache[SearchCacheKey, list[dict]](
    ttl_seconds=_SEARCH_CACHE_TTL_SEC,
    max_entries=_SEARCH_CACHE_MAX_ENTRIES,
    max_inflight=_SEARCH_CACHE_MAX_INFLIGHT,
)
_search_playlists_flights = SingleFlightTtlCache[SearchCacheKey, list[dict]](
    ttl_seconds=_SEARCH_CACHE_TTL_SEC,
    max_entries=_SEARCH_CACHE_MAX_ENTRIES,
    max_inflight=_SEARCH_CACHE_MAX_INFLIGHT,
)


def clear_search_caches() -> None:
    """Clear all public catalog search caches (tests/benchmarks)."""
    for flights in (
        _search_tracks_flights,
        _search_albums_flights,
        _search_artists_flights,
        _search_playlists_flights,
    ):
        with flights.lock:
            flights.cache.clear()


def _search_cache_key(
    *,
    entity: str,
    query: str,
    limit: int,
    enrich: bool = False,
) -> SearchCacheKey:
    """Build a boundary-safe cache key over active public-search dimensions.

    Uses outer trim only (preserving case and internal whitespace) and encodes
    the anonymous ``public`` access scope, catalog entity, upstream limit, and
    enrichment mode so distinct boundaries never collide.
    """
    return (
        _PUBLIC_ACCESS_SCOPE,
        entity,
        query.strip(),
        limit,
        bool(enrich),
    )


def search_tracks_public(
    query: str,
    limit: int = 40,
    *,
    enrich: bool = False,
) -> list[dict]:
    """Track search over the public Deezer API with singleflight & boundary-safe caching.

    By default (``enrich=False``), issues a single ``/search`` call and reuses
    any already-cached per-track credits/metadata and album release types with
    zero blocking N+1 requests. Callers needing authoritative full credits
    (imports, recommendations) pass ``enrich=True`` explicitly.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError(f"search track limit must be between 1 and 100, got {limit}")
    trimmed = query.strip()
    if not trimmed:
        return []
    key = _search_cache_key(
        entity="track",
        query=trimmed,
        limit=limit,
        enrich=enrich,
    )

    def load() -> list[dict]:
        data = _public_get(
            f"/search?q={quote_plus(trimmed)}&limit={limit}",
            interactive=not enrich,
        )
        items = data.get("data")
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise DeezerClientError(
                f"Public Deezer track search returned invalid data for query {trimmed!r}"
            )
        normalized = normalize_public_tracks(
            items, enrich_missing_details=enrich
        )
        return dedupe_public_tracks(
            normalized, fetch_record_types=enrich
        )

    return deepcopy(_search_tracks_flights.get(key, load))


def _search_items(query: str, entity: str, *, limit: int) -> list[dict]:
    data = _public_get(
        f"/search/{entity}?q={quote_plus(query)}&limit={limit}",
        interactive=True,
    )
    items = data.get("data")
    context = f"Public Deezer {entity} search"
    if not isinstance(items, list):
        raise DeezerClientError(f"{context}: data must be an array")
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            raise DeezerClientError(f"{context}: data[{idx}] must be an object")
    return items


def _search_id(item: dict, context: str) -> str:
    value = item.get("id")
    if isinstance(value, bool) or not (
        isinstance(value, int) and 0 < value <= 2**53 - 1
        or isinstance(value, str) and value.isascii() and value.isdigit() and bool(value.lstrip("0"))
    ):
        raise DeezerClientError(
            f"{context}: id must be a positive numeric identifier; numeric IDs must be safe for JavaScript clients"
        )
    return str(value)


def _search_text(item: dict, field: str, context: str) -> str:
    value = item.get(field)
    if not isinstance(value, str) or not value.strip():
        raise DeezerClientError(f"{context}: {field} must be nonempty text")
    return value


def _search_artwork(item: dict, prefix: str, context: str) -> str:
    fields = (f"{prefix}_medium", f"{prefix}_big", prefix)
    for field in fields:
        value = item.get(field)
        if value is not None and not isinstance(value, str):
            raise DeezerClientError(f"{context}: {field} must be text or null")
    # Artwork is optional in provider results. A supplied malformed value must
    # still fail even when a different resolution happens to be available.
    return next((item[field] for field in fields if item.get(field)), "")


def search_albums(query: str) -> list[dict]:
    """Public album search, retaining the catalog's existing Track projection."""
    trimmed = query.strip()
    if not trimmed:
        return []
    key = _search_cache_key(entity="album", query=trimmed, limit=25)

    def load() -> list[dict]:
        out = []
        for idx, item in enumerate(_search_items(trimmed, "album", limit=25)):
            context = f"Public Deezer album search: data[{idx}]"
            album_id = _search_id(item, context)
            title = _search_text(item, "title", context)
            artist = item.get("artist")
            if not isinstance(artist, dict):
                raise DeezerClientError(f"{context}: artist must be an object")
            record_type = item.get("record_type")
            if isinstance(record_type, str) and record_type.strip():
                _album_record_type_flights.put(album_id, record_type.strip().lower())
            out.append({
                "id": album_id,
                "title": title,
                "artist": _search_text(artist, "name", f"{context}.artist"),
                "album": title,
                "album_id": item["id"],
                "cover": _search_artwork(item, "cover", context),
                "duration_sec": 0,
                "preview_url": None,
            })
        return out

    return deepcopy(_search_albums_flights.get(key, load))


def search_artists(query: str) -> list[dict]:
    trimmed = query.strip()
    if not trimmed:
        return []
    key = _search_cache_key(entity="artist", query=trimmed, limit=24)

    def load() -> list[dict]:
        out = []
        for idx, item in enumerate(_search_items(trimmed, "artist", limit=24)):
            context = f"Public Deezer artist search: data[{idx}]"
            out.append({
                "id": _search_id(item, context),
                "name": _search_text(item, "name", context),
                "picture": _search_artwork(item, "picture", context),
            })
        return out

    return deepcopy(_search_artists_flights.get(key, load))


def search_playlists(query: str) -> list[dict]:
    trimmed = query.strip()
    if not trimmed:
        return []
    key = _search_cache_key(entity="playlist", query=trimmed, limit=24)

    def load() -> list[dict]:
        out = []
        for idx, item in enumerate(_search_items(trimmed, "playlist", limit=24)):
            context = f"Public Deezer playlist search: data[{idx}]"
            count = item.get("nb_tracks")
            if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 2**53 - 1:
                raise DeezerClientError(
                    f"{context}: nb_tracks must be a nonnegative integer safe for JavaScript clients"
                )
            out.append({
                "id": _search_id(item, context),
                "title": _search_text(item, "title", context),
                "cover": _search_artwork(item, "picture", context),
                "track_count": count,
            })
        return out

    return deepcopy(_search_playlists_flights.get(key, load))


def charts() -> list[dict]:
    data = _public_get("/chart")
    tracks = (data.get("tracks") or {}).get("data") or []
    return dedupe_public_tracks(normalize_public_tracks(tracks))


def genres() -> list[dict]:
    data = _public_get("/genre")
    items = data.get("data") or []
    out = []
    for g in items:
        gid = str(g.get("id", ""))
        if gid == "0":  # "All" pseudo-genre
            continue
        out.append(
            {
                "id": gid,
                "name": g.get("name", "") or "",
                "picture": g.get("picture_medium")
                or g.get("picture_big")
                or g.get("picture", "")
                or "",
            }
        )
    return out


# Deezer's ``/editorial/{id}/releases`` feed answers ``{"data": [], "total": 0}``
# for every editorial (verified 2026-11-18), so new releases are assembled from
# the staff-picked ``/editorial/{id}/selection`` lists. Those lists carry no
# ``release_date`` and mix this week's picks with years-old ones, so every
# candidate's date is looked up and only recent releases are returned.
_NEW_RELEASES_LIMIT = 24
# Same notion of "recent" as the Release Radar cutoff in routers/home.py.
_NEW_RELEASES_MAX_AGE_DAYS = 90
# (editorial id, picks taken from the top of its selection). "0" is the
# all-genres editorial; the rest are Pop, Rap/Hip Hop, Rock, Dance, R&B,
# Alternative, Electro, Folk, Country, Heavy Metal and Latin: the genre
# editorials whose leading picks were recent when the feed was chosen. Fresh
# picks sit at the top of a list, and the small per-genre depth keeps a cold
# load near Deezer's quota of 50 requests per 5 seconds (12 lists + <= 43 dates).
_NEW_RELEASES_SOURCES: tuple[tuple[str, int], ...] = (
    ("0", 10),
    ("132", 3),
    ("116", 3),
    ("152", 3),
    ("113", 3),
    ("165", 3),
    ("85", 3),
    ("106", 3),
    ("466", 3),
    ("84", 3),
    ("464", 3),
    ("197", 3),
)
_NEW_RELEASES_TTL_SEC = 3600
_new_releases_flights = SingleFlightTtlCache[str, list[dict]](
    ttl_seconds=_NEW_RELEASES_TTL_SEC,
    max_entries=1,
    max_inflight=1,
)
# A published album's release date does not change, so hourly refreshes of the
# merged list only look up picks that are new since the previous refresh.
_ALBUM_RELEASE_DATE_TTL_SEC = 7 * 24 * 3600
_album_release_date_flights = SingleFlightTtlCache[str, date](
    ttl_seconds=_ALBUM_RELEASE_DATE_TTL_SEC,
    max_entries=512,
    max_inflight=64,
)


def _editorial_selection_path(editorial_id: str) -> str:
    return f"/editorial/{editorial_id}/selection"


def _editorial_selection(source: tuple[str, int]) -> list[tuple[str, dict]]:
    """The leading ``(album id, album)`` picks of one editorial selection."""
    editorial_id, limit = source
    path = _editorial_selection_path(editorial_id)
    items = _public_get(path).get("data")
    context = f"Public Deezer editorial selection {path}"
    if not isinstance(items, list):
        raise DeezerClientError(
            f"{context}: data must be an array, got {type(items).__name__}"
        )
    picks: list[tuple[str, dict]] = []
    for index, item in enumerate(items[:limit]):
        item_context = f"{context}: data[{index}]"
        if not isinstance(item, dict):
            raise DeezerClientError(f"{item_context} must be an object")
        album_id = _search_id(item, item_context)
        _search_text(item, "title", item_context)
        artist = item.get("artist")
        if not isinstance(artist, dict):
            raise DeezerClientError(f"{item_context}: artist must be an object")
        _search_text(artist, "name", f"{item_context}.artist")
        picks.append((album_id, item))
    return picks


def _album_release_date(album_id: str) -> date:
    """Release date of one album, cached because selections do not include it."""
    def load() -> date:
        try:
            detail = _public_get(f"/album/{album_id}")
        except TrackUnavailable as e:
            # A missing album must not surface as "new releases not found".
            raise DeezerClientError(
                f"Could not load the release date of editorial pick album {album_id}: "
                f"Deezer no longer has the album ({e})"
            ) from e
        except DeezerClientError as e:
            raise _rewrap_deezer_error(
                e, f"Could not load the release date of editorial pick album {album_id}"
            ) from e
        if detail.get("record_type"):
            _album_record_type_flights.put(
                str(album_id), str(detail["record_type"]).strip().lower()
            )
        value = detail.get("release_date")
        if isinstance(value, str):
            try:
                return datetime.strptime(value, "%Y-%m-%d").date()
            except ValueError:
                pass
        raise DeezerClientError(
            f"Deezer album {album_id} has an invalid release_date {value!r}; "
            "expected YYYY-MM-DD"
        )

    return _album_release_date_flights.get(album_id, load)


def _load_new_releases() -> list[dict]:
    with ThreadPoolExecutor(max_workers=4) as pool:
        selections = list(pool.map(_editorial_selection, _NEW_RELEASES_SOURCES))
    picks: dict[str, dict] = {}
    for selection in selections:
        for album_id, item in selection:
            picks.setdefault(album_id, item)
    sources = ", ".join(
        _editorial_selection_path(editorial_id)
        for editorial_id, _limit in _NEW_RELEASES_SOURCES
    )
    if not picks:
        raise DeezerClientError(
            "Deezer returned no editorial picks from any new-release source "
            f"({sources}); the feed may have been retired"
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        released = list(pool.map(_album_release_date, picks))
    oldest = date.today() - timedelta(days=_NEW_RELEASES_MAX_AGE_DAYS)
    recent = [
        (released_on, item)
        for released_on, item in zip(released, picks.values(), strict=True)
        if released_on >= oldest
    ]
    if not recent:
        raise DeezerClientError(
            f"None of the {len(picks)} Deezer editorial picks was released in the "
            f"last {_NEW_RELEASES_MAX_AGE_DAYS} days (newest: {max(released).isoformat()}; "
            f"sources: {sources}); the feed appears to be stale"
        )
    # Stable sort: picks released on the same day keep their source order.
    recent.sort(key=lambda entry: entry[0], reverse=True)
    return [
        normalize_album_summary({**item, "release_date": released_on.isoformat()})
        for released_on, item in recent[:_NEW_RELEASES_LIMIT]
    ]


def new_releases() -> list[dict]:
    """Up to 24 staff-picked albums of the last 90 days, newest first.

    Merges the leading picks of several editorial selections, drops duplicate
    albums, and adds each album's release date. A malformed list, an album
    without a valid date, and a merge without any recent release all raise
    instead of producing an empty section.
    """
    return deepcopy(_new_releases_flights.get("editorial-selections", _load_new_releases))


def genre_detail(genre_id: str) -> dict:
    info = _public_get(f"/genre/{genre_id}")
    try:
        chart = _public_get(f"/chart/{genre_id}")
    except DeezerClientError:
        chart = {}
    tracks = (chart.get("tracks") or {}).get("data") or []
    albums = (chart.get("albums") or {}).get("data") or []
    artists = (chart.get("artists") or {}).get("data") or []
    return {
        "id": str(info.get("id", genre_id)),
        "name": info.get("name", "") or "",
        "picture": info.get("picture_medium")
        or info.get("picture_big")
        or info.get("picture", "")
        or "",
        "tracks": dedupe_public_tracks(normalize_public_tracks(tracks)),
        "albums": [normalize_album_summary(a) for a in albums],
        "artists": [normalize_artist_summary(a) for a in artists],
    }


# Per-artist release lists change rarely; cache them in-process for 24h so
# the release-radar fan-out (one call per followed/top artist) doesn't hammer
# the public API on every home-page load.
_ARTIST_ALBUMS_TTL_SEC = 24 * 3600
_artist_albums_cache: dict[str, tuple[float, list[dict]]] = {}
_artist_albums_lock = threading.Lock()


def artist_albums(artist_id: str, *, refresh: bool = False) -> list[dict]:
    """An artist's releases as AlbumSummary dicts, cached for 24h.

    ``refresh=True`` bypasses a cached value and replaces it with a fresh
    response. Release Radar uses this only for an explicit user refresh.
    """
    now = time.monotonic()
    with _artist_albums_lock:
        hit = _artist_albums_cache.get(artist_id)
        if (
            not refresh
            and hit is not None
            and now - hit[0] < _ARTIST_ALBUMS_TTL_SEC
        ):
            return hit[1]
    data = _public_get(f"/artist/{artist_id}/albums?limit=50")
    albums = [normalize_album_summary(a) for a in (data.get("data") or [])]
    with _artist_albums_lock:
        _artist_albums_cache[artist_id] = (now, albums)
    return albums


def related_artists(artist_id: str) -> list[dict]:
    data = _public_get(f"/artist/{artist_id}/related?limit=12")
    items = data.get("data") or []
    return [normalize_artist_summary(a) for a in items]


def track_by_isrc(isrc: str) -> dict | None:
    """Resolve a playable Deezer track by ISRC (exact cross-catalog match).

    None when Deezer has no track for the ISRC, or only a withdrawn one
    (``readable: false``, e.g. a dead compilation entry that 404s on
    download). Any other upstream failure raises.
    """
    if not isrc:
        return None
    try:
        data = _public_get(f"/track/isrc:{isrc}")
    except TrackUnavailable:
        return None
    if not data.get("id"):
        raise DeezerClientError(f"Deezer ISRC lookup {isrc} returned a track without id")
    readable = data.get("readable")
    if not isinstance(readable, bool):
        raise DeezerClientError(
            f"Deezer ISRC lookup {isrc} (track {data['id']}) returned no boolean "
            f"'readable' flag: {readable!r}"
        )
    if not readable:
        return None
    return normalize_public_tracks([data])[0]


def match_track(title: str, artist: str, isrc: str = "") -> dict | None:
    """Map external metadata to a playable Deezer track.

    Prefers an exact, playable ISRC match; falls back to a text search on
    artist+title (Deezer's public search only lists playable tracks). Upstream
    failures raise so the caller can report them instead of a silent no-hit.
    """
    hit = track_by_isrc(isrc)
    if hit:
        return hit
    query = f"{artist} {title}".strip()
    if not query:
        return None
    results = search_tracks_public(query, limit=1, enrich=True)
    return results[0] if results else None


def _album_genres(data: dict, album_id: str) -> list[dict]:
    """Genres from a public /album object, validated: Deezer always sends a
    ``genres`` object (``{"data": []}`` when the album has none)."""
    genres = data.get("genres")
    if not isinstance(genres, dict) or not isinstance(genres.get("data"), list):
        raise DeezerClientError(
            f"Album {album_id} has no valid genres object: {genres!r}"
        )
    parsed = []
    for index, genre in enumerate(genres["data"]):
        if not isinstance(genre, dict) or genre.get("id") in (None, "") or not genre.get("name"):
            raise DeezerClientError(
                f"Album {album_id} has an invalid genre at index {index}: {genre!r}"
            )
        parsed.append({"id": str(genre["id"]), "name": str(genre["name"])})
    return parsed


def album_detail(album_id: str, *, track_limit: int | None = None) -> dict:
    if track_limit is not None and track_limit < 1:
        raise ValueError("Album track_limit must be positive")
    data = _public_get(f"/album/{album_id}")
    if data.get("record_type"):
        _album_record_type_flights.put(
            str(data.get("id") or album_id),
            str(data["record_type"]).strip().lower(),
        )
    artist = data.get("artist") or {}
    tracks = (data.get("tracks") or {}).get("data") or []
    if track_limit is not None:
        tracks = tracks[:track_limit]
    norm_tracks = []
    for t in tracks:
        # album/{id} track items omit the album object; inject it.
        t.setdefault("album", {})
        t["album"].setdefault("id", data.get("id"))
        t["album"].setdefault("title", data.get("title"))
        t["album"].setdefault("cover_medium", data.get("cover_medium"))
        norm_tracks.append(t)
    norm_tracks = normalize_public_tracks(norm_tracks)
    return {
        "id": str(data.get("id", album_id)),
        "title": data.get("title", "") or "",
        "artist": artist.get("name", "") or "",
        "artist_id": str(artist.get("id", "") or ""),
        "cover": data.get("cover_medium") or data.get("cover_big") or data.get("cover", "") or "",
        "release_date": data.get("release_date") or "",
        "nb_tracks": int(data.get("nb_tracks", len(norm_tracks)) or 0),
        "genres": _album_genres(data, album_id),
        "tracks": norm_tracks,
    }


def playlist_detail(playlist_id: str) -> dict:
    data = _public_get(f"/playlist/{playlist_id}")
    tracks = (data.get("tracks") or {}).get("data") or []
    return {
        "id": str(data.get("id", playlist_id)),
        "name": data.get("title", "") or "",
        "cover": data.get("picture_medium")
        or data.get("picture_big")
        or data.get("picture", "")
        or "",
        "tracks": normalize_public_tracks(tracks),
    }


def artist_detail(artist_id: str) -> dict:
    data = _public_get(f"/artist/{artist_id}")
    top_data = _public_get(f"/artist/{artist_id}/top?limit=25")
    tracks = top_data.get("data") or []
    try:
        albums_data = _public_get(f"/artist/{artist_id}/albums?limit=24")
        albums = [normalize_album_summary(a) for a in (albums_data.get("data") or [])]
    except DeezerClientError:
        albums = []
    try:
        related = related_artists(artist_id)
    except DeezerClientError:
        related = []
    return {
        "id": str(data.get("id", artist_id)),
        "name": data.get("name", "") or "",
        "picture": data.get("picture_medium")
        or data.get("picture_big")
        or data.get("picture", "")
        or "",
        "fans": data.get("nb_fan", 0) or 0,
        "albums_count": data.get("nb_album", 0) or 0,
        "top": dedupe_public_tracks(normalize_public_tracks(tracks, require_isrc=True)),
        "albums": albums,
        "related": related,
    }
