"""Resolve external (Spotify) links into Deezer-playable tracks."""
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..schemas.resolve import ResolveResult, UnmatchedTrack
from ..schemas.track import Track
from ..services import deezer_client as dc
from ..services import spotify

router = APIRouter(prefix="/api", tags=["resolve"])


def _resolve_blocking(url: str) -> dict:
    meta = spotify.resolve(url)
    sp_tracks = meta.get("tracks") or []

    def _match(sp: dict) -> tuple[dict, dict | None]:
        return sp, dc.match_track(sp.get("title", ""), sp.get("artist", ""), sp.get("isrc", ""))

    matched: list[dict] = []
    unmatched: list[dict] = []
    if sp_tracks:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for sp, deezer in pool.map(_match, sp_tracks):
                if deezer:
                    matched.append(deezer)
                else:
                    unmatched.append({"title": sp.get("title", ""), "artist": sp.get("artist", "")})

    return {
        "type": meta.get("type", ""),
        "name": meta.get("name", ""),
        "image": meta.get("image", ""),
        "total": len(sp_tracks),
        "matched": len(matched),
        "tracks": matched,
        "unmatched": unmatched,
    }


@router.get("/resolve", response_model=ResolveResult)
async def resolve(url: str = Query(..., description="Spotify playlist/album/track link")) -> ResolveResult:
    try:
        data = await run_in_threadpool(_resolve_blocking, url)
    except spotify.SpotifyNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except spotify.SpotifyBadLink as e:
        raise HTTPException(status_code=400, detail=str(e))
    except spotify.SpotifyNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except spotify.SpotifyError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return ResolveResult(
        type=data["type"],
        name=data["name"],
        image=data["image"],
        total=data["total"],
        matched=data["matched"],
        tracks=[Track(**t) for t in data["tracks"]],
        unmatched=[UnmatchedTrack(**u) for u in data["unmatched"]],
    )
