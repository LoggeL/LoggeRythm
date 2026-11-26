"""Beat-matched DJ transitions for the Android player (opt-in per account)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user
from ..db.models import User
from ..schemas.dj import DjTransition
from ..services.dj import service
from .stream import AudioQuality, _range_response, effective_stream_quality

router = APIRouter(prefix="/api/dj", tags=["dj"])


def _require_enabled(user: User) -> None:
    if not user.dj_transitions_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="DJ-Übergänge sind in den Wiedergabe-Einstellungen dieses Kontos ausgeschaltet.",
        )


@router.get(
    "/transition",
    response_model=DjTransition,
    response_model_exclude_none=True,
    description=(
        "Plan the transition from one track into the next. Returns `pending` while the "
        "server downloads, analyses or renders (ask again after `retry_after_s`), a "
        "`crossfade` decision with its reason code when the pair cannot be beat-matched, "
        "or a `beatmatch` decision with the rendered clip's timeline."
    ),
)
async def get_transition(
    from_id: str = Query(pattern=r"^\d+$"),
    to_id: str = Query(pattern=r"^\d+$"),
    quality: AudioQuality | None = Query(
        default=None,
        description="Quality of both stream URLs; omit when they carry no `quality` parameter "
        "(then the account's preferred quality applies, as for /api/tracks/{id}/stream)",
    ),
    a_gain: float = Query(gt=0, le=1, description="Linear volume the player applies to the outgoing track"),
    b_gain: float = Query(gt=0, le=1, description="Linear volume the player applies to the incoming track"),
    user: User = Depends(get_current_user),
) -> DjTransition:
    _require_enabled(user)
    try:
        result = await run_in_threadpool(
            service.get_transition, from_id, to_id, effective_stream_quality(quality, user),
            a_gain, b_gain, user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except service.DjTransitionError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return DjTransition(**result)


@router.get(
    "/clips/{clip_id}",
    response_class=Response,
    description="Rendered transition clip (audio/flac), with Range support.",
    responses={
        200: {"content": {"audio/flac": {"schema": {"type": "string", "format": "binary"}}}},
        206: {"content": {"audio/flac": {"schema": {"type": "string", "format": "binary"}}}},
        304: {"description": "Clip unchanged (ETag matched)."},
        404: {"description": "Unknown or pruned clip."},
    },
)
async def get_clip(
    clip_id: str,
    request: Request,
    user: User = Depends(get_current_user),
) -> Response:
    _require_enabled(user)
    try:
        flac, _meta = service.clip_paths(clip_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        return _range_response(flac, request, deezer_id=f"dj-{clip_id}", quality="clip", explicit_quality=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"DJ clip {clip_id} does not exist") from exc
