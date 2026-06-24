"""Browse + search endpoints (health, search, tracks meta, charts, albums, artists)."""
from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..schemas.track import (
    AlbumDetail,
    AlbumSummary,
    ArtistDetail,
    ArtistSummary,
    Genre,
    PlaylistSearchResult,
    Track,
)
from ..services import deezer_client as dc
from .errors import to_http

router = APIRouter(prefix="/api", tags=["browse"])


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
