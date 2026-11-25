"""Playlist CRUD, track membership, collaborative playlists, sync manifest, deduplication & blends."""
import asyncio
import glob
import json
import os
import re
import secrets
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.types import Receive, Scope, Send

from ..auth import get_current_user, get_current_user_optional
from ..config import STORAGE_DIR
from ..db.models import (
    FollowedArtist,
    Like,
    Play,
    Playlist,
    PlaylistCollaborator,
    PlaylistInvite,
    PlaylistTrack,
    StoredLyrics,
    StoredTrack,
    User,
)
from ..db.session import SessionLocal, get_db
from ..email_identity import find_user_by_email
from ..schemas.playlist import (
    OfflineLyricsEntry,
    PlaylistBlendOut,
    PlaylistCollaborativeUpdate,
    PlaylistCollaboratorAdd,
    PlaylistCollaboratorOut,
    PlaylistCollaboratorUser,
    PlaylistCreate,
    PlaylistDeduplicateResult,
    PlaylistDetail,
    PlaylistDuplicateGroup,
    PlaylistDuplicatesOut,
    PlaylistEntryReorder,
    PlaylistInviteOut,
    PlaylistInvitePreview,
    PlaylistInviteStatus,
    PlaylistJoinResult,
    PlaylistReorder,
    PlaylistSummary,
    PlaylistSyncManifest,
    PlaylistSyncTrackItem,
    PlaylistTrackEntry,
    PlaylistUpdate,
)
from ..schemas.track import Track, dump_artists, load_artists
from ..services import deezer_client as dc
from ..services import playlist_bus, recommend, storage
from ..services.discovery import DiscoveryError
from ..services.lastfm_client import LastfmError
from ..services.playlist_export import (
    PlaylistExportError,
    PlaylistExportTrack,
    build_playlist_archive,
)
from ..services.track_identity import (
    TrackDescriptor,
    group_duplicates,
    normalize_isrc,
    pick_preferred_entry,
    resolve_record_types_for_groups,
    same_recording,
)
from ..uploads import image_extension, save_image_upload
from .errors import to_http

router = APIRouter(prefix="/api/playlists", tags=["playlists"])
_PLAYLIST_SSE_HEARTBEAT_SEC = 20.0


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


def _commit_and_publish(db: Session, pl: Playlist, event: str = "updated") -> None:
    playlist_id = pl.id
    revision = int(pl.revision or 0)
    db.commit()
    playlist_bus.publish(playlist_id, revision, event=event)


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
    stored: StoredTrack | None = None,
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
    gain_db = (
        pt.loudness_gain_db
        if pt.loudness_gain_db is not None
        else (stored.loudness_gain_db if stored is not None else None)
    )
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
        isrc=pt.isrc or "",
        loudness_gain_db=gain_db,
        loudness_lufs=stored.loudness_lufs if stored is not None else None,
        loudness_peak=stored.loudness_peak if stored is not None else None,
        bpm=stored.bpm if stored is not None else None,
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
        _commit_and_publish(db, pl)
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


def _blend_candidate_pool(db: Session, user_id: int) -> tuple[list[dict], set[str]]:
    """Collect a user's top played + liked tracks and artist names for Blending."""
    candidates: list[dict] = []
    seen_descs: list[TrackDescriptor] = []
    artists: set[str] = set()

    top_plays = db.execute(
        select(
            Play.deezer_id,
            func.max(Play.title).label("title"),
            func.max(Play.artist).label("artist"),
            func.max(Play.artist_id).label("artist_id"),
            func.max(Play.artists_json).label("artists_json"),
            func.max(Play.album).label("album"),
            func.max(Play.album_id).label("album_id"),
            func.max(Play.cover_url).label("cover_url"),
            func.max(Play.duration_sec).label("duration_sec"),
            func.count(Play.id).label("cnt"),
        )
        .where(Play.user_id == user_id, Play.deezer_id != "")
        .group_by(Play.deezer_id)
        .order_by(func.count(Play.id).desc())
        .limit(40)
    ).all()
    for r in top_plays:
        if r.artist:
            artists.add(r.artist.strip())
        desc = TrackDescriptor(
            deezer_id=r.deezer_id,
            isrc="",
            title=r.title or "",
            artist=r.artist or "",
            duration_sec=max(int(r.duration_sec or 0), 0),
        )
        if any(same_recording(existing, desc) for existing in seen_descs):
            continue
        seen_descs.append(desc)
        candidates.append(
            {
                "deezer_id": r.deezer_id,
                "isrc": "",
                "title": r.title or "",
                "artist": r.artist or "",
                "artists_json": r.artists_json or "[]",
                "album": r.album or "",
                "album_id": r.album_id or "",
                "cover_url": r.cover_url,
                "duration_sec": max(int(r.duration_sec or 0), 0),
                "loudness_gain_db": None,
                "owner_user_id": user_id,
                "desc": desc,
            }
        )

    likes = db.scalars(
        select(Like)
        .where(Like.user_id == user_id)
        .order_by(Like.created_at.desc())
        .limit(60)
    ).all()
    for lk in likes:
        if lk.artist:
            artists.add(lk.artist.strip())
        desc = TrackDescriptor(
            deezer_id=lk.deezer_id,
            isrc=normalize_isrc(lk.isrc),
            title=lk.title or "",
            artist=lk.artist or "",
            duration_sec=max(int(lk.duration_sec or 0), 0),
        )
        if any(same_recording(existing, desc) for existing in seen_descs):
            continue
        seen_descs.append(desc)
        candidates.append(
            {
                "deezer_id": lk.deezer_id,
                "isrc": normalize_isrc(lk.isrc),
                "title": lk.title or "",
                "artist": lk.artist or "",
                "artists_json": lk.artists_json or "[]",
                "album": lk.album or "",
                "album_id": lk.album_id or "",
                "cover_url": lk.cover_url,
                "duration_sec": max(int(lk.duration_sec or 0), 0),
                "loudness_gain_db": lk.loudness_gain_db,
                "owner_user_id": user_id,
                "desc": desc,
            }
        )

    follows = db.scalars(
        select(FollowedArtist.name).where(FollowedArtist.user_id == user_id)
    ).all()
    for name in follows:
        if name and name.strip():
            artists.add(name.strip())

    return candidates, artists


@router.post(
    "/blend/{other_user_id}",
    response_model=PlaylistBlendOut,
    status_code=status.HTTP_201_CREATED,
    description=(
        "Create a collaborative Blend playlist combining both users' plays and "
        "likes with a computed taste-match score."
    ),
)
def create_blend_playlist(
    other_user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistBlendOut:
    if other_user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Du kannst keinen Blend mit dir selbst erstellen.",
        )
    other = db.get(User, other_user_id)
    if other is None or (not other.is_approved and not other.is_admin):
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")

    mine, my_artists = _blend_candidate_pool(db, user.id)
    theirs, their_artists = _blend_candidate_pool(db, other.id)

    my_artists_fold = {a.casefold(): a for a in my_artists}
    their_artists_fold = {a.casefold(): a for a in their_artists}
    shared_artist_keys = sorted(set(my_artists_fold) & set(their_artists_fold))
    shared_artists = [my_artists_fold[k] for k in shared_artist_keys]

    shared_tracks: list[dict] = []
    mine_unique: list[dict] = []
    theirs_unique: list[dict] = []
    their_matched_indices: set[int] = set()

    for item in mine:
        matched_idx = next(
            (
                idx
                for idx, other_item in enumerate(theirs)
                if same_recording(item["desc"], other_item["desc"])
            ),
            None,
        )
        if matched_idx is not None:
            their_matched_indices.add(matched_idx)
            shared_tracks.append(item)
        else:
            mine_unique.append(item)

    for idx, other_item in enumerate(theirs):
        if idx not in their_matched_indices:
            theirs_unique.append(other_item)

    artist_union = len(set(my_artists_fold) | set(their_artists_fold))
    artist_ratio = (len(shared_artists) / artist_union) if artist_union else 0.0
    track_union = len(mine) + len(theirs) - len(shared_tracks)
    track_ratio = (len(shared_tracks) / track_union) if track_union else 0.0
    # Weighted blend match: artist overlap + track overlap, scaled cleanly to 0..100.
    match_percent = int(round(min(1.0, artist_ratio * 0.65 + track_ratio * 0.35) * 100))

    blended: list[dict] = []
    blended_descs: list[TrackDescriptor] = []

    def _add_candidate(item: dict) -> None:
        if len(blended) >= 40:
            return
        if any(same_recording(existing, item["desc"]) for existing in blended_descs):
            return
        blended_descs.append(item["desc"])
        blended.append(item)

    for item in shared_tracks:
        _add_candidate(item)

    max_len = max(len(mine_unique), len(theirs_unique))
    for idx in range(max_len):
        if idx < len(mine_unique):
            _add_candidate(mine_unique[idx])
        if idx < len(theirs_unique):
            _add_candidate(theirs_unique[idx])
        if len(blended) >= 40:
            break

    # Optional Last.fm bridge tracks when the blend is still short and shared artists exist.
    if len(blended) < 20 and shared_tracks and recommend.LASTFM_API_KEY:
        seed = shared_tracks[0]
        if seed["artist"] and seed["title"]:
            try:
                bridges = recommend.similar_tracks(seed["artist"], seed["title"], 10)
            except (dc.DeezerClientError, LastfmError, DiscoveryError) as error:
                raise to_http(error) from error
            for track_dict in bridges:
                desc = TrackDescriptor(
                    deezer_id=str(track_dict.get("id") or ""),
                    isrc=normalize_isrc(track_dict.get("isrc")),
                    title=str(track_dict.get("title") or ""),
                    artist=str(track_dict.get("artist") or ""),
                    duration_sec=int(track_dict.get("duration_sec") or 0),
                )
                if not desc.deezer_id:
                    continue
                _add_candidate(
                    {
                        "deezer_id": desc.deezer_id,
                        "isrc": desc.isrc,
                        "title": desc.title,
                        "artist": desc.artist,
                        "artists_json": dump_artists(Track.model_validate(track_dict)),
                        "album": str(track_dict.get("album") or ""),
                        "album_id": str(track_dict.get("album_id") or ""),
                        "cover_url": track_dict.get("cover") or None,
                        "duration_sec": desc.duration_sec,
                        "loudness_gain_db": track_dict.get("loudness_gain_db"),
                        "owner_user_id": user.id,
                        "desc": desc,
                    }
                )

    my_name = user.display_name or user.email.split("@", 1)[0]
    other_name = other.display_name or other.email.split("@", 1)[0]
    pl = Playlist(
        user_id=user.id,
        name=f"Blend: {my_name} × {other_name}",
        description=f"{match_percent}% Taste Match",
        cover_url=next((t["cover_url"] for t in blended if t.get("cover_url")), None),
        is_collaborative=True,
        revision=1,
    )
    db.add(pl)
    db.flush()
    db.add(
        PlaylistCollaborator(
            playlist_id=pl.id,
            user_id=other.id,
            role="editor",
            added_by_user_id=user.id,
            joined_at=_utcnow(),
        )
    )
    for pos, item in enumerate(blended):
        db.add(
            PlaylistTrack(
                playlist_id=pl.id,
                deezer_id=item["deezer_id"],
                isrc=item["isrc"],
                title=item["title"],
                artist=item["artist"],
                artists_json=item["artists_json"],
                album=item["album"],
                album_id=item["album_id"],
                cover_url=item["cover_url"],
                duration_sec=item["duration_sec"],
                loudness_gain_db=item["loudness_gain_db"],
                position=pos,
                added_by_user_id=item["owner_user_id"],
            )
        )
    db.commit()
    detail = get_playlist(pl.id, user=user, db=db)
    return PlaylistBlendOut(
        playlist=detail,
        match_percent=match_percent,
        shared_artists=shared_artists[:10],
        shared_tracks_count=len(shared_tracks),
        other_user=_user_ref(other),
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

    stored_by_id: dict[str, StoredTrack] = {}
    if ordered_tracks:
        track_ids = {pt.deezer_id for pt in ordered_tracks}
        stored_by_id = {
            row.deezer_id: row
            for row in db.scalars(
                select(StoredTrack).where(StoredTrack.deezer_id.in_(track_ids))
            ).all()
        }

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
        tracks=[
            _pt_to_track(pt, users_by_id, stored_by_id.get(pt.deezer_id))
            for pt in ordered_tracks
        ],
    )


class _PlaylistEventResponse(StreamingResponse):
    def __init__(
        self,
        content: AsyncIterator[str],
        playlist_id: int,
        subscription: playlist_bus.Subscription,
    ) -> None:
        super().__init__(
            content,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )
        self._playlist_id = playlist_id
        self._subscription = subscription

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            playlist_bus.unsubscribe(self._playlist_id, self._subscription)


def _playlist_revision_snapshot(playlist_id: int, viewer_id: int | None) -> int:
    with SessionLocal() as db:
        viewer = db.get(User, viewer_id) if viewer_id is not None else None
        pl, _, _ = _load_access(db, playlist_id, viewer)
        return int(pl.revision or 0)


def _viewer_still_has_access(playlist_id: int, viewer_id: int | None) -> bool:
    with SessionLocal() as db:
        viewer = db.get(User, viewer_id) if viewer_id is not None else None
        try:
            _load_access(db, playlist_id, viewer)
            return True
        except HTTPException:
            return False


@router.get(
    "/{playlist_id}/events",
    response_class=Response,
    responses={
        200: {
            "description": "Server-Sent Events emitting collaborative playlist revision updates.",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
            "headers": {
                "Cache-Control": {"schema": {"type": "string"}},
                "X-Accel-Buffering": {"schema": {"type": "string"}},
            },
        },
    },
)
async def playlist_events(
    playlist_id: int,
    user: User | None = Depends(get_current_user_optional),
) -> StreamingResponse:
    """Live SSE stream keyed on ``Playlist.revision`` for collaborative sync."""
    viewer_id = user.id if user is not None else None
    subscription = playlist_bus.subscribe(playlist_id)
    try:
        initial_rev = await run_in_threadpool(
            _playlist_revision_snapshot, playlist_id, viewer_id
        )
    except BaseException:
        playlist_bus.unsubscribe(playlist_id, subscription)
        raise

    async def event_stream() -> AsyncIterator[str]:
        try:
            latest = subscription.take_latest(
                playlist_bus.PlaylistEvent(
                    playlist_id=playlist_id, revision=initial_rev, event="snapshot"
                )
            )
            yield (
                f"data: {json.dumps({'playlist_id': latest.playlist_id, 'revision': latest.revision, 'event': latest.event})}\n\n"
            )
            if latest.event == "deleted":
                return
            while True:
                try:
                    incoming = await asyncio.wait_for(
                        subscription.queue.get(), timeout=_PLAYLIST_SSE_HEARTBEAT_SEC
                    )
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if incoming.event == "deleted":
                    yield (
                        f"data: {json.dumps({'playlist_id': incoming.playlist_id, 'revision': incoming.revision, 'event': 'deleted'})}\n\n"
                    )
                    return
                if incoming.revision <= latest.revision:
                    continue
                still_allowed = await run_in_threadpool(
                    _viewer_still_has_access, playlist_id, viewer_id
                )
                if not still_allowed:
                    yield (
                        f"data: {json.dumps({'playlist_id': incoming.playlist_id, 'revision': incoming.revision, 'event': 'revoked'})}\n\n"
                    )
                    return
                latest = incoming
                yield (
                    f"data: {json.dumps({'playlist_id': latest.playlist_id, 'revision': latest.revision, 'event': latest.event})}\n\n"
                )
        finally:
            playlist_bus.unsubscribe(playlist_id, subscription)

    return _PlaylistEventResponse(event_stream(), playlist_id, subscription)


@router.get("/{playlist_id}/sync-manifest", response_model=PlaylistSyncManifest)
def playlist_sync_manifest(
    playlist_id: int,
    include_lyrics: bool = Query(default=False),
    preload: bool = Query(default=True),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistSyncManifest:
    """Return offline-sync manifest (revision, sizes, loudness, cached lyrics) and preload uncached tracks."""
    pl, _, _ = _load_access(db, playlist_id, user)
    ordered = _ordered_tracks(pl)
    track_ids = list({pt.deezer_id for pt in ordered})

    stored_by_id: dict[str, StoredTrack] = {}
    lyrics_by_id: dict[str, StoredLyrics] = {}
    if track_ids:
        stored_by_id = {
            row.deezer_id: row
            for row in db.scalars(
                select(StoredTrack).where(
                    StoredTrack.deezer_id.in_(track_ids),
                    StoredTrack.status == "ready",
                )
            ).all()
        }
        lyrics_by_id = {
            row.deezer_id: row
            for row in db.scalars(
                select(StoredLyrics).where(StoredLyrics.deezer_id.in_(track_ids))
            ).all()
        }

    items: list[PlaylistSyncTrackItem] = []
    uncached_ids: list[str] = []
    stored_count = 0
    total_known_bytes = 0

    for pt in ordered:
        stored = stored_by_id.get(pt.deezer_id)
        is_stored = stored is not None or storage.is_ready(pt.deezer_id)
        size_bytes: int | None = None
        audio_format: str | None = None
        if stored is not None and stored.size_bytes > 0:
            size_bytes = stored.size_bytes
            audio_format = stored.audio_format
        elif is_stored:
            disk = storage.existing_audio_path(pt.deezer_id)
            if disk is not None:
                size_bytes = os.path.getsize(disk)
                audio_format = (
                    "flac" if storage.media_type_for_path(disk) == "audio/flac" else "mp3"
                )
        if is_stored:
            stored_count += 1
            if size_bytes is not None:
                total_known_bytes += size_bytes
        else:
            uncached_ids.append(pt.deezer_id)

        gain_db = (
            pt.loudness_gain_db
            if pt.loudness_gain_db is not None
            else (stored.loudness_gain_db if stored is not None else None)
        )
        items.append(
            PlaylistSyncTrackItem(
                playlist_entry_id=pt.id,
                deezer_id=pt.deezer_id,
                title=pt.title,
                artist=pt.artist,
                duration_sec=pt.duration_sec,
                is_stored=is_stored,
                size_bytes=size_bytes,
                audio_format=audio_format,
                loudness_gain_db=gain_db,
                loudness_lufs=stored.loudness_lufs if stored is not None else None,
                loudness_peak=stored.loudness_peak if stored is not None else None,
                has_lyrics=pt.deezer_id in lyrics_by_id,
            )
        )

    if preload and uncached_ids:
        storage.schedule_preload(uncached_ids, user_id=user.id, source="preload")

    lyrics_map: dict[str, OfflineLyricsEntry] | None = None
    if include_lyrics:
        lyrics_map = {
            did: OfflineLyricsEntry(
                lines=json.loads(row.lines_json or "[]"),
                synced=bool(row.synced),
                source=row.source,
                ai_generated=bool(row.ai_generated),
                instrumental=bool(row.instrumental),
            )
            for did, row in lyrics_by_id.items()
        }

    return PlaylistSyncManifest(
        playlist_id=pl.id,
        revision=int(pl.revision or 0),
        track_count=len(ordered),
        stored_count=stored_count,
        total_known_bytes=total_known_bytes,
        tracks=items,
        lyrics=lyrics_map,
    )


def _playlist_entry_descriptor(pt: PlaylistTrack) -> TrackDescriptor:
    return TrackDescriptor(
        deezer_id=str(pt.deezer_id or "").strip(),
        isrc=normalize_isrc(pt.isrc),
        title=pt.title or "",
        artist=pt.artist or "",
        duration_sec=max(int(pt.duration_sec or 0), 0),
        album_id=str(pt.album_id or "").strip(),
    )


def _find_playlist_duplicate_groups(
    ordered: list[PlaylistTrack],
) -> list[tuple[PlaylistTrack, list[PlaylistTrack], str]]:
    """Group duplicate recordings in a playlist and choose the preferred survivor."""
    groups = group_duplicates(ordered, _playlist_entry_descriptor)
    dup_groups = [g for g in groups if len(g.items) >= 2]
    if not dup_groups:
        return []
    record_types = resolve_record_types_for_groups(dup_groups, dc.album_record_type)
    resolved: list[tuple[PlaylistTrack, list[PlaylistTrack], str]] = []
    for group in dup_groups:
        _, winner, _ = pick_preferred_entry(group, record_types)
        losers = [row for _, row, _ in group.items if row.id != winner.id]
        resolved.append((winner, losers, group.isrc))
    return resolved


@router.get("/{playlist_id}/duplicates", response_model=PlaylistDuplicatesOut)
def get_playlist_duplicates(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistDuplicatesOut:
    """Detect duplicate recordings (exact ID, ISRC, or artist+title+duration) in a playlist."""
    pl, _, _ = _load_access(db, playlist_id, user)
    ordered = _ordered_tracks(pl)
    groups = _find_playlist_duplicate_groups(ordered)
    out_groups = [
        PlaylistDuplicateGroup(
            keep_entry_id=winner.id,
            duplicate_entry_ids=[loser.id for loser in losers],
            title=winner.title,
            artist=winner.artist,
            isrc=isrc or winner.isrc or "",
        )
        for winner, losers, isrc in groups
    ]
    return PlaylistDuplicatesOut(
        playlist_id=pl.id,
        total_duplicates=sum(len(g.duplicate_entry_ids) for g in out_groups),
        groups=out_groups,
    )


@router.post("/{playlist_id}/deduplicate", response_model=PlaylistDeduplicateResult)
def deduplicate_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlaylistDeduplicateResult:
    """Remove duplicate recordings from a playlist, keeping Album > EP > Single."""
    pl = _require_track_editor(db, playlist_id, user)
    ordered = _ordered_tracks(pl)
    groups = _find_playlist_duplicate_groups(ordered)
    removed_ids: list[int] = []
    removed_id_set: set[int] = set()
    for _winner, losers, _isrc in groups:
        for loser in losers:
            db.delete(loser)
            removed_ids.append(loser.id)
            removed_id_set.add(loser.id)
    if removed_ids:
        remaining = [track for track in ordered if track.id not in removed_id_set]
        _normalize_positions(remaining)
        _bump_revision(pl)
        _commit_and_publish(db, pl)
    return PlaylistDeduplicateResult(
        playlist_id=pl.id,
        groups_merged=len(groups),
        removed_count=len(removed_ids),
        removed_entry_ids=removed_ids,
        revision=int(pl.revision or 0),
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
            cover_url=track.cover_url,
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
    _commit_and_publish(db, pl)
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
    _commit_and_publish(db, pl)
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
    _commit_and_publish(db, pl)
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
    _commit_and_publish(db, pl)
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
        _commit_and_publish(db, pl)
    else:
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
        _commit_and_publish(db, pl)
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
    _commit_and_publish(db, pl)
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
    _commit_and_publish(db, pl)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pl = _require_owner(db, playlist_id, user)
    next_rev = int(pl.revision or 0) + 1
    db.delete(pl)
    db.commit()
    playlist_bus.publish_deleted(playlist_id, next_rev)
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
    _commit_and_publish(db, pl)
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
            isrc=normalize_isrc(track.isrc),
            title=track.title,
            artist=track.artist,
            artists_json=dump_artists(track),
            album=track.album,
            album_id=str(track.album_id or ""),
            cover_url=track.cover or None,
            duration_sec=track.duration_sec,
            loudness_gain_db=track.loudness_gain_db,
            position=int(next_pos if next_pos is not None else -1) + 1,
            added_by_user_id=user.id,
        )
    )
    # Set a cover from the first added track if the playlist has none.
    if not pl.cover_url and track.cover:
        pl.cover_url = track.cover
    _bump_revision(pl)
    _commit_and_publish(db, pl)
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
                isrc=normalize_isrc(track.isrc),
                title=track.title,
                artist=track.artist,
                artists_json=dump_artists(track),
                album=track.album,
                album_id=str(track.album_id or ""),
                cover_url=track.cover or None,
                duration_sec=track.duration_sec,
                loudness_gain_db=track.loudness_gain_db,
                position=pos,
                added_by_user_id=user.id,
            )
        )
        if not pl.cover_url and track.cover:
            pl.cover_url = track.cover
        added += 1
    if added > 0:
        _bump_revision(pl)
        _commit_and_publish(db, pl)
    else:
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
    _commit_and_publish(db, pl)
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
    _commit_and_publish(db, pl)
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
    _commit_and_publish(db, pl)
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
        _commit_and_publish(db, pl)
    else:
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
