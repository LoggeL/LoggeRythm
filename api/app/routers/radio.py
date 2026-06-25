"""Song-radio endpoint: seed track → a "track mix" of similar songs.

Builds a varied mix like Deezer's track mix: the seed artist's radio plus
top tracks from related artists, deduped and shuffled. Falls back to charts.
"""
import random

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from ..schemas.track import Track
from ..services import deezer_client as dc
from .errors import to_http

router = APIRouter(prefix="/api", tags=["radio"])

_MIX_SIZE = 40


def _radio(deezer_id: str) -> list[dict]:
    # Resolve the seed track's artist via the public API (reliable artist id).
    try:
        seed = dc._public_get(f"/track/{deezer_id}")
    except dc.DeezerClientError:
        seed = {}
    artist_id = (seed.get("artist") or {}).get("id") if isinstance(seed, dict) else None

    pool: list[dict] = []
    seen: set[str] = {str(deezer_id)}

    def add(items: list) -> None:
        for t in items or []:
            tid = str(t.get("id", ""))
            if tid and tid not in seen:
                seen.add(tid)
                pool.append(dc.normalize_public_track(t))

    if artist_id:
        # Primary source: the seed artist's radio (smart similar-songs list).
        try:
            add(dc._public_get(f"/artist/{artist_id}/radio").get("data"))
        except dc.DeezerClientError:
            pass
        # Variety: top tracks from related artists → a true "mix".
        try:
            related = dc._public_get(f"/artist/{artist_id}/related?limit=6").get("data") or []
        except dc.DeezerClientError:
            related = []
        for r in related[:6]:
            rid = r.get("id")
            if not rid:
                continue
            try:
                add(dc._public_get(f"/artist/{rid}/top?limit=5").get("data"))
            except dc.DeezerClientError:
                pass

    if not pool:
        return dc.charts()

    random.shuffle(pool)  # mix feel, not a single-artist block
    return pool[:_MIX_SIZE]


@router.get("/radio/{deezer_id}", response_model=list[Track])
async def radio(deezer_id: str) -> list[dict]:
    try:
        return await run_in_threadpool(_radio, deezer_id)
    except dc.DeezerClientError as e:
        raise to_http(e)
