"""Song-radio endpoint: seed track → artist radio (fallback: charts)."""
from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from ..schemas.track import Track
from ..services import deezer_client as dc
from .errors import to_http

router = APIRouter(prefix="/api", tags=["radio"])


def _radio(deezer_id: str) -> list[dict]:
    artist_id = None
    try:
        meta = dc.track_metadata(deezer_id)
        artist_id = meta.get("artist_id")
    except dc.DeezerClientError:
        artist_id = None

    if artist_id:
        try:
            data = dc._public_get(f"/artist/{artist_id}/radio")
            items = data.get("data", []) if isinstance(data, dict) else []
            tracks = [dc.normalize_public_track(t) for t in items]
            if tracks:
                return tracks
        except dc.DeezerClientError:
            pass

    return dc.charts()


@router.get("/radio/{deezer_id}", response_model=list[Track])
async def radio(deezer_id: str) -> list[dict]:
    try:
        return await run_in_threadpool(_radio, deezer_id)
    except dc.DeezerClientError as e:
        raise to_http(e)
