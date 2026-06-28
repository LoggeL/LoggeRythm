"""Home/discovery endpoints: curated mixes, charts collections, mood shelves.

All shelves are built from real sources — Deezer charts/genre-charts and
Last.fm similarity/tag data resolved to playable Deezer tracks, personalised
with the signed-in user's local play/like/follow history. Routes are sync
(`def`) so FastAPI runs them in a threadpool, letting them freely mix the
blocking DB session with blocking network calls.
"""
from __future__ import annotations

import random

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
    try:
        data = dc._public_get(f"/chart/{genre_id}")
    except dc.DeezerClientError:
        return []
    tracks = (data.get("tracks") or {}).get("data") or []
    return [dc.normalize_public_track(t) for t in tracks]


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


@router.get("/charts-collections", response_model=list[Shelf])
def charts_collections() -> list[Shelf]:
    shelves: list[Shelf] = []
    for c in _CHART_COLLECTIONS:
        tracks = _chart_tracks(int(c["id"]))
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
    return recommend.tag_top_tracks(tags, 40)


@router.get("/mixes", response_model=list[Shelf])
def mixes(
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[Shelf]:
    shelves: list[Shelf] = []

    # 1) Dein Mix der Woche — similar to the user's most-played seeds.
    if user is not None:
        seeds = _user_seed_tracks(db, user)
        pool: list[dict] = []
        for title, artist in seeds[:3]:
            pool.extend(recommend.similar_tracks(artist, title, 12))
        pool = _dedupe(pool)
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
    chill = recommend.tag_top_tracks(_MOODS["chill"], 30)
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
        names: list[str] = []
        for artist in _user_top_artists(db, user)[:2]:
            names.extend(recommend.similar_artists(artist, 8))
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
