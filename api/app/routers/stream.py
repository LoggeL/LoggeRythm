"""Audio streaming with HTTP Range (206) support.

The Range logic is preserved verbatim from the verified Phase-0 spike.
"""
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user
from ..db.models import User
from ..services import deezer, storage

router = APIRouter(prefix="/api", tags=["stream"])


@router.get("/cached-tracks")
async def cached_tracks(
    _user: User = Depends(get_current_user),
) -> dict[str, list[str]]:
    """Track ids stored on the server (available without re-fetching Deezer)."""
    ids = await run_in_threadpool(storage.cached_ids)
    return {"ids": ids}

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
) -> str:
    if not deezer_id.isdigit():
        raise HTTPException(status_code=400, detail="deezer_id must be numeric")
    try:
        if source is None:
            return await run_in_threadpool(storage.materialize, deezer_id)
        return await run_in_threadpool(
            storage.materialize,
            deezer_id,
            requested_by_user_id=requested_by_user_id,
            source=source,
            record_cache_hit=record_cache_hit,
        )
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


def _range_response(path: str, request: Request) -> Response:
    """Serve a file honoring a single HTTP Range request (206) or full body (200)."""
    file_size = os.path.getsize(path)
    range_header = request.headers.get("range")
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": "audio/mpeg",
    }

    if range_header is None:
        return FileResponse(path, headers=headers, media_type="audio/mpeg")

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
    return StreamingResponse(body(), status_code=206, headers=headers)


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
    "/tracks/{deezer_id}/stream",
    response_class=Response,
    description=(
        "Return MP3 bytes, with a 206 response for a valid single Range request. "
        "A cache miss materializes the track on the server before streaming."
    ),
    responses={
        200: {
            "description": "Complete MP3 audio file.",
            "content": {"audio/mpeg": {"schema": {"type": "string", "format": "binary"}}},
            "headers": {"Accept-Ranges": {"schema": {"type": "string"}}},
        },
        206: {
            "description": "Requested MP3 byte range.",
            "content": {"audio/mpeg": {"schema": {"type": "string", "format": "binary"}}},
            "headers": {
                "Accept-Ranges": {"schema": {"type": "string"}},
                "Content-Range": {"schema": {"type": "string"}},
                "Content-Length": {"schema": {"type": "string"}},
            },
        },
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
    user: User = Depends(get_current_user),
) -> Response:
    path = await _materialize_track(
        deezer_id,
        requested_by_user_id=user.id,
        source="stream",
        record_cache_hit=_is_initial_stream_request(request),
    )
    return _range_response(path, request)
