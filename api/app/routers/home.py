"""Home/discovery endpoints: curated mixes, charts collections, mood shelves.

All shelves are built from real sources — Deezer charts/genre-charts and
Last.fm similarity/tag data resolved to playable Deezer tracks, personalised
with the signed-in user's local play/like/follow history. Routes are sync
(`def`) so FastAPI runs them in a threadpool, letting them freely mix the
blocking DB session with blocking network calls.
"""
from __future__ import annotations

import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user_optional
from ..db.models import FollowedArtist, Like, Play, User
from ..db.session import get_db
from ..schemas.track import Track
from ..services import deezer_client as dc
from ..services import recommend
from ..services.discovery import DiscoveryError, run_jobs
from ..services.lastfm_client import LastfmError
from ..services.singleflight_cache import SingleFlightTtlCache
from .errors import to_http

router = APIRouter(prefix="/api/home", tags=["home"])


class Shelf(BaseModel):
    key: str
    title: str
    subtitle: str = ""
    cover: str = ""
    tracks: list[Track]


# Curated charts collections → Deezer genre-chart IDs.
_CHART_COLLECTIONS = [
    {"key": "top-global", "id": 0, "title": "Top 50 Global", "subtitle": "Was gerade die Welt bewegt"},
    {"key": "pop", "id": 132, "title": "Pop Hits", "subtitle": "Die größten Pop-Hits"},
    {"key": "hiphop", "id": 116, "title": "Hip-Hop Vibes", "subtitle": "Neue Bars, heiße Beats"},
    {"key": "rock", "id": 152, "title": "Rock Anthems", "subtitle": "Gitarren laut gestellt"},
    {"key": "electro", "id": 106, "title": "Electronic Pulse", "subtitle": "Club Sounds & elektronische Hits"},
]

# Mood chips → ordered Last.fm tag candidates (first non-empty wins).
_MOODS: dict[str, list[str]] = {
    "chill": ["chill", "relax"],
    "focus": ["focus", "instrumental"],
    "workout": ["workout", "happy"],
    "party": ["party", "dance"],
}


def _cover_of(tracks: list[dict]) -> str:
    for t in tracks:
        if t.get("cover"):
            return t["cover"]
    return ""


def _chart_tracks(genre_id: int) -> list[dict]:
    data = dc._public_get(f"/chart/{genre_id}")
    if not isinstance(data, dict):
        raise dc.DeezerClientError(f"Chart {genre_id} returned a non-object response")
    track_section = data.get("tracks")
    if not isinstance(track_section, dict):
        raise dc.DeezerClientError(f"Chart {genre_id} has no valid tracks object")
    tracks = track_section.get("data")
    if not isinstance(tracks, list):
        raise dc.DeezerClientError(f"Chart {genre_id} has no valid tracks.data list")
    for index, track in enumerate(tracks):
        if not isinstance(track, dict):
            raise dc.DeezerClientError(
                f"Chart {genre_id} has a non-object track at index {index}"
            )
    return dc.normalize_public_tracks(tracks)


def _dedupe(tracks: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for t in tracks:
        tid = str(t.get("id", ""))
        if tid and tid not in seen:
            seen.add(tid)
            out.append(t)
    return out


def _user_seed_tracks(db: Session, user: User, limit: int = 5) -> list[tuple[str, str]]:
    """Top played (title, artist) for the user; falls back to recent likes."""
    rows = db.execute(
        select(Play.title, Play.artist, func.count().label("c"))
        .where(Play.user_id == user.id, Play.title != "", Play.artist != "")
        .group_by(Play.title, Play.artist)
        .order_by(func.count().desc())
        .limit(limit)
    ).all()
    seeds = [(r.title, r.artist) for r in rows]
    if seeds:
        return seeds
    likes = db.scalars(
        select(Like)
        .where(Like.user_id == user.id)
        .order_by(Like.created_at.desc())
        .limit(limit)
    ).all()
    return [(lk.title, lk.artist) for lk in likes if lk.title and lk.artist]


def _user_top_artists(db: Session, user: User, limit: int = 3) -> list[str]:
    """Most played artists; falls back to followed artists."""
    rows = db.execute(
        select(Play.artist, func.count().label("c"))
        .where(Play.user_id == user.id, Play.artist != "")
        .group_by(Play.artist)
        .order_by(func.count().desc())
        .limit(limit)
    ).all()
    arts = [r.artist for r in rows]
    if arts:
        return arts
    follows = db.scalars(
        select(FollowedArtist)
        .where(FollowedArtist.user_id == user.id)
        .order_by(FollowedArtist.created_at.desc())
        .limit(limit)
    ).all()
    return [f.name for f in follows if f.name]


def _radar_artist_ids(db: Session, user: User, limit: int = 60) -> list[str]:
    """Deezer artist IDs the radar should watch.

    All artists the user played at least twice in the last 90 days (most-played
    first), plus followed artists — capped to bound the per-artist API fan-out.
    """
    ids: list[str] = []
    seen: set[str] = set()
    since = datetime.utcnow() - timedelta(days=90)
    rows = db.execute(
        select(Play.artist_id, func.count().label("c"))
        .where(Play.user_id == user.id, Play.artist_id != "", Play.played_at >= since)
        .group_by(Play.artist_id)
        .having(func.count() >= 2)
        .order_by(func.count().desc())
    ).all()
    for r in rows:
        if r.artist_id not in seen:
            seen.add(r.artist_id)
            ids.append(r.artist_id)
    follows = db.scalars(
        select(FollowedArtist)
        .where(FollowedArtist.user_id == user.id)
        .order_by(FollowedArtist.created_at.desc())
        .limit(limit)
    ).all()
    for f in follows:
        if f.artist_id and f.artist_id not in seen:
            seen.add(f.artist_id)
            ids.append(f.artist_id)
    return ids[:limit]


_RADAR_TRACKS_PER_ARTIST = 2
_RADAR_MAX_WORKERS = 2


def _artist_new_tracks(
    artist_id: str,
    cutoff: str,
    *,
    refresh: bool = False,
) -> list[dict]:
    """Up to `_RADAR_TRACKS_PER_ARTIST` newest tracks from an artist's recent
    releases (cutoff <= release_date <= today), newest release first. Future
    pre-release albums must not enter the radar: Deezer exposes their available
    singles under the future-dated album as well as under their already
    released single entries. Each track is tagged with `release_date` so
    callers can sort the merged radar globally.
    """
    albums = dc.artist_albums(artist_id, refresh=refresh)
    today = date.today().isoformat()
    recent = sorted(
        (
            a
            for a in albums
            if cutoff <= a.get("release_date", "") <= today
        ),
        key=lambda a: a.get("release_date", ""),
        reverse=True,
    )
    tracks: list[dict] = []
    for al in recent:
        # Full albums can have dozens of songs. Only the remaining radar slots
        # need performer-credit lookups, so trim before normalizing metadata.
        detail = dc.album_detail(al["id"], track_limit=_RADAR_TRACKS_PER_ARTIST - len(tracks))
        for t in detail.get("tracks", []):
            # Real Track field (survives serialization) + drives global sort.
            t["release_date"] = detail.get("release_date", "")
            tracks.append(t)
            if len(tracks) >= _RADAR_TRACKS_PER_ARTIST:
                return tracks
    return tracks


@router.get("/release-radar", response_model=list[Track])
def release_radar(
    refresh: bool = False,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Recent songs (last 90 days), at most two per followed/top artist.

    Fans out per artist over the 24h-cached album lists, then pulls the newest
    release's tracks. Any per-artist failure aborts the response after all
    lookups finish so clients never accept a partial radar as a successful
    refresh. Signed-out or no artist history → empty list, frontend hides the
    section.
    """
    if user is None:
        return []
    artist_ids = _radar_artist_ids(db, user)
    if not artist_ids:
        return []

    cutoff = (date.today() - timedelta(days=90)).isoformat()
    tracks: list[dict] = []
    failures: list[tuple[str, dc.DeezerClientError]] = []
    with ThreadPoolExecutor(max_workers=_RADAR_MAX_WORKERS) as ex:
        futures = {
            ex.submit(_artist_new_tracks, aid, cutoff, refresh=refresh): aid
            for aid in artist_ids
        }
        for fut in as_completed(futures):
            try:
                tracks.extend(fut.result())
            except dc.DeezerClientError as e:
                failures.append((futures[fut], e))

    if failures:
        details = "; ".join(
            f"artist {artist_id}: {error}" for artist_id, error in failures
        )
        error = DiscoveryError(
            f"Release Radar failed for {len(failures)} of "
            f"{len(artist_ids)} artists: {details}",
            failures=tuple(error for _, error in failures),
        )
        raise to_http(error) from failures[0][1]

    tracks.sort(key=lambda t: t.get("release_date", ""), reverse=True)
    seen: set[str] = set()
    per_artist: dict[str, int] = {}
    out: list[dict] = []
    for t in tracks:
        tid = t.get("id", "")
        if not tid or tid in seen:
            continue
        # Cap at two songs per primary artist, even when collaborations surface
        # the same artist across several source artists' albums.
        key = str(t.get("artist_id") or t.get("artist") or "")
        if per_artist.get(key, 0) >= _RADAR_TRACKS_PER_ARTIST:
            continue
        seen.add(tid)
        per_artist[key] = per_artist.get(key, 0) + 1
        out.append(t)
    return out[:100]


@router.get("/charts-collections", response_model=list[Shelf])
def charts_collections() -> list[Shelf]:
    charts = _CHART_COLLECTIONS
    if not charts:
        raise RuntimeError("No chart collections are configured")
    results: dict[int, list[dict]] = {}
    failures: dict[int, Exception] = {}
    with ThreadPoolExecutor(max_workers=min(5, len(charts))) as pool:
        futures = {
            pool.submit(_chart_tracks, int(chart["id"])): index
            for index, chart in enumerate(charts)
        }
        for future in as_completed(futures):
            index = futures[future]
            try:
                results[index] = future.result()
            except Exception as error:
                failures[index] = error

    if failures:
        details = "; ".join(
            f"chart {charts[index]['id']}: {failures[index]}"
            for index in sorted(failures)
        )
        error = dc.DeezerClientError(
            f"Chart collections failed for {len(failures)} of {len(charts)} charts: "
            f"{details}"
        )
        raise to_http(error) from failures[min(failures)]

    shelves: list[Shelf] = []
    for index, c in enumerate(charts):
        tracks = results[index]
        if not tracks:
            continue
        shelves.append(
            Shelf(
                key=str(c["key"]),
                title=str(c["title"]),
                subtitle=str(c["subtitle"]),
                cover=_cover_of(tracks),
                tracks=tracks[:50],
            )
        )
    return shelves


@router.get("/mood/{tag}", response_model=list[Track])
def mood(tag: str) -> list[dict]:
    tags = _MOODS.get(tag, [tag])
    try:
        return recommend.tag_top_tracks(tags, 40)
    except (dc.DeezerClientError, LastfmError, DiscoveryError) as error:
        raise to_http(error) from error


@router.get("/because-you-listened", response_model=list[Shelf])
def because_you_listened(
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[Shelf]:
    """Per-artist recommendation rails seeded from the user's most-played artists.

    Returns up to 3 shelves ("Weil du <Artist> gehört hast"), each a seed artist
    plus recommended playable Deezer tracks. If the user is signed out or has no
    plays/follows to seed from, returns an empty list (explicit) — the frontend
    simply won't render the section.
    """
    if user is None:
        return []

    # Read seeds on the request thread before provider work starts. SQLAlchemy
    # sessions must not be passed to these concurrent jobs.
    artists = _user_top_artists(db, user, limit=3)

    def artist_tracks(artist: str) -> list[dict]:
        names = recommend.similar_artists(artist, 8)
        return _dedupe(recommend.resolve_queries(names, 24)) if names else []

    try:
        results = run_jobs({
            artist: lambda artist=artist: artist_tracks(artist) for artist in artists
        }, max_workers=3)
    except (dc.DeezerClientError, LastfmError, DiscoveryError) as error:
        raise to_http(error) from error

    shelves: list[Shelf] = []
    for artist, tracks in results.items():
        if not tracks:
            continue
        shelves.append(
            Shelf(
                key=f"byl-{artist.lower().replace(' ', '-')}",
                title=f"Weil du {artist} gehört hast",
                subtitle="Ähnliche Künstler:innen, die dir gefallen könnten",
                cover=_cover_of(tracks),
                tracks=tracks[:30],
            )
        )

    return shelves


# The "Für dich" mixes are an expensive per-user Last.fm/Deezer fan-out that
# changes slowly — cache each user's result in-process for 1h so repeated home
# loads (and multiple tabs) don't recompute it every time.
_MIXES_TTL_SEC = 3600
_MIXES_CACHE_MAX = 256
_mixes_cache = SingleFlightTtlCache[str, list[Shelf]](
    ttl_seconds=_MIXES_TTL_SEC, max_entries=_MIXES_CACHE_MAX, max_inflight=6,
)


@router.get("/mixes", response_model=list[Shelf])
def mixes(
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[Shelf]:
    cache_key = str(user.id) if user is not None else "anon"
    try:
        return _mixes_cache.get(cache_key, lambda: _build_mixes(user, db))
    except (dc.DeezerClientError, LastfmError, DiscoveryError) as error:
        raise to_http(error) from error


def _build_mixes(user: User | None, db: Session) -> list[Shelf]:
    seeds = _user_seed_tracks(db, user)[:3] if user is not None else []
    artists = _user_top_artists(db, user)[:2] if user is not None else []
    jobs = {
        f"seed-{index}": lambda title=title, artist=artist: recommend.similar_tracks(artist, title, 12)
        for index, (title, artist) in enumerate(seeds)
    }
    jobs["chill"] = lambda: recommend.tag_top_tracks(_MOODS["chill"], 30)
    jobs.update({
        f"artist-{index}": lambda artist=artist: recommend.similar_artists(artist, 8)
        for index, artist in enumerate(artists)
    })
    results = run_jobs(jobs)
    shelves: list[Shelf] = []

    # 1) Dein Mix der Woche — similar to the user's most-played seeds.
    if user is not None:
        pool = _dedupe([
            track for index in range(len(seeds)) for track in results[f"seed-{index}"]
        ])
        if pool:
            random.shuffle(pool)
            shelves.append(
                Shelf(
                    key="weekly",
                    title="Dein Mix der Woche",
                    subtitle="Frische Tracks, handverlesen für deinen Geschmack",
                    cover=_cover_of(pool),
                    tracks=pool[:30],
                )
            )

    # 2) Entspannt am Abend — chill mood.
    chill = results["chill"]
    if chill:
        shelves.append(
            Shelf(
                key="chill",
                title="Entspannt am Abend",
                subtitle="Lehne dich zurück und genieße den Moment",
                cover=_cover_of(chill),
                tracks=chill,
            )
        )

    # 3) Entdecke Neues — tracks from artists similar to the user's favourites.
    discover: list[dict] = []
    if user is not None:
        names = [name for index in range(len(artists)) for name in results[f"artist-{index}"]]
        discover = _dedupe(recommend.resolve_queries(names, 24))
    if not discover:
        discover = recommend.tag_top_tracks(_MOODS["party"], 24)
    if discover:
        shelves.append(
            Shelf(
                key="discover",
                title="Entdecke Neues",
                subtitle="Neue Musik von Künstler:innen, die du noch nicht kennst",
                cover=_cover_of(discover),
                tracks=discover,
            )
        )

    # Fallback: never return an empty home — seed from the global chart.
    if not shelves:
        top = _chart_tracks(0)
        if top:
            shelves.append(
                Shelf(
                    key="top",
                    title="Top Hits",
                    subtitle="Die größten Songs gerade",
                    cover=_cover_of(top),
                    tracks=top[:30],
                )
            )

    return shelves
