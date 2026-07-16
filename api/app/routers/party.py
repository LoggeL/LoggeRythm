"""Collaborative party sessions: shared queue and host-authoritative playback.

Real-time updates are delivered over Server-Sent Events (SSE) — a plain HTTP
``text/event-stream`` GET that survives the Next.js dev proxy (WebSockets do
not). Every mutation fans a full state frame out to connected clients via the
in-process :mod:`app.services.party_bus`.
"""
import asyncio
import json
import secrets
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

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


def _upsert_member(db: Session, session: PartySession, user: User) -> None:
    member = db.scalar(
        select(PartyMember).where(
            PartyMember.session_code == session.code,
            PartyMember.user_id == user.id,
        )
    )
    if member is None:
        db.add(
            PartyMember(
                session_code=session.code,
                user_id=user.id,
                display_name=_member_display(user),
                last_seen=_utcnow(),
            )
        )
    else:
        member.display_name = _member_display(user)
        member.last_seen = _utcnow()


def _require_host(session: PartySession, user: User) -> None:
    """Reject non-host mutations to host-authoritative state (playback/order)."""
    if user.id != session.host_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Nur der Host kann die Wiedergabe steuern.",
        )


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
            for t in session.tracks
        ],
    )
    return state.model_dump(mode="json")


def _build_state(db: Session, session: PartySession, user: User) -> PartyState:
    data = _state_dict(db, session)
    data["is_host"] = user.id == session.host_id
    return PartyState(**data)


def _publish(db: Session, session: PartySession) -> None:
    """Fan the current full state out to all SSE subscribers of this party."""
    party_bus.publish(session.code, _state_dict(db, session))


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
    db.commit()
    return _build_state(db, session, user)


@router.get("/{code}", response_model=PartyState)
def get_party(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PartyState:
    session = _get_session(db, code)
    _upsert_member(db, session, user)
    db.commit()
    return _build_state(db, session, user)


@router.post("/{code}/join", response_model=PartyState)
def join_party(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PartyState:
    session = _get_session(db, code)
    _upsert_member(db, session, user)
    db.commit()
    _publish(db, session)
    return _build_state(db, session, user)


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
    session.updated_at = _utcnow()
    db.commit()
    _publish(db, session)
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
    db.execute(
        delete(PartyTrack).where(
            PartyTrack.session_code == session.code,
            PartyTrack.id == item_id,
        )
    )
    session.updated_at = _utcnow()
    db.commit()
    _publish(db, session)
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
    position_of = {item_id: i for i, item_id in enumerate(body.ids)}
    for t in session.tracks:
        if t.id in position_of:
            t.position = position_of[t.id]
    session.updated_at = _utcnow()
    db.commit()
    _publish(db, session)
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
    session.current_index = body.index
    # A track change resets the playback clock so guests re-sync from the top.
    session.position_sec = 0.0
    session.playback_updated_at = _utcnow()
    session.updated_at = _utcnow()
    db.commit()
    _publish(db, session)
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
    session.is_playing = body.is_playing
    session.position_sec = max(0.0, body.position_sec)
    session.playback_updated_at = _utcnow()
    session.updated_at = _utcnow()
    db.commit()
    _publish(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{code}/events")
async def party_events(
    code: str,
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """SSE stream of full party-state frames (initial + on every mutation).

    EventSource cannot set headers, but auth is cookie-based so the session
    cookie rides along automatically through the Next proxy. We validate the
    party and capture ``host_id`` up front using a short-lived DB session — the
    stream itself holds no DB connection open for its (potentially long)
    lifetime; subsequent frames come from the in-memory bus.
    """
    with SessionLocal() as db:
        session = db.get(PartySession, code)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Party not found"
            )
        host_id = session.host_id
        initial = _state_dict(db, session)

    queue = party_bus.subscribe(code)

    async def event_stream() -> AsyncIterator[str]:
        try:
            initial["is_host"] = user.id == host_id
            yield f"data: {json.dumps(initial)}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_SEC
                    )
                except asyncio.TimeoutError:
                    # Comment frame: keeps proxies/browsers from closing an idle
                    # connection. EventSource ignores comment lines.
                    yield ": ping\n\n"
                    continue
                frame = {**payload, "is_host": user.id == host_id}
                yield f"data: {json.dumps(frame)}\n\n"
        finally:
            # Runs on client disconnect (generator cancelled) — no leak.
            party_bus.unsubscribe(code, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            # Disable proxy buffering so frames flush immediately.
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{code}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_party(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    db.execute(
        delete(PartyMember).where(
            PartyMember.session_code == session.code,
            PartyMember.user_id == user.id,
        )
    )
    db.commit()
    _publish(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
