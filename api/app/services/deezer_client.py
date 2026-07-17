"""Adapter around the legacy MelodAI ``deezer.py`` module.

Provides:
- a small error taxonomy (AuthExpired, TrackUnavailable, RateLimited, DecryptFailed)
- normalization of legacy search/website dicts into the API's Track shape
- public-Deezer-API browse helpers (charts, album, artist) needing no auth

All functions here are synchronous/blocking (network + crypto). Async routes
must call them via starlette.concurrency.run_in_threadpool.
"""
from __future__ import annotations

import threading
import time
from urllib.parse import quote_plus

import requests

from ..config import DEEZER_ARL, DEEZER_PUBLIC_API, DEEZER_QUALITY
from . import deezer


# --- error taxonomy -------------------------------------------------------
class DeezerClientError(Exception):
    """Base error for the Deezer adapter."""


class AuthExpired(DeezerClientError):
    """The ARL/session is no longer valid (Deezer 403)."""


class TrackUnavailable(DeezerClientError):
    """The requested track/resource was not found (Deezer 404)."""


class RateLimited(DeezerClientError):
    """Deezer signalled a rate limit / quota error."""


class DecryptFailed(DeezerClientError):
    """Download succeeded but decryption/storage failed."""


# --- session lifecycle ----------------------------------------------------
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
    """Return True if the Deezer login (ARL) still works."""
    try:
        return bool(deezer.test_deezer_login())
    except Exception:  # noqa: BLE001 — health must never raise
        return False


# --- normalization --------------------------------------------------------
def _cover_from_picture(picture_id: str | None, size: str = "500x500") -> str:
    if not picture_id:
        return ""
    return f"https://e-cdns-images.dzcdn.net/images/cover/{picture_id}/{size}.jpg"


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


def search_albums(query: str) -> list[dict]:
    try:
        items = deezer.deezer_search(query, deezer.TYPE_ALBUM)
    except deezer.DeezerApiException as e:
        raise DeezerClientError(str(e)) from e
    out = []
    for i in items:
        out.append(
            {
                "id": str(i.get("album_id", i.get("id", ""))),
                "title": i.get("album", "") or "",
                "artist": i.get("artist", "") or "",
                "album": i.get("album", "") or "",
                "album_id": i.get("album_id", "") or "",
                "cover": i.get("img_url", "") or "",
                "duration_sec": 0,
                "preview_url": None,
            }
        )
    return out


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
    }


def track_public(deezer_id: str) -> dict:
    """Fetch a single track's metadata via the **public** Deezer API (no ARL).

    Returns the normalized Track shape including ``artist_id``, ``album_id`` and
    the full ``artists`` credit list. Raises on any failure (no silent fallback).
    """
    return normalize_public_track(_public_get(f"/track/{deezer_id}"))


# --- public Deezer API browse (no auth) -----------------------------------
def _public_get(path: str, _retries: int = 3) -> dict:
    """GET the public Deezer API, retrying with backoff on rate limits.

    Bulk operations (e.g. importing a long playlist) hammer the public API and
    routinely hit its quota; transparent retry keeps those imports robust.
    """
    try:
        resp = requests.get(f"{DEEZER_PUBLIC_API}{path}", timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.RequestException as e:
        raise DeezerClientError(f"Public Deezer API request failed: {e}") from e
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        code = (err or {}).get("code")
        if code == 4:  # rate limited / quota
            if _retries > 0:
                time.sleep(0.6 * (4 - _retries))  # 0.6s, 1.2s, 1.8s
                return _public_get(path, _retries - 1)
            raise RateLimited(str(err))
        if code in (800, 300):
            raise TrackUnavailable(str(err))
        raise DeezerClientError(str(err))
    return data


def search_tracks_public(query: str) -> list[dict]:
    """Track search via the public Deezer API (richer: artist_id + duration)."""
    data = _public_get(f"/search?q={quote_plus(query)}&limit=40")
    items = data.get("data") or []
    return [normalize_public_track(t) for t in items]


def search_artists(query: str) -> list[dict]:
    data = _public_get(f"/search/artist?q={quote_plus(query)}&limit=24")
    items = data.get("data") or []
    return [normalize_artist_summary(a) for a in items]


def search_playlists(query: str) -> list[dict]:
    data = _public_get(f"/search/playlist?q={quote_plus(query)}&limit=24")
    items = data.get("data") or []
    out = []
    for p in items:
        out.append(
            {
                "id": str(p.get("id", "")),
                "title": p.get("title", "") or "",
                "cover": p.get("picture_medium")
                or p.get("picture_big")
                or p.get("picture", "")
                or "",
                "track_count": int(p.get("nb_tracks", 0) or 0),
            }
        )
    return out


def charts() -> list[dict]:
    data = _public_get("/chart")
    tracks = (data.get("tracks") or {}).get("data") or []
    return [normalize_public_track(t) for t in tracks]


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


def new_releases() -> list[dict]:
    data = _public_get("/editorial/0/releases?limit=24")
    items = data.get("data") or []
    return [normalize_album_summary(a) for a in items]


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
        "tracks": [normalize_public_track(t) for t in tracks],
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
    """Resolve a Deezer track by ISRC (exact cross-catalog match). None if absent."""
    if not isrc:
        return None
    try:
        data = _public_get(f"/track/isrc:{isrc}")
    except DeezerClientError:
        return None
    if not data or not data.get("id"):
        return None
    return normalize_public_track(data)


def match_track(title: str, artist: str, isrc: str = "") -> dict | None:
    """Best-effort map of external metadata to a playable Deezer track.

    Prefers an exact ISRC match; falls back to a text search on artist+title.
    """
    hit = track_by_isrc(isrc)
    if hit:
        return hit
    query = f"{artist} {title}".strip()
    if not query:
        return None
    try:
        results = search_tracks_public(query)
    except DeezerClientError:
        return None
    return results[0] if results else None


def album_detail(album_id: str) -> dict:
    data = _public_get(f"/album/{album_id}")
    artist = data.get("artist") or {}
    tracks = (data.get("tracks") or {}).get("data") or []
    norm_tracks = []
    for t in tracks:
        # album/{id} track items omit the album object; inject it.
        t.setdefault("album", {})
        t["album"].setdefault("id", data.get("id"))
        t["album"].setdefault("title", data.get("title"))
        t["album"].setdefault("cover_medium", data.get("cover_medium"))
        norm_tracks.append(normalize_public_track(t))
    return {
        "id": str(data.get("id", album_id)),
        "title": data.get("title", "") or "",
        "artist": artist.get("name", "") or "",
        "artist_id": str(artist.get("id", "") or ""),
        "cover": data.get("cover_medium") or data.get("cover_big") or data.get("cover", "") or "",
        "release_date": data.get("release_date") or "",
        "nb_tracks": int(data.get("nb_tracks", len(norm_tracks)) or 0),
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
        "tracks": [normalize_public_track(t) for t in tracks],
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
        "top": [normalize_public_track(t) for t in tracks],
        "albums": albums,
        "related": related,
    }
