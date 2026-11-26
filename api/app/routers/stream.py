"""Audio streaming with HTTP Range (206), quality tiers, caching & audio analysis.

The Range logic is preserved verbatim from the verified Phase-0 spike, extended
with ETag / Cache-Control headers, true audio/flac vs audio/mpeg MIME detection,
batch preloading, scoped cache checks, and server-side audio analysis metadata.
"""
from __future__ import annotations

import hashlib
import os
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user
from ..db.models import StoredTrack, User
from ..db.session import get_db
from ..schemas.track import TrackAudioMeta
from ..services import audio_analysis, deezer, storage

router = APIRouter(prefix="/api", tags=["stream"])

AudioQuality = Literal["lossless", "high", "saver"]
_CACHE_CONTROL_IMMUTABLE = "private, max-age=604800, immutable"
_CACHE_CONTROL_DYNAMIC = "private, no-cache"


class BatchPreloadRequest(BaseModel):
    track_ids: list[str] = Field(..., min_length=1, max_length=50)


class BatchPreloadResponse(BaseModel):
    queued: list[str] = Field(default_factory=list)
    already_cached: list[str] = Field(default_factory=list)


class CachedCheckRequest(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=500)


class CachedCheckResponse(BaseModel):
    cached: dict[str, bool] = Field(default_factory=dict)
    sizes: dict[str, int] = Field(default_factory=dict)


@router.get("/cached-tracks")
async def cached_tracks(
    _user: User = Depends(get_current_user),
) -> dict[str, list[str]]:
    """Track ids stored on the server (available without re-fetching Deezer)."""
    ids = await run_in_threadpool(storage.cached_ids)
    return {"ids": ids}


@router.post("/tracks/cached-check", response_model=CachedCheckResponse)
def cached_check(
    body: CachedCheckRequest,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CachedCheckResponse:
    """Scoped check of whether specific Deezer track IDs are cached on the server."""
    unique_ids = list(dict.fromkeys(tid.strip() for tid in body.ids if tid and tid.strip()))
    if not unique_ids:
        return CachedCheckResponse()
    rows = db.execute(
        select(StoredTrack.deezer_id, StoredTrack.size_bytes).where(
            StoredTrack.deezer_id.in_(unique_ids),
            StoredTrack.status == "ready",
        )
    ).all()
    by_id = {r.deezer_id: max(int(r.size_bytes or 0), 0) for r in rows}
    cached: dict[str, bool] = {}
    sizes: dict[str, int] = {}
    for tid in unique_ids:
        ready = tid in by_id or storage.is_ready(tid)
        cached[tid] = ready
        if ready:
            if tid in by_id and by_id[tid] > 0:
                sizes[tid] = by_id[tid]
            else:
                disk = storage.existing_audio_path(tid)
                if disk is not None:
                    sizes[tid] = os.path.getsize(disk)
    return CachedCheckResponse(cached=cached, sizes=sizes)


@router.post("/tracks/preload", response_model=BatchPreloadResponse)
def preload_tracks_batch(
    body: BatchPreloadRequest,
    user: User = Depends(get_current_user),
) -> BatchPreloadResponse:
    """Queue up to 50 tracks for background server-side materialization."""
    invalid = [tid for tid in body.track_ids if not tid.strip().isdigit()]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"All track_ids must be numeric Deezer IDs; got invalid: {invalid[:5]!r}",
        )
    queued, already_cached = storage.schedule_preload(
        body.track_ids,
        user_id=user.id,
        source="preload",
    )
    return BatchPreloadResponse(queued=queued, already_cached=already_cached)


_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
_CHUNK = 64 * 1024


def _is_initial_stream_request(request: Request) -> bool:
    """True for full fetches or byte-0 ranges; False for continuation/seek chunks."""
    range_header = request.headers.get("range")
    if range_header is None:
        return True
    match = _RANGE_RE.fullmatch(range_header.strip())
    if not match:
        return False
    start_s = match.group(1)
    return start_s != "" and int(start_s) == 0


async def _materialize_track(
    deezer_id: str,
    *,
    requested_by_user_id: int | None = None,
    source: str | None = None,
    record_cache_hit: bool = True,
    quality: str = "high",
) -> str:
    if not deezer_id.isdigit():
        raise HTTPException(status_code=400, detail="deezer_id must be numeric")
    try:
        if source is None and quality == "high":
            return await run_in_threadpool(storage.materialize, deezer_id)
        kwargs: dict = {
            "requested_by_user_id": requested_by_user_id,
            "source": source,
            "record_cache_hit": record_cache_hit,
        }
        if quality != "high":
            kwargs["quality"] = quality
        return await run_in_threadpool(storage.materialize, deezer_id, **kwargs)
    except deezer.Deezer404Exception as exc:
        # Withdrawn catalog entries (``readable: false``) 404 on Deezer. That
        # is a client-visible fact about the track, not a gateway failure, and
        # a 502 body would be replaced by Cloudflare's HTML error page.
        raise HTTPException(
            status_code=404,
            detail=f"Track {deezer_id} is not available on Deezer: {exc}",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Could not materialize track: {exc}",
        ) from exc


def _etag_for(deezer_id: str, quality: str, st: os.stat_result) -> str:
    digest = hashlib.sha256(
        f"{deezer_id}:{quality}:{st.st_size}:{st.st_mtime_ns}".encode("utf-8")
    ).hexdigest()[:24]
    return f'"{digest}"'


def _range_response(
    path: str,
    request: Request,
    *,
    deezer_id: str = "",
    quality: str = "high",
    explicit_quality: bool = False,
) -> Response:
    """Serve a file honoring a single HTTP Range request (206), ETag (304), or full body (200)."""
    st = os.stat(path)
    file_size = st.st_size
    media_type = storage.media_type_for_path(path)
    etag = _etag_for(deezer_id or os.path.basename(path), quality, st)
    range_header = request.headers.get("range")
    cache_control = _CACHE_CONTROL_IMMUTABLE if explicit_quality else _CACHE_CONTROL_DYNAMIC
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": media_type,
        "Cache-Control": cache_control,
        "ETag": etag,
        "X-Audio-Quality": quality,
    }

    if range_header is None:
        if_none_match = request.headers.get("if-none-match")
        if if_none_match and etag in {tag.strip() for tag in if_none_match.split(",")}:
            return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
        return FileResponse(path, headers=headers, media_type=media_type)

    m = _RANGE_RE.fullmatch(range_header.strip())
    if not m:
        raise HTTPException(
            status_code=416,
            detail="Invalid Range header",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    start_s, end_s = m.group(1), m.group(2)
    if start_s == "" and end_s == "":
        raise HTTPException(
            status_code=416,
            detail="Invalid Range header",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    if start_s == "":
        # suffix range: last N bytes
        length = int(end_s)
        if length <= 0:
            raise HTTPException(
                status_code=416,
                detail="Requested Range Not Satisfiable",
                headers={"Content-Range": f"bytes */{file_size}"},
            )
        start = max(file_size - length, 0)
        end = file_size - 1
    else:
        try:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1
        except ValueError as exc:
            raise HTTPException(
                status_code=416,
                detail="Invalid Range header",
                headers={"Content-Range": f"bytes */{file_size}"},
            ) from exc

    if start > end or start >= file_size:
        raise HTTPException(
            status_code=416,
            detail="Requested Range Not Satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    end = min(end, file_size - 1)
    length = end - start + 1

    def body():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(_CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers.update(
        {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
        }
    )
    return StreamingResponse(body(), status_code=206, headers=headers, media_type=media_type)


@router.post(
    "/tracks/{deezer_id}/preload",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def preload_track(
    deezer_id: str,
    user: User = Depends(get_current_user),
) -> Response:
    """Materialize a track without returning its audio payload."""
    await _materialize_track(
        deezer_id,
        requested_by_user_id=user.id,
        source="preload",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/tracks/{deezer_id}/audio-meta",
    response_model=TrackAudioMeta,
    description=(
        "Return server-computed waveform peaks, true EBU R128 loudness, BPM, "
        "and leading/trailing silence cue points for a track."
    ),
)
async def track_audio_meta(
    deezer_id: str,
    user: User = Depends(get_current_user),
) -> TrackAudioMeta:
    if not deezer_id.isdigit():
        raise HTTPException(status_code=400, detail="deezer_id must be numeric")
    path = storage.existing_audio_path(deezer_id)
    if path is None:
        path = await _materialize_track(
            deezer_id,
            requested_by_user_id=user.id,
            source="preload",
        )
    sidecar = storage.meta_path_for(deezer_id)
    try:
        result = await run_in_threadpool(
            audio_analysis.get_or_analyze, deezer_id, path, sidecar
        )
    except audio_analysis.AudioAnalysisUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except audio_analysis.AudioAnalysisError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return TrackAudioMeta(**result)


def effective_stream_quality(quality: str | None, user: User) -> str:
    """The quality a stream URL resolves to: explicit ``?quality=`` wins, otherwise the
    account's preferred quality. Shared with the DJ endpoint, which must analyse exactly
    the file the player streams."""
    if quality is not None:
        return quality
    return (
        user.preferred_quality
        if getattr(user, "preferred_quality", None) in storage.VALID_QUALITIES
        else "high"
    )


@router.get(
    "/tracks/{deezer_id}/stream",
    response_class=Response,
    description=(
        "Materializes and returns audio bytes (audio/mpeg or audio/flac), with a 206 "
        "response for a valid single Range request and ETag/Cache-Control headers. "
        "Supports optional quality tiers (lossless, high, saver)."
    ),
    responses={
        200: {
            "description": "Complete audio file.",
            "content": {
                "audio/mpeg": {"schema": {"type": "string", "format": "binary"}},
                "audio/flac": {"schema": {"type": "string", "format": "binary"}},
            },
            "headers": {
                "Accept-Ranges": {"schema": {"type": "string"}},
                "Cache-Control": {"schema": {"type": "string"}},
                "ETag": {"schema": {"type": "string"}},
                "X-Audio-Quality": {"schema": {"type": "string"}},
            },
        },
        206: {
            "description": "Requested audio byte range.",
            "content": {
                "audio/mpeg": {"schema": {"type": "string", "format": "binary"}},
                "audio/flac": {"schema": {"type": "string", "format": "binary"}},
            },
            "headers": {
                "Accept-Ranges": {"schema": {"type": "string"}},
                "Cache-Control": {"schema": {"type": "string"}},
                "Content-Range": {"schema": {"type": "string"}},
                "Content-Length": {"schema": {"type": "string"}},
                "ETag": {"schema": {"type": "string"}},
                "X-Audio-Quality": {"schema": {"type": "string"}},
            },
        },
        304: {"description": "Audio file unchanged (ETag matched)."},
        416: {
            "description": "Invalid or unsatisfiable Range header.",
            "content": {"application/json": {"schema": {"type": "object"}}},
            "headers": {"Content-Range": {"schema": {"type": "string"}}},
        },
    },
)
async def stream(
    deezer_id: str,
    request: Request,
    quality: AudioQuality | None = Query(default=None),
    user: User = Depends(get_current_user),
) -> Response:
    effective_quality = effective_stream_quality(quality, user)
    path = await _materialize_track(
        deezer_id,
        requested_by_user_id=user.id,
        source="stream",
        record_cache_hit=_is_initial_stream_request(request),
        quality=effective_quality,
    )
    return _range_response(
        path,
        request,
        deezer_id=deezer_id,
        quality=effective_quality,
        explicit_quality=(quality is not None),
    )
