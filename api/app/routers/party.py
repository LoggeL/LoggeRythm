"""Collaborative party sessions: shared queue and live Jam playback.

Real-time updates are delivered over Server-Sent Events (SSE) — a plain HTTP
``text/event-stream`` GET that survives proxies cleanly. Every mutation fans a
full state frame out to connected clients via the in-process
:mod:`app.services.party_bus`.

Participants are approved accounts or anonymous guests who joined with a
nickname (:mod:`app.party_auth`). Everyone can add tracks (append or play next)
and remove their own not-yet-playing additions; host controls playback, order,
settings, kicking, and ending the Jam, and may optionally toggle
``guests_can_control`` to let participants share playback & queue controls
(Spotify Jam-style). Queued tracks are pre-loaded into the server cache in the
background (:mod:`app.services.party_preload`) and every frame carries both
each track's authoritative server-cache availability (``is_stored``) and its
live preload state.
"""
import asyncio
import json
import logging
import math
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, AsyncIterator, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value
from starlette.concurrency import run_in_threadpool
from starlette.types import Receive, Scope, Send

from ..auth import get_current_user
from ..db.models import PartyGuest, PartyMember, PartySession, PartyTrack, User
from ..db.session import SessionLocal, get_db
from ..party_auth import (
    PartyActor,
    clear_guest_cookie,
    get_party_actor,
    hash_guest_token,
    new_guest_token,
    set_guest_cookie,
)
from ..schemas.party import (
    PartyCachedTracks,
    PartyGuestJoin,
    PartyMemberOut,
    PartySettingsUpdate,
    PartyState,
    PartyTrackOut,
)
from ..schemas.track import Track, dump_artists, load_artists
from ..services import party_bus, party_preload, storage

# Seconds between SSE heartbeat comments that keep idle connections alive.
_HEARTBEAT_SEC = 20.0

router = APIRouter(prefix="/api/party", tags=["party"])

logger = logging.getLogger(__name__)

# Upper bound on anonymous guests per party; a share link must not be able to
# grow one party's member table without limit.
_MAX_GUESTS = 100

_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _member_display(user: User) -> str:
    return user.display_name or user.email


def _user_id_from_member_key(member_key: str) -> int | None:
    if member_key.startswith("u:") and member_key[2:].isdigit():
        return int(member_key[2:])
    return None


def _parse_member_key(member_key: str) -> tuple[Literal["u", "g"], int]:
    if len(member_key) >= 3 and member_key[1] == ":" and member_key[2:].isdigit():
        prefix = member_key[0]
        if prefix == "u":
            return "u", int(member_key[2:])
        if prefix == "g":
            return "g", int(member_key[2:])
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Invalid party member key {member_key!r}; expected 'u:<id>' or 'g:<id>'",
    )


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


def _party_track_row(
    session_code: str, track: Track, position: int, added_by: PartyActor
) -> PartyTrack:
    return PartyTrack(
        session_code=session_code,
        deezer_id=track.id,
        title=track.title,
        artist=track.artist,
        artist_id=str(track.artist_id),
        artists_json=dump_artists(track),
        album=track.album,
        album_id=str(track.album_id),
        cover_url=track.cover or None,
        duration_sec=track.duration_sec,
        position=position,
        added_by=added_by.display_name,
        added_by_member=added_by.key,
    )


def _is_host(session: PartySession, actor: PartyActor) -> bool:
    return actor.user is not None and actor.user.id == session.host_id


def _can_control(session: PartySession, actor: PartyActor) -> bool:
    return _is_host(session, actor) or bool(session.guests_can_control)


def _require_host(session: PartySession, actor: PartyActor) -> None:
    """Reject non-host mutations to strictly host-owned operations."""
    if not _is_host(session, actor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Nur der Host kann diese Aktion ausführen.",
        )


def _require_control(session: PartySession, actor: PartyActor) -> None:
    """Reject mutations to playback/queue order when the caller lacks control."""
    if not _can_control(session, actor):
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


def _state_dict(
    db: Session,
    session: PartySession,
    *,
    ended: bool = False,
) -> dict[str, Any]:
    """Build the canonical, user-independent party state as a JSON-ready dict.

    ``is_host`` is left ``False`` here; each SSE connection (and the REST
    endpoints) stamp it for their own user.
    """
    db.refresh(session)
    host = db.get(User, session.host_id)
    host_name = _member_display(host) if host is not None else ""
    ordered_tracks = _ordered_tracks(session)

    avatar_user_ids: set[int] = {m.user_id for m in session.members}
    for track in ordered_tracks:
        uid = _user_id_from_member_key(track.added_by_member)
        if uid is not None:
            avatar_user_ids.add(uid)

    avatars = {
        u.id: u.avatar_url
        for u in db.scalars(
            select(User).where(User.id.in_(avatar_user_ids or {0}))
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
        guests_can_control=bool(session.guests_can_control),
        current_index=session.current_index,
        is_playing=False if ended else session.is_playing,
        position_sec=session.position_sec,
        playback_updated_at=updated_at.isoformat() if updated_at else None,
        playback_changed_by=session.playback_changed_by or "",
        playback_revision=session.playback_revision or 0,
        ended=ended,
        server_time=_utcnow().isoformat(),
        members=[
            PartyMemberOut(
                key=f"u:{m.user_id}",
                name=m.display_name,
                avatar_url=avatars.get(m.user_id),
                is_guest=False,
                is_host=(m.user_id == session.host_id),
            )
            for m in session.members
        ]
        + [
            PartyMemberOut(
                key=f"g:{g.id}",
                name=g.nickname,
                avatar_url=None,
                is_guest=True,
                is_host=False,
            )
            for g in session.guests
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
                added_by_member=t.added_by_member,
                added_by_avatar_url=avatars.get(
                    _user_id_from_member_key(t.added_by_member) or -1
                ),
                **_load_fields(t.deezer_id),
            )
            for t in ordered_tracks
        ],
    )
    return state.model_dump(mode="json")


def _load_fields(deezer_id: str) -> dict[str, Any]:
    load_state, load_error = party_preload.load_state(deezer_id)
    return {
        "is_stored": load_state == "ready",
        "load_state": load_state,
        "load_error": load_error,
    }


def _viewer_fields(host_id: int, actor: PartyActor) -> dict[str, Any]:
    """Per-connection fields stamped onto the shared canonical frame."""
    return {
        "is_host": actor.user is not None and actor.user.id == host_id,
        "viewer_key": actor.key,
        "viewer_name": actor.display_name,
        "viewer_is_guest": actor.is_guest,
    }


def _commit_state_for(db: Session, session: PartySession, actor: PartyActor) -> PartyState:
    host_id = session.host_id
    frame = _commit_state(db, session)
    return PartyState(**{**frame.payload, **_viewer_fields(host_id, actor)})


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
    _preload_upcoming(frame.payload)
    return frame


def _preload_upcoming(payload: dict[str, Any]) -> None:
    """Keep the playing and next tracks of the committed queue loading."""
    party_preload.schedule(
        party_preload.upcoming(
            [track["deezer_id"] for track in payload["tracks"]],
            payload["current_index"],
        )
    )


def _publish_load_change(deezer_id: str) -> None:
    """Preload listener: push a new revision to every party holding the track.

    Load state lives outside the database, so a fresh revision is what lets
    connected clients accept the frame. A concurrent mutation (409) is retried;
    it would carry the new load state anyway.
    """
    with SessionLocal() as db:
        codes = db.scalars(
            select(PartyTrack.session_code)
            .where(PartyTrack.deezer_id == deezer_id)
            .distinct()
        ).all()
        for code in codes:
            for attempt in range(5):
                session = db.get(PartySession, code)
                if session is None:
                    break  # the party ended meanwhile
                try:
                    _touch_session(db, session)
                    _commit_state(db, session)
                    break
                except HTTPException as exc:
                    if exc.status_code != status.HTTP_409_CONFLICT or attempt == 4:
                        raise RuntimeError(
                            f"Could not publish load state of track {deezer_id} "
                            f"to party {code}: {exc.detail}"
                        ) from exc
                    db.rollback()
                    db.expire_all()


party_preload.set_settled_listener(_publish_load_change)


def _require_numeric_track_id(track: Track) -> None:
    if not track.id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Party tracks need a numeric Deezer id, got {track.id!r}",
        )


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
    """New party, optionally seeded with the host's current player queue.

    ``current_index``/``is_playing``/``position_sec`` describe the host's
    playhead inside ``tracks`` so the party continues exactly where the host's
    own playback was instead of starting from an empty queue.
    """
    name: str | None = None
    tracks: list[Track] = Field(default_factory=list)
    current_index: int = -1
    is_playing: bool = False
    position_sec: float = 0.0
    guests_can_control: bool = False


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
    if body.current_index < -1 or body.current_index >= len(body.tracks):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Party start index {body.current_index} is outside the "
                f"{len(body.tracks)}-track queue it was started with"
            ),
        )
    if not math.isfinite(body.position_sec) or body.position_sec < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Party playback position must be a finite, non-negative number",
        )
    if body.is_playing and body.current_index == -1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A party can only start playing with a selected queue track",
        )
    for track in body.tracks:
        _require_numeric_track_id(track)
    code = _generate_code(db)
    selected = body.current_index != -1
    host = PartyActor(user=user)
    session = PartySession(
        code=code,
        name=body.name or "",
        host_id=user.id,
        current_index=body.current_index,
        is_playing=body.is_playing,
        position_sec=body.position_sec if selected else 0.0,
        playback_updated_at=_utcnow() if selected else None,
        guests_can_control=body.guests_can_control,
        playback_changed_by=host.key if selected else "",
        playback_revision=1 if selected else 0,
    )
    db.add(session)
    db.flush()
    db.add_all(
        _party_track_row(session.code, track, position, host)
        for position, track in enumerate(body.tracks)
    )
    _upsert_member(db, session, user)
    return _commit_state_for(db, session, host)


@router.get(
    "/active",
    response_model=PartyState | None,
    description=(
        "Return the authenticated user's currently active party (as host or "
        "member), or null when the user is not in any party."
    ),
)
def get_active_party(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PartyState | None:
    session = db.scalar(
        select(PartySession)
        .join(PartyMember, PartyMember.session_code == PartySession.code)
        .where(PartyMember.user_id == user.id)
        .order_by(PartySession.updated_at.desc())
        .limit(1)
    )
    if session is None:
        return None
    actor = PartyActor(user=user)
    payload = _state_dict(db, session)
    return PartyState(**{**payload, **_viewer_fields(session.host_id, actor)})


@router.get(
    "/{code}",
    response_model=PartyState,
    description=(
        "Read party state and register or refresh the requesting user as a party "
        "member. Anonymous guests of this party (guest cookie) can read it too."
    ),
)
def get_party(
    code: str,
    actor: PartyActor = Depends(get_party_actor),
    db: Session = Depends(get_db),
) -> PartyState:
    session = _get_session(db, code)
    if actor.user is not None:
        _upsert_member(db, session, actor.user)
    return _commit_state_for(db, session, actor)


@router.get(
    "/{code}/cached-tracks",
    response_model=PartyCachedTracks,
    description=(
        "Return server-cached track IDs for any valid party participant "
        "(including anonymous party guests)."
    ),
)
def party_cached_tracks(
    code: str,
    actor: PartyActor = Depends(get_party_actor),
    db: Session = Depends(get_db),
) -> PartyCachedTracks:
    _get_session(db, code)
    return PartyCachedTracks(ids=storage.cached_ids())


@router.patch(
    "/{code}/settings",
    response_model=PartyState,
    description="Host-only: update party name and/or shared guest playback controls.",
)
def update_party_settings(
    code: str,
    body: PartySettingsUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PartyState:
    if body.name is None and body.guests_can_control is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one party setting (name or guests_can_control) must be provided",
        )
    session = _get_session(db, code)
    host = PartyActor(user=user)
    _require_host(session, host)
    if body.name is not None:
        session.name = body.name.strip()
    if body.guests_can_control is not None:
        session.guests_can_control = body.guests_can_control
    _touch_session(db, session)
    return _commit_state_for(db, session, host)


@router.delete(
    "/{code}",
    status_code=status.HTTP_204_NO_CONTENT,
    description=(
        "Host-only: end the party for everyone, broadcasting a terminal state "
        "frame with ended=true before removing the session."
    ),
)
def end_party(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    _require_host(session, PartyActor(user=user))
    _touch_session(db, session)
    revision = party_bus.utc_revision(session.updated_at)
    terminal_payload = _state_dict(db, session, ended=True)
    db.delete(session)
    db.commit()
    party_bus.publish(code, party_bus.StateFrame(revision, terminal_payload))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{code}/members/{member_key}",
    status_code=status.HTTP_204_NO_CONTENT,
    description="Host-only: remove a member ('u:<id>') or guest ('g:<id>') from the party.",
)
def kick_member(
    code: str,
    member_key: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    _require_host(session, PartyActor(user=user))
    kind, target_id = _parse_member_key(member_key)
    if kind == "u" and target_id == session.host_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Der Host kann sich nicht selbst aus der Party entfernen.",
        )
    if kind == "u":
        member = db.scalar(
            select(PartyMember).where(
                PartyMember.session_code == session.code,
                PartyMember.user_id == target_id,
            )
        )
        if member is None:
            raise HTTPException(status_code=404, detail="Party member not found")
        db.delete(member)
    else:
        guest = db.scalar(
            select(PartyGuest).where(
                PartyGuest.session_code == session.code,
                PartyGuest.id == target_id,
            )
        )
        if guest is None:
            raise HTTPException(status_code=404, detail="Party guest not found")
        db.delete(guest)
    _touch_session(db, session)
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{code}/join", response_model=PartyState)
def join_party(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PartyState:
    session = _get_session(db, code)
    _upsert_member(db, session, user)
    return _commit_state_for(db, session, PartyActor(user=user))


@router.post(
    "/{code}/guest",
    response_model=PartyState,
    description=(
        "Join the party anonymously with a nickname. Sets an HttpOnly guest "
        "cookie scoped to this party's API path; no account is involved."
    ),
)
def join_as_guest(
    code: str,
    body: PartyGuestJoin,
    response: Response,
    db: Session = Depends(get_db),
) -> PartyState:
    session = _get_session(db, code)
    nickname = " ".join(body.nickname.split())
    if not nickname:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Der Nickname darf nicht nur aus Leerzeichen bestehen.",
        )
    taken = {g.nickname.casefold() for g in session.guests} | {
        m.display_name.casefold() for m in session.members
    }
    if nickname.casefold() in taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Der Nickname „{nickname}“ ist in dieser Party schon vergeben.",
        )
    if len(session.guests) >= _MAX_GUESTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Diese Party hat schon {_MAX_GUESTS} Gäste; es kann niemand mehr anonym beitreten.",
        )
    token = new_guest_token()
    guest = PartyGuest(
        session_code=session.code,
        nickname=nickname,
        token_hash=hash_guest_token(token),
    )
    db.add(guest)
    db.flush()
    _touch_session(db, session)
    state = _commit_state_for(db, session, PartyActor(guest=guest))
    set_guest_cookie(response, session.code, token)
    return state


@router.post("/{code}/tracks", status_code=status.HTTP_204_NO_CONTENT)
def add_track(
    code: str,
    track: Track,
    actor: PartyActor = Depends(get_party_actor),
    db: Session = Depends(get_db),
    insert: Annotated[Literal["end", "next"], Query()] = "end",
) -> Response:
    _require_numeric_track_id(track)
    session = _get_session(db, code)
    if insert == "next":
        tracks = _ordered_tracks(session)
        target_pos = (
            session.current_index + 1
            if 0 <= session.current_index < len(tracks)
            else 0
        )
        for idx, existing in enumerate(tracks):
            existing.position = idx if idx < target_pos else idx + 1
        db.add(_party_track_row(session.code, track, target_pos, actor))
    else:
        next_pos = db.scalar(
            select(func.coalesce(func.max(PartyTrack.position), -1)).where(
                PartyTrack.session_code == session.code
            )
        )
        db.add(
            _party_track_row(
                session.code,
                track,
                (next_pos if next_pos is not None else -1) + 1,
                actor,
            )
        )
    _touch_session(db, session)
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{code}/tracks/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_track(
    code: str,
    item_id: int,
    actor: PartyActor = Depends(get_party_actor),
    db: Session = Depends(get_db),
) -> Response:
    """The host removes any track; participants remove own (or any upcoming when guests_can_control)."""
    session = _get_session(db, code)
    tracks = _ordered_tracks(session)
    current = _current_track(session, tracks)
    removed = next((track for track in tracks if track.id == item_id), None)
    if removed is None:
        raise HTTPException(status_code=404, detail="Party track not found")
    if not _is_host(session, actor):
        if removed is current:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Der Titel läuft gerade; nur der Host kann ihn jetzt entfernen.",
            )
        if not session.guests_can_control and removed.added_by_member != actor.key:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Du kannst nur Titel entfernen, die du selbst hinzugefügt hast.",
            )
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
        session.playback_changed_by = actor.key
        session.playback_revision = (session.playback_revision or 0) + 1
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
    actor: PartyActor = Depends(get_party_actor),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    _require_control(session, actor)
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
    actor: PartyActor = Depends(get_party_actor),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    _require_control(session, actor)
    if body.index < -1 or body.index >= len(session.tracks):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Party playback index must be -1 or refer to an existing queue track",
        )
    session.current_index = body.index
    if body.index == -1:
        session.is_playing = False
    # A track change resets the playback clock so listeners re-sync from the top.
    session.position_sec = 0.0
    session.playback_updated_at = _utcnow()
    session.playback_changed_by = actor.key
    session.playback_revision = (session.playback_revision or 0) + 1
    _touch_session(db, session)
    _commit_state(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{code}/playback", status_code=status.HTTP_204_NO_CONTENT)
def set_playback(
    code: str,
    body: PlaybackUpdate,
    actor: PartyActor = Depends(get_party_actor),
    db: Session = Depends(get_db),
) -> Response:
    """Set play/pause + position (host, or any participant when guests_can_control is on).

    Listeners use ``position_sec`` together with elapsed time since
    ``playback_updated_at`` to stay in sync. ``playback_changed_by`` and
    ``playback_revision`` let the host apply remote participant changes cleanly.
    """
    session = _get_session(db, code)
    _require_control(session, actor)
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
    session.playback_changed_by = actor.key
    session.playback_revision = (session.playback_revision or 0) + 1
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
    actor: PartyActor = Depends(get_party_actor),
) -> StreamingResponse:
    """SSE stream of the latest full party state, with idle heartbeats.

    EventSource cannot set headers, but auth is cookie-based so the session
    cookie rides along automatically through the proxy. Subscribe before
    a worker loads the initial canonical state so mutations during connection
    setup cannot disappear. No DB connection stays open for the stream's
    lifetime; revisions order subsequent in-memory frames.
    """
    # Read the actor's identity now; the stream outlives its DB session.
    viewer = _viewer_fields(-1, actor)
    viewer_user_id = actor.user.id if actor.user is not None else None
    subscription = party_bus.subscribe(code)
    try:
        host_id, initial = await run_in_threadpool(_stream_snapshot, code)
    except BaseException:
        party_bus.unsubscribe(code, subscription)
        raise
    viewer["is_host"] = viewer_user_id is not None and viewer_user_id == host_id

    async def event_stream() -> AsyncIterator[str]:
        try:
            latest = subscription.take_latest(initial)
            frame = {**latest.payload, **viewer}
            yield f"data: {json.dumps(frame)}\n\n"
            if frame.get("ended"):
                return
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
                frame = {**latest.payload, **viewer}
                yield f"data: {json.dumps(frame)}\n\n"
                if frame.get("ended"):
                    return
        finally:
            # Runs on client disconnect (generator cancelled) — no leak.
            party_bus.unsubscribe(code, subscription)

    return _PartyEventResponse(event_stream(), code, subscription)


@router.post("/{code}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_party(
    code: str,
    actor: PartyActor = Depends(get_party_actor),
    db: Session = Depends(get_db),
) -> Response:
    """Leave the party. A guest's identity ends with it (cookie cleared)."""
    session = _get_session(db, code)
    _touch_session(db, session)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    if actor.user is not None:
        db.execute(
            delete(PartyMember).where(
                PartyMember.session_code == session.code,
                PartyMember.user_id == actor.user.id,
            )
        )
    else:
        assert actor.guest is not None
        db.delete(actor.guest)
        clear_guest_cookie(response, session.code)
    _commit_state(db, session)
    return response
