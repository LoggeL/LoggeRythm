"""Browse + search endpoints (health, search, tracks meta, charts, albums, artists)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user
from ..db.models import User
from ..schemas.track import (
    AlbumDetail,
    AlbumSummary,
    ArtistDetail,
    ArtistSummary,
    Genre,
    GenreDetail,
    PlaylistSearchResult,
    Track,
)
from ..services import deezer_client as dc
from ..services import lastfm
from .errors import to_http

router = APIRouter(prefix="/api", tags=["browse"])


class PlayQuery(BaseModel):
    id: str
    artist: str = ""
    title: str = ""


class PlaysRequest(BaseModel):
    tracks: list[PlayQuery] = []


@router.post("/track-plays")
async def track_plays(
    body: PlaysRequest,
    _user: User = Depends(get_current_user),
) -> dict[str, dict]:
    """Batched Last.fm play counts for a set of tracks → ``{id: {plays, listeners}}``."""
    items = [
        {"id": t.id, "artist": t.artist, "title": t.title} for t in body.tracks
    ][:60]
    if not items:
        return {}
    return await run_in_threadpool(lastfm.plays_for, items)


@router.get("/health/deezer")
async def health_deezer() -> dict:
    ok = await run_in_threadpool(dc.health)
    return {"ok": ok}


@router.get("/search", response_model=list[Track])
async def search(
    q: str = Query(default=""),
    type: str = Query(default="track"),
) -> list[dict]:
    if not q.strip():
        return []
    try:
        if type == "album":
            return await run_in_threadpool(dc.search_albums, q)
        return await run_in_threadpool(dc.search_tracks_public, q)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/search/artist", response_model=list[ArtistSummary])
async def search_artist(q: str = Query(default="")) -> list[dict]:
    if not q.strip():
        return []
    try:
        return await run_in_threadpool(dc.search_artists, q)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/search/playlist", response_model=list[PlaylistSearchResult])
async def search_playlist(q: str = Query(default="")) -> list[dict]:
    if not q.strip():
        return []
    try:
        return await run_in_threadpool(dc.search_playlists, q)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/tracks/{deezer_id}", response_model=Track)
async def track_metadata(deezer_id: str) -> dict:
    if not deezer_id.isdigit():
        raise HTTPException(status_code=400, detail="deezer_id must be numeric")
    try:
        return await run_in_threadpool(dc.track_metadata, deezer_id)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/charts", response_model=list[Track])
async def charts() -> list[dict]:
    try:
        return await run_in_threadpool(dc.charts)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/genres", response_model=list[Genre])
async def genres() -> list[dict]:
    try:
        return await run_in_threadpool(dc.genres)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/new-releases", response_model=list[AlbumSummary])
async def new_releases() -> list[dict]:
    try:
        return await run_in_threadpool(dc.new_releases)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/genres/{genre_id}", response_model=GenreDetail)
async def genre(genre_id: str) -> dict:
    try:
        return await run_in_threadpool(dc.genre_detail, genre_id)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/albums/{album_id}", response_model=AlbumDetail)
async def album(album_id: str) -> dict:
    try:
        return await run_in_threadpool(dc.album_detail, album_id)
    except dc.DeezerClientError as e:
        raise to_http(e)


@router.get("/artists/{artist_id}", response_model=ArtistDetail)
async def artist(artist_id: str) -> dict:
    try:
        return await run_in_threadpool(dc.artist_detail, artist_id)
    except dc.DeezerClientError as e:
        raise to_http(e)


class ArtistAbout(BaseModel):
    bio: str = ""
    listeners: int = 0
    playcount: int = 0
    tags: list[str] = []


@router.get("/artist-about", response_model=ArtistAbout)
async def artist_about(name: str = Query(default="")) -> dict:
    """Last.fm artist biography + stats for the "About" section (lazy-loaded)."""
    info = await run_in_threadpool(lastfm.artist_info, name)
    return info or {}


@router.get("/deezer-playlist/{playlist_id}")
async def deezer_playlist(playlist_id: str) -> dict:
    try:
        return await run_in_threadpool(dc.playlist_detail, playlist_id)
    except dc.DeezerClientError as e:
        raise to_http(e)
