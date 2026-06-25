"""Resolve external (Spotify) links into Deezer-playable tracks."""
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from ..schemas.resolve import ResolveResult, UnmatchedTrack
from ..schemas.track import Track
from ..services import deezer_client as dc
from ..services import spotify

router = APIRouter(prefix="/api", tags=["resolve"])


def _dedupe(sp_tracks: list[dict]) -> list[dict]:
    """Drop duplicate tracks (long playlists repeat songs) — key by ISRC else artist|title."""
    seen: set[str] = set()
    out: list[dict] = []
    for sp in sp_tracks:
        key = (sp.get("isrc") or f"{sp.get('artist', '')}|{sp.get('title', '')}").lower()
        if key and key not in seen:
            seen.add(key)
            out.append(sp)
    return out


def _resolve_blocking(url: str) -> dict:
    meta = spotify.resolve(url)
    raw = meta.get("tracks") or []
    sp_tracks = _dedupe(raw)
    source_total = int(meta.get("total", len(raw)) or len(raw))

    def _match(sp: dict) -> tuple[dict, dict | None]:
        try:
            return sp, dc.match_track(
                sp.get("title", ""), sp.get("artist", ""), sp.get("isrc", "")
            )
        except Exception:  # noqa: BLE001 — a single bad lookup must not abort the import
            return sp, None

    matched: list[dict] = []
    unmatched: list[dict] = []
    seen_deezer: set[str] = set()
    if sp_tracks:
        # Modest concurrency + backoff (in _public_get) keeps big imports under the rate limit.
        with ThreadPoolExecutor(max_workers=6) as pool:
            for sp, deezer in pool.map(_match, sp_tracks):
                if deezer and deezer["id"] not in seen_deezer:
                    seen_deezer.add(deezer["id"])
                    matched.append(deezer)
                elif not deezer:
                    unmatched.append(
                        {"title": sp.get("title", ""), "artist": sp.get("artist", "")}
                    )

    return {
        "type": meta.get("type", ""),
        "name": meta.get("name", ""),
        "image": meta.get("image", ""),
        "total": len(sp_tracks),
        "source_total": source_total,
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
        source_total=data.get("source_total", data["total"]),
        matched=data["matched"],
        tracks=[Track(**t) for t in data["tracks"]],
        unmatched=[UnmatchedTrack(**u) for u in data["unmatched"]],
    )
