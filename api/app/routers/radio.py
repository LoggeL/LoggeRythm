"""Song-radio endpoint: a "track mix" of similar songs.

Primary similarity source is Last.fm (track.getSimilar) — its collaborative
data gives genuinely similar songs across artists; each is resolved to a
playable Deezer track. Falls back to Deezer's own artist radio + related
artists' top tracks, then to the seed album's genre charts, then to charts.

Each tier only runs when the previous ones failed to deliver enough tracks by
*other* artists: for a long-tail artist Last.fm knows nothing, and Deezer's
artist radio degrades to "that artist's own three songs" with an empty related
list — which used to make song radio a single-artist loop.
"""
import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user_optional
from ..db.models import Play, User
from ..db.session import get_db
from ..schemas.track import Track
from ..services import deezer_client as dc
from ..services import recommend
from ..services.discovery import DiscoveryError
from ..services.lastfm_client import LastfmError
from ..services.track_identity import (
    TrackDescriptor,
    descriptor_from_mapping,
    same_recording,
)
from .errors import to_http

router = APIRouter(prefix="/api", tags=["radio"])


class RadioSeedRequest(BaseModel):
    track_ids: list[str] = Field(default_factory=list, max_length=10)
    exclude_ids: list[str] = Field(default_factory=list, max_length=500)
    mood_tag: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=40, ge=5, le=80)

_MIX_SIZE = 40
# Below this many usable non-seed-artist slots, the mix is not a radio station
# yet and the next fallback tier runs. Each artist contributes at most
# `_MAX_PER_ARTIST` slots.
_MIN_OTHER_ARTIST_SLOTS = 12
# No single artist may own the station — including the seed artist.
_MAX_PER_ARTIST = 2
# Only below this does the per-artist cap get relaxed to keep the queue usable.
_MIN_MIX_SIZE = 20


def _seed_meta(deezer_id: str) -> dict:
    track = dc._public_get(f"/track/{deezer_id}")
    if not isinstance(track, dict):
        raise dc.DeezerClientError(
            f"Deezer track {deezer_id} returned an invalid metadata payload"
        )
    return track


def _lastfm_similar(artist: str, title: str) -> list[dict]:
    """Share the same validated discovery provider used by home shelves."""
    return recommend.similar_tracks(artist, title, 40, resolve_limit=30)


def _deezer_mix(deezer_id: str, artist_id) -> list[dict]:
    """Fallback: seed artist radio + related artists' top tracks."""
    pool: list[dict] = []
    seen: set[str] = {str(deezer_id)}

    def add(items: list) -> None:
        for t in items or []:
            tid = str(t.get("id", ""))
            if tid and tid not in seen:
                seen.add(tid)
                pool.append(t)

    if artist_id:
        add(dc._public_get(f"/artist/{artist_id}/radio").get("data"))
        related = dc._public_get(f"/artist/{artist_id}/related?limit=6").get("data") or []
        for r in related[:6]:
            rid = r.get("id")
            if rid:
                add(dc._public_get(f"/artist/{rid}/top?limit=5").get("data"))
    return dc.normalize_public_tracks(pool)


def _genre_charts(album_id) -> list[dict]:
    """Fallback: charts of the seed album's genres.

    The safety net for long-tail artists that neither Last.fm nor Deezer's
    related-artist graph knows — at least the mix stays in the right corner of
    music instead of collapsing onto the seed artist.
    """
    if not album_id:
        return []
    album = dc._public_get(f"/album/{album_id}")
    genre_ids = [
        g.get("id")
        for g in ((album.get("genres") or {}).get("data") or [])
        if g.get("id")
    ]
    if not genre_ids and album.get("genre_id", -1) not in (None, -1):
        genre_ids = [album["genre_id"]]

    raw: list[dict] = []
    seen: set[str] = set()
    for gid in genre_ids[:3]:
        items = dc._public_get(f"/chart/{gid}/tracks?limit=30").get("data") or []
        for t in items:
            tid = str(t.get("id", ""))
            if tid and tid not in seen:
                seen.add(tid)
                raw.append(t)

    # Chart entries carry no inline contributors, so normalizing costs one
    # Deezer request per track — trim to the mix size before paying for it.
    random.shuffle(raw)
    return dc.normalize_public_tracks(raw[:_MIX_SIZE])


def _merge(
    pool: list[dict],
    extra: list[dict],
    seen: set[str],
    seed_desc: TrackDescriptor | None = None,
) -> list[dict]:
    """Append `extra` to `pool`, skipping ids already taken (or matching the seed)."""
    for t in extra:
        tid = str(t.get("id", ""))
        if not tid or tid in seen:
            continue
        if seed_desc is not None and same_recording(seed_desc, descriptor_from_mapping(t)):
            continue
        seen.add(tid)
        pool.append(t)
    return pool


def _other_artist_slots(pool: list[dict], artist_id) -> int:
    """Count non-seed tracks that survive the per-artist diversity cap."""
    seed = str(artist_id or "")
    per_artist: dict[str, int] = {}
    for track in pool:
        artist = str(track.get("artist_id", "")) or track.get("artist", "")
        if artist == seed:
            continue
        per_artist[artist] = per_artist.get(artist, 0) + 1
    return sum(min(count, _MAX_PER_ARTIST) for count in per_artist.values())


def _diversify(pool: list[dict]) -> list[dict]:
    """Take at most `_MAX_PER_ARTIST` per artist, overflow only as padding.

    The held-back tracks are used solely to reach `_MIN_MIX_SIZE` — a short but
    varied station beats a long one padded out with the same artist again.
    """
    per_artist: dict[str, int] = {}
    picked: list[dict] = []
    overflow: list[dict] = []
    for t in pool:
        key = str(t.get("artist_id", "")) or t.get("artist", "")
        if per_artist.get(key, 0) < _MAX_PER_ARTIST:
            per_artist[key] = per_artist.get(key, 0) + 1
            picked.append(t)
        else:
            overflow.append(t)
    mix = picked[:_MIX_SIZE]
    if len(mix) < _MIN_MIX_SIZE:
        mix = (mix + overflow)[:_MIN_MIX_SIZE]
    return mix


def _radio(deezer_id: str) -> list[dict]:
    seed = _seed_meta(deezer_id)
    seed_artist = seed.get("artist")
    seed_album = seed.get("album")
    title = seed.get("title")
    if not isinstance(seed_artist, dict) or not seed_artist.get("id"):
        raise dc.DeezerClientError(
            f"Deezer track {deezer_id} has no valid primary artist metadata"
        )
    if not isinstance(seed_album, dict):
        raise dc.DeezerClientError(
            f"Deezer track {deezer_id} has no valid album metadata"
        )
    if not isinstance(title, str) or not title:
        raise dc.DeezerClientError(f"Deezer track {deezer_id} has no valid title")
    artist = str(seed_artist.get("name") or "")
    artist_id = seed_artist["id"]
    album_id = seed_album.get("id")

    pool: list[dict] = []
    seen: set[str] = {str(deezer_id)}
    seed_desc = descriptor_from_mapping(seed)

    # 1) External similarity (Last.fm) → Deezer-playable.
    _merge(pool, _lastfm_similar(artist, title), seen, seed_desc)
    # 2) Deezer's own mix — artist radio + related artists.
    if _other_artist_slots(pool, artist_id) < _MIN_OTHER_ARTIST_SLOTS:
        _merge(pool, _deezer_mix(deezer_id, artist_id), seen, seed_desc)
    # 3) Genre charts of the seed album.
    if _other_artist_slots(pool, artist_id) < _MIN_OTHER_ARTIST_SLOTS:
        _merge(pool, _genre_charts(album_id), seen, seed_desc)
    # 4) Last resort: global charts.
    if _other_artist_slots(pool, artist_id) < _MIN_OTHER_ARTIST_SLOTS:
        _merge(pool, dc.charts(), seen, seed_desc)
    pool = dc.dedupe_public_tracks(pool)
    if not pool:
        raise dc.DeezerClientError(
            f"All radio recommendation sources returned no tracks for seed {deezer_id}"
        )

    random.shuffle(pool)
    return _diversify(pool)


@router.get("/radio/{deezer_id}", response_model=list[Track])
async def radio(deezer_id: str) -> list[dict]:
    try:
        return await run_in_threadpool(_radio, deezer_id)
    except (dc.DeezerClientError, LastfmError, DiscoveryError) as e:
        raise to_http(e)


def _seeded_radio(
    track_ids: list[str],
    exclude_ids: set[str],
    mood_tag: str | None,
    limit: int,
) -> list[dict]:
    pool: list[dict] = []
    seen: set[str] = set(exclude_ids) | set(track_ids)
    seed_descs: list[TrackDescriptor] = []

    def _add_filtered(items: list[dict]) -> None:
        for t in items:
            tid = str(t.get("id", ""))
            if not tid or tid in seen:
                continue
            desc = descriptor_from_mapping(t)
            if any(same_recording(s, desc) for s in seed_descs):
                continue
            seen.add(tid)
            pool.append(t)

    if mood_tag and mood_tag.strip():
        _add_filtered(recommend.tag_top_tracks([mood_tag.strip()], limit))

    seed_metas: list[tuple[str, dict]] = []
    for tid in track_ids[:5]:
        seed = _seed_meta(tid)
        seed_descs.append(descriptor_from_mapping(seed))
        seed_metas.append((tid, seed))

    for tid, seed in seed_metas:
        seed_artist = seed.get("artist") or {}
        artist_name = str(seed_artist.get("name") or "")
        title = str(seed.get("title") or "")
        if artist_name and title:
            _add_filtered(_lastfm_similar(artist_name, title))

    if len(pool) < _MIN_OTHER_ARTIST_SLOTS:
        for tid, seed in seed_metas:
            seed_artist = seed.get("artist") or {}
            artist_id = seed_artist.get("id")
            if artist_id:
                _add_filtered(_deezer_mix(tid, artist_id))

    if len(pool) < _MIN_OTHER_ARTIST_SLOTS:
        for _tid, seed in seed_metas:
            album_id = (seed.get("album") or {}).get("id")
            if album_id:
                _add_filtered(_genre_charts(album_id))

    if len(pool) < _MIN_OTHER_ARTIST_SLOTS:
        _add_filtered(dc.charts())

    pool = dc.dedupe_public_tracks(pool)
    pool = [t for t in pool if str(t.get("id", "")) not in exclude_ids]
    if not pool:
        raise dc.DeezerClientError(
            "All radio recommendation sources returned no eligible tracks for the given seed"
        )
    random.shuffle(pool)
    return _diversify(pool)[:limit]


@router.post("/radio/seed", response_model=list[Track])
async def seeded_radio(
    body: RadioSeedRequest,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Context-aware multi-seed radio that excludes recently played tracks (last 7d)."""
    cleaned_tracks = [tid.strip() for tid in body.track_ids if tid and tid.strip()]
    mood_tag = body.mood_tag.strip() if body.mood_tag else None
    if not cleaned_tracks and not mood_tag:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide at least one track_id or mood_tag to seed radio.",
        )
    bad = [tid for tid in cleaned_tracks if not tid.isdigit()]
    if bad:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Radio seed track_ids must be numeric Deezer IDs; got {bad[:5]!r}",
        )

    exclude_ids: set[str] = {tid.strip() for tid in body.exclude_ids if tid and tid.strip()}
    if user is not None:
        cutoff_7d = datetime.utcnow() - timedelta(days=7)
        recent_ids = db.scalars(
            select(Play.deezer_id)
            .where(Play.user_id == user.id, Play.played_at >= cutoff_7d)
            .distinct()
        ).all()
        exclude_ids.update(recent_ids)

    try:
        return await run_in_threadpool(
            _seeded_radio, cleaned_tracks, exclude_ids, mood_tag, body.limit
        )
    except (dc.DeezerClientError, LastfmError, DiscoveryError) as e:
        raise to_http(e)
