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
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user_optional
from ..db.models import FollowedArtist, Like, Play, User
from ..db.session import get_db
from ..schemas.track import RadarTrack, Track
from ..services import deezer_client as dc
from ..services import radar_preload, recommend
from ..services.discovery import DiscoveryError, run_jobs
from ..services.lastfm_client import LastfmError
from ..services.singleflight_cache import SingleFlightTtlCache
from ..services.track_identity import (
    TrackDescriptor,
    descriptor_from_mapping,
    same_recording,
)
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
    return dc.dedupe_public_tracks(dc.normalize_public_tracks(tracks))


def _dedupe(tracks: list[dict]) -> list[dict]:
    valid = [t for t in tracks if str(t.get("id", ""))]
    return dc.dedupe_public_tracks(valid)


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


_RADAR_MIN_PLAYS = 2


@dataclass(frozen=True)
class RadarArtist:
    """An artist the radar watches, with the facts that explain why."""

    artist_id: str
    # From the user's own follow/play rows; "" when none of them stored a name.
    name: str
    # The user's plays of this artist in the last 90 days (0 if none).
    play_count: int
    followed: bool


def _radar_artists(db: Session, user: User, limit: int = 60) -> list[RadarArtist]:
    """The artists the radar should watch, in watch order.

    All artists the user played at least twice in the last 90 days (most-played
    first), plus followed artists — capped to bound the per-artist API fan-out.
    Each entry also carries what a client needs to explain the watch: the
    artist's name, the play count in that window, and whether they are followed.
    """
    since = datetime.utcnow() - timedelta(days=90)
    # One row per (artist, spelling of the name): an artist ID can have been
    # recorded under several names, and with an empty one.
    rows = db.execute(
        select(
            Play.artist_id,
            Play.artist,
            func.count().label("plays"),
            func.max(Play.played_at).label("last_played_at"),
            func.max(Play.id).label("last_play_id"),
        )
        .where(Play.user_id == user.id, Play.artist_id != "", Play.played_at >= since)
        .group_by(Play.artist_id, Play.artist)
    ).all()
    play_counts: dict[str, int] = {}
    # artist_id -> (recency of the most recent named play, that play's name)
    played_names: dict[str, tuple[tuple[datetime, int], str]] = {}
    for r in rows:
        play_counts[r.artist_id] = play_counts.get(r.artist_id, 0) + r.plays
        name = r.artist.strip()
        if not name:
            continue
        recency = (r.last_played_at, r.last_play_id)
        known = played_names.get(r.artist_id)
        if known is None or recency > known[0]:
            played_names[r.artist_id] = (recency, name)

    # Every follow decides the "followed" flag; only the most recent `limit`
    # follows add artists to the watch list (unchanged fan-out bound).
    follows = db.scalars(
        select(FollowedArtist)
        .where(FollowedArtist.user_id == user.id)
        .order_by(FollowedArtist.created_at.desc(), FollowedArtist.id.desc())
    ).all()
    followed_names = {f.artist_id: f.name.strip() for f in follows if f.artist_id}

    def watched(artist_id: str) -> RadarArtist:
        played_name = played_names.get(artist_id)
        return RadarArtist(
            artist_id=artist_id,
            # Follow and play rows both legitimately allow an empty name
            # (column default ""). Stay honest about that: report "" rather
            # than inventing a name or failing the whole radar for one row.
            name=followed_names.get(artist_id)
            or (played_name[1] if played_name is not None else ""),
            play_count=play_counts.get(artist_id, 0),
            followed=artist_id in followed_names,
        )

    ids: list[str] = [
        artist_id
        for artist_id, plays in sorted(
            play_counts.items(), key=lambda item: (-item[1], item[0])
        )
        if plays >= _RADAR_MIN_PLAYS
    ]
    seen: set[str] = set(ids)
    for f in follows[:limit]:
        if f.artist_id and f.artist_id not in seen:
            seen.add(f.artist_id)
            ids.append(f.artist_id)
    return [watched(artist_id) for artist_id in ids[:limit]]


def _radar_reason(artist: RadarArtist) -> dict:
    """The `RadarReason` wire dict for a track produced by `artist`."""
    if not artist.followed and artist.play_count < _RADAR_MIN_PLAYS:
        raise RuntimeError(
            f"Release Radar watches artist {artist.artist_id} without a reason: "
            f"not followed and only {artist.play_count} plays in the last 90 days"
        )
    return {
        # "followed" wins when the artist is both followed and played.
        "kind": "followed" if artist.followed else "played",
        "artist_id": artist.artist_id,
        "artist_name": artist.name,
        "play_count": artist.play_count,
    }


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
    collected_descs: list[TrackDescriptor] = []
    for al in recent:
        # Full albums can have dozens of songs. Only the remaining radar slots
        # need performer-credit lookups, so trim before normalizing metadata.
        detail = dc.album_detail(al["id"], track_limit=_RADAR_TRACKS_PER_ARTIST - len(tracks))
        for t in detail.get("tracks", []):
            desc = descriptor_from_mapping(t)
            if any(same_recording(existing, desc) for existing in collected_descs):
                continue
            # Real Track field (survives serialization) + drives global sort.
            t["release_date"] = detail.get("release_date", "")
            tracks.append(t)
            collected_descs.append(desc)
            if len(tracks) >= _RADAR_TRACKS_PER_ARTIST:
                return tracks
    return tracks


@router.get("/release-radar", response_model=list[RadarTrack])
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

    Every track carries `radar_reason`: the watched artist whose release list
    produced it and why that artist is watched. That source artist can differ
    from the track's primary artist (Deezer lists releases an artist merely
    contributes to), which is what lets a client explain an unfamiliar name.
    """
    if user is None:
        return []
    artists = _radar_artists(db, user)
    if not artists:
        return []

    cutoff = (date.today() - timedelta(days=90)).isoformat()
    produced: dict[int, list[dict]] = {}
    failures: list[tuple[str, dc.DeezerClientError]] = []
    with ThreadPoolExecutor(max_workers=_RADAR_MAX_WORKERS) as ex:
        futures = {
            ex.submit(
                _artist_new_tracks, artist.artist_id, cutoff, refresh=refresh
            ): index
            for index, artist in enumerate(artists)
        }
        for fut in as_completed(futures):
            index = futures[fut]
            try:
                produced[index] = fut.result()
            except dc.DeezerClientError as e:
                failures.append((artists[index].artist_id, e))

    if failures:
        details = "; ".join(
            f"artist {artist_id}: {error}" for artist_id, error in failures
        )
        error = DiscoveryError(
            f"Release Radar failed for {len(failures)} of "
            f"{len(artists)} artists: {details}",
            failures=tuple(error for _, error in failures),
        )
        raise to_http(error) from failures[0][1]

    # Merge in watch order rather than lookup-completion order. The sort below
    # is stable, so when several watched artists produce the same track the
    # dedupe keeps the first watched artist's copy — and with it a reason that
    # is the same on every request.
    tracks: list[dict] = []
    for index, artist in enumerate(artists):
        reason = _radar_reason(artist)
        for t in produced[index]:
            tracks.append({**t, "radar_reason": dict(reason)})

    tracks.sort(key=lambda t: t.get("release_date", ""), reverse=True)
    valid_tracks = [t for t in tracks if t.get("id", "")]
    # Merge identical recordings across Single / EP / Album releases (preferring
    # Album > EP > Single) while keeping the first watched artist's radar_reason.
    deduped = dc.dedupe_public_tracks(valid_tracks, preserve_fields=("radar_reason",))
    per_artist: dict[str, int] = {}
    out: list[dict] = []
    for t in deduped:
        # Cap at two songs per primary artist, even when collaborations surface
        # the same artist across several source artists' albums.
        key = str(t.get("artist_id") or t.get("artist") or "")
        if per_artist.get(key, 0) >= _RADAR_TRACKS_PER_ARTIST:
            continue
        per_artist[key] = per_artist.get(key, 0) + 1
        out.append(t)
    radar = out[:100]
    if user.id is None:
        raise RuntimeError(
            "Release Radar preload requires a persisted user, but user.id is None"
        )
    # Warm the server cache for the newest releases. This only queues work for
    # a background worker and returns; download failures are reported by that
    # worker (services/radar_preload.py), never through this response.
    radar_preload.schedule(radar, user_id=user.id)
    return radar


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


_CHILL_MIX_SIZE = 30


def _chill_draw_seed(user: User | None, day: date) -> str:
    """Seed of the chill shelf's draw: one selection per listener and day.

    Within a day it stays the same, so a cache rebuild or a mix detail page
    re-reading the shelf gets the tracks the home page showed. Signed-out
    visitors have no identity and share one selection per day, like they share
    the "anon" mixes cache entry.
    """
    if user is None:
        listener = "anon"
    else:
        if user.id is None:
            raise RuntimeError("Chill mix draw needs a persisted user, but user.id is None")
        listener = f"user:{user.id}"
    return f"home-mix:chill:{day.isoformat()}:{listener}"


def _build_mixes(user: User | None, db: Session) -> list[Shelf]:
    seeds = _user_seed_tracks(db, user)[:3] if user is not None else []
    artists = _user_top_artists(db, user)[:2] if user is not None else []
    # Server-local date, like the release radar. Read here on the request
    # thread, where the user object belongs, not inside a provider job.
    chill_seed = _chill_draw_seed(user, date.today())
    jobs = {
        f"seed-{index}": lambda title=title, artist=artist: recommend.similar_tracks(artist, title, 12)
        for index, (title, artist) in enumerate(seeds)
    }
    jobs["chill"] = lambda: recommend.tag_track_draw(
        _MOODS["chill"], _CHILL_MIX_SIZE, seed=chill_seed,
    )
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

    # 2) Entspannt am Abend — chill mood, a new draw per listener and day.
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
