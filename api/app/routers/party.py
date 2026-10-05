"""Collaborative party sessions: shared queue and host-authoritative playback.

Real-time updates are delivered over Server-Sent Events (SSE) — a plain HTTP
``text/event-stream`` GET that survives the Next.js dev proxy (WebSockets do
not). Every mutation fans a full state frame out to connected clients via the
in-process :mod:`app.services.party_bus`.
"""
import asyncio
import json
import math
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value
from starlette.concurrency import run_in_threadpool
from starlette.types import Receive, Scope, Send

from ..auth import get_current_user
from ..db.models import PartyMember, PartySession, PartyTrack, User
from ..db.session import SessionLocal, get_db
from ..schemas.party import PartyMemberOut, PartyState, PartyTrackOut
from ..schemas.track import Track, dump_artists, load_artists
from ..services import party_bus
from pydantic import BaseModel

# Seconds between SSE heartbeat comments that keep idle connections alive.
_HEARTBEAT_SEC = 20.0

router = APIRouter(prefix="/api/party", tags=["party"])

_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _member_display(user: User) -> str:
    return user.display_name or user.email


def _generate_code(db: Session) -> str:
    for _ in range(50):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        if db.get(PartySession, code) is None:
            return code
    raise HTTPException(status_code=500, detail="Could not allocate a party code")


def _get_session(db: Session, code: str) -> PartySession:
    session = db.get(PartySession, code)
    if session is None:
        raise HTTPException(status_code=404, detail="Party not found")
    return session


def _touch_session(db: Session, session: PartySession) -> None:
    """Advance the canonical revision atomically, or reject a stale mutation.

    A timestamp assigned before commit alone cannot order concurrent changes.
    The conditional update locks the row until commit and ensures each committed
    queue, playback or membership mutation has a strictly newer revision.
    """
    previous = session.updated_at
    revision = max(
        _utcnow(),
        party_bus.utc_revision(previous) + timedelta(microseconds=1),
    )
    changed = db.execute(
        update(PartySession)
        .where(PartySession.code == session.code, PartySession.updated_at == previous)
        .values(updated_at=revision)
        .execution_options(synchronize_session=False)
    )
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Party changed; reload before modifying it",
        )
    set_committed_value(session, "updated_at", revision)


def _upsert_member(db: Session, session: PartySession, user: User) -> None:
    member = db.scalar(
        select(PartyMember).where(
            PartyMember.session_code == session.code,
            PartyMember.user_id == user.id,
        )
    )
    display_name = _member_display(user)
    visible_change = member is None or member.display_name != display_name
    if member is None:
        db.add(
            PartyMember(
                session_code=session.code,
                user_id=user.id,
                display_name=display_name,
                last_seen=_utcnow(),
            )
        )
    else:
        member.display_name = display_name
        member.last_seen = _utcnow()
    # Refreshing last_seen does not change any wire field. Avoid competing with
    # host playback updates when an existing member merely reads/reconnects.
    if visible_change:
        _touch_session(db, session)


def _require_host(session: PartySession, user: User) -> None:
    """Reject non-host mutations to host-authoritative state (playback/order)."""
    if user.id != session.host_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Nur der Host kann die Wiedergabe steuern.",
        )


def _ordered_tracks(session: PartySession) -> list[PartyTrack]:
    return sorted(session.tracks, key=lambda track: (track.position, track.id))


def _current_track(
    session: PartySession, tracks: list[PartyTrack]
) -> PartyTrack | None:
    if session.current_index == -1:
        return None
    if not 0 <= session.current_index < len(tracks):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Party playback index is outside the queue; select a track again",
        )
    return tracks[session.current_index]


def _state_dict(db: Session, session: PartySession) -> dict[str, Any]:
    """Build the canonical, user-independent party state as a JSON-ready dict.

    ``is_host`` is left ``False`` here; each SSE connection (and the REST
    endpoints) stamp it for their own user.
    """
    db.refresh(session)
    host = db.get(User, session.host_id)
    host_name = _member_display(host) if host is not None else ""
    avatars = {
        u.id: u.avatar_url
        for u in db.scalars(
            select(User).where(
                User.id.in_([m.user_id for m in session.members] or [0])
            )
        ).all()
    }
    updated_at = session.playback_updated_at
    if updated_at is not None:
        # SQLite returns naive datetimes for values written by _utcnow(). Keep
        # the API timestamp unambiguous for clients in other time zones.
        updated_at = (
            updated_at.replace(tzinfo=timezone.utc)
            if updated_at.tzinfo is None
            else updated_at.astimezone(timezone.utc)
        )
    state = PartyState(
        code=session.code,
        name=session.name,
        host_name=host_name,
        is_host=False,
        current_index=session.current_index,
        is_playing=session.is_playing,
        position_sec=session.position_sec,
        playback_updated_at=updated_at.isoformat() if updated_at else None,
        members=[
            PartyMemberOut(name=m.display_name, avatar_url=avatars.get(m.user_id))
            for m in session.members
        ],
        tracks=[
            PartyTrackOut(
                id=t.id,
                deezer_id=t.deezer_id,
                title=t.title,
                artist=t.artist,
                artist_id=t.artist_id,
                artists=load_artists(t.artists_json, t.artist, t.artist_id),
                album=t.album,
                album_id=t.album_id,
                cover=t.cover_url or "",
                duration_sec=t.duration_sec,
                added_by=t.added_by,
            )
            for t in _ordered_tracks(session)
        ],
    )
    return state.model_dump(mode="json")


def _commit_state_for_user(db: Session, session: PartySession, user: User) -> PartyState:
    is_host = user.id == session.host_id
    frame = _commit_state(db, session)
    return PartyState(**{**frame.payload, "is_host": is_host})


def _commit_state(db: Session, session: PartySession) -> party_bus.StateFrame:
    """Capture state under the mutation's row lock, commit, then broadcast.

    Flush first so refreshing the canonical state cannot discard pending ORM
    changes. Reading before commit also prevents a snapshot conflict being
    reported after a mutation has already been persisted.
    """
    db.flush()
    frame = _canonical_frame(db, session)
    db.commit()
    party_bus.publish(session.code, frame)
    return frame


def _canonical_frame(db: Session, session: PartySession) -> party_bus.StateFrame:
    """Read a consistent revision with its state, including lazy relationships."""
    for _ in range(5):
        payload = _state_dict(db, session)
        revision = party_bus.utc_revision(session.updated_at)
        current = db.scalar(
            select(PartySession.updated_at).where(PartySession.code == session.code)
        )
        if current is None:
            raise HTTPException(status_code=404, detail="Party not found")
        if party_bus.utc_revision(current) == revision:
            return party_bus.StateFrame(revision, payload)
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Party changed while reading its state; reconnect or reload",
    )


def _stream_snapshot(code: str) -> tuple[int, party_bus.StateFrame]:
    """Load the initial state in a worker, closing its DB session before SSE."""
    with SessionLocal() as db:
        session = _get_session(db, code)
        return session.host_id, _canonical_frame(db, session)


class _PartyEventResponse(StreamingResponse):
    """Close subscriptions even if sending fails before generator iteration."""

    def __init__(
        self,
        content: AsyncIterator[str],
        code: str,
        subscription: party_bus.Subscription,
    ) -> None:
        super().__init__(
            content,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )
        self._party_code = code
        self._subscription = subscription

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            party_bus.unsubscribe(self._party_code, self._subscription)


class PartyCreate(BaseModel):
    name: str | None = None


class CurrentUpdate(BaseModel):
    index: int


class OrderUpdate(BaseModel):
    ids: list[int]


class PlaybackUpdate(BaseModel):
    is_playing: bool
    position_sec: float


@router.post("", response_model=PartyState)
def create_party(
    body: PartyCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PartyState:
    code = _generate_code(db)
    session = PartySession(
        code=code,
        name=body.name or "",
        host_id=user.id,
        current_index=-1,
    )
    db.add(session)
    db.flush()
    _upsert_member(db, session, user)
    return _commit_state_for_user(db, session, user)


@router.get(
    "/{code}",
    response_model=PartyState,
    description=(
        "Read party state and register or refresh the requesting user as a party member."
    ),
)
def get_party(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PartyState:
    session = _get_session(db, code)
    _upsert_member(db, session, user)
    return _commit_state_for_user(db, session, user)


@router.post("/{code}/join", response_model=PartyState)
def join_party(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PartyState:
    session = _get_session(db, code)
    _upsert_member(db, session, user)
    return _commit_state_for_user(db, session, user)


@router.post("/{code}/tracks", status_code=status.HTTP_204_NO_CONTENT)
def add_track(
    code: str,
    track: Track,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    next_pos = db.scalar(
        select(func.coalesce(func.max(PartyTrack.position), -1)).where(
            PartyTrack.session_code == session.code
        )
    )
    db.add(
        PartyTrack(
            session_code=session.code,
            deezer_id=track.id,
            title=track.title,
            artist=track.artist,
            artist_id=str(track.artist_id),
            artists_json=dump_artists(track),
            album=track.album,
            album_id=str(track.album_id),
            cover_url=track.cover or None,
            duration_sec=track.duration_sec,
            position=(next_pos if next_pos is not None else -1) + 1,
            added_by=_member_display(user),
        )
    )
    _touch_session(db, session)
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{code}/tracks/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_track(
    code: str,
    item_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    _require_host(session, user)
    tracks = _ordered_tracks(session)
    current = _current_track(session, tracks)
    removed = next((track for track in tracks if track.id == item_id), None)
    if removed is None:
        raise HTTPException(status_code=404, detail="Party track not found")
    remaining = [track for track in tracks if track.id != item_id]
    for position, track in enumerate(remaining):
        track.position = position
    db.delete(removed)
    now = _utcnow()
    if current is removed:
        # Continue with the following track, or the previous one at the end.
        session.current_index = min(session.current_index, len(remaining) - 1)
        session.position_sec = 0.0
        session.playback_updated_at = now
        if not remaining:
            session.is_playing = False
    elif current is not None:
        session.current_index = remaining.index(current)
    _touch_session(db, session)
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{code}/tracks/order", status_code=status.HTTP_204_NO_CONTENT)
def reorder_tracks(
    code: str,
    body: OrderUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    _require_host(session, user)
    tracks = _ordered_tracks(session)
    current_ids = {track.id for track in tracks}
    if (
        len(body.ids) != len(tracks)
        or len(set(body.ids)) != len(body.ids)
        or set(body.ids) != current_ids
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Party queue changed; reload before reordering",
        )
    current = _current_track(session, tracks)
    position_of = {item_id: i for i, item_id in enumerate(body.ids)}
    for track in tracks:
        track.position = position_of[track.id]
    if current is not None:
        session.current_index = position_of[current.id]
    _touch_session(db, session)
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{code}/current", status_code=status.HTTP_204_NO_CONTENT)
def set_current(
    code: str,
    body: CurrentUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    _require_host(session, user)
    if body.index < -1 or body.index >= len(session.tracks):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Party playback index must be -1 or refer to an existing queue track",
        )
    session.current_index = body.index
    if body.index == -1:
        session.is_playing = False
    # A track change resets the playback clock so guests re-sync from the top.
    session.position_sec = 0.0
    session.playback_updated_at = _utcnow()
    _touch_session(db, session)
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{code}/playback", status_code=status.HTTP_204_NO_CONTENT)
def set_playback(
    code: str,
    body: PlaybackUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Host-only: set play/pause + position and stamp a server timestamp.

    Guests use ``position_sec`` together with the elapsed time since
    ``playback_updated_at`` to keep their local player in sync.
    """
    session = _get_session(db, code)
    _require_host(session, user)
    if not math.isfinite(body.position_sec) or body.position_sec < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Party playback position must be a finite, non-negative number",
        )
    if body.is_playing and _current_track(session, _ordered_tracks(session)) is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Select a party track before starting playback",
        )
    session.is_playing = body.is_playing
    session.position_sec = body.position_sec
    session.playback_updated_at = _utcnow()
    _touch_session(db, session)
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{code}/events",
    response_class=Response,
    responses={
        200: {
            "description": "Server-Sent Events containing party state frames and heartbeat comments.",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
            "headers": {
                "Cache-Control": {"schema": {"type": "string"}},
                "X-Accel-Buffering": {"schema": {"type": "string"}},
            },
        },
    },
)
async def party_events(
    code: str,
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """SSE stream of the latest full party state, with idle heartbeats.

    EventSource cannot set headers, but auth is cookie-based so the session
    cookie rides along automatically through the Next proxy. Subscribe before
    a worker loads the initial canonical state so mutations
    during connection setup cannot disappear. No DB connection stays open for
    the stream's lifetime; revisions order subsequent in-memory frames.
    """
    user_id = user.id
    subscription = party_bus.subscribe(code)
    try:
        host_id, initial = await run_in_threadpool(_stream_snapshot, code)
    except BaseException:
        party_bus.unsubscribe(code, subscription)
        raise

    async def event_stream() -> AsyncIterator[str]:
        try:
            latest = subscription.take_latest(initial)
            frame = {**latest.payload, "is_host": user_id == host_id}
            yield f"data: {json.dumps(frame)}\n\n"
            while True:
                try:
                    incoming = await asyncio.wait_for(
                        subscription.queue.get(), timeout=_HEARTBEAT_SEC
                    )
                except asyncio.TimeoutError:
                    # Comment frame: keeps proxies/browsers from closing an idle
                    # connection. EventSource ignores comment lines.
                    yield ": ping\n\n"
                    continue
                if incoming.updated_at <= latest.updated_at:
                    continue
                latest = incoming
                frame = {**latest.payload, "is_host": user_id == host_id}
                yield f"data: {json.dumps(frame)}\n\n"
        finally:
            # Runs on client disconnect (generator cancelled) — no leak.
            party_bus.unsubscribe(code, subscription)

    return _PartyEventResponse(event_stream(), code, subscription)


@router.post("/{code}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_party(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    _touch_session(db, session)
    db.execute(
        delete(PartyMember).where(
            PartyMember.session_code == session.code,
            PartyMember.user_id == user.id,
        )
    )
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
