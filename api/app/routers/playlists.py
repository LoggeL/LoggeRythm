"""Playlist CRUD, track membership, and collaborative playlist management."""
import glob
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user, get_current_user_optional
from ..config import STORAGE_DIR
from ..db.models import (
    Playlist,
    PlaylistCollaborator,
    PlaylistInvite,
    PlaylistTrack,
    User,
)
from ..db.session import get_db
from ..email_identity import find_user_by_email
from ..schemas.playlist import (
    PlaylistCollaborativeUpdate,
    PlaylistCollaboratorAdd,
    PlaylistCollaboratorOut,
    PlaylistCollaboratorUser,
    PlaylistCreate,
    PlaylistDetail,
    PlaylistEntryReorder,
    PlaylistInviteOut,
    PlaylistInvitePreview,
    PlaylistInviteStatus,
    PlaylistJoinResult,
    PlaylistReorder,
    PlaylistSummary,
    PlaylistTrackEntry,
    PlaylistUpdate,
)
from ..schemas.track import Track, dump_artists, load_artists
from ..services.playlist_export import (
    PlaylistExportError,
    PlaylistExportTrack,
    build_playlist_archive,
)
from ..uploads import image_extension, save_image_upload

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class _VisibilityUpdate(BaseModel):
    is_public: bool


_COVERS_DIR = os.path.join(STORAGE_DIR, "covers")
_INVITE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def _remove_cover_files(playlist_id: int, keep_path: str | None = None) -> None:
    for f in glob.glob(os.path.join(_COVERS_DIR, f"{playlist_id}.*")):
        if keep_path is not None and os.path.abspath(f) == os.path.abspath(keep_path):
            continue
        try:
            os.remove(f)
        except OSError:
            pass


def _bump_revision(pl: Playlist) -> None:
    pl.revision = int(pl.revision or 0) + 1


def _is_collaborator(db: Session, playlist_id: int, user_id: int) -> bool:
    return (
        db.scalar(
            select(PlaylistCollaborator.id).where(
                PlaylistCollaborator.playlist_id == playlist_id,
                PlaylistCollaborator.user_id == user_id,
            )
        )
        is not None
    )


def _load_access(
    db: Session, playlist_id: int, user: User | None
) -> tuple[Playlist, bool, bool]:
    """Return ``(playlist, is_owner, is_collaborator)`` if visible, else 404."""
    pl = db.get(Playlist, playlist_id)
    if pl is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    is_owner = user is not None and pl.user_id == user.id
    is_collaborator = (
        user is not None and not is_owner and _is_collaborator(db, pl.id, user.id)
    )
    if not is_owner and not is_collaborator and not pl.is_public:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return pl, is_owner, is_collaborator


def _require_owner(db: Session, playlist_id: int, user: User) -> Playlist:
    """Return the playlist if owned by ``user``; 404 if hidden, 403 if visible non-owner."""
    pl, is_owner, _ = _load_access(db, playlist_id, user)
    if not is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Nur der Eigentümer dieser Playlist kann diese Aktion ausführen.",
        )
    return pl


def _require_track_editor(db: Session, playlist_id: int, user: User) -> Playlist:
    """Return the playlist if ``user`` may edit tracks; 404 if hidden, 403 otherwise."""
    pl, is_owner, is_collaborator = _load_access(db, playlist_id, user)
    if is_owner:
        return pl
    if is_collaborator:
        if not pl.is_collaborative:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Diese Playlist ist derzeit nicht für gemeinsame Bearbeitung freigegeben.",
            )
        return pl
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Keine Berechtigung zum Bearbeiten dieser Playlist.",
    )


def _user_ref(user: User) -> PlaylistCollaboratorUser:
    return PlaylistCollaboratorUser(
        id=user.id,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
    )


def _require_owner_user(db: Session, pl: Playlist) -> User:
    owner = db.get(User, pl.user_id)
    if owner is None:
        raise RuntimeError(
            f"Playlist {pl.id} references missing owner user {pl.user_id}"
        )
    return owner


def _ordered_tracks(pl: Playlist) -> list[PlaylistTrack]:
    """Return a deterministic occurrence order, including legacy position ties."""
    return sorted(pl.tracks, key=lambda track: (track.position, track.id))


def _normalize_positions(tracks: list[PlaylistTrack]) -> None:
    ordered = sorted(tracks, key=lambda item: (item.position, item.id))
    for position, track in enumerate(ordered):
        track.position = position


def _pt_to_track(
    pt: PlaylistTrack,
    users_by_id: dict[int, User],
) -> PlaylistTrackEntry:
    artists = load_artists(pt.artists_json, pt.artist)
    added_by: PlaylistCollaboratorUser | None = None
    if pt.added_by_user_id is not None:
        adder = users_by_id.get(pt.added_by_user_id)
        if adder is None:
            raise RuntimeError(
                f"Playlist track {pt.id} references missing user {pt.added_by_user_id}"
            )
        added_by = _user_ref(adder)
    return PlaylistTrackEntry(
        id=pt.deezer_id,
        title=pt.title,
        artist=pt.artist,
        artist_id=artists[0].id if artists else "",
        artists=artists,
        album=pt.album,
        album_id=pt.album_id,
        cover=pt.cover_url or "",
        duration_sec=pt.duration_sec,
        preview_url=None,
        playlist_entry_id=pt.id,
        added_by=added_by,
        added_at=_as_utc(pt.added_at),
    )


def build_playlist_summaries(
    db: Session,
    playlists_list: list[Playlist],
    *,
    viewer: User | None,
) -> list[PlaylistSummary]:
    """Hydrate ``PlaylistSummary`` items with batch-loaded counts, owner info, and roles."""
    if not playlists_list:
        return []
    playlist_ids = [pl.id for pl in playlists_list]
    track_counts = {
        pid: int(count)
        for pid, count in db.execute(
            select(PlaylistTrack.playlist_id, func.count(PlaylistTrack.id))
            .where(PlaylistTrack.playlist_id.in_(playlist_ids))
            .group_by(PlaylistTrack.playlist_id)
        ).all()
    }
    collab_counts = {
        pid: int(count)
        for pid, count in db.execute(
            select(PlaylistCollaborator.playlist_id, func.count(PlaylistCollaborator.id))
            .where(PlaylistCollaborator.playlist_id.in_(playlist_ids))
            .group_by(PlaylistCollaborator.playlist_id)
        ).all()
    }
    owner_ids = {pl.user_id for pl in playlists_list}
    owners = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_(owner_ids))).all()
    }
    viewer_collab_ids: set[int] = set()
    if viewer is not None:
        viewer_collab_ids = set(
            db.scalars(
                select(PlaylistCollaborator.playlist_id).where(
                    PlaylistCollaborator.playlist_id.in_(playlist_ids),
                    PlaylistCollaborator.user_id == viewer.id,
                )
            ).all()
        )

    summaries: list[PlaylistSummary] = []
    for pl in playlists_list:
        owner = owners.get(pl.user_id)
        if owner is None:
            raise RuntimeError(
                f"Playlist {pl.id} references missing owner user {pl.user_id}"
            )
        is_owner = viewer is not None and pl.user_id == viewer.id
        is_collaborator = (
            viewer is not None and not is_owner and pl.id in viewer_collab_ids
        )
        is_collaborative = bool(pl.is_collaborative)
        summaries.append(
            PlaylistSummary(
                id=pl.id,
                name=pl.name,
                description=pl.description,
                cover_url=pl.cover_url,
                track_count=track_counts.get(pl.id, 0),
                is_public=bool(pl.is_public),
                owner_name=owner.display_name,
                owner_id=owner.id,
                owner_avatar_url=owner.avatar_url,
                is_collaborative=is_collaborative,
                is_owner=is_owner,
                is_collaborator=is_collaborator,
                can_edit_tracks=is_owner or (is_collaborator and is_collaborative),
                collaborator_count=collab_counts.get(pl.id, 0),
            )
        )
    return summaries


def _summary_for(db: Session, pl: Playlist, *, viewer: User | None) -> PlaylistSummary:
    return build_playlist_summaries(db, [pl], viewer=viewer)[0]


def _invite_out(invite: PlaylistInvite) -> PlaylistInviteOut:
    created_at = _as_utc(invite.created_at)
    if created_at is None:
        raise RuntimeError(f"Playlist invite {invite.id} has no created_at timestamp")
    return PlaylistInviteOut(
        token=invite.token,
        created_at=created_at,
        expires_at=_as_utc(invite.expires_at),
    )


def _generate_invite_token(db: Session) -> str:
    for _ in range(20):
        token = secrets.token_urlsafe(24)
        exists = db.scalar(
            select(PlaylistInvite.id).where(PlaylistInvite.token == token)
        )
        if exists is None:
            return token
    raise RuntimeError("Could not allocate a unique playlist invite token")


def _revoke_active_invites(db: Session, playlist_id: int, now: datetime) -> int:
    result = db.execute(
        update(PlaylistInvite)
        .where(
            PlaylistInvite.playlist_id == playlist_id,
            PlaylistInvite.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    return int(result.rowcount or 0)


def _resolve_active_invite(db: Session, token: str) -> tuple[PlaylistInvite, Playlist]:
    """Validate an invite token; 404 unknown, 410 revoked/expired/disabled."""
    if not _INVITE_TOKEN_RE.fullmatch(token):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Einladungslink wurde nicht gefunden.",
        )
    invite = db.scalar(select(PlaylistInvite).where(PlaylistInvite.token == token))
    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Einladungslink wurde nicht gefunden.",
        )
    pl = db.get(Playlist, invite.playlist_id)
    if pl is None:
        raise RuntimeError(
            f"Playlist invite {invite.id} references missing playlist {invite.playlist_id}"
        )
    if invite.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Dieser Einladungslink wurde widerrufen.",
        )
    expires_at = _as_utc(invite.expires_at)
    if expires_at is not None and expires_at <= _utcnow():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Dieser Einladungslink ist abgelaufen.",
        )
    if not pl.is_collaborative:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Die Zusammenarbeit für diese Playlist ist deaktiviert.",
        )
    return invite, pl


@router.get("", response_model=list[PlaylistSummary])
def list_playlists(
    scope: Literal["all", "owned", "collaborative"] = Query(
        default="all",
        description=(
            "Filter playlists: 'all' returns owned and collaborated playlists, "
            "'owned' returns playlists owned by the user, and 'collaborative' "
            "returns collaborated playlists plus owned collaborative playlists."
        ),
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PlaylistSummary]:
    collab_playlist_ids = select(PlaylistCollaborator.playlist_id).where(
        PlaylistCollaborator.user_id == user.id
    )
    q = select(Playlist)
    if scope == "owned":
        q = q.where(Playlist.user_id == user.id)
    elif scope == "collaborative":
        q = q.where(
            or_(
                Playlist.id.in_(collab_playlist_ids),
                (Playlist.user_id == user.id) & Playlist.is_collaborative.is_(True),
            )
        )
    else:
        q = q.where(
            or_(
                Playlist.user_id == user.id,
                Playlist.id.in_(collab_playlist_ids),
            )
        )
    rows = list(db.scalars(q.order_by(Playlist.created_at.desc(), Playlist.id.desc())).all())
    return build_playlist_summaries(db, rows, viewer=user)


@router.post("", response_model=PlaylistSummary, status_code=status.HTTP_201_CREATED)
def create_playlist(
    body: PlaylistCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    pl = Playlist(
        user_id=user.id,
        name=body.name,
        description=body.description,
        is_collaborative=body.is_collaborative,
    )
    db.add(pl)
    db.commit()
    db.refresh(pl)
    return _summary_for(db, pl, viewer=user)


@router.get("/public", response_model=list[PlaylistSummary])
def public_playlists(
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[PlaylistSummary]:
    """Public, non-empty playlists from other users — for the community shelf."""
    q = (
        select(Playlist)
        .join(PlaylistTrack, PlaylistTrack.playlist_id == Playlist.id)
        .where(Playlist.is_public.is_(True))
        .group_by(Playlist.id)
        .order_by(Playlist.created_at.desc(), Playlist.id.desc())
        .limit(24)
    )
    if user is not None:
        collab_playlist_ids = select(PlaylistCollaborator.playlist_id).where(
            PlaylistCollaborator.user_id == user.id
        )
        q = q.where(
            Playlist.user_id != user.id,
            ~Playlist.id.in_(collab_playlist_ids),
        )
    rows = list(db.scalars(q).all())
    return build_playlist_summaries(db, rows, viewer=user)


@router.get("/invites/{token}", response_model=PlaylistInvitePreview)
def preview_playlist_invite(
    token: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistInvitePreview:
    """Preview a collaborative playlist before accepting an invite link."""
    _, pl = _resolve_active_invite(db, token)
    owner = _require_owner_user(db, pl)
    track_count = int(
        db.scalar(
            select(func.count(PlaylistTrack.id)).where(
                PlaylistTrack.playlist_id == pl.id
            )
        )
        or 0
    )
    collaborator_count = int(
        db.scalar(
            select(func.count(PlaylistCollaborator.id)).where(
                PlaylistCollaborator.playlist_id == pl.id
            )
        )
        or 0
    )
    is_owner = pl.user_id == user.id
    already_collaborator = not is_owner and _is_collaborator(db, pl.id, user.id)
    return PlaylistInvitePreview(
        playlist_id=pl.id,
        name=pl.name,
        description=pl.description,
        cover_url=pl.cover_url,
        track_count=track_count,
        collaborator_count=collaborator_count,
        owner=_user_ref(owner),
        is_owner=is_owner,
        already_collaborator=already_collaborator,
    )


@router.post("/invites/{token}/accept", response_model=PlaylistJoinResult)
def accept_playlist_invite(
    token: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistJoinResult:
    """Accept a collaborative playlist invite link and join as an editor."""
    invite, pl = _resolve_active_invite(db, token)
    if pl.user_id == user.id:
        return PlaylistJoinResult(
            playlist_id=pl.id,
            playlist_name=pl.name,
            joined=False,
            already_member=True,
            role="owner",
        )
    if _is_collaborator(db, pl.id, user.id):
        return PlaylistJoinResult(
            playlist_id=pl.id,
            playlist_name=pl.name,
            joined=False,
            already_member=True,
            role="editor",
        )
    playlist_id = pl.id
    playlist_name = pl.name
    db.add(
        PlaylistCollaborator(
            playlist_id=playlist_id,
            user_id=user.id,
            role="editor",
            added_by_user_id=invite.created_by_user_id,
            joined_at=_utcnow(),
        )
    )
    _bump_revision(pl)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if _is_collaborator(db, playlist_id, user.id):
            return PlaylistJoinResult(
                playlist_id=playlist_id,
                playlist_name=playlist_name,
                joined=False,
                already_member=True,
                role="editor",
            )
        raise
    return PlaylistJoinResult(
        playlist_id=playlist_id,
        playlist_name=playlist_name,
        joined=True,
        already_member=False,
        role="editor",
    )


def _require_joined_at(row: PlaylistCollaborator) -> datetime:
    joined_at = _as_utc(row.joined_at)
    if joined_at is None:
        raise RuntimeError(
            f"Playlist collaborator {row.id} on playlist {row.playlist_id} "
            "has no joined_at timestamp"
        )
    return joined_at


@router.get("/{playlist_id}", response_model=PlaylistDetail)
def get_playlist(
    playlist_id: int,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    pl, is_owner, is_collaborator = _load_access(db, playlist_id, user)
    owner = _require_owner_user(db, pl)
    ordered_tracks = _ordered_tracks(pl)
    collab_rows = sorted(
        pl.collaborators,
        key=lambda row: (_require_joined_at(row), row.id),
    )

    user_ids: set[int] = {pl.user_id}
    user_ids.update(row.user_id for row in collab_rows)
    user_ids.update(
        pt.added_by_user_id for pt in ordered_tracks if pt.added_by_user_id is not None
    )
    users_by_id = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    }

    collaborators: list[PlaylistCollaboratorOut] = []
    for row in collab_rows:
        collab_user = users_by_id.get(row.user_id)
        if collab_user is None:
            raise RuntimeError(
                f"Playlist collaborator {row.id} on playlist {pl.id} "
                f"references missing user {row.user_id}"
            )
        role: Literal["owner", "editor"] = "editor"
        if row.role != "editor":
            raise RuntimeError(
                f"Playlist collaborator {row.id} on playlist {pl.id} "
                f"has unsupported role {row.role!r}"
            )
        collaborators.append(
            PlaylistCollaboratorOut(
                user_id=collab_user.id,
                display_name=collab_user.display_name,
                avatar_url=collab_user.avatar_url,
                role=role,
                joined_at=_require_joined_at(row),
            )
        )

    is_collaborative = bool(pl.is_collaborative)
    return PlaylistDetail(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        cover_url=pl.cover_url,
        is_public=bool(pl.is_public),
        is_owner=is_owner,
        owner_name=owner.display_name,
        owner_id=owner.id,
        owner_avatar_url=owner.avatar_url,
        is_collaborative=is_collaborative,
        is_collaborator=is_collaborator,
        can_edit_tracks=is_owner or (is_collaborator and is_collaborative),
        collaborators=collaborators,
        collaborator_count=len(collaborators),
        revision=int(pl.revision or 0),
        tracks=[_pt_to_track(pt, users_by_id) for pt in ordered_tracks],
    )


@router.get(
    "/{playlist_id}/export",
    response_class=Response,
    responses={
        200: {
            "description": "ZIP archive containing the playlist's ordered MP3 tracks.",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
            "headers": {
                "Content-Disposition": {"schema": {"type": "string"}},
                "X-Playlist-Track-Count": {"schema": {"type": "string"}},
            },
        },
    },
)
async def export_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Download all tracks in a visible playlist as an ordered MP3 ZIP."""
    pl, _, _ = _load_access(db, playlist_id, user)

    tracks = [
        PlaylistExportTrack(
            deezer_id=track.deezer_id,
            artist=track.artist,
            title=track.title,
        )
        for track in _ordered_tracks(pl)
    ]
    try:
        archive_path, archive_filename = await run_in_threadpool(
            build_playlist_archive,
            pl.name,
            tracks,
            requested_by_user_id=user.id,
        )
    except PlaylistExportError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Playlist export failed: {exc}",
        ) from exc

    return FileResponse(
        archive_path,
        filename=archive_filename,
        media_type="application/zip",
        headers={"X-Playlist-Track-Count": str(len(tracks))},
        background=BackgroundTask(os.remove, archive_path),
    )


@router.patch("/{playlist_id}", response_model=PlaylistSummary)
def update_playlist(
    playlist_id: int,
    body: PlaylistUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    pl = _require_owner(db, playlist_id, user)
    if body.name is not None:
        pl.name = body.name
    if body.description is not None:
        pl.description = body.description
    _bump_revision(pl)
    db.commit()
    db.refresh(pl)
    return _summary_for(db, pl, viewer=user)


@router.patch("/{playlist_id}/visibility", response_model=PlaylistSummary)
def set_visibility(
    playlist_id: int,
    body: _VisibilityUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    pl = _require_owner(db, playlist_id, user)
    pl.is_public = body.is_public
    _bump_revision(pl)
    db.commit()
    db.refresh(pl)
    return _summary_for(db, pl, viewer=user)


@router.patch("/{playlist_id}/collaborative", response_model=PlaylistSummary)
def set_collaborative(
    playlist_id: int,
    body: PlaylistCollaborativeUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    """Owner-only: toggle collaboration. Disabling revokes active invite links while keeping collaborators read-only."""
    pl = _require_owner(db, playlist_id, user)
    pl.is_collaborative = body.is_collaborative
    if not body.is_collaborative:
        _revoke_active_invites(db, pl.id, _utcnow())
    _bump_revision(pl)
    db.commit()
    db.refresh(pl)
    return _summary_for(db, pl, viewer=user)


@router.get("/{playlist_id}/invite", response_model=PlaylistInviteStatus)
def get_playlist_invite(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistInviteStatus:
    """Owner-only: inspect the active invite link for this playlist, if any."""
    pl = _require_owner(db, playlist_id, user)
    if not pl.is_collaborative:
        return PlaylistInviteStatus(invite=None)
    invite = db.scalar(
        select(PlaylistInvite)
        .where(
            PlaylistInvite.playlist_id == pl.id,
            PlaylistInvite.revoked_at.is_(None),
        )
        .order_by(PlaylistInvite.created_at.desc(), PlaylistInvite.id.desc())
        .limit(1)
    )
    if invite is None:
        return PlaylistInviteStatus(invite=None)
    expires_at = _as_utc(invite.expires_at)
    if expires_at is not None and expires_at <= _utcnow():
        return PlaylistInviteStatus(invite=None)
    return PlaylistInviteStatus(invite=_invite_out(invite))


@router.post(
    "/{playlist_id}/invite",
    response_model=PlaylistInviteOut,
    status_code=status.HTTP_201_CREATED,
)
def create_or_rotate_playlist_invite(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistInviteOut:
    """Owner-only: create or rotate the active invite token (revokes any previous link)."""
    pl = _require_owner(db, playlist_id, user)
    if not pl.is_collaborative:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Aktiviere zuerst die Zusammenarbeit für diese Playlist, um einen Einladungslink zu erstellen.",
        )
    now = _utcnow()
    _revoke_active_invites(db, pl.id, now)
    invite = PlaylistInvite(
        playlist_id=pl.id,
        token=_generate_invite_token(db),
        created_by_user_id=user.id,
        created_at=now,
        expires_at=None,
    )
    db.add(invite)
    _bump_revision(pl)
    db.commit()
    db.refresh(invite)
    return _invite_out(invite)


@router.delete("/{playlist_id}/invite", status_code=status.HTTP_204_NO_CONTENT)
def revoke_playlist_invite(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Owner-only: revoke the active invite link without removing existing collaborators."""
    pl = _require_owner(db, playlist_id, user)
    revoked = _revoke_active_invites(db, pl.id, _utcnow())
    if revoked > 0:
        _bump_revision(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{playlist_id}/collaborators",
    response_model=PlaylistCollaboratorOut,
    status_code=status.HTTP_201_CREATED,
)
def add_collaborator(
    playlist_id: int,
    body: PlaylistCollaboratorAdd,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistCollaboratorOut:
    """Owner-only: directly add an approved user as a collaborator by email."""
    pl = _require_owner(db, playlist_id, user)
    if not pl.is_collaborative:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Aktiviere zuerst die Zusammenarbeit für diese Playlist.",
        )
    target = find_user_by_email(db, str(body.email))
    if target is None or (not target.is_approved and not target.is_admin):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kein freigegebenes Konto mit dieser E-Mail-Adresse gefunden.",
        )
    if target.id == pl.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Der Eigentümer ist bereits Mitglied dieser Playlist.",
        )
    if _is_collaborator(db, pl.id, target.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Dieses Konto ist bereits Mitwirkender dieser Playlist.",
        )
    playlist_id_val = pl.id
    collab = PlaylistCollaborator(
        playlist_id=playlist_id_val,
        user_id=target.id,
        role="editor",
        added_by_user_id=user.id,
        joined_at=_utcnow(),
    )
    db.add(collab)
    _bump_revision(pl)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_collaborator(db, playlist_id_val, target.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Dieses Konto ist bereits Mitwirkender dieser Playlist.",
            ) from exc
        raise
    db.refresh(collab)
    return PlaylistCollaboratorOut(
        user_id=target.id,
        display_name=target.display_name,
        avatar_url=target.avatar_url,
        role="editor",
        joined_at=_as_utc(collab.joined_at),
    )


@router.delete(
    "/{playlist_id}/collaborators/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_collaborator(
    playlist_id: int,
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Owner-only: remove a collaborator from this playlist."""
    pl = _require_owner(db, playlist_id, user)
    if user_id == pl.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Der Eigentümer kann nicht als Mitwirkender entfernt werden.",
        )
    collab = db.scalar(
        select(PlaylistCollaborator).where(
            PlaylistCollaborator.playlist_id == pl.id,
            PlaylistCollaborator.user_id == user_id,
        )
    )
    if collab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitwirkender nicht gefunden.",
        )
    db.delete(collab)
    _bump_revision(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{playlist_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Leave a collaborative playlist (works even when collaboration is paused)."""
    pl, is_owner, is_collaborator = _load_access(db, playlist_id, user)
    if is_owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Der Eigentümer kann seine eigene Playlist nicht verlassen.",
        )
    if not is_collaborator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Du bist kein Mitwirkender dieser Playlist.",
        )
    collab = db.scalar(
        select(PlaylistCollaborator).where(
            PlaylistCollaborator.playlist_id == pl.id,
            PlaylistCollaborator.user_id == user.id,
        )
    )
    if collab is None:
        raise RuntimeError(
            f"Collaborator row vanished for user {user.id} on playlist {pl.id}"
        )
    db.delete(collab)
    _bump_revision(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _require_owner(db, playlist_id, user)
    db.delete(pl)
    db.commit()
    _remove_cover_files(playlist_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{playlist_id}/cover", response_model=PlaylistSummary)
def set_cover(
    playlist_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSummary:
    pl = _require_owner(db, playlist_id, user)
    ext = image_extension(file.content_type)
    path = os.path.join(_COVERS_DIR, f"{playlist_id}{ext}")
    save_image_upload(file, path, ext)
    _remove_cover_files(playlist_id, keep_path=path)
    # cache-bust via file mtime so the new image replaces the cached one
    pl.cover_url = f"/api/playlists/{playlist_id}/cover?v={int(os.path.getmtime(path))}"
    _bump_revision(pl)
    db.commit()
    db.refresh(pl)
    return _summary_for(db, pl, viewer=user)


@router.get("/{playlist_id}/cover")
def get_cover(
    playlist_id: int,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> FileResponse:
    # Same visibility rule as get_playlist: owner, collaborator, or public.
    _load_access(db, playlist_id, user)
    for f in glob.glob(os.path.join(_COVERS_DIR, f"{playlist_id}.*")):
        if os.path.isfile(f):
            return FileResponse(f)
    raise HTTPException(status_code=404, detail="Kein Cover")


@router.post("/{playlist_id}/tracks", status_code=status.HTTP_204_NO_CONTENT)
def add_track(
    playlist_id: int,
    track: Track,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _require_track_editor(db, playlist_id, user)
    # Idempotent: skip if the track is already in the playlist.
    exists = db.scalar(
        select(PlaylistTrack.id).where(
            PlaylistTrack.playlist_id == pl.id,
            PlaylistTrack.deezer_id == track.id,
        )
    )
    if exists is not None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    next_pos = db.scalar(
        select(func.coalesce(func.max(PlaylistTrack.position), -1)).where(
            PlaylistTrack.playlist_id == pl.id
        )
    )
    db.add(
        PlaylistTrack(
            playlist_id=pl.id,
            deezer_id=track.id,
            title=track.title,
            artist=track.artist,
            artists_json=dump_artists(track),
            album=track.album,
            album_id=str(track.album_id or ""),
            cover_url=track.cover or None,
            duration_sec=track.duration_sec,
            position=int(next_pos if next_pos is not None else -1) + 1,
            added_by_user_id=user.id,
        )
    )
    # Set a cover from the first added track if the playlist has none.
    if not pl.cover_url and track.cover:
        pl.cover_url = track.cover
    _bump_revision(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{playlist_id}/tracks/bulk")
def add_tracks_bulk(
    playlist_id: int,
    tracks: list[Track],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    pl = _require_track_editor(db, playlist_id, user)
    existing = set(
        db.scalars(
            select(PlaylistTrack.deezer_id).where(PlaylistTrack.playlist_id == pl.id)
        ).all()
    )
    pos = db.scalar(
        select(func.coalesce(func.max(PlaylistTrack.position), -1)).where(
            PlaylistTrack.playlist_id == pl.id
        )
    )
    pos = pos if pos is not None else -1
    added = 0
    for track in tracks:
        if track.id in existing:
            continue
        existing.add(track.id)
        pos += 1
        db.add(
            PlaylistTrack(
                playlist_id=pl.id,
                deezer_id=track.id,
                title=track.title,
                artist=track.artist,
                artists_json=dump_artists(track),
                album=track.album,
                album_id=str(track.album_id or ""),
                cover_url=track.cover or None,
                duration_sec=track.duration_sec,
                position=pos,
                added_by_user_id=user.id,
            )
        )
        if not pl.cover_url and track.cover:
            pl.cover_url = track.cover
        added += 1
    if added > 0:
        _bump_revision(pl)
    db.commit()
    return {"added": added}


@router.patch("/{playlist_id}/tracks/order", status_code=status.HTTP_204_NO_CONTENT)
def reorder_tracks(
    playlist_id: int,
    body: PlaylistReorder,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _require_track_editor(db, playlist_id, user)
    position_of = {deezer_id: i for i, deezer_id in enumerate(body.deezer_ids)}
    for pt in pl.tracks:
        if pt.deezer_id in position_of:
            pt.position = position_of[pt.deezer_id]
    _bump_revision(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/{playlist_id}/tracks/entries/order",
    status_code=status.HTTP_204_NO_CONTENT,
)
def reorder_playlist_entries(
    playlist_id: int,
    body: PlaylistEntryReorder,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Atomically reorder an exact stable-entry snapshot.

    A stale add/remove or a duplicate ID is rejected instead of partially
    mutating positions.  This is the duplicate-safe v2 contract; the legacy
    Deezer-ID route above remains available to existing callers.
    """
    pl = _require_track_editor(db, playlist_id, user)
    tracks = _ordered_tracks(pl)
    current_ids = [track.id for track in tracks]
    requested_ids = body.entry_ids
    if (
        len(requested_ids) != len(current_ids)
        or len(set(requested_ids)) != len(requested_ids)
        or set(requested_ids) != set(current_ids)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Playlist entries changed; reload before reordering",
        )
    by_id = {track.id: track for track in tracks}
    for position, entry_id in enumerate(requested_ids):
        by_id[entry_id].position = position
    _bump_revision(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{playlist_id}/tracks/entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_playlist_entry(
    playlist_id: int,
    entry_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Remove exactly one stable playlist occurrence, even for duplicates."""
    pl = _require_track_editor(db, playlist_id, user)
    entry = db.scalar(
        select(PlaylistTrack).where(
            PlaylistTrack.playlist_id == pl.id,
            PlaylistTrack.id == entry_id,
        )
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Playlist entry not found")
    db.delete(entry)
    remaining = [track for track in _ordered_tracks(pl) if track.id != entry_id]
    _normalize_positions(remaining)
    _bump_revision(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{playlist_id}/tracks/{deezer_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_track(
    playlist_id: int,
    deezer_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _require_track_editor(db, playlist_id, user)
    result = db.execute(
        delete(PlaylistTrack).where(
            PlaylistTrack.playlist_id == pl.id,
            PlaylistTrack.deezer_id == deezer_id,
        )
    )
    if result.rowcount:
        _bump_revision(pl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
