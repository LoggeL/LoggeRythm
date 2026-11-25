"""Private-server social endpoints: opt-in live friends listening activity."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.types import Receive, Scope, Send

from ..auth import get_current_user
from ..db.models import User
from ..db.session import SessionLocal, get_db
from ..schemas.connect import DeviceType
from ..schemas.track import Track
from ..services import connect_hub, social_bus

router = APIRouter(prefix="/api/social", tags=["social"])

_HEARTBEAT_SEC = 20.0


class FriendActivityItem(BaseModel):
    user_id: int
    display_name: str | None = None
    avatar_url: str | None = None
    is_playing: bool = False
    track: Track | None = None
    device_name: str | None = None
    device_type: DeviceType | None = None
    party_code: str | None = None
    updated_at: str | None = None


class SocialActivityResponse(BaseModel):
    items: list[FriendActivityItem] = Field(default_factory=list)
    server_time: str


def _build_activity_snapshot(db: Session) -> SocialActivityResponse:
    snapshots = connect_hub.hub.snapshot_all()
    now_iso = datetime.now(timezone.utc).isoformat()
    if not snapshots:
        return SocialActivityResponse(items=[], server_time=now_iso)

    user_ids = list(snapshots.keys())
    opted_in_users = list(
        db.scalars(
            select(User).where(
                User.id.in_(user_ids),
                User.share_listening_activity.is_(True),
                or_(User.is_approved.is_(True), User.is_admin.is_(True)),
            )
        ).all()
    )

    items: list[FriendActivityItem] = []
    for u in opted_in_users:
        state = snapshots.get(u.id)
        if state is None or not state.devices:
            continue
        active_dev = next((d for d in state.devices if d.is_active), None)
        fallback_dev = state.devices[0]
        party_code = (
            active_dev.party_code
            if active_dev is not None and active_dev.party_code
            else next((d.party_code for d in state.devices if d.party_code), None)
        )
        pb = state.playback
        current_track: Track | None = None
        if 0 <= pb.current_index < len(pb.queue):
            current_track = pb.queue[pb.current_index]
        is_playing = bool(active_dev is not None and pb.is_playing and current_track is not None)
        dev = active_dev or fallback_dev
        items.append(
            FriendActivityItem(
                user_id=u.id,
                display_name=u.display_name,
                avatar_url=u.avatar_url,
                is_playing=is_playing,
                track=current_track,
                device_name=dev.name,
                device_type=dev.device_type,
                party_code=party_code,
                updated_at=pb.updated_at or dev.last_seen_at,
            )
        )

    items.sort(
        key=lambda item: (
            0 if item.is_playing else 1,
            0 if item.party_code else 1,
            item.user_id,
        )
    )
    return SocialActivityResponse(items=items, server_time=now_iso)


def _snapshot_payload() -> dict:
    with SessionLocal() as db:
        return _build_activity_snapshot(db).model_dump(mode="json")


class _SocialEventResponse(StreamingResponse):
    def __init__(
        self,
        content: AsyncIterator[str],
        subscription: social_bus.Subscription,
    ) -> None:
        super().__init__(
            content,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )
        self._subscription = subscription

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            social_bus.unsubscribe(self._subscription)


@router.get(
    "/activity",
    response_model=SocialActivityResponse,
    description=(
        "Return currently online opted-in server members' live listening activity "
        "and active Party Jam codes."
    ),
)
def get_social_activity(
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SocialActivityResponse:
    return _build_activity_snapshot(db)


@router.get(
    "/activity/events",
    response_class=Response,
    responses={
        200: {
            "description": "Server-Sent Events stream of opted-in friend listening activity.",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
            "headers": {
                "Cache-Control": {"schema": {"type": "string"}},
                "X-Accel-Buffering": {"schema": {"type": "string"}},
            },
        },
    },
)
async def social_activity_events(
    _user: User = Depends(get_current_user),
) -> StreamingResponse:
    subscription = social_bus.subscribe()
    try:
        initial = await run_in_threadpool(_snapshot_payload)
    except BaseException:
        social_bus.unsubscribe(subscription)
        raise

    async def event_stream() -> AsyncIterator[str]:
        try:
            yield f"data: {json.dumps(initial)}\n\n"
            while True:
                try:
                    await asyncio.wait_for(subscription.queue.get(), timeout=_HEARTBEAT_SEC)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                payload = await run_in_threadpool(_snapshot_payload)
                yield f"data: {json.dumps(payload)}\n\n"
        finally:
            social_bus.unsubscribe(subscription)

    return _SocialEventResponse(event_stream(), subscription)
