"""Spotify Web API client for resolving public links (playlist/album/track).

Uses the Client Credentials flow (app-only, no user login) to read public
catalog metadata. The actual audio is played via Deezer, so callers map the
returned tracks to Deezer (preferably by ISRC) elsewhere.
"""
from __future__ import annotations

import re
import time

import requests

from ..config import (
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_RESOLVE_LIMIT,
)

_TOKEN_URL = "https://accounts.spotify.com/api/token"
_API = "https://api.spotify.com/v1"

# open.spotify.com/<kind>/<id>, optionally with /intl-xx/ locale prefix and ?si=...
# Also supports spotify:<kind>:<id> URIs.
_URL_RE = re.compile(
    r"(?:open\.spotify\.com/(?:intl-[a-z]{2}/)?|spotify:)(playlist|album|track)[:/]([A-Za-z0-9]+)"
)


class SpotifyError(Exception):
    """Base error for the Spotify adapter."""


class SpotifyNotConfigured(SpotifyError):
    """SPOTIFY_CLIENT_ID/SECRET missing."""


class SpotifyBadLink(SpotifyError):
    """The provided string is not a recognizable Spotify link."""


class SpotifyNotFound(SpotifyError):
    """Spotify returned 404 for the resource."""


_token: dict = {"value": None, "exp": 0.0}


def is_configured() -> bool:
    return bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET)


def parse_link(text: str) -> tuple[str, str]:
    """Return (kind, id) for a Spotify URL/URI; raise SpotifyBadLink otherwise."""
    m = _URL_RE.search(text.strip())
    if not m:
        raise SpotifyBadLink("Kein gültiger Spotify-Link (Playlist, Album oder Titel).")
    return m.group(1), m.group(2)


def _get_token() -> str:
    if not is_configured():
        raise SpotifyNotConfigured(
            "Spotify ist nicht konfiguriert (SPOTIFY_CLIENT_ID/SECRET fehlen)."
        )
    now = time.time()
    if _token["value"] and now < _token["exp"]:
        return _token["value"]
    try:
        resp = requests.post(
            _TOKEN_URL,
            data={"grant_type": "client_credentials"},
            auth=(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET),
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.RequestException as e:
        raise SpotifyError(f"Spotify-Token-Anfrage fehlgeschlagen: {e}") from e
    _token["value"] = data["access_token"]
    _token["exp"] = now + int(data.get("expires_in", 3600)) - 30
    return _token["value"]


def _api_get(path: str, params: dict | None = None) -> dict:
    token = _get_token()
    try:
        resp = requests.get(
            f"{_API}{path}",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
            timeout=15,
        )
        if resp.status_code == 404:
            raise SpotifyNotFound("Spotify-Ressource nicht gefunden.")
        if resp.status_code == 401:
            # token may have been revoked; drop cache so next call refreshes
            _token["value"] = None
        resp.raise_for_status()
        return resp.json()
    except SpotifyNotFound:
        raise
    except requests.exceptions.RequestException as e:
        raise SpotifyError(f"Spotify-API-Anfrage fehlgeschlagen: {e}") from e


def _norm_track(t: dict) -> dict:
    """Normalize a Spotify track object to a provider-agnostic shape."""
    if not t:
        return {}
    artists = t.get("artists") or []
    album = t.get("album") or {}
    images = album.get("images") or []
    return {
        "title": t.get("name", "") or "",
        "artist": ", ".join(a.get("name", "") for a in artists if a.get("name")),
        "isrc": (t.get("external_ids") or {}).get("isrc", "") or "",
        "duration_sec": int(round((t.get("duration_ms", 0) or 0) / 1000)),
        "cover": images[0]["url"] if images else "",
    }


def _first_image(images: list | None) -> str:
    return images[0]["url"] if images else ""


def get_track(spotify_id: str) -> dict:
    t = _api_get(f"/tracks/{spotify_id}")
    tracks = [_norm_track(t)]
    return {
        "type": "track",
        "name": t.get("name", "") or "",
        "image": _first_image((t.get("album") or {}).get("images")),
        "total": len(tracks),
        "tracks": tracks,
    }


def get_album(spotify_id: str) -> dict:
    al = _api_get(f"/albums/{spotify_id}")
    image = _first_image(al.get("images"))
    album_stub = {"images": al.get("images") or []}
    items = (al.get("tracks") or {}).get("items") or []
    tracks = []
    for it in items[:SPOTIFY_RESOLVE_LIMIT]:
        it.setdefault("album", album_stub)
        it.setdefault("external_ids", {})
        tracks.append(_norm_track(it))
    return {
        "type": "album",
        "name": al.get("name", "") or "",
        "image": image,
        "total": int((al.get("tracks") or {}).get("total", len(tracks)) or len(tracks)),
        "tracks": tracks,
    }


def get_playlist(spotify_id: str) -> dict:
    pl = _api_get(f"/playlists/{spotify_id}")
    image = _first_image(pl.get("images"))
    tracks: list[dict] = []
    page = pl.get("tracks") or {}
    # Real playlist size (so a capped import can be reported honestly).
    source_total = int(page.get("total", 0) or 0)
    pages = 0
    while pages < 250:  # hard ceiling on pagination loops (safety for 10k+)
        pages += 1
        for it in page.get("items") or []:
            track = it.get("track")
            if track and track.get("type", "track") == "track":
                tracks.append(_norm_track(track))
            if len(tracks) >= SPOTIFY_RESOLVE_LIMIT:
                break
        next_url = page.get("next")
        if not next_url or len(tracks) >= SPOTIFY_RESOLVE_LIMIT:
            break
        # follow pagination via the absolute "next" URL (strip API base)
        page = _api_get(next_url.replace(_API, "", 1))
    return {
        "type": "playlist",
        "name": pl.get("name", "") or "",
        "image": image,
        "total": source_total or len(tracks),
        "tracks": tracks,
    }


def resolve(text: str) -> dict:
    """Resolve a Spotify link to {type, name, image, tracks:[normalized]}."""
    kind, spotify_id = parse_link(text)
    if kind == "playlist":
        return get_playlist(spotify_id)
    if kind == "album":
        return get_album(spotify_id)
    return get_track(spotify_id)
