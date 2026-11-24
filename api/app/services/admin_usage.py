"""Aggregation service for the admin usage dashboard.

All metrics are derived strictly from recorded DB rows, on-disk files, and live
in-process Connect state without synthetic estimates or silent fallbacks.
"""
from __future__ import annotations

import os
import shutil
from collections import defaultdict
from collections.abc import Iterator, Sequence
from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .. import config as cfg
from ..db.models import (
    FollowedArtist,
    ImportJob,
    Like,
    PartyMember,
    PartySession,
    PartyTrack,
    Play,
    Playlist,
    PlaylistTrack,
    StoredTrack,
    TrackRequest,
    User,
)
from ..schemas.admin_usage import (
    AdminConnectDevice,
    AdminOverviewStorage,
    AdminRecentPlay,
    AdminRecentTrackRequest,
    AdminRequestSourceStat,
    AdminUsageOverview,
    AdminUsageOverviewResponse,
    AdminUserLibrary,
    AdminUserStorage,
    AdminUserStorageBreakdown,
    AdminUserUsageDetailResponse,
    AdminUserUsageSummary,
    UsageRange,
)
from ..schemas.connect import ConnectStateOut
from ..schemas.stats import MAX_SAFE_WIRE_INTEGER, StatEntry
from . import connect_hub, storage

_RANGE_DAYS: dict[UsageRange, int | None] = {
    "7d": 7,
    "30d": 30,
    "all": None,
}
_IN_CHUNK_SIZE = 400


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _require_utc(value: datetime | None, label: str) -> datetime:
    utc = _as_utc(value)
    if utc is None:
        raise RuntimeError(f"Missing required timestamp for {label}")
    return utc


def _parse_iso_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return (
        parsed.replace(tzinfo=timezone.utc)
        if parsed.tzinfo is None
        else parsed.astimezone(timezone.utc)
    )


def _cutoff_for_range(usage_range: UsageRange, now: datetime) -> datetime | None:
    if usage_range not in _RANGE_DAYS:
        raise ValueError(f"Unsupported usage range {usage_range!r}")
    days = _RANGE_DAYS[usage_range]
    if days is None:
        return None
    return now - timedelta(days=days)


def _parse_user_member_key(member_key: str) -> int | None:
    if member_key.startswith("u:") and member_key[2:].isdigit():
        return int(member_key[2:])
    return None


def _chunks(items: Sequence[str], size: int = _IN_CHUNK_SIZE) -> Iterator[Sequence[str]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def _clamp_duration(value: int | None) -> int:
    return min(max(int(value or 0), 0), MAX_SAFE_WIRE_INTEGER)


def _max_utc(*values: datetime | None) -> datetime | None:
    latest: datetime | None = None
    for value in values:
        utc = _as_utc(value)
        if utc is not None and (latest is None or utc > latest):
            latest = utc
    return latest


def _scan_numeric_uploads(directory: str) -> tuple[dict[int, int], int]:
    """Return ``(bytes_by_numeric_id, total_bytes)`` for an upload directory.

    A missing directory means no uploads have been saved yet (0 bytes). Any
    other OS error (e.g. permission denied) raises loudly.
    """
    by_id: dict[int, int] = defaultdict(int)
    total = 0
    try:
        entries = os.scandir(directory)
    except FileNotFoundError:
        return {}, 0

    with entries:
        for entry in entries:
            if entry.name.startswith("."):
                continue
            if not entry.is_file(follow_symlinks=False):
                continue
            size = entry.stat(follow_symlinks=False).st_size
            total += size
            stem = entry.name.rsplit(".", 1)[0]
            if stem.isdigit():
                by_id[int(stem)] += size
    return dict(by_id), total


def _live_connect_summary(
    state: ConnectStateOut | None,
) -> tuple[int, bool, str | None, str | None, datetime | None, list[AdminConnectDevice]]:
    if state is None or not state.devices:
        return 0, False, None, None, None, []

    active_device_name: str | None = None
    active_party_code: str | None = None
    fallback_party_code: str | None = None
    last_seen: datetime | None = None
    devices: list[AdminConnectDevice] = []

    for dev in state.devices:
        connected_dt = _parse_iso_utc(dev.connected_at)
        seen_dt = _parse_iso_utc(dev.last_seen_at)
        last_seen = _max_utc(last_seen, seen_dt)
        if dev.is_active:
            active_device_name = dev.name
            if dev.party_code:
                active_party_code = dev.party_code
        elif dev.party_code and fallback_party_code is None:
            fallback_party_code = dev.party_code
        devices.append(
            AdminConnectDevice(
                device_id=dev.device_id,
                name=dev.name,
                device_type=dev.device_type,
                is_active=dev.is_active,
                party_code=dev.party_code,
                connected_at=connected_dt,
                last_seen_at=seen_dt,
            )
        )

    is_playing_now = bool(state.active_device_id is not None and state.playback.is_playing)
    party_code = active_party_code or fallback_party_code
    return len(devices), is_playing_now, active_device_name, party_code, last_seen, devices


def _request_tracking_since(db: Session) -> datetime | None:
    earliest = db.scalar(select(func.min(TrackRequest.requested_at)))
    return _as_utc(earliest)


def get_usage_overview(
    db: Session,
    usage_range: UsageRange = "all",
) -> AdminUsageOverviewResponse:
    """Compute system-wide usage totals, disk storage partition, and per-user rows."""
    now = _utcnow()
    cutoff = _cutoff_for_range(usage_range, now)
    request_tracking_since = _request_tracking_since(db)

    users = list(db.scalars(select(User).order_by(User.id)).all())
    valid_user_ids = {user.id for user in users}

    # --- Currently stored audio tracks (no per-track filesystem stat calls) ---
    stored_rows = db.execute(
        select(
            StoredTrack.deezer_id,
            StoredTrack.size_bytes,
            StoredTrack.requested_by_user_id,
        ).where(StoredTrack.status == "ready")
    ).all()
    track_sizes: dict[str, int] = {}
    track_requester: dict[str, int | None] = {}
    for row in stored_rows:
        track_sizes[row.deezer_id] = max(int(row.size_bytes or 0), 0)
        req_uid = row.requested_by_user_id
        track_requester[row.deezer_id] = req_uid if req_uid in valid_user_ids else None

    cached_tracks = len(track_sizes)
    total_audio_bytes = sum(track_sizes.values())

    # --- Storage association graph over currently stored tracks ---
    track_users: dict[str, set[int]] = {did: set() for did in track_sizes}
    pinned_by_user: dict[int, set[str]] = defaultdict(set)

    if track_sizes:
        for did, req_uid in track_requester.items():
            if req_uid is not None:
                track_users[did].add(req_uid)

        for uid, did in db.execute(
            select(Play.user_id, Play.deezer_id)
            .join(StoredTrack, StoredTrack.deezer_id == Play.deezer_id)
            .where(StoredTrack.status == "ready")
            .distinct()
        ).all():
            if uid in valid_user_ids and did in track_users:
                track_users[did].add(uid)

        for uid, did in db.execute(
            select(Like.user_id, Like.deezer_id)
            .join(StoredTrack, StoredTrack.deezer_id == Like.deezer_id)
            .where(StoredTrack.status == "ready")
            .distinct()
        ).all():
            if uid in valid_user_ids and did in track_users:
                track_users[did].add(uid)
                pinned_by_user[uid].add(did)

        for uid, did in db.execute(
            select(Playlist.user_id, PlaylistTrack.deezer_id)
            .join(Playlist, Playlist.id == PlaylistTrack.playlist_id)
            .join(StoredTrack, StoredTrack.deezer_id == PlaylistTrack.deezer_id)
            .where(StoredTrack.status == "ready")
            .distinct()
        ).all():
            if uid in valid_user_ids and did in track_users:
                track_users[did].add(uid)
                pinned_by_user[uid].add(did)

        for uid, did in db.execute(
            select(TrackRequest.user_id, TrackRequest.deezer_id)
            .join(StoredTrack, StoredTrack.deezer_id == TrackRequest.deezer_id)
            .where(StoredTrack.status == "ready", TrackRequest.user_id.isnot(None))
            .distinct()
        ).all():
            if uid in valid_user_ids and did in track_users:
                track_users[did].add(uid)

        for member_key, did in db.execute(
            select(PartyTrack.added_by_member, PartyTrack.deezer_id)
            .join(StoredTrack, StoredTrack.deezer_id == PartyTrack.deezer_id)
            .where(
                StoredTrack.status == "ready",
                PartyTrack.added_by_member.like("u:%"),
            )
            .distinct()
        ).all():
            uid = _parse_user_member_key(member_key or "")
            if uid is not None and uid in valid_user_ids and did in track_users:
                track_users[did].add(uid)

    exclusive_audio_bytes = 0
    exclusive_audio_tracks = 0
    shared_audio_bytes = 0
    shared_audio_tracks = 0
    unattributed_audio_bytes = 0
    unattributed_audio_tracks = 0
    directly_attributed_tracks = 0
    directly_attributed_bytes = 0

    user_exclusive_bytes: dict[int, int] = defaultdict(int)
    user_exclusive_tracks: dict[int, int] = defaultdict(int)
    user_shared_bytes: dict[int, int] = defaultdict(int)
    user_shared_tracks: dict[int, int] = defaultdict(int)
    user_mat_disk_bytes: dict[int, int] = defaultdict(int)
    user_mat_disk_tracks: dict[int, int] = defaultdict(int)

    for did, size in track_sizes.items():
        owners = track_users[did]
        owner_count = len(owners)
        if owner_count == 0:
            unattributed_audio_tracks += 1
            unattributed_audio_bytes += size
        elif owner_count == 1:
            only_uid = next(iter(owners))
            exclusive_audio_tracks += 1
            exclusive_audio_bytes += size
            user_exclusive_tracks[only_uid] += 1
            user_exclusive_bytes[only_uid] += size
        else:
            shared_audio_tracks += 1
            shared_audio_bytes += size
            for uid in owners:
                user_shared_tracks[uid] += 1
                user_shared_bytes[uid] += size

        req_uid = track_requester[did]
        if req_uid is not None:
            directly_attributed_tracks += 1
            directly_attributed_bytes += size
            user_mat_disk_tracks[req_uid] += 1
            user_mat_disk_bytes[req_uid] += size

    # --- Disk totals and upload bytes (single-pass scandir) ---
    base_dir = storage.storage_dir()
    disk = shutil.disk_usage(base_dir)
    avatar_bytes_by_user, avatar_total_bytes = _scan_numeric_uploads(
        os.path.join(base_dir, "avatars")
    )
    cover_bytes_by_playlist, cover_total_bytes = _scan_numeric_uploads(
        os.path.join(base_dir, "covers")
    )
    total_upload_bytes = avatar_total_bytes + cover_total_bytes

    # Map playlist ownership for cover byte attribution + playlist counts.
    playlists_by_user: dict[int, int] = defaultdict(int)
    public_playlists_by_user: dict[int, int] = defaultdict(int)
    cover_bytes_by_user: dict[int, int] = defaultdict(int)
    for pl_id, pl_uid, is_public in db.execute(
        select(Playlist.id, Playlist.user_id, Playlist.is_public)
    ).all():
        playlists_by_user[pl_uid] += 1
        if is_public:
            public_playlists_by_user[pl_uid] += 1
        cover_bytes_by_user[pl_uid] += cover_bytes_by_playlist.get(pl_id, 0)

    # --- Time-ranged Play aggregates + all-time last_played_at ---
    play_duration = case((Play.duration_sec > 0, Play.duration_sec), else_=0)
    play_stmt = select(
        Play.user_id,
        func.count(Play.id).label("plays"),
        func.coalesce(func.sum(play_duration), 0).label("listening_sec"),
        func.count(func.distinct(Play.deezer_id)).label("unique_tracks"),
    ).group_by(Play.user_id)
    if cutoff is not None:
        play_stmt = play_stmt.where(Play.played_at >= cutoff)
    plays_by_user: dict[int, tuple[int, int, int]] = {
        r.user_id: (int(r.plays), int(r.listening_sec), int(r.unique_tracks))
        for r in db.execute(play_stmt).all()
    }

    global_unique_stmt = select(func.count(func.distinct(Play.deezer_id)))
    if cutoff is not None:
        global_unique_stmt = global_unique_stmt.where(Play.played_at >= cutoff)
    global_unique_tracks_played = int(db.scalar(global_unique_stmt) or 0)

    last_played_by_user: dict[int, datetime | None] = {
        r.user_id: _as_utc(r.last_at)
        for r in db.execute(
            select(Play.user_id, func.max(Play.played_at).label("last_at")).group_by(
                Play.user_id
            )
        ).all()
    }

    # --- Time-ranged TrackRequest aggregates + all-time last_requested_at ---
    mat_flag = case((TrackRequest.materialized.is_(True), 1), else_=0)
    mat_size = case(
        (
            TrackRequest.materialized.is_(True),
            case((TrackRequest.size_bytes > 0, TrackRequest.size_bytes), else_=0),
        ),
        else_=0,
    )
    req_stmt = select(
        TrackRequest.user_id,
        func.count(TrackRequest.id).label("requests"),
        func.coalesce(func.sum(mat_flag), 0).label("materialized"),
        func.coalesce(func.sum(mat_size), 0).label("materialized_bytes"),
    ).group_by(TrackRequest.user_id)
    if cutoff is not None:
        req_stmt = req_stmt.where(TrackRequest.requested_at >= cutoff)
    req_by_user: dict[int, tuple[int, int, int]] = {}
    total_tracks_requested = 0
    total_tracks_materialized = 0
    total_materialized_bytes = 0
    for r in db.execute(req_stmt).all():
        req_cnt = int(r.requests)
        mat_cnt = int(r.materialized)
        mat_bytes = int(r.materialized_bytes)
        total_tracks_requested += req_cnt
        total_tracks_materialized += mat_cnt
        total_materialized_bytes += mat_bytes
        if r.user_id is not None:
            req_by_user[r.user_id] = (req_cnt, mat_cnt, mat_bytes)

    last_requested_by_user: dict[int, datetime | None] = {
        r.user_id: _as_utc(r.last_at)
        for r in db.execute(
            select(
                TrackRequest.user_id,
                func.max(TrackRequest.requested_at).label("last_at"),
            )
            .where(TrackRequest.user_id.isnot(None))
            .group_by(TrackRequest.user_id)
        ).all()
    }

    # --- Library, Party & Import aggregates (all-time current snapshot) ---
    likes_by_user: dict[int, int] = {}
    last_like_by_user: dict[int, datetime | None] = {}
    for uid, cnt, last_at in db.execute(
        select(Like.user_id, func.count(Like.id), func.max(Like.created_at)).group_by(
            Like.user_id
        )
    ).all():
        likes_by_user[uid] = int(cnt)
        last_like_by_user[uid] = _as_utc(last_at)

    playlist_tracks_by_user: dict[int, int] = {}
    last_playlist_track_by_user: dict[int, datetime | None] = {}
    for uid, cnt, last_at in db.execute(
        select(
            Playlist.user_id,
            func.count(PlaylistTrack.id),
            func.max(PlaylistTrack.added_at),
        )
        .join(Playlist, Playlist.id == PlaylistTrack.playlist_id)
        .group_by(Playlist.user_id)
    ).all():
        playlist_tracks_by_user[uid] = int(cnt)
        last_playlist_track_by_user[uid] = _as_utc(last_at)

    follows_by_user: dict[int, int] = {
        uid: int(cnt)
        for uid, cnt in db.execute(
            select(FollowedArtist.user_id, func.count(FollowedArtist.id)).group_by(
                FollowedArtist.user_id
            )
        ).all()
    }

    party_hosted_by_user: dict[int, int] = {
        host_id: int(cnt)
        for host_id, cnt in db.execute(
            select(PartySession.host_id, func.count(PartySession.code)).group_by(
                PartySession.host_id
            )
        ).all()
    }
    active_parties = sum(party_hosted_by_user.values())

    last_party_seen_by_user: dict[int, datetime | None] = {
        uid: _as_utc(last_at)
        for uid, last_at in db.execute(
            select(PartyMember.user_id, func.max(PartyMember.last_seen)).group_by(
                PartyMember.user_id
            )
        ).all()
    }

    party_tracks_by_user: dict[int, int] = defaultdict(int)
    last_party_track_by_user: dict[int, datetime | None] = {}
    for member_key, cnt, last_at in db.execute(
        select(
            PartyTrack.added_by_member,
            func.count(PartyTrack.id),
            func.max(PartyTrack.added_at),
        )
        .where(PartyTrack.added_by_member.like("u:%"))
        .group_by(PartyTrack.added_by_member)
    ).all():
        uid = _parse_user_member_key(member_key or "")
        if uid is not None:
            party_tracks_by_user[uid] += int(cnt)
            last_party_track_by_user[uid] = _max_utc(
                last_party_track_by_user.get(uid), last_at
            )

    import_jobs_by_user: dict[int, int] = {}
    import_matched_by_user: dict[int, int] = {}
    last_import_by_user: dict[int, datetime | None] = {}
    for uid, cnt, matched_sum, last_at in db.execute(
        select(
            ImportJob.user_id,
            func.count(ImportJob.id),
            func.coalesce(func.sum(ImportJob.matched), 0),
            func.max(ImportJob.created_at),
        ).group_by(ImportJob.user_id)
    ).all():
        import_jobs_by_user[uid] = int(cnt)
        import_matched_by_user[uid] = int(matched_sum)
        last_import_by_user[uid] = _as_utc(last_at)

    # --- Live Connect presence ---
    connect_states = connect_hub.hub.snapshot_all()

    user_summaries: list[AdminUserUsageSummary] = []
    approved_users = 0
    active_users = 0
    total_plays = 0
    total_listening_sec = 0
    online_connect_devices = 0
    online_connect_users = 0

    for user in users:
        uid = user.id
        if user.is_approved:
            approved_users += 1

        plays, listening_sec, unique_tracks = plays_by_user.get(uid, (0, 0, 0))
        total_plays += plays
        total_listening_sec += listening_sec

        tracks_requested, tracks_materialized, mat_range_bytes = req_by_user.get(
            uid, (0, 0, 0)
        )

        (
            online_devices,
            is_playing_now,
            active_device_name,
            active_party_code,
            connect_last_seen,
            _devices,
        ) = _live_connect_summary(connect_states.get(uid))
        if online_devices > 0:
            online_connect_devices += online_devices
            online_connect_users += 1

        last_active_at = _max_utc(
            last_played_by_user.get(uid),
            last_requested_by_user.get(uid),
            last_like_by_user.get(uid),
            last_playlist_track_by_user.get(uid),
            last_party_seen_by_user.get(uid),
            last_party_track_by_user.get(uid),
            last_import_by_user.get(uid),
            connect_last_seen,
        )
        is_active = online_devices > 0 or (
            last_active_at is not None
            and (cutoff is None or last_active_at >= cutoff)
        )
        if is_active:
            active_users += 1

        excl_bytes = user_exclusive_bytes.get(uid, 0)
        excl_tracks = user_exclusive_tracks.get(uid, 0)
        sh_bytes = user_shared_bytes.get(uid, 0)
        sh_tracks = user_shared_tracks.get(uid, 0)
        pinned_ids = pinned_by_user.get(uid, set())
        pinned_bytes = sum(track_sizes[did] for did in pinned_ids)
        upload_bytes = avatar_bytes_by_user.get(uid, 0) + cover_bytes_by_user.get(
            uid, 0
        )

        user_summaries.append(
            AdminUserUsageSummary(
                id=uid,
                email=user.email,
                display_name=user.display_name,
                avatar_url=user.avatar_url,
                is_admin=bool(user.is_admin),
                is_approved=bool(user.is_approved),
                created_at=_as_utc(user.created_at),
                last_active_at=last_active_at,
                plays=plays,
                listening_sec=listening_sec,
                unique_tracks=unique_tracks,
                tracks_requested=tracks_requested,
                tracks_materialized=tracks_materialized,
                materialized_bytes=mat_range_bytes,
                storage=AdminUserStorage(
                    exclusive_bytes=excl_bytes,
                    exclusive_tracks=excl_tracks,
                    shared_bytes=sh_bytes,
                    shared_tracks=sh_tracks,
                    accessed_bytes=excl_bytes + sh_bytes,
                    accessed_tracks=excl_tracks + sh_tracks,
                    materialized_bytes=user_mat_disk_bytes.get(uid, 0),
                    materialized_tracks=user_mat_disk_tracks.get(uid, 0),
                    pinned_bytes=pinned_bytes,
                    pinned_tracks=len(pinned_ids),
                    upload_bytes=upload_bytes,
                ),
                library=AdminUserLibrary(
                    likes=likes_by_user.get(uid, 0),
                    playlists=playlists_by_user.get(uid, 0),
                    public_playlists=public_playlists_by_user.get(uid, 0),
                    playlist_tracks=playlist_tracks_by_user.get(uid, 0),
                    follows=follows_by_user.get(uid, 0),
                    party_tracks_added=party_tracks_by_user.get(uid, 0),
                    party_hosted=party_hosted_by_user.get(uid, 0),
                    import_jobs=import_jobs_by_user.get(uid, 0),
                    import_tracks_matched=import_matched_by_user.get(uid, 0),
                ),
                online_devices=online_devices,
                is_playing_now=is_playing_now,
                active_device_name=active_device_name,
                active_party_code=active_party_code,
            )
        )

    user_summaries.sort(
        key=lambda u: (-u.plays, -u.storage.exclusive_bytes, u.id)
    )

    return AdminUsageOverviewResponse(
        range=usage_range,
        generated_at=now,
        request_tracking_since=request_tracking_since,
        overview=AdminUsageOverview(
            total_users=len(users),
            approved_users=approved_users,
            pending_users=len(users) - approved_users,
            active_users=active_users,
            total_plays=total_plays,
            total_listening_sec=total_listening_sec,
            unique_tracks_played=global_unique_tracks_played,
            tracks_requested=total_tracks_requested,
            tracks_materialized=total_tracks_materialized,
            materialized_bytes=total_materialized_bytes,
            online_connect_devices=online_connect_devices,
            online_connect_users=online_connect_users,
            active_parties=active_parties,
            storage=AdminOverviewStorage(
                cached_tracks=cached_tracks,
                total_audio_bytes=total_audio_bytes,
                exclusive_audio_bytes=exclusive_audio_bytes,
                exclusive_audio_tracks=exclusive_audio_tracks,
                shared_audio_bytes=shared_audio_bytes,
                shared_audio_tracks=shared_audio_tracks,
                unattributed_audio_bytes=unattributed_audio_bytes,
                unattributed_audio_tracks=unattributed_audio_tracks,
                directly_attributed_tracks=directly_attributed_tracks,
                directly_attributed_bytes=directly_attributed_bytes,
                upload_bytes=total_upload_bytes,
                disk_total=disk.total,
                disk_used=disk.used,
                disk_free=disk.free,
                retention_days=cfg.STORAGE_RETENTION_DAYS,
            ),
        ),
        users=user_summaries,
    )


def _shared_stored_ids_for_user(
    db: Session,
    user_id: int,
    candidate_ids: list[str],
    valid_other_user_ids: set[int],
) -> set[str]:
    """Subset of ``candidate_ids`` that at least one other surviving user touches."""
    if not candidate_ids or not valid_other_user_ids:
        return set()

    shared: set[str] = set()
    member_self = f"u:{user_id}"

    for chunk in _chunks(candidate_ids):
        for did, req_uid in db.execute(
            select(StoredTrack.deezer_id, StoredTrack.requested_by_user_id).where(
                StoredTrack.deezer_id.in_(chunk),
                StoredTrack.status == "ready",
                StoredTrack.requested_by_user_id.isnot(None),
                StoredTrack.requested_by_user_id != user_id,
            )
        ).all():
            if req_uid in valid_other_user_ids:
                shared.add(did)

        remaining = [did for did in chunk if did not in shared]
        if not remaining:
            continue

        for uid, did in db.execute(
            select(Play.user_id, Play.deezer_id)
            .where(Play.deezer_id.in_(remaining), Play.user_id != user_id)
            .distinct()
        ).all():
            if uid in valid_other_user_ids:
                shared.add(did)

        remaining = [did for did in remaining if did not in shared]
        if not remaining:
            continue

        for uid, did in db.execute(
            select(Like.user_id, Like.deezer_id)
            .where(Like.deezer_id.in_(remaining), Like.user_id != user_id)
            .distinct()
        ).all():
            if uid in valid_other_user_ids:
                shared.add(did)

        remaining = [did for did in remaining if did not in shared]
        if not remaining:
            continue

        for uid, did in db.execute(
            select(Playlist.user_id, PlaylistTrack.deezer_id)
            .join(Playlist, Playlist.id == PlaylistTrack.playlist_id)
            .where(
                PlaylistTrack.deezer_id.in_(remaining),
                Playlist.user_id != user_id,
            )
            .distinct()
        ).all():
            if uid in valid_other_user_ids:
                shared.add(did)

        remaining = [did for did in remaining if did not in shared]
        if not remaining:
            continue

        for uid, did in db.execute(
            select(TrackRequest.user_id, TrackRequest.deezer_id)
            .where(
                TrackRequest.deezer_id.in_(remaining),
                TrackRequest.user_id.isnot(None),
                TrackRequest.user_id != user_id,
            )
            .distinct()
        ).all():
            if uid in valid_other_user_ids:
                shared.add(did)

        remaining = [did for did in remaining if did not in shared]
        if not remaining:
            continue

        for member_key, did in db.execute(
            select(PartyTrack.added_by_member, PartyTrack.deezer_id)
            .where(
                PartyTrack.deezer_id.in_(remaining),
                PartyTrack.added_by_member.like("u:%"),
                PartyTrack.added_by_member != member_self,
            )
            .distinct()
        ).all():
            uid = _parse_user_member_key(member_key or "")
            if uid is not None and uid in valid_other_user_ids:
                shared.add(did)

    return shared


def get_user_usage_detail(
    db: Session,
    user: User,
    usage_range: UsageRange = "all",
) -> AdminUserUsageDetailResponse:
    """Compute a detailed usage drill-down for a single user."""
    now = _utcnow()
    cutoff = _cutoff_for_range(usage_range, now)
    request_tracking_since = _request_tracking_since(db)
    uid = user.id
    member_key = f"u:{uid}"

    stored_size = case((StoredTrack.size_bytes > 0, StoredTrack.size_bytes), else_=0)
    total_cache_bytes = int(
        db.scalar(
            select(func.coalesce(func.sum(stored_size), 0)).where(
                StoredTrack.status == "ready"
            )
        )
        or 0
    )

    # --- Stored tracks associated with this user ---
    played_stored = set(
        db.scalars(
            select(Play.deezer_id)
            .join(StoredTrack, StoredTrack.deezer_id == Play.deezer_id)
            .where(Play.user_id == uid, StoredTrack.status == "ready")
            .distinct()
        ).all()
    )
    liked_stored = set(
        db.scalars(
            select(Like.deezer_id)
            .join(StoredTrack, StoredTrack.deezer_id == Like.deezer_id)
            .where(Like.user_id == uid, StoredTrack.status == "ready")
            .distinct()
        ).all()
    )
    playlisted_stored = set(
        db.scalars(
            select(PlaylistTrack.deezer_id)
            .join(Playlist, Playlist.id == PlaylistTrack.playlist_id)
            .join(StoredTrack, StoredTrack.deezer_id == PlaylistTrack.deezer_id)
            .where(Playlist.user_id == uid, StoredTrack.status == "ready")
            .distinct()
        ).all()
    )
    requested_stored = set(
        db.scalars(
            select(TrackRequest.deezer_id)
            .join(StoredTrack, StoredTrack.deezer_id == TrackRequest.deezer_id)
            .where(TrackRequest.user_id == uid, StoredTrack.status == "ready")
            .distinct()
        ).all()
    )
    party_stored = set(
        db.scalars(
            select(PartyTrack.deezer_id)
            .join(StoredTrack, StoredTrack.deezer_id == PartyTrack.deezer_id)
            .where(
                PartyTrack.added_by_member == member_key,
                StoredTrack.status == "ready",
            )
            .distinct()
        ).all()
    )
    materialized_stored_rows = db.execute(
        select(StoredTrack.deezer_id, StoredTrack.size_bytes).where(
            StoredTrack.status == "ready",
            StoredTrack.requested_by_user_id == uid,
        )
    ).all()
    materialized_stored_ids = {r.deezer_id for r in materialized_stored_rows}

    pinned_ids = liked_stored | playlisted_stored
    accessed_ids = sorted(
        played_stored
        | liked_stored
        | playlisted_stored
        | requested_stored
        | party_stored
        | materialized_stored_ids
    )

    accessed_sizes: dict[str, int] = {}
    for chunk in _chunks(accessed_ids):
        for did, size_bytes in db.execute(
            select(StoredTrack.deezer_id, StoredTrack.size_bytes).where(
                StoredTrack.deezer_id.in_(chunk),
                StoredTrack.status == "ready",
            )
        ).all():
            accessed_sizes[did] = max(int(size_bytes or 0), 0)

    other_user_ids = set(
        db.scalars(select(User.id).where(User.id != uid)).all()
    )
    shared_ids = _shared_stored_ids_for_user(db, uid, accessed_ids, other_user_ids)
    exclusive_ids = [did for did in accessed_ids if did not in shared_ids]

    exclusive_bytes = sum(accessed_sizes[did] for did in exclusive_ids)
    shared_bytes = sum(accessed_sizes[did] for did in shared_ids if did in accessed_sizes)
    materialized_disk_bytes = sum(
        max(int(r.size_bytes or 0), 0) for r in materialized_stored_rows
    )
    pinned_bytes = sum(accessed_sizes[did] for did in pinned_ids if did in accessed_sizes)

    # --- User's upload bytes ---
    base_dir = storage.storage_dir()
    avatar_bytes_by_user, _ = _scan_numeric_uploads(os.path.join(base_dir, "avatars"))
    cover_bytes_by_playlist, _ = _scan_numeric_uploads(os.path.join(base_dir, "covers"))
    user_playlists = db.execute(
        select(Playlist.id, Playlist.is_public).where(Playlist.user_id == uid)
    ).all()
    upload_bytes = avatar_bytes_by_user.get(uid, 0) + sum(
        cover_bytes_by_playlist.get(pl_id, 0) for pl_id, _ in user_playlists
    )

    # --- Time-ranged play totals, top tracks, top artists, recent plays ---
    play_filter = Play.user_id == uid
    if cutoff is not None:
        play_filter = play_filter & (Play.played_at >= cutoff)
    play_duration = case((Play.duration_sec > 0, Play.duration_sec), else_=0)
    play_row = db.execute(
        select(
            func.count(Play.id).label("plays"),
            func.coalesce(func.sum(play_duration), 0).label("listening_sec"),
            func.count(func.distinct(Play.deezer_id)).label("unique_tracks"),
        ).where(play_filter)
    ).one()
    plays = int(play_row.plays)
    listening_sec = int(play_row.listening_sec)
    unique_tracks = int(play_row.unique_tracks)

    track_count_col = func.count().label("count")
    top_tracks = [
        StatEntry(
            key=r.deezer_id,
            label=r.title or "",
            sublabel=r.artist or "",
            cover=r.cover_url or "",
            count=int(r.count),
        )
        for r in db.execute(
            select(
                Play.deezer_id,
                func.max(Play.title).label("title"),
                func.max(Play.artist).label("artist"),
                func.max(Play.cover_url).label("cover_url"),
                track_count_col,
            )
            .where(play_filter)
            .group_by(Play.deezer_id)
            .order_by(track_count_col.desc(), Play.deezer_id.asc())
            .limit(10)
        ).all()
    ]

    artist_count_col = func.count().label("count")
    top_artists = [
        StatEntry(
            key=r.artist_id or "",
            label=r.artist or "",
            count=int(r.count),
        )
        for r in db.execute(
            select(
                Play.artist,
                Play.artist_id,
                artist_count_col,
            )
            .where(play_filter)
            .group_by(Play.artist, Play.artist_id)
            .order_by(artist_count_col.desc(), Play.artist.asc())
            .limit(10)
        ).all()
    ]

    recent_plays = [
        AdminRecentPlay(
            id=p.deezer_id,
            title=p.title,
            artist=p.artist,
            album=p.album,
            cover=p.cover_url or "",
            duration_sec=_clamp_duration(p.duration_sec),
            played_at=_require_utc(p.played_at, f"plays.id={p.id}.played_at"),
        )
        for p in db.scalars(
            select(Play)
            .where(play_filter)
            .order_by(Play.played_at.desc(), Play.id.desc())
            .limit(20)
        ).all()
    ]

    # --- Time-ranged track requests, breakdown by source, recent requests ---
    req_filter = TrackRequest.user_id == uid
    if cutoff is not None:
        req_filter = req_filter & (TrackRequest.requested_at >= cutoff)
    mat_flag = case((TrackRequest.materialized.is_(True), 1), else_=0)
    mat_size = case(
        (
            TrackRequest.materialized.is_(True),
            case((TrackRequest.size_bytes > 0, TrackRequest.size_bytes), else_=0),
        ),
        else_=0,
    )
    source_rows = db.execute(
        select(
            TrackRequest.source,
            func.count(TrackRequest.id).label("requests"),
            func.coalesce(func.sum(mat_flag), 0).label("materialized"),
            func.coalesce(func.sum(mat_size), 0).label("materialized_bytes"),
        )
        .where(req_filter)
        .group_by(TrackRequest.source)
        .order_by(func.count(TrackRequest.id).desc(), TrackRequest.source.asc())
    ).all()
    requests_by_source = [
        AdminRequestSourceStat(
            source=r.source,
            requests=int(r.requests),
            materialized=int(r.materialized),
            materialized_bytes=int(r.materialized_bytes),
        )
        for r in source_rows
    ]
    tracks_requested = sum(s.requests for s in requests_by_source)
    tracks_materialized = sum(s.materialized for s in requests_by_source)
    materialized_range_bytes = sum(s.materialized_bytes for s in requests_by_source)

    recent_req_rows = list(
        db.scalars(
            select(TrackRequest)
            .where(req_filter)
            .order_by(TrackRequest.requested_at.desc(), TrackRequest.id.desc())
            .limit(20)
        ).all()
    )
    recent_req_dids = sorted({r.deezer_id for r in recent_req_rows})
    currently_stored_recent: set[str] = set()
    if recent_req_dids:
        currently_stored_recent = set(
            db.scalars(
                select(StoredTrack.deezer_id).where(
                    StoredTrack.deezer_id.in_(recent_req_dids),
                    StoredTrack.status == "ready",
                )
            ).all()
        )
    recent_requests = [
        AdminRecentTrackRequest(
            deezer_id=r.deezer_id,
            title=r.title,
            artist=r.artist,
            cover=r.cover_url or "",
            source=r.source,
            materialized=bool(r.materialized),
            size_bytes=max(int(r.size_bytes or 0), 0),
            requested_at=_require_utc(
                r.requested_at, f"track_requests.id={r.id}.requested_at"
            ),
            is_currently_stored=r.deezer_id in currently_stored_recent,
        )
        for r in recent_req_rows
    ]

    # --- Library counts + all-time last_active_at ---
    likes_row = db.execute(
        select(func.count(Like.id), func.max(Like.created_at)).where(
            Like.user_id == uid
        )
    ).one()
    playlist_tracks_row = db.execute(
        select(func.count(PlaylistTrack.id), func.max(PlaylistTrack.added_at))
        .join(Playlist, Playlist.id == PlaylistTrack.playlist_id)
        .where(Playlist.user_id == uid)
    ).one()
    follows_count = int(
        db.scalar(
            select(func.count(FollowedArtist.id)).where(
                FollowedArtist.user_id == uid
            )
        )
        or 0
    )
    party_hosted = int(
        db.scalar(
            select(func.count(PartySession.code)).where(
                PartySession.host_id == uid
            )
        )
        or 0
    )
    party_tracks_row = db.execute(
        select(func.count(PartyTrack.id), func.max(PartyTrack.added_at)).where(
            PartyTrack.added_by_member == member_key
        )
    ).one()
    import_row = db.execute(
        select(
            func.count(ImportJob.id),
            func.coalesce(func.sum(ImportJob.matched), 0),
            func.max(ImportJob.created_at),
        ).where(ImportJob.user_id == uid)
    ).one()

    last_played_at = db.scalar(
        select(func.max(Play.played_at)).where(Play.user_id == uid)
    )
    last_requested_at = db.scalar(
        select(func.max(TrackRequest.requested_at)).where(
            TrackRequest.user_id == uid
        )
    )
    last_party_seen = db.scalar(
        select(func.max(PartyMember.last_seen)).where(PartyMember.user_id == uid)
    )

    connect_state = connect_hub.hub.get_state(uid)
    (
        online_devices,
        is_playing_now,
        active_device_name,
        active_party_code,
        connect_last_seen,
        active_devices,
    ) = _live_connect_summary(connect_state)

    last_active_at = _max_utc(
        last_played_at,
        last_requested_at,
        likes_row[1],
        playlist_tracks_row[1],
        last_party_seen,
        party_tracks_row[1],
        import_row[2],
        connect_last_seen,
    )

    storage_summary = AdminUserStorage(
        exclusive_bytes=exclusive_bytes,
        exclusive_tracks=len(exclusive_ids),
        shared_bytes=shared_bytes,
        shared_tracks=len(shared_ids),
        accessed_bytes=exclusive_bytes + shared_bytes,
        accessed_tracks=len(accessed_ids),
        materialized_bytes=materialized_disk_bytes,
        materialized_tracks=len(materialized_stored_ids),
        pinned_bytes=pinned_bytes,
        pinned_tracks=len(pinned_ids),
        upload_bytes=upload_bytes,
    )
    storage_breakdown = AdminUserStorageBreakdown(
        **storage_summary.model_dump(),
        total_cache_bytes=total_cache_bytes,
    )

    summary = AdminUserUsageSummary(
        id=uid,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        is_admin=bool(user.is_admin),
        is_approved=bool(user.is_approved),
        created_at=_as_utc(user.created_at),
        last_active_at=last_active_at,
        plays=plays,
        listening_sec=listening_sec,
        unique_tracks=unique_tracks,
        tracks_requested=tracks_requested,
        tracks_materialized=tracks_materialized,
        materialized_bytes=materialized_range_bytes,
        storage=storage_summary,
        library=AdminUserLibrary(
            likes=int(likes_row[0] or 0),
            playlists=len(user_playlists),
            public_playlists=sum(1 for _, is_pub in user_playlists if is_pub),
            playlist_tracks=int(playlist_tracks_row[0] or 0),
            follows=follows_count,
            party_tracks_added=int(party_tracks_row[0] or 0),
            party_hosted=party_hosted,
            import_jobs=int(import_row[0] or 0),
            import_tracks_matched=int(import_row[1] or 0),
        ),
        online_devices=online_devices,
        is_playing_now=is_playing_now,
        active_device_name=active_device_name,
        active_party_code=active_party_code,
    )

    return AdminUserUsageDetailResponse(
        range=usage_range,
        generated_at=now,
        request_tracking_since=request_tracking_since,
        user=summary,
        storage_breakdown=storage_breakdown,
        requests_by_source=requests_by_source,
        active_devices=active_devices,
        top_tracks=top_tracks,
        top_artists=top_artists,
        recent_plays=recent_plays,
        recent_requests=recent_requests,
    )
