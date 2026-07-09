"""Audio streaming with HTTP Range (206) support.

The Range logic is preserved verbatim from the verified Phase-0 spike.
"""
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user
from ..db.models import User
from ..services import storage

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


@router.get("/tracks/{deezer_id}/stream")
async def stream(
    deezer_id: str,
    request: Request,
    _user: User = Depends(get_current_user),
) -> Response:
    if not deezer_id.isdigit():
        raise HTTPException(status_code=400, detail="deezer_id must be numeric")
    try:
        path = await run_in_threadpool(storage.materialize, deezer_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not materialize track: {e}")
    return _range_response(path, request)
