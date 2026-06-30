"""Collaborative party sessions: shared queue and playback position."""
from datetime import datetime, timezone

import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db.models import PartyMember, PartySession, PartyTrack, User
from ..db.session import get_db
from ..schemas.party import PartyMemberOut, PartyState, PartyTrackOut
from ..schemas.track import Track, dump_artists, load_artists
from pydantic import BaseModel

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


def _build_state(db: Session, session: PartySession, user: User) -> PartyState:
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
    return PartyState(
        code=session.code,
        name=session.name,
        host_name=host_name,
        is_host=(user.id == session.host_id),
        current_index=session.current_index,
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


class PartyCreate(BaseModel):
    name: str | None = None


class CurrentUpdate(BaseModel):
    index: int


class OrderUpdate(BaseModel):
    ids: list[int]


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
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{code}/tracks/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_track(
    code: str,
    item_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    db.execute(
        delete(PartyTrack).where(
            PartyTrack.session_code == session.code,
            PartyTrack.id == item_id,
        )
    )
    session.updated_at = _utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{code}/tracks/order", status_code=status.HTTP_204_NO_CONTENT)
def reorder_tracks(
    code: str,
    body: OrderUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    position_of = {item_id: i for i, item_id in enumerate(body.ids)}
    for t in session.tracks:
        if t.id in position_of:
            t.position = position_of[t.id]
    session.updated_at = _utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{code}/current", status_code=status.HTTP_204_NO_CONTENT)
def set_current(
    code: str,
    body: CurrentUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    session = _get_session(db, code)
    session.current_index = body.index
    session.updated_at = _utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    return Response(status_code=status.HTTP_204_NO_CONTENT)
