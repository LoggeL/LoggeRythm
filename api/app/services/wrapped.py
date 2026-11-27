"""Wrapped analytics engine, allowlisted artwork loader, and SVG share-card renderer."""
from __future__ import annotations

import glob
import math
import mimetypes
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from urllib.parse import unquote, urlparse
from xml.sax.saxutils import escape as xml_escape

import requests
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import config as app_config
from ..db.models import Play, StoredTrack, User
from ..schemas.stats import InsightsRange, MAX_SAFE_WIRE_INTEGER
from ..schemas.wrapped import (
    WrappedAura,
    WrappedCardFormat,
    WrappedCardTemplate,
    WrappedCardTheme,
    WrappedChronotype,
    WrappedEmblemId,
    WrappedEquivalent,
    WrappedEquivalentIcon,
    WrappedObsession,
    WrappedPeakDay,
    WrappedPersona,
    WrappedRankedItem,
    WrappedReport,
    WrappedRhythm,
    WrappedTempo,
    WrappedTotals,
    WrappedUser,
)
from ..uploads import MAX_IMAGE_UPLOAD_BYTES, _looks_like_image

INSIGHTS_RANGE_DAYS: dict[InsightsRange, int | None] = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "year": 365,
    "all": None,
}

_RANGE_LABELS: dict[InsightsRange, str] = {
    "7d": "LETZTE 7 TAGE",
    "30d": "LETZTE 30 TAGE",
    "90d": "LETZTE 90 TAGE",
    "year": "DIESES JAHR",
    "all": "ALL-TIME ARCHIV",
}

_WEEKDAY_FULL = (
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
)
_WEEKDAY_SHORT = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")

_CHRONOTYPE_LABELS: dict[WrappedChronotype, str] = {
    "night_owl": "Nachtschwärmer",
    "early_bird": "Frühaufsteher",
    "day_cruiser": "Tages-Cruiser",
    "evening_viber": "Abend-Viber",
}

_ARTWORK_FETCH_TIMEOUT_SEC = 10
_ARTWORK_CHUNK_BYTES = 64 * 1024
_IMAGE_MIME_BY_EXT: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
_LOCAL_AVATAR_RE = re.compile(r"^/api/users/(\d+)/avatar$")
_LOCAL_PLAYLIST_COVER_RE = re.compile(r"^/api/playlists/(\d+)/cover$")
_LOCAL_UPLOADS_PREFIX = "/api/uploads/"


def as_utc(dt: datetime) -> datetime:
    """Normalize naive or offset datetimes to timezone-aware UTC."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def compute_streaks(play_dates: set[date], today: date) -> tuple[int, int]:
    """Return ``(current_streak_days, longest_streak_days)`` over UTC calendar days."""
    if not play_dates:
        return 0, 0
    ordered = sorted(play_dates)
    longest = 1
    run = 1
    for prev, curr in zip(ordered, ordered[1:]):
        if (curr - prev).days == 1:
            run += 1
            if run > longest:
                longest = run
        else:
            run = 1

    current = 0
    cursor = today if today in play_dates else (today - timedelta(days=1))
    while cursor in play_dates:
        current += 1
        cursor -= timedelta(days=1)
    return current, longest


def _clamp_wire_int(value: int) -> int:
    return min(max(int(value), 0), MAX_SAFE_WIRE_INTEGER)


def _pct(part: int, whole: int) -> int:
    if whole <= 0 or part <= 0:
        return 0
    return min(100, max(0, round((part * 100) / whole)))


@dataclass
class _TrackBucket:
    key: str
    title: str = ""
    artist: str = ""
    album: str = ""
    cover: str = ""
    count: int = 0
    listening_sec: int = 0
    day_counts: Counter[date] | None = None

    def record(self, title: str, artist: str, album: str, cover: str, dur: int, day: date) -> None:
        if title:
            self.title = title
        if artist:
            self.artist = artist
        if album:
            self.album = album
        if cover:
            self.cover = cover
        self.count += 1
        self.listening_sec += dur
        if self.day_counts is None:
            self.day_counts = Counter()
        self.day_counts[day] += 1


@dataclass
class _ArtistBucket:
    name: str
    artist_id: str = ""
    cover: str = ""
    count: int = 0
    listening_sec: int = 0
    track_ids: set[str] | None = None

    def record(self, artist_id: str, cover: str, dur: int, deezer_id: str) -> None:
        if artist_id:
            self.artist_id = artist_id
        if cover:
            self.cover = cover
        self.count += 1
        self.listening_sec += dur
        if self.track_ids is None:
            self.track_ids = set()
        if deezer_id:
            self.track_ids.add(deezer_id)


@dataclass
class _AlbumBucket:
    album: str
    album_id: str = ""
    artist: str = ""
    cover: str = ""
    count: int = 0
    listening_sec: int = 0

    def record(self, album_id: str, artist: str, cover: str, dur: int) -> None:
        if album_id:
            self.album_id = album_id
        if artist:
            self.artist = artist
        if cover:
            self.cover = cover
        self.count += 1
        self.listening_sec += dur


@dataclass
class _DayBucket:
    day: date
    play_count: int = 0
    listening_sec: int = 0
    track_counts: Counter[str] | None = None
    track_secs: Counter[str] | None = None
    track_meta: dict[str, tuple[str, str, str]] | None = None

    def record(self, track_key: str, title: str, artist: str, cover: str, dur: int) -> None:
        self.play_count += 1
        self.listening_sec += dur
        if self.track_counts is None:
            self.track_counts = Counter()
            self.track_secs = Counter()
            self.track_meta = {}
        assert self.track_secs is not None and self.track_meta is not None
        self.track_counts[track_key] += 1
        self.track_secs[track_key] += dur
        prev_title, prev_artist, prev_cover = self.track_meta.get(track_key, ("", "", ""))
        self.track_meta[track_key] = (
            title or prev_title,
            artist or prev_artist,
            cover or prev_cover,
        )


def _chronotype_for_hourly(hourly: list[int], peak_hour: int) -> tuple[WrappedChronotype, int]:
    """Return dominant chronotype and the night share percentage (22:00-04:59)."""
    total = sum(hourly)
    if total <= 0:
        return "day_cruiser", 0
    early = sum(hourly[5:11])
    day = sum(hourly[11:17])
    evening = sum(hourly[17:22])
    night = hourly[22] + hourly[23] + sum(hourly[0:5])

    def _hour_bucket(hour: int) -> WrappedChronotype:
        if 5 <= hour <= 10:
            return "early_bird"
        if 11 <= hour <= 16:
            return "day_cruiser"
        if 17 <= hour <= 21:
            return "evening_viber"
        return "night_owl"

    peak_bucket = _hour_bucket(peak_hour)
    counts: dict[WrappedChronotype, int] = {
        "night_owl": night,
        "early_bird": early,
        "day_cruiser": day,
        "evening_viber": evening,
    }
    dominant = max(
        counts,
        key=lambda kind: (counts[kind], 1 if kind == peak_bucket else 0),
    )
    return dominant, _pct(night, total)


def _build_persona(
    *,
    totals: WrappedTotals,
    rhythm: WrappedRhythm,
    obsession: WrappedObsession | None,
    top_albums: list[WrappedRankedItem],
    hourly: list[int],
) -> WrappedPersona:
    play_count = totals.play_count
    night_plays = hourly[22] + hourly[23] + sum(hourly[0:5])
    morning_plays = sum(hourly[5:11])
    night_pct = _pct(night_plays, play_count)
    morning_pct = _pct(morning_plays, play_count)
    avg_daily_min = max(1, round(totals.avg_daily_sec / 60)) if totals.avg_daily_sec > 0 else 0
    peak_weekday_name = _WEEKDAY_FULL[rhythm.peak_weekday]

    def make(
        pid: str,
        title: str,
        subtitle: str,
        tagline: str,
        emblem: WrappedEmblemId,
        traits: list[str],
    ) -> WrappedPersona:
        return WrappedPersona(
            id=pid,
            title=title,
            subtitle=subtitle,
            tagline=tagline,
            emblem=emblem,
            traits=traits,
        )

    if (
        obsession is not None
        and obsession.play_count >= 5
        and (obsession.share_pct >= 20 or rhythm.repeat_score_pct >= 55)
    ):
        return make(
            "loop_architect",
            "Endlosschleifen-Architekt",
            "Wenn ein Track sitzt, läuft er auf Heavy Rotation.",
            f"{obsession.play_count}× „{obsession.title}“ — {rhythm.repeat_score_pct}% Wiederholungsquote in deinem Mix.",
            "infinite_vinyl",
            [
                f"{rhythm.repeat_score_pct}% Repeat-Faktor",
                f"Top-Track: {obsession.play_count}×",
                f"{obsession.share_pct}% Obsession-Anteil",
            ],
        )

    if totals.longest_streak_days >= 7 or (
        totals.longest_streak_days >= 5 and totals.active_days >= 6
    ):
        return make(
            "streak_runner",
            "Dauerbrenner",
            "Kein Tag ohne deinen Soundtrack.",
            f"{totals.longest_streak_days} Tage Serie am Stück — {totals.active_days} von {max(1, totals.total_days)} Tagen aktiv.",
            "flame_metro",
            [
                f"{totals.longest_streak_days} Tage Rekord-Serie",
                f"{totals.active_days} aktive Tage",
                f"Ø {avg_daily_min} Min./Tag",
            ],
        )

    if rhythm.chronotype == "night_owl" or night_pct >= 40:
        return make(
            "night_owl",
            "Nachtschwärmer",
            "Wenn die Stadt schläft, drehst du erst richtig auf.",
            f"Dein Peak liegt um {rhythm.peak_hour:02d}:00 Uhr — {night_pct}% deiner Plays fallen in die Nacht.",
            "moon_wave",
            [
                f"Peak: {rhythm.peak_hour:02d}:00 Uhr",
                f"{night_pct}% Nacht-Anteil",
                f"{totals.unique_tracks} Tracks im Mix",
            ],
        )

    if rhythm.chronotype == "early_bird" or morning_pct >= 40:
        return make(
            "morning_freq",
            "Morgen-Frequenz",
            "Erster Kaffee, erster Beat — perfekt getaktet.",
            f"Deine Hochphase startet um {rhythm.peak_hour:02d}:00 Uhr mit {morning_pct}% Morgen-Plays.",
            "sunrise_pulse",
            [
                f"Peak: {rhythm.peak_hour:02d}:00 Uhr",
                f"{morning_pct}% Früh-Plays",
                f"{totals.active_days} aktive Tage",
            ],
        )

    if rhythm.weekend_share_pct >= 42:
        return make(
            "weekend_headliner",
            "Wochenend-Headliner",
            "Samstag und Sonntag gehören deiner Anlage.",
            f"{rhythm.weekend_share_pct}% deines Sounds laufen am Wochenende — Peak am {peak_weekday_name}.",
            "strobe_bars",
            [
                f"{rhythm.weekend_share_pct}% Weekend-Anteil",
                f"Peak-Tag: {peak_weekday_name}",
                f"{play_count} Wiedergaben",
            ],
        )

    if (
        (rhythm.discovery_score_pct >= 65 and totals.unique_artists >= 4)
        or (totals.new_artists_count >= 5 and rhythm.discovery_score_pct >= 55)
    ):
        return make(
            "explorer",
            "Trüffelschwein",
            "Immer auf der Jagd nach frischen Artists und neuen Gems.",
            f"{totals.unique_artists} verschiedene Artists und {rhythm.discovery_score_pct}% Entdecker-Score in {play_count} Plays.",
            "compass_radar",
            [
                f"{rhythm.discovery_score_pct}% Discovery-Score",
                f"{totals.unique_artists} Artists",
                f"{totals.new_artists_count} neue Artists",
            ],
        )

    if top_albums and top_albums[0].count >= 3 and (
        top_albums[0].share_pct >= 30
        or (totals.unique_albums > 0 and (play_count / totals.unique_albums) >= 3.0)
    ):
        top_album = top_albums[0]
        return make(
            "album_purist",
            "Album-Purist",
            "Singles sind nett, aber du willst das ganze Werk.",
            f"„{top_album.label}“ vereint {top_album.share_pct}% deiner Wiedergaben in diesem Zeitraum.",
            "tonearm_disc",
            [
                f"Top-Album: {top_album.count}×",
                f"{totals.unique_albums} Alben gehört",
                f"{top_album.share_pct}% Album-Fokus",
            ],
        )

    return make(
        "sound_alchemist",
        "Klang-Alchemist",
        "Perfekte Balance aus Favoriten, Flow und Neuentdeckungen.",
        f"{totals.unique_tracks} Tracks von {totals.unique_artists} Artists — am stärksten am {peak_weekday_name} um {rhythm.peak_hour:02d}:00 Uhr.",
        "prism_beat",
        [
            f"{totals.unique_artists} Artists",
            f"{rhythm.discovery_score_pct}% Entdeckergeist",
            f"Peak: {rhythm.peak_hour:02d}:00 Uhr",
        ],
    )


def _build_aura(
    *,
    rhythm: WrappedRhythm,
    tempo: WrappedTempo | None,
) -> WrappedAura:
    avg_bpm = tempo.avg_bpm if tempo is not None else None

    if rhythm.chronotype == "night_owl" and avg_bpm is not None and avg_bpm >= 126:
        return WrappedAura(
            id="midnight_strobe",
            title="Mitternachts-Strobe",
            description="Tiefes Ultraviolett und grelles Signal-Lime — voller Club-Puls nach Einbruch der Dunkelheit.",
            colors=["#0F0C29", "#7F5AF0", "#D6FF4B"],
            mood_tags=["Treibend", "Elektrisch", "Nachtaktiv"],
        )
    if rhythm.chronotype == "night_owl":
        return WrappedAura(
            id="velvet_noir",
            title="Samt-Mitternacht",
            description="Sattes Indigo und kühles Cyan begleiten deine späten Hör-Sessions bis tief in die Nacht.",
            colors=["#131126", "#4F46E5", "#2EC4B6"],
            mood_tags=["Hypnotisch", "Spät", "Fokussiert"],
        )
    if rhythm.chronotype == "early_bird":
        return WrappedAura(
            id="amber_dawn",
            title="Morgenrot-Puls",
            description="Warme Bernstein- und Korall-Verläufe spiegeln deinen klaren Start in den Tag.",
            colors=["#2B192E", "#FF7B54", "#FFD166"],
            mood_tags=["Wach", "Klar", "Goldstunde"],
        )
    if rhythm.repeat_score_pct >= 50:
        return WrappedAura(
            id="crimson_loop",
            title="Analog-Glut",
            description="Dunkles Vinyl-Rot und warmes Kupfer für Tracks, die du nicht mehr aus dem Kopf bekommst.",
            colors=["#1F1118", "#E63946", "#F4A261"],
            mood_tags=["Intensiv", "Vertraut", "Obsessiv"],
        )
    if rhythm.discovery_score_pct >= 65:
        return WrappedAura(
            id="acid_horizon",
            title="Entdecker-Prisma",
            description="Leuchtendes Smaragdgrün und Signal-Lime stehen für deinen ständigen Durst nach neuem Sound.",
            colors=["#0D2129", "#06D6A0", "#D6FF4B"],
            mood_tags=["Neugierig", "Vielseitig", "Frisch"],
        )
    if rhythm.chronotype == "evening_viber" or (avg_bpm is not None and avg_bpm < 100):
        return WrappedAura(
            id="twilight_amber",
            title="Dämmerungs-Glow",
            description="Violetter Abendhimmel mit weichem Rosé-Schimmer für entspannte Feierabend-Runden.",
            colors=["#1B1528", "#C084FC", "#FB7185"],
            mood_tags=["Atmosphärisch", "Warm", "Abendflow"],
        )
    return WrappedAura(
        id="signal_daylight",
        title="Tages-Signal",
        description="Stahlblau und LoggeRythm-Signal-Lime für deinen gleichmäßigen Flow durch den Tag.",
        colors=["#141A24", "#38BDF8", "#D6FF4B"],
        mood_tags=["Ausgeglichen", "Klar", "Rhythmisch"],
    )


def _format_multiplier(ratio: float) -> str:
    bounded = max(0.1, ratio)
    if bounded >= 10:
        return f"{round(bounded)}×"
    if abs(bounded - round(bounded)) < 0.05:
        return f"{round(bounded)}×"
    return f"{bounded:.1f}".replace(".", ",") + "×"


def _build_equivalents(listening_sec: int) -> list[WrappedEquivalent]:
    if listening_sec <= 0:
        return []
    catalog: dict[WrappedEquivalentIcon, tuple[int, str]] = {
        "vinyl": (45 * 60, "Vinyl-LPs (à 45 Min.)"),
        "concert": (90 * 60, "Live-Konzerte"),
        "movie": (120 * 60, "Spielfilme (à 2 Std.)"),
        "flight": (210 * 60, "Flüge Berlin → Lissabon"),
        "marathon": (240 * 60, "Marathon-Läufe"),
    }
    if listening_sec < 6 * 3600:
        chosen: tuple[WrappedEquivalentIcon, WrappedEquivalentIcon, WrappedEquivalentIcon] = (
            "vinyl",
            "concert",
            "movie",
        )
    elif listening_sec < 24 * 3600:
        chosen = ("vinyl", "movie", "flight")
    else:
        chosen = ("vinyl", "flight", "marathon")

    return [
        WrappedEquivalent(
            icon=icon,
            value=_format_multiplier(listening_sec / catalog[icon][0]),
            label=catalog[icon][1],
        )
        for icon in chosen
    ]


def build_wrapped_report(
    db: Session,
    user: User,
    range_name: InsightsRange,
    *,
    now: datetime | None = None,
) -> WrappedReport:
    """Compute a complete, contract-valid WrappedReport for ``user`` in ``range_name``."""
    if range_name not in INSIGHTS_RANGE_DAYS:
        raise ValueError(f"Unsupported Wrapped range: {range_name!r}")

    now_utc = as_utc(now) if now is not None else datetime.now(timezone.utc)
    days = INSIGHTS_RANGE_DAYS[range_name]
    cutoff = (now_utc - timedelta(days=days)).replace(tzinfo=None) if days is not None else None

    stmt = (
        select(Play)
        .where(Play.user_id == user.id)
        .order_by(Play.played_at.asc(), Play.id.asc())
    )
    if cutoff is not None:
        stmt = stmt.where(Play.played_at >= cutoff)
    plays = list(db.scalars(stmt).all())

    display_name = (user.display_name or "").strip() or (user.email or "").split("@", 1)[0] or "LoggeRythm"
    wrapped_user = WrappedUser(
        display_name=display_name,
        avatar_url=user.avatar_url or "",
    )

    if not plays:
        return WrappedReport(
            range=range_name,
            generated_at=now_utc,
            period_start=(now_utc - timedelta(days=days)) if days is not None else None,
            period_end=now_utc,
            user=wrapped_user,
            totals=WrappedTotals(
                play_count=0,
                listening_sec=0,
                unique_tracks=0,
                unique_artists=0,
                unique_albums=0,
                new_artists_count=0,
                active_days=0,
                total_days=days if days is not None else 0,
                avg_daily_sec=0,
                current_streak_days=0,
                longest_streak_days=0,
            ),
            persona=None,
            aura=None,
            rhythm=WrappedRhythm(
                chronotype="day_cruiser",
                chronotype_label="Noch keine Daten",
                peak_hour=0,
                peak_weekday=0,
                weekend_share_pct=0,
                discovery_score_pct=0,
                repeat_score_pct=0,
                hourly_distribution=[0] * 24,
                weekday_distribution=[0] * 7,
            ),
            obsession=None,
            peak_day=None,
            tempo=None,
            equivalents=[],
            top_tracks=[],
            top_artists=[],
            top_albums=[],
        )

    hourly = [0] * 24
    weekday = [0] * 7
    play_dates: set[date] = set()
    track_buckets: dict[str, _TrackBucket] = {}
    artist_buckets: dict[str, _ArtistBucket] = {}
    album_buckets: dict[tuple[str, str], _AlbumBucket] = {}
    day_buckets: dict[date, _DayBucket] = {}

    total_listening_sec = 0
    earliest_play_utc: datetime | None = None

    for play in plays:
        if play.played_at is None:
            raise ValueError(f"Play row id={play.id} is missing played_at")
        played_utc = as_utc(play.played_at)
        if earliest_play_utc is None or played_utc < earliest_play_utc:
            earliest_play_utc = played_utc

        dur = _clamp_wire_int(play.duration_sec or 0)
        total_listening_sec += dur

        hour = played_utc.hour
        wday = played_utc.weekday()
        day = played_utc.date()
        hourly[hour] += 1
        weekday[wday] += 1
        play_dates.add(day)

        track_key = play.deezer_id or f"play-{play.id}"
        title = play.title or ""
        artist_name = (play.artist or "").strip()
        artist_id = (play.artist_id or "").strip()
        album_name = (play.album or "").strip()
        album_id = (play.album_id or "").strip()
        cover_url = play.cover_url or ""

        tb = track_buckets.get(track_key)
        if tb is None:
            tb = _TrackBucket(key=track_key)
            track_buckets[track_key] = tb
        tb.record(title, artist_name, album_name, cover_url, dur, day)

        if artist_name:
            ab = artist_buckets.get(artist_name)
            if ab is None:
                ab = _ArtistBucket(name=artist_name)
                artist_buckets[artist_name] = ab
            ab.record(artist_id, cover_url, dur, track_key)

        if album_name:
            album_group_key = (album_id, album_name)
            alb = album_buckets.get(album_group_key)
            if alb is None:
                alb = _AlbumBucket(album=album_name, album_id=album_id)
                album_buckets[album_group_key] = alb
            alb.record(album_id, artist_name, cover_url, dur)

        dbucket = day_buckets.get(day)
        if dbucket is None:
            dbucket = _DayBucket(day=day)
            day_buckets[day] = dbucket
        dbucket.record(track_key, title, artist_name, cover_url, dur)

    assert earliest_play_utc is not None
    play_count = len(plays)
    listening_sec = _clamp_wire_int(total_listening_sec)
    unique_tracks = len(track_buckets)
    unique_artists = len(artist_buckets)
    unique_albums = len(album_buckets)
    active_days = len(play_dates)
    total_days = (
        days
        if days is not None
        else max(1, (now_utc.date() - earliest_play_utc.date()).days + 1)
    )
    avg_daily_sec = _clamp_wire_int(round(listening_sec / active_days)) if active_days > 0 else 0
    current_streak, longest_streak = compute_streaks(play_dates, now_utc.date())

    if cutoff is None:
        new_artists_count = unique_artists
    else:
        cutoff_utc = as_utc(cutoff)
        first_plays = db.execute(
            select(Play.artist, func.min(Play.played_at).label("first_at"))
            .where(Play.user_id == user.id, Play.artist != "")
            .group_by(Play.artist)
        ).all()
        active_artist_names = set(artist_buckets)
        new_artists_count = sum(
            1
            for row in first_plays
            if (row.artist or "").strip() in active_artist_names
            and row.first_at is not None
            and as_utc(row.first_at) >= cutoff_utc
        )

    totals = WrappedTotals(
        play_count=_clamp_wire_int(play_count),
        listening_sec=listening_sec,
        unique_tracks=_clamp_wire_int(unique_tracks),
        unique_artists=_clamp_wire_int(unique_artists),
        unique_albums=_clamp_wire_int(unique_albums),
        new_artists_count=_clamp_wire_int(new_artists_count),
        active_days=_clamp_wire_int(active_days),
        total_days=_clamp_wire_int(total_days),
        avg_daily_sec=avg_daily_sec,
        current_streak_days=_clamp_wire_int(current_streak),
        longest_streak_days=_clamp_wire_int(longest_streak),
    )

    ordered_tracks = sorted(
        track_buckets.values(),
        key=lambda item: (-item.count, -item.listening_sec, item.title.casefold(), item.key),
    )
    top_tracks = [
        WrappedRankedItem(
            rank=idx,
            key=item.key,
            label=item.title,
            sublabel=item.artist,
            cover=item.cover,
            count=_clamp_wire_int(item.count),
            listening_sec=_clamp_wire_int(item.listening_sec),
            share_pct=_pct(item.count, play_count),
        )
        for idx, item in enumerate(ordered_tracks[:10], start=1)
    ]

    ordered_artists = sorted(
        artist_buckets.values(),
        key=lambda item: (-item.count, -item.listening_sec, item.name.casefold(), item.artist_id),
    )
    top_artists = [
        WrappedRankedItem(
            rank=idx,
            key=item.artist_id or item.name,
            label=item.name,
            sublabel=(
                f"{len(item.track_ids)} {'Track' if len(item.track_ids) == 1 else 'Tracks'}"
                if item.track_ids
                else ""
            ),
            cover=item.cover,
            count=_clamp_wire_int(item.count),
            listening_sec=_clamp_wire_int(item.listening_sec),
            share_pct=_pct(item.count, play_count),
        )
        for idx, item in enumerate(ordered_artists[:10], start=1)
    ]

    ordered_albums = sorted(
        album_buckets.values(),
        key=lambda item: (-item.count, -item.listening_sec, item.album.casefold(), item.album_id),
    )
    top_albums = [
        WrappedRankedItem(
            rank=idx,
            key=item.album_id or item.album,
            label=item.album,
            sublabel=item.artist,
            cover=item.cover,
            count=_clamp_wire_int(item.count),
            listening_sec=_clamp_wire_int(item.listening_sec),
            share_pct=_pct(item.count, play_count),
        )
        for idx, item in enumerate(ordered_albums[:10], start=1)
    ]

    peak_hour = max(range(24), key=lambda h: (hourly[h], -h))
    peak_weekday = max(range(7), key=lambda d: (weekday[d], -d))
    weekend_share_pct = _pct(weekday[5] + weekday[6], play_count)
    repeat_score_pct = _pct(max(0, play_count - unique_tracks), play_count)

    uniqueness_ratio = unique_tracks / play_count
    artist_spread = min(1.0, unique_artists / play_count)
    new_artist_ratio = (
        (new_artists_count / unique_artists)
        if (cutoff is not None and unique_artists > 0)
        else artist_spread
    )
    discovery_score_pct = min(
        100,
        max(
            0,
            round(
                100
                * (
                    0.55 * uniqueness_ratio
                    + 0.25 * artist_spread
                    + 0.20 * (new_artist_ratio * uniqueness_ratio)
                )
            ),
        ),
    )

    chronotype, _night_pct = _chronotype_for_hourly(hourly, peak_hour)
    rhythm = WrappedRhythm(
        chronotype=chronotype,
        chronotype_label=_CHRONOTYPE_LABELS[chronotype],
        peak_hour=peak_hour,
        peak_weekday=peak_weekday,
        weekend_share_pct=weekend_share_pct,
        discovery_score_pct=discovery_score_pct,
        repeat_score_pct=repeat_score_pct,
        hourly_distribution=[_clamp_wire_int(v) for v in hourly],
        weekday_distribution=[_clamp_wire_int(v) for v in weekday],
    )

    top_track_bucket = ordered_tracks[0]
    best_track_day: date | None = None
    best_track_day_plays = 0
    if top_track_bucket.day_counts:
        best_track_day, best_track_day_plays = max(
            top_track_bucket.day_counts.items(),
            key=lambda kv: (kv[1], kv[0]),
        )
    obsession = WrappedObsession(
        track_key=top_track_bucket.key,
        title=top_track_bucket.title,
        artist=top_track_bucket.artist,
        album=top_track_bucket.album,
        cover=top_track_bucket.cover,
        play_count=_clamp_wire_int(top_track_bucket.count),
        listening_sec=_clamp_wire_int(top_track_bucket.listening_sec),
        share_pct=_pct(top_track_bucket.count, play_count),
        peak_day_date=best_track_day.isoformat() if best_track_day is not None else None,
        peak_day_plays=_clamp_wire_int(best_track_day_plays),
    )

    best_day_bucket = max(
        day_buckets.values(),
        key=lambda b: (b.listening_sec, b.play_count, b.day),
    )
    assert (
        best_day_bucket.track_counts is not None
        and best_day_bucket.track_secs is not None
        and best_day_bucket.track_meta is not None
    )
    day_top_track_key = max(
        best_day_bucket.track_counts,
        key=lambda tk: (
            best_day_bucket.track_counts[tk],
            best_day_bucket.track_secs[tk],
            tk,
        ),
    )
    day_track_title, day_track_artist, day_track_cover = best_day_bucket.track_meta[
        day_top_track_key
    ]
    peak_day = WrappedPeakDay(
        date=best_day_bucket.day.isoformat(),
        weekday=best_day_bucket.day.weekday(),
        play_count=_clamp_wire_int(best_day_bucket.play_count),
        listening_sec=_clamp_wire_int(best_day_bucket.listening_sec),
        top_track_title=day_track_title,
        top_track_artist=day_track_artist,
        top_track_cover=day_track_cover,
    )

    stored_bpms = db.execute(
        select(StoredTrack.deezer_id, StoredTrack.bpm).where(
            StoredTrack.deezer_id.in_(list(track_buckets)),
            StoredTrack.bpm.is_not(None),
        )
    ).all()
    bpm_by_id: dict[str, float] = {}
    for row in stored_bpms:
        if row.bpm is None:
            continue
        bpm_val = float(row.bpm)
        if math.isfinite(bpm_val) and bpm_val > 0:
            bpm_by_id[row.deezer_id] = bpm_val

    play_bpms = [bpm_by_id[p.deezer_id] for p in plays if p.deezer_id in bpm_by_id]
    tempo: WrappedTempo | None = None
    if play_bpms:
        avg_bpm = max(1, round(sum(play_bpms) / len(play_bpms)))
        min_bpm = max(1, round(min(play_bpms)))
        max_bpm = max(min_bpm, round(max(play_bpms)))
        if avg_bpm < 95:
            vibe_label = "Entspannt"
        elif avg_bpm < 118:
            vibe_label = "Groove-Puls"
        elif avg_bpm < 135:
            vibe_label = "Club-Puls"
        else:
            vibe_label = "High-Energy"
        tempo = WrappedTempo(
            avg_bpm=avg_bpm,
            min_bpm=min_bpm,
            max_bpm=max_bpm,
            analyzed_plays=_clamp_wire_int(len(play_bpms)),
            vibe_label=vibe_label,
        )

    persona = _build_persona(
        totals=totals,
        rhythm=rhythm,
        obsession=obsession,
        top_albums=top_albums,
        hourly=hourly,
    )
    aura = _build_aura(rhythm=rhythm, tempo=tempo)
    equivalents = _build_equivalents(listening_sec)

    period_start = (now_utc - timedelta(days=days)) if days is not None else earliest_play_utc

    return WrappedReport(
        range=range_name,
        generated_at=now_utc,
        period_start=period_start,
        period_end=now_utc,
        user=wrapped_user,
        totals=totals,
        persona=persona,
        aura=aura,
        rhythm=rhythm,
        obsession=obsession,
        peak_day=peak_day,
        tempo=tempo,
        equivalents=equivalents,
        top_tracks=top_tracks,
        top_artists=top_artists,
        top_albums=top_albums,
    )


def _storage_dir() -> str:
    return os.getenv("STORAGE_DIR") or app_config.STORAGE_DIR


def _local_image_media_type(file_path: str, data: bytes) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    if ext in _IMAGE_MIME_BY_EXT and _looks_like_image(data[:16], ".jpg" if ext == ".jpeg" else ext):
        return _IMAGE_MIME_BY_EXT[ext]
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    guessed, _ = mimetypes.guess_type(file_path)
    if guessed and guessed.startswith("image/"):
        return guessed
    raise HTTPException(
        status_code=502,
        detail="Lokale Bilddatei hat kein gültiges Bildformat.",
    )


def _read_local_image_file(file_path: str) -> tuple[bytes, str]:
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Lokale Bilddatei nicht gefunden.")
    size = os.path.getsize(file_path)
    if size <= 0:
        raise HTTPException(status_code=502, detail="Lokale Bilddatei ist leer.")
    if size > MAX_IMAGE_UPLOAD_BYTES:
        raise HTTPException(
            status_code=502,
            detail="Lokale Bilddatei überschreitet das Limit von 5 MB.",
        )
    with open(file_path, "rb") as fh:
        data = fh.read(MAX_IMAGE_UPLOAD_BYTES + 1)
    if len(data) > MAX_IMAGE_UPLOAD_BYTES:
        raise HTTPException(
            status_code=502,
            detail="Lokale Bilddatei überschreitet das Limit von 5 MB.",
        )
    media_type = _local_image_media_type(file_path, data)
    return data, media_type


def _load_local_artwork(raw_url: str) -> tuple[bytes, str]:
    if raw_url.startswith("//"):
        raise HTTPException(status_code=403, detail="Protokoll-relative Bild-URLs sind nicht erlaubt.")
    parsed = urlparse(raw_url)
    if parsed.scheme or parsed.netloc:
        raise HTTPException(status_code=403, detail="Ungültiger lokaler Bildpfad.")
    path = unquote(parsed.path)
    base_dir = _storage_dir()

    avatar_match = _LOCAL_AVATAR_RE.fullmatch(path)
    if avatar_match is not None:
        uid = avatar_match.group(1)
        matches = sorted(glob.glob(os.path.join(base_dir, "avatars", f"{uid}.*")))
        for candidate in matches:
            if os.path.isfile(candidate):
                return _read_local_image_file(candidate)
        raise HTTPException(status_code=404, detail="Avatar-Datei auf dem Server nicht gefunden.")

    cover_match = _LOCAL_PLAYLIST_COVER_RE.fullmatch(path)
    if cover_match is not None:
        pid = cover_match.group(1)
        matches = sorted(glob.glob(os.path.join(base_dir, "covers", f"{pid}.*")))
        for candidate in matches:
            if os.path.isfile(candidate):
                return _read_local_image_file(candidate)
        raise HTTPException(status_code=404, detail="Cover-Datei auf dem Server nicht gefunden.")

    if path.startswith(_LOCAL_UPLOADS_PREFIX):
        rel = path[len(_LOCAL_UPLOADS_PREFIX) :]
        if not rel or "\x00" in rel:
            raise HTTPException(status_code=403, detail="Ungültiger Upload-Pfad.")
        uploads_root = os.path.realpath(os.path.join(base_dir, "uploads"))
        candidate = os.path.realpath(os.path.join(uploads_root, rel))
        if not candidate.startswith(uploads_root + os.sep):
            raise HTTPException(status_code=403, detail="Pfad-Traversal außerhalb von uploads/ blockiert.")
        return _read_local_image_file(candidate)

    raise HTTPException(status_code=403, detail="Lokaler Bildpfad ist nicht freigegeben.")


def load_wrapped_artwork(db: Session, user: User, raw_url: str) -> tuple[bytes, str]:
    """Load allowlisted cover or avatar image bytes for Canvas export without SSRF."""
    if not raw_url:
        raise HTTPException(status_code=403, detail="Artwork-URL darf nicht leer sein.")

    is_avatar = bool(user.avatar_url) and raw_url == user.avatar_url
    has_play_cover = (
        db.scalar(
            select(Play.id)
            .where(Play.user_id == user.id, Play.cover_url == raw_url)
            .limit(1)
        )
        is not None
    )
    if not (is_avatar or has_play_cover):
        raise HTTPException(
            status_code=403,
            detail="Artwork-URL ist für das angemeldete Konto nicht freigegeben.",
        )

    if raw_url.startswith("/"):
        return _load_local_artwork(raw_url)

    parsed = urlparse(raw_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(
            status_code=403,
            detail="Artwork-URL muss ein gültiges http(s)-Schema oder ein freigegebener lokaler Pfad sein.",
        )

    try:
        resp = requests.get(raw_url, timeout=_ARTWORK_FETCH_TIMEOUT_SEC, stream=True)
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Artwork konnte nicht vom Upstream geladen werden: {exc}",
        ) from exc

    try:
        if resp.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Artwork-Upstream antwortete mit HTTP {resp.status_code}.",
            )
        raw_ct = resp.headers.get("Content-Type", "")
        media_type = raw_ct.split(";", 1)[0].strip().lower()
        if not media_type.startswith("image/"):
            raise HTTPException(
                status_code=502,
                detail=f"Upstream lieferte keinen gültigen Bild-Content-Type ({raw_ct!r}).",
            )
        raw_len = resp.headers.get("Content-Length")
        if raw_len is not None:
            try:
                content_len = int(raw_len)
            except ValueError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Ungültiger Content-Length-Header vom Upstream: {raw_len!r}",
                ) from exc
            if content_len > MAX_IMAGE_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=502,
                    detail="Artwork überschreitet die maximale Dateigröße von 5 MB.",
                )

        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in resp.iter_content(chunk_size=_ARTWORK_CHUNK_BYTES):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_IMAGE_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=502,
                        detail="Artwork überschreitet die maximale Dateigröße von 5 MB.",
                    )
                chunks.append(chunk)
        except requests.RequestException as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Artwork-Stream wurde unterbrochen: {exc}",
            ) from exc

        data = b"".join(chunks)
        if not data:
            raise HTTPException(
                status_code=502,
                detail="Artwork-Upstream lieferte eine leere Antwort.",
            )
        return data, media_type
    finally:
        resp.close()


# --- Pure-Python SVG Card Renderer -------------------------------------------


@dataclass(frozen=True)
class _SvgPalette:
    bg: str
    bg2: str
    surface: str
    text: str
    muted: str
    accent: str
    accent2: str
    border: str


_SVG_THEMES: dict[WrappedCardTheme, _SvgPalette] = {
    "signal": _SvgPalette(
        bg="#09090B",
        bg2="#14131A",
        surface="#1B1A22",
        text="#F4F0E6",
        muted="#9E978E",
        accent="#D6FF4B",
        accent2="#5CE1E6",
        border="#2F2D3A",
    ),
    "vinyl": _SvgPalette(
        bg="#160D0B",
        bg2="#251511",
        surface="#311C17",
        text="#FAF1E4",
        muted="#C9B0A0",
        accent="#FF7B54",
        accent2="#FFB26B",
        border="#4D2E25",
    ),
    "neon": _SvgPalette(
        bg="#070B19",
        bg2="#0E1733",
        surface="#162348",
        text="#F1F5FF",
        muted="#94A6CE",
        accent="#38BDF8",
        accent2="#C084FC",
        border="#283C70",
    ),
    "paper": _SvgPalette(
        bg="#F4F0E6",
        bg2="#E8E0CE",
        surface="#FFFFFF",
        text="#121116",
        muted="#68625B",
        accent="#C83E2B",
        accent2="#1D4ED8",
        border="#D5CCB9",
    ),
}


def _esc(value: object) -> str:
    return xml_escape(str(value), {'"': "&quot;", "'": "&apos;"})


def _trunc(value: str, limit: int) -> str:
    clean = " ".join(value.split())
    if len(clean) <= limit:
        return clean
    return clean[: max(1, limit - 1)].rstrip() + "…"


def _wrap_lines(text: str, max_chars: int, max_lines: int) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word[:max_chars]
            if len(lines) >= max_lines:
                break
    if len(lines) < max_lines and current:
        lines.append(current)
    if len(lines) == max_lines and len(" ".join(words)) > sum(len(l) for l in lines):
        lines[-1] = _trunc(lines[-1], max_chars)
    return lines[:max_lines]


def _fmt_hours(listening_sec: int) -> tuple[str, str]:
    if listening_sec < 3600:
        mins = max(1, round(listening_sec / 60)) if listening_sec > 0 else 0
        return str(mins), "MINUTEN"
    hours = listening_sec / 3600
    if hours >= 100:
        return str(round(hours)), "STUNDEN"
    return f"{hours:.1f}".replace(".", ","), "STUNDEN"


def _fmt_mmss(duration_sec: int) -> str:
    mins = duration_sec // 60
    secs = duration_sec % 60
    return f"{mins:02d}:{secs:02d}"


def _svg_logo_mark(x: int, y: int, size: int, accent: str, muted: str) -> str:
    scale = size / 256.0
    rects = (
        (38, 38),
        (38, 86),
        (38, 134),
        (38, 182),
        (86, 182),
        (134, 182),
        (182, 182),
        (134, 86),
    )
    dots = (
        (104, 56),
        (152, 56),
        (200, 56),
        (104, 104),
        (200, 104),
        (104, 152),
        (152, 152),
        (200, 152),
    )
    parts = [f'<g transform="translate({x},{y}) scale({scale:.4f})">']
    for rx, ry in rects:
        parts.append(f'<rect x="{rx}" y="{ry}" width="36" height="36" rx="10" fill="{accent}"/>')
    for cx, cy in dots:
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="6" fill="{muted}" opacity="0.45"/>')
    parts.append("</g>")
    return "".join(parts)


def _svg_emblem(emblem: WrappedEmblemId, cx: int, cy: int, radius: int, pal: _SvgPalette) -> str:
    r = radius
    parts = [
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{pal.surface}" stroke="{pal.border}" stroke-width="3"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{int(r * 0.84)}" fill="none" stroke="{pal.accent}" stroke-width="2" opacity="0.35"/>',
    ]
    if emblem == "moon_wave":
        parts.append(
            f'<path d="M {cx + 12} {cy - int(r * 0.45)} A {int(r * 0.48)} {int(r * 0.48)} 0 1 0 {cx + 12} {cy + int(r * 0.45)} '
            f'A {int(r * 0.34)} {int(r * 0.34)} 0 1 1 {cx + 12} {cy - int(r * 0.45)} Z" fill="{pal.accent}"/>'
        )
        parts.append(
            f'<path d="M {cx - 56} {cy + 34} Q {cx - 24} {cy + 14}, {cx} {cy + 34} T {cx + 56} {cy + 34}" '
            f'fill="none" stroke="{pal.accent2}" stroke-width="6" stroke-linecap="round"/>'
        )
    elif emblem == "infinite_vinyl":
        parts.append(
            f'<circle cx="{cx - 34}" cy="{cy}" r="36" fill="none" stroke="{pal.accent}" stroke-width="10"/>'
            f'<circle cx="{cx + 34}" cy="{cy}" r="36" fill="none" stroke="{pal.accent2}" stroke-width="10"/>'
            f'<circle cx="{cx - 34}" cy="{cy}" r="8" fill="{pal.text}"/>'
            f'<circle cx="{cx + 34}" cy="{cy}" r="8" fill="{pal.text}"/>'
        )
    elif emblem == "compass_radar":
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{int(r * 0.56)}" fill="none" stroke="{pal.muted}" stroke-width="2" stroke-dasharray="6 6"/>'
            f'<polygon points="{cx},{cy - 54} {cx + 22},{cy} {cx},{cy + 54} {cx - 22},{cy}" fill="{pal.accent}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="9" fill="{pal.bg}"/>'
        )
    elif emblem == "tonearm_disc":
        parts.append(
            f'<circle cx="{cx - 10}" cy="{cy}" r="{int(r * 0.5)}" fill="{pal.bg2}" stroke="{pal.accent}" stroke-width="4"/>'
            f'<circle cx="{cx - 10}" cy="{cy}" r="{int(r * 0.16)}" fill="{pal.accent}"/>'
            f'<path d="M {cx + 42} {cy - 48} L {cx + 26} {cy + 16} L {cx + 8} {cy + 28}" fill="none" stroke="{pal.accent2}" stroke-width="7" stroke-linecap="round"/>'
        )
    elif emblem == "strobe_bars":
        heights = (34, 68, 92, 56, 82, 42)
        for i, h in enumerate(heights):
            bx = cx - 68 + i * 24
            fill = pal.accent if i % 2 == 0 else pal.accent2
            parts.append(
                f'<rect x="{bx}" y="{cy - h // 2}" width="16" height="{h}" rx="6" fill="{fill}"/>'
            )
    elif emblem == "sunrise_pulse":
        parts.append(
            f'<path d="M {cx - 56} {cy + 14} A 56 56 0 0 1 {cx + 56} {cy + 14} Z" fill="{pal.accent}"/>'
            f'<line x1="{cx - 68}" y1="{cy + 26}" x2="{cx + 68}" y2="{cy + 26}" stroke="{pal.accent2}" stroke-width="6" stroke-linecap="round"/>'
            f'<line x1="{cx}" y1="{cy - 68}" x2="{cx}" y2="{cy - 48}" stroke="{pal.accent}" stroke-width="6" stroke-linecap="round"/>'
        )
    elif emblem == "flame_metro":
        parts.append(
            f'<path d="M {cx} {cy - 60} C {cx + 44} {cy - 18}, {cx + 48} {cy + 42}, {cx} {cy + 58} '
            f'C {cx - 48} {cy + 42}, {cx - 44} {cy - 18}, {cx} {cy - 60} Z" fill="{pal.accent}"/>'
            f'<path d="M {cx} {cy - 16} C {cx + 20} {cy + 4}, {cx + 20} {cy + 36}, {cx} {cy + 46} '
            f'C {cx - 20} {cy + 36}, {cx - 20} {cy + 4}, {cx} {cy - 16} Z" fill="{pal.accent2}"/>'
        )
    else:  # prism_beat
        parts.append(
            f'<polygon points="{cx},{cy - 58} {cx + 56},{cy + 44} {cx - 56},{cy + 44}" fill="none" stroke="{pal.accent}" stroke-width="7" stroke-linejoin="round"/>'
            f'<line x1="{cx - 66}" y1="{cy - 4}" x2="{cx}" y2="{cy - 4}" stroke="{pal.text}" stroke-width="5"/>'
            f'<line x1="{cx + 12}" y1="{cy - 10}" x2="{cx + 72}" y2="{cy - 28}" stroke="{pal.accent2}" stroke-width="5"/>'
            f'<line x1="{cx + 18}" y1="{cy + 12}" x2="{cx + 72}" y2="{cy + 26}" stroke="{pal.accent}" stroke-width="5"/>'
        )
    return "".join(parts)


def _svg_header(
    report: WrappedReport,
    width: int,
    pal: _SvgPalette,
    *,
    show_user: bool,
    kicker: str,
) -> str:
    range_label = _RANGE_LABELS[report.range]
    user_label = _trunc(report.user.display_name, 26)
    parts = [
        _svg_logo_mark(72, 68, 56, pal.accent, pal.muted),
        f'<text x="148" y="92" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="800" letter-spacing="3" fill="{pal.text}">LOGGERYTHM WRAPPED</text>',
        f'<text x="148" y="120" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="600" letter-spacing="2" fill="{pal.muted}">{_esc(kicker)} · {_esc(range_label)}</text>',
    ]
    if show_user:
        parts.append(
            f'<rect x="{width - 332}" y="72" width="260" height="48" rx="24" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
            f'<text x="{width - 202}" y="103" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" fill="{pal.text}">@{_esc(user_label)}</text>'
        )
    parts.append(
        f'<line x1="72" y1="148" x2="{width - 72}" y2="148" stroke="{pal.border}" stroke-width="2"/>'
    )
    return "".join(parts)


def _svg_footer(report: WrappedReport, width: int, height: int, pal: _SvgPalette, *, show_counts: bool) -> str:
    y = height - 64
    right_txt = (
        f"{report.totals.play_count} PLAYS · {report.totals.unique_artists} ARTISTS"
        if show_counts
        else "DEIN PERSÖNLICHER RÜCKBLICK"
    )
    return (
        f'<line x1="72" y1="{y - 34}" x2="{width - 72}" y2="{y - 34}" stroke="{pal.border}" stroke-width="2"/>'
        f'<text x="72" y="{y}" font-family="ui-monospace, Menlo, monospace" font-size="17" font-weight="600" letter-spacing="2" fill="{pal.muted}">LOGGERYTHM.APP/WRAPPED</text>'
        f'<text x="{width - 72}" y="{y}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="17" font-weight="700" letter-spacing="1.5" fill="{pal.accent}">{_esc(right_txt)}</text>'
    )


def _render_summary_body(report: WrappedReport, width: int, height: int, pal: _SvgPalette, *, show_counts: bool) -> str:
    is_story = height > width
    hero_val, hero_unit = _fmt_hours(report.totals.listening_sec)
    parts: list[str] = []

    hero_y = 265 if is_story else 245
    parts.append(
        f'<text x="72" y="{hero_y - 44}" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" letter-spacing="3" fill="{pal.accent}">GEHÖRTE ZEIT</text>'
        f'<text x="72" y="{hero_y + 72}" font-family="system-ui, -apple-system, sans-serif" font-size="136" font-weight="900" letter-spacing="-4" fill="{pal.text}">{_esc(hero_val)}</text>'
        f'<text x="72" y="{hero_y + 114}" font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="700" letter-spacing="4" fill="{pal.muted}">{hero_unit}</text>'
    )

    if report.equivalents:
        eq = report.equivalents[0]
        parts.append(
            f'<rect x="{width - 432}" y="{hero_y - 20}" width="360" height="128" rx="24" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
            f'<text x="{width - 404}" y="{hero_y + 20}" font-family="ui-monospace, Menlo, monospace" font-size="15" font-weight="700" letter-spacing="2" fill="{pal.muted}">ENTSPRICHT</text>'
            f'<text x="{width - 404}" y="{hero_y + 66}" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="900" fill="{pal.accent}">{_esc(eq.value)}</text>'
            f'<text x="{width - 404}" y="{hero_y + 94}" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="{pal.text}">{_esc(_trunc(eq.label, 28))}</text>'
        )

    if report.persona is not None:
        pill_y = hero_y + 150
        parts.append(
            f'<rect x="72" y="{pill_y}" width="{width - 144}" height="88" rx="22" fill="{pal.surface}" stroke="{pal.accent}" stroke-width="2"/>'
            f'<text x="102" y="{pill_y + 34}" font-family="ui-monospace, Menlo, monospace" font-size="15" font-weight="700" letter-spacing="2" fill="{pal.accent}">KLANG-PERSÖNLICHKEIT</text>'
            f'<text x="102" y="{pill_y + 66}" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800" fill="{pal.text}">{_esc(_trunc(report.persona.title, 34))}</text>'
        )

    cols_y = 620 if is_story else 510
    row_limit = 5 if is_story else 4
    row_gap = 128 if is_story else 96
    col_w = (width - 144 - 36) // 2

    def draw_col(x: int, title: str, items: list[WrappedRankedItem], accent_bar: str) -> None:
        parts.append(
            f'<text x="{x}" y="{cols_y}" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" letter-spacing="2.5" fill="{pal.muted}">{_esc(title)}</text>'
        )
        max_c = max((i.count for i in items[:row_limit]), default=1)
        for idx, item in enumerate(items[:row_limit]):
            ry = cols_y + 34 + idx * row_gap
            bar_w = max(24, int((col_w - 48) * (item.count / max(1, max_c))))
            parts.append(
                f'<rect x="{x}" y="{ry}" width="{col_w}" height="{row_gap - 16}" rx="18" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
                f'<text x="{x + 22}" y="{ry + 36}" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="800" fill="{accent_bar}">#{item.rank:02d}</text>'
                f'<text x="{x + 76}" y="{ry + 36}" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="800" fill="{pal.text}">{_esc(_trunc(item.label, 20))}</text>'
            )
            if item.sublabel:
                parts.append(
                    f'<text x="{x + 76}" y="{ry + 62}" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="{pal.muted}">{_esc(_trunc(item.sublabel, 24))}</text>'
                )
            if show_counts:
                parts.append(
                    f'<text x="{x + col_w - 20}" y="{ry + 36}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" fill="{pal.text}">{item.count}×</text>'
                )
            bar_y = ry + row_gap - 30
            parts.append(
                f'<rect x="{x + 22}" y="{bar_y}" width="{col_w - 44}" height="5" rx="2.5" fill="{pal.border}"/>'
                f'<rect x="{x + 22}" y="{bar_y}" width="{bar_w}" height="5" rx="2.5" fill="{accent_bar}"/>'
            )

    draw_col(72, "TOP ARTISTS", report.top_artists, pal.accent)
    draw_col(72 + col_w + 36, "TOP TRACKS", report.top_tracks, pal.accent2)

    if is_story:
        stats_y = 1360
        kpis = [
            ("WIEDERGABEN", str(report.totals.play_count) if show_counts else "AKTIV"),
            ("UNIQUE TRACKS", str(report.totals.unique_tracks)),
            ("REKORD-SERIE", f"{report.totals.longest_streak_days} TAGE"),
            ("ENTDECKER", f"{report.rhythm.discovery_score_pct}%"),
        ]
        box_w = (width - 144 - 54) // 4
        for idx, (lbl, val) in enumerate(kpis):
            bx = 72 + idx * (box_w + 18)
            parts.append(
                f'<rect x="{bx}" y="{stats_y}" width="{box_w}" height="150" rx="22" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
                f'<text x="{bx + 20}" y="{stats_y + 44}" font-family="ui-monospace, Menlo, monospace" font-size="14" font-weight="700" letter-spacing="1.5" fill="{pal.muted}">{_esc(lbl)}</text>'
                f'<text x="{bx + 20}" y="{stats_y + 106}" font-family="system-ui, -apple-system, sans-serif" font-size="38" font-weight="900" fill="{pal.accent if idx == 0 else pal.text}">{_esc(val)}</text>'
            )

        wave_y = 1580
        parts.append(
            f'<text x="72" y="{wave_y}" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="2" fill="{pal.muted}">24H-RHYTHMUS</text>'
        )
        max_h = max(1, *report.rhythm.hourly_distribution)
        bar_step = (width - 144) / 24
        for h_idx, h_val in enumerate(report.rhythm.hourly_distribution):
            bh = 16 + int((h_val / max_h) * 140)
            bx = int(72 + h_idx * bar_step)
            fill = pal.accent if h_idx == report.rhythm.peak_hour else pal.accent2
            opacity = "1" if h_idx == report.rhythm.peak_hour else ("0.65" if h_val > 0 else "0.18")
            parts.append(
                f'<rect x="{bx}" y="{wave_y + 170 - bh}" width="{max(10, int(bar_step - 8))}" height="{bh}" rx="5" fill="{fill}" opacity="{opacity}"/>'
            )

    return "".join(parts)


def _render_persona_body(report: WrappedReport, width: int, height: int, pal: _SvgPalette, *, show_counts: bool) -> str:
    persona = report.persona
    assert persona is not None
    is_story = height > width
    cx = width // 2
    cy = 430 if is_story else 340
    radius = 160 if is_story else 120
    parts = [_svg_emblem(persona.emblem, cx, cy, radius, pal)]

    title_y = cy + radius + 96
    parts.append(
        f'<text x="{cx}" y="{title_y - 52}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" letter-spacing="3.5" fill="{pal.accent}">DEINE KLANG-PERSÖNLICHKEIT</text>'
        f'<text x="{cx}" y="{title_y + 12}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="60" font-weight="900" letter-spacing="-1.5" fill="{pal.text}">{_esc(_trunc(persona.title, 28))}</text>'
        f'<text x="{cx}" y="{title_y + 62}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="600" fill="{pal.muted}">{_esc(_trunc(persona.subtitle, 54))}</text>'
    )

    tagline_y = title_y + 130
    tag_lines = _wrap_lines(persona.tagline, 42, 3)
    box_h = 46 + len(tag_lines) * 44
    parts.append(
        f'<rect x="92" y="{tagline_y}" width="{width - 184}" height="{box_h}" rx="24" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
    )
    for idx, line in enumerate(tag_lines):
        parts.append(
            f'<text x="{cx}" y="{tagline_y + 50 + idx * 42}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="700" fill="{pal.text}">{_esc(line)}</text>'
        )

    pills_y = tagline_y + box_h + 46
    pill_w = (width - 144 - 36) // 3
    for idx, trait in enumerate(persona.traits[:3]):
        px = 72 + idx * (pill_w + 18)
        display_trait = trait if show_counts else _trunc(trait.split(":")[-1].strip() or trait, 22)
        parts.append(
            f'<rect x="{px}" y="{pills_y}" width="{pill_w}" height="74" rx="20" fill="{pal.bg2}" stroke="{pal.accent if idx == 0 else pal.border}" stroke-width="2"/>'
            f'<text x="{px + pill_w // 2}" y="{pills_y + 45}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="20" font-weight="700" fill="{pal.accent if idx == 0 else pal.text}">{_esc(_trunc(display_trait, 22))}</text>'
        )

    if is_story:
        dna_y = pills_y + 148
        parts.append(
            f'<text x="{cx}" y="{dna_y}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="3" fill="{pal.muted}">SOUND-DNA WAVEFORM</text>'
        )
        max_h = max(1, *report.rhythm.hourly_distribution)
        for i, h_val in enumerate(report.rhythm.hourly_distribution):
            bh = 24 + int((h_val / max_h) * 190)
            bx = 96 + i * 38
            parts.append(
                f'<rect x="{bx}" y="{dna_y + 135 - bh // 2}" width="24" height="{bh}" rx="12" fill="{pal.accent if i % 3 == 0 else pal.accent2}" opacity="{0.35 + 0.65 * (h_val / max_h):.2f}"/>'
            )

    return "".join(parts)


def _render_receipt_body(report: WrappedReport, width: int, height: int, pal: _SvgPalette, *, show_counts: bool) -> str:
    is_story = height > width
    px = 104
    pw = width - 208
    top_y = 186
    bot_y = height - 134
    paper_bg = "#F7F3E9"
    paper_ink = "#151419"
    paper_muted = "#635E56"

    teeth_top = " ".join(
        f"{px + i * 24},{top_y + (16 if i % 2 else 0)}"
        for i in range(pw // 24 + 1)
    )
    teeth_bot = " ".join(
        f"{px + pw - i * 24},{bot_y - (16 if i % 2 else 0)}"
        for i in range(pw // 24 + 1)
    )
    parts = [
        f'<polygon points="{teeth_top} {px + pw},{bot_y} {teeth_bot} {px},{bot_y}" fill="{paper_bg}"/>',
        f'<text x="{width // 2}" y="{top_y + 68}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="34" font-weight="900" letter-spacing="4" fill="{paper_ink}">LOGGERYTHM STUDIO</text>',
        f'<text x="{width // 2}" y="{top_y + 102}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="600" letter-spacing="2" fill="{paper_muted}">BELEG #{report.totals.play_count:04d} · {_esc(_RANGE_LABELS[report.range])}</text>',
        f'<line x1="{px + 36}" y1="{top_y + 126}" x2="{px + pw - 36}" y2="{top_y + 126}" stroke="{paper_ink}" stroke-width="2" stroke-dasharray="8 6"/>',
    ]

    max_rows = 10 if is_story else 6
    row_step = 76 if is_story else 64
    list_y = top_y + 172
    parts.append(
        f'<text x="{px + 36}" y="{list_y - 16}" font-family="ui-monospace, Menlo, monospace" font-size="15" font-weight="700" fill="{paper_muted}">QTY  TITEL / ARTIST</text>'
        f'<text x="{px + pw - 36}" y="{list_y - 16}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="15" font-weight="700" fill="{paper_muted}">DAUER</text>'
    )
    for idx, item in enumerate(report.top_tracks[:max_rows]):
        ry = list_y + idx * row_step
        qty = f"{item.count:02d}×" if show_counts else f"#{item.rank:02d}"
        dur_txt = _fmt_mmss(item.listening_sec)
        parts.append(
            f'<text x="{px + 36}" y="{ry + 22}" font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="800" fill="{paper_ink}">{qty}</text>'
            f'<text x="{px + 102}" y="{ry + 22}" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="800" fill="{paper_ink}">{_esc(_trunc(item.label, 30))}</text>'
            f'<text x="{px + 102}" y="{ry + 48}" font-family="ui-monospace, Menlo, monospace" font-size="16" fill="{paper_muted}">{_esc(_trunc(item.sublabel, 34))}</text>'
            f'<text x="{px + pw - 36}" y="{ry + 22}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="20" font-weight="700" fill="{paper_ink}">{dur_txt}</text>'
        )

    tot_y = bot_y - 260
    hero_val, hero_unit = _fmt_hours(report.totals.listening_sec)
    parts.extend([
        f'<line x1="{px + 36}" y1="{tot_y}" x2="{px + pw - 36}" y2="{tot_y}" stroke="{paper_ink}" stroke-width="2" stroke-dasharray="8 6"/>',
        f'<text x="{px + 36}" y="{tot_y + 44}" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" fill="{paper_muted}">ENTDECKER-SCORE</text>',
        f'<text x="{px + pw - 36}" y="{tot_y + 44}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="20" font-weight="800" fill="{paper_ink}">{report.rhythm.discovery_score_pct}%</text>',
        f'<text x="{px + 36}" y="{tot_y + 94}" font-family="ui-monospace, Menlo, monospace" font-size="26" font-weight="900" fill="{paper_ink}">GESAMTZEIT</text>',
        f'<text x="{px + pw - 36}" y="{tot_y + 94}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="28" font-weight="900" fill="{pal.accent if pal.bg == "#F4F0E6" else "#151419"}">{_esc(hero_val)} {hero_unit}</text>',
    ])

    bar_y = bot_y - 122
    bar_x = px + 68
    widths = (6, 2, 10, 4, 2, 8, 4, 12, 2, 6, 8, 2, 10, 4, 6, 2, 12, 4, 8, 2, 6, 4, 10, 2, 8, 6, 4, 10, 2, 6, 8, 4, 12, 2, 6)
    cursor = bar_x
    for idx, bw in enumerate(widths):
        if cursor + bw > px + pw - 68:
            break
        if idx % 2 == 0:
            parts.append(f'<rect x="{cursor}" y="{bar_y}" width="{bw * 2}" height="68" fill="{paper_ink}"/>')
        cursor += bw * 2 + 4
    return "".join(parts)


def _render_festival_body(report: WrappedReport, width: int, height: int, pal: _SvgPalette, *, show_counts: bool) -> str:
    is_story = height > width
    cx = width // 2
    parts = [
        f'<circle cx="{cx}" cy="{height // 2}" r="420" fill="{pal.accent}" opacity="0.08"/>',
        f'<text x="{cx}" y="226" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="800" letter-spacing="6" fill="{pal.accent}">LOGGERYTHM FEST · EDITION</text>',
    ]
    artists = report.top_artists
    headliner = artists[0].label if artists else report.top_tracks[0].sublabel or report.top_tracks[0].label
    headliner_sub = (
        f"{artists[0].count} WIEDERGABEN · {artists[0].share_pct}% SHARE"
        if artists and show_counts
        else "MAIN STAGE HEADLINER"
    )
    parts.append(
        f'<text x="{cx}" y="{345 if is_story else 315}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="88" font-weight="900" letter-spacing="-2" fill="{pal.text}">{_esc(_trunc(headliner.upper(), 18))}</text>'
        f'<text x="{cx}" y="{395 if is_story else 362}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="20" font-weight="700" letter-spacing="2.5" fill="{pal.accent2}">{_esc(headliner_sub)}</text>'
    )

    co = artists[1:4]
    co_y = 540 if is_story else 470
    parts.append(
        f'<line x1="120" y1="{co_y - 54}" x2="{width - 120}" y2="{co_y - 54}" stroke="{pal.border}" stroke-width="2"/>'
        f'<text x="{cx}" y="{co_y - 22}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="3" fill="{pal.muted}">CO-HEADLINER</text>'
    )
    if co:
        co_text = "  ★  ".join(_trunc(a.label.upper(), 16) for a in co)
        for idx, line in enumerate(_wrap_lines(co_text, 28, 3)):
            parts.append(
                f'<text x="{cx}" y="{co_y + 38 + idx * 58}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="44" font-weight="900" fill="{pal.accent}">{_esc(line)}</text>'
            )
    else:
        parts.append(
            f'<text x="{cx}" y="{co_y + 42}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="800" fill="{pal.accent}">SOLO HEADLINER SET</text>'
        )

    under = artists[4:10]
    under_y = 850 if is_story else 690
    parts.append(
        f'<line x1="160" y1="{under_y - 44}" x2="{width - 160}" y2="{under_y - 44}" stroke="{pal.border}" stroke-width="2"/>'
        f'<text x="{cx}" y="{under_y - 12}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="3" fill="{pal.muted}">UNDERCARD &amp; NIGHT SESSIONS</text>'
    )
    if under:
        under_str = " · ".join(_trunc(a.label, 18) for a in under)
        for idx, line in enumerate(_wrap_lines(under_str, 34, 4)):
            parts.append(
                f'<text x="{cx}" y="{under_y + 42 + idx * 46}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="700" fill="{pal.text}">{_esc(line)}</text>'
            )
    else:
        tracks_str = " · ".join(_trunc(t.label, 18) for t in report.top_tracks[:5])
        for idx, line in enumerate(_wrap_lines(tracks_str, 36, 3)):
            parts.append(
                f'<text x="{cx}" y="{under_y + 42 + idx * 44}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="700" fill="{pal.text}">{_esc(line)}</text>'
            )

    stamp_y = height - 240
    parts.append(
        f'<rect x="140" y="{stamp_y}" width="{width - 280}" height="110" rx="22" fill="{pal.surface}" stroke="{pal.accent}" stroke-width="2"/>'
        f'<text x="{cx}" y="{stamp_y + 46}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" letter-spacing="2.5" fill="{pal.accent}">FESTIVAL PASS · {_esc(report.rhythm.chronotype_label.upper())}</text>'
        f'<text x="{cx}" y="{stamp_y + 84}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="800" fill="{pal.text}">{report.totals.unique_artists} ARTISTS · {report.totals.active_days} TAGE LIVE</text>'
    )
    return "".join(parts)


def _render_obsession_body(report: WrappedReport, width: int, height: int, pal: _SvgPalette, *, show_counts: bool) -> str:
    obs = report.obsession
    assert obs is not None
    is_story = height > width
    disc_cx = 680
    disc_cy = 440 if is_story else 390
    disc_r = 210 if is_story else 175
    jacket_x = 140
    jacket_y = disc_cy - disc_r
    jacket_s = disc_r * 2

    parts = [
        f'<circle cx="{disc_cx}" cy="{disc_cy}" r="{disc_r}" fill="#111116" stroke="{pal.border}" stroke-width="4"/>',
        f'<circle cx="{disc_cx}" cy="{disc_cy}" r="{int(disc_r * 0.82)}" fill="none" stroke="#2D2D38" stroke-width="2"/>',
        f'<circle cx="{disc_cx}" cy="{disc_cy}" r="{int(disc_r * 0.65)}" fill="none" stroke="#2D2D38" stroke-width="2"/>',
        f'<circle cx="{disc_cx}" cy="{disc_cy}" r="{int(disc_r * 0.48)}" fill="none" stroke="#2D2D38" stroke-width="2"/>',
        f'<circle cx="{disc_cx}" cy="{disc_cy}" r="{int(disc_r * 0.30)}" fill="{pal.accent}"/>',
        f'<circle cx="{disc_cx}" cy="{disc_cy}" r="14" fill="{pal.bg}"/>',
        f'<rect x="{jacket_x}" y="{jacket_y}" width="{jacket_s}" height="{jacket_s}" rx="28" fill="{pal.surface}" stroke="{pal.accent}" stroke-width="3"/>',
        f'<text x="{jacket_x + 34}" y="{jacket_y + 58}" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="800" letter-spacing="2.5" fill="{pal.accent}">#1 OHRWURM</text>',
        f'<text x="{jacket_x + 34}" y="{jacket_y + jacket_s // 2}" font-family="system-ui, -apple-system, sans-serif" font-size="112" font-weight="900" fill="{pal.text}">{obs.play_count}×</text>',
        f'<text x="{jacket_x + 34}" y="{jacket_y + jacket_s - 48}" font-family="ui-monospace, Menlo, monospace" font-size="20" font-weight="700" fill="{pal.muted}">{obs.share_pct}% DEINER PLAYS</text>',
    ]

    info_y = jacket_y + jacket_s + 86
    parts.append(
        f'<text x="72" y="{info_y}" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="900" fill="{pal.text}">{_esc(_trunc(obs.title, 26))}</text>'
        f'<text x="72" y="{info_y + 52}" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="700" fill="{pal.accent2}">{_esc(_trunc(obs.artist or "Unbekannter Artist", 34))}</text>'
    )
    if obs.album:
        parts.append(
            f'<text x="72" y="{info_y + 92}" font-family="ui-monospace, Menlo, monospace" font-size="20" fill="{pal.muted}">ALBUM · {_esc(_trunc(obs.album, 38))}</text>'
        )

    binge_y = info_y + 136
    binge_txt = (
        f"Binge-Rekord: {obs.peak_day_plays}× am {obs.peak_day_date}"
        if obs.peak_day_date and show_counts
        else f"Dauerschleife: {obs.share_pct}% Anteil"
    )
    parts.append(
        f'<rect x="72" y="{binge_y}" width="{width - 144}" height="82" rx="20" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
        f'<text x="104" y="{binge_y + 50}" font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="700" fill="{pal.accent}">{_esc(binge_txt)}</text>'
    )

    if is_story and len(report.top_tracks) > 1:
        podium_y = binge_y + 146
        parts.append(
            f'<text x="72" y="{podium_y}" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="2.5" fill="{pal.muted}">AUF DEN FERSEN</text>'
        )
        for idx, runner in enumerate(report.top_tracks[1:4]):
            ry = podium_y + 32 + idx * 108
            parts.append(
                f'<rect x="72" y="{ry}" width="{width - 144}" height="88" rx="18" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
                f'<text x="102" y="{ry + 52}" font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="800" fill="{pal.accent2}">#{runner.rank:02d}</text>'
                f'<text x="172" y="{ry + 44}" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="800" fill="{pal.text}">{_esc(_trunc(runner.label, 30))}</text>'
                f'<text x="172" y="{ry + 72}" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="{pal.muted}">{_esc(_trunc(runner.sublabel, 34))}</text>'
                f'<text x="{width - 102}" y="{ry + 52}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="800" fill="{pal.text}">{runner.count}×</text>'
            )
    return "".join(parts)


def _render_aura_body(report: WrappedReport, width: int, height: int, pal: _SvgPalette, *, show_counts: bool) -> str:
    aura = report.aura
    assert aura is not None
    is_story = height > width
    cx = width // 2
    cy = 520 if is_story else 420
    c1, c2, c3 = aura.colors

    parts = [
        f'<circle cx="{cx - 110}" cy="{cy - 40}" r="220" fill="{c1}" opacity="0.55"/>',
        f'<circle cx="{cx + 120}" cy="{cy - 20}" r="200" fill="{c2}" opacity="0.45"/>',
        f'<circle cx="{cx}" cy="{cy + 90}" r="210" fill="{c3}" opacity="0.35"/>',
        f'<circle cx="{cx}" cy="{cy}" r="188" fill="{pal.bg}" fill-opacity="0.72" stroke="{pal.border}" stroke-width="2"/>',
    ]

    max_h = max(1, *report.rhythm.hourly_distribution)
    for hour, count in enumerate(report.rhythm.hourly_distribution):
        angle = math.radians(hour * 15 - 90)
        inner_r = 92
        bar_len = 16 + (count / max_h) * 84
        x1 = cx + math.cos(angle) * inner_r
        y1 = cy + math.sin(angle) * inner_r
        x2 = cx + math.cos(angle) * (inner_r + bar_len)
        y2 = cy + math.sin(angle) * (inner_r + bar_len)
        stroke = c3 if hour == report.rhythm.peak_hour else c2
        width_px = 10 if hour == report.rhythm.peak_hour else 6
        opacity = 1.0 if count > 0 else 0.2
        parts.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{width_px}" stroke-linecap="round" opacity="{opacity:.2f}"/>'
        )

    parts.append(
        f'<text x="{cx}" y="{cy - 8}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="2" fill="{pal.muted}">PEAK</text>'
        f'<text x="{cx}" y="{cy + 34}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="900" fill="{pal.text}">{report.rhythm.peak_hour:02d}:00</text>'
    )

    title_y = cy + 265
    parts.append(
        f'<text x="{cx}" y="{title_y - 44}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" letter-spacing="3" fill="{pal.accent}">DEINE KLANG-AURA</text>'
        f'<text x="{cx}" y="{title_y + 12}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="900" fill="{pal.text}">{_esc(_trunc(aura.title, 26))}</text>'
    )
    desc_lines = _wrap_lines(aura.description, 46, 3)
    for idx, line in enumerate(desc_lines):
        parts.append(
            f'<text x="{cx}" y="{title_y + 62 + idx * 36}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="{pal.muted}">{_esc(line)}</text>'
        )

    tags_y = title_y + 68 + len(desc_lines) * 36 + 24
    tag_w = (width - 144 - 36) // 3
    for idx, tag in enumerate(aura.mood_tags[:3]):
        tx = 72 + idx * (tag_w + 18)
        swatch = aura.colors[idx]
        parts.append(
            f'<rect x="{tx}" y="{tags_y}" width="{tag_w}" height="68" rx="18" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
            f'<circle cx="{tx + 28}" cy="{tags_y + 34}" r="10" fill="{swatch}"/>'
            f'<text x="{tx + 52}" y="{tags_y + 41}" font-family="ui-monospace, Menlo, monospace" font-size="20" font-weight="700" fill="{pal.text}">{_esc(_trunc(tag, 16))}</text>'
        )

    if is_story:
        badge_y = tags_y + 120
        tempo_txt = (
            f"{report.tempo.avg_bpm} BPM · {report.tempo.vibe_label}"
            if report.tempo is not None
            else f"{report.rhythm.chronotype_label} · {report.rhythm.weekend_share_pct}% Weekend"
        )
        parts.append(
            f'<rect x="72" y="{badge_y}" width="{width - 144}" height="104" rx="22" fill="{pal.surface}" stroke="{pal.accent2}" stroke-width="2"/>'
            f'<text x="108" y="{badge_y + 42}" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="2" fill="{pal.muted}">TEMPO &amp; CHRONOTYP</text>'
            f'<text x="108" y="{badge_y + 80}" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800" fill="{pal.text}">{_esc(report.rhythm.chronotype_label)} · {_esc(tempo_txt if show_counts else report.rhythm.chronotype_label)}</text>'
        )
    return "".join(parts)


def _render_peak_body(report: WrappedReport, width: int, height: int, pal: _SvgPalette, *, show_counts: bool) -> str:
    peak = report.peak_day
    assert peak is not None
    is_story = height > width
    parts: list[str] = []

    card_y = 200
    card_h = 270 if is_story else 230
    parts.extend([
        f'<rect x="72" y="{card_y}" width="{width - 144}" height="{card_h}" rx="28" fill="{pal.surface}" stroke="{pal.accent}" stroke-width="3"/>',
        f'<text x="112" y="{card_y + 52}" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="800" letter-spacing="3" fill="{pal.accent}">DEIN REKORD-TAG · {_esc(_WEEKDAY_FULL[peak.weekday].upper())}</text>',
        f'<text x="112" y="{card_y + 124}" font-family="system-ui, -apple-system, sans-serif" font-size="68" font-weight="900" fill="{pal.text}">{_esc(peak.date)}</text>',
    ])
    peak_val, peak_unit = _fmt_hours(peak.listening_sec)
    parts.append(
        f'<text x="112" y="{card_y + 184}" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="800" fill="{pal.accent2}">{_esc(peak_val)} {peak_unit} · {peak.play_count} PLAYS</text>'
        f'<text x="112" y="{card_y + 226}" font-family="ui-monospace, Menlo, monospace" font-size="20" fill="{pal.muted}">TAGES-FAVORIT: {_esc(_trunc(peak.top_track_title, 34))}</text>'
    )

    streak_y = card_y + card_h + 36
    box_w = (width - 144 - 36) // 3
    streak_cards = [
        ("REKORD-SERIE", f"{report.totals.longest_streak_days} Tage", pal.accent),
        ("AKTUELL", f"{report.totals.current_streak_days} Tage", pal.accent2),
        (
            "AKTIVE TAGE",
            f"{report.totals.active_days}/{max(1, report.totals.total_days)}"
            if show_counts
            else f"{report.totals.active_days} Tage",
            pal.text,
        ),
    ]
    for idx, (lbl, val, col) in enumerate(streak_cards):
        bx = 72 + idx * (box_w + 18)
        parts.append(
            f'<rect x="{bx}" y="{streak_y}" width="{box_w}" height="170" rx="22" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
            f'<text x="{bx + 26}" y="{streak_y + 48}" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="2" fill="{pal.muted}">{lbl}</text>'
            f'<text x="{bx + 26}" y="{streak_y + 122}" font-family="system-ui, -apple-system, sans-serif" font-size="48" font-weight="900" fill="{col}">{_esc(val)}</text>'
        )

    bar_y = streak_y + 240
    parts.append(
        f'<text x="72" y="{bar_y}" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" letter-spacing="2.5" fill="{pal.muted}">WOCHEN-EQUALIZER</text>'
    )
    max_w = max(1, *report.rhythm.weekday_distribution)
    col_step = (width - 144 - 6 * 18) // 7
    chart_h = 380 if is_story else 190
    for d_idx, count in enumerate(report.rhythm.weekday_distribution):
        bx = 72 + d_idx * (col_step + 18)
        bh = 28 + int((count / max_w) * (chart_h - 60))
        by = bar_y + 30 + (chart_h - 40 - bh)
        is_peak_day = d_idx == report.rhythm.peak_weekday
        parts.append(
            f'<rect x="{bx}" y="{bar_y + 30}" width="{col_step}" height="{chart_h - 40}" rx="16" fill="{pal.bg2}" stroke="{pal.border}" stroke-width="1.5"/>'
            f'<rect x="{bx}" y="{by}" width="{col_step}" height="{bh}" rx="16" fill="{pal.accent if is_peak_day else pal.accent2}" opacity="{1.0 if is_peak_day else 0.65}"/>'
            f'<text x="{bx + col_step // 2}" y="{bar_y + chart_h + 24}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="20" font-weight="800" fill="{pal.accent if is_peak_day else pal.muted}">{_WEEKDAY_SHORT[d_idx]}</text>'
        )

    if is_story and report.equivalents:
        eq_y = bar_y + chart_h + 90
        eq_w = (width - 144 - 36) // 3
        for idx, eq in enumerate(report.equivalents[:3]):
            ex = 72 + idx * (eq_w + 18)
            parts.append(
                f'<rect x="{ex}" y="{eq_y}" width="{eq_w}" height="150" rx="22" fill="{pal.surface}" stroke="{pal.border}" stroke-width="2"/>'
                f'<text x="{ex + 24}" y="{eq_y + 68}" font-family="system-ui, -apple-system, sans-serif" font-size="44" font-weight="900" fill="{pal.accent}">{_esc(eq.value)}</text>'
                f'<text x="{ex + 24}" y="{eq_y + 110}" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="{pal.text}">{_esc(_trunc(eq.label, 22))}</text>'
            )
    return "".join(parts)


_TEMPLATE_KICKERS: dict[WrappedCardTemplate, str] = {
    "summary": "RÜCKBLICK",
    "persona": "PERSONA",
    "receipt": "SOUND-BELEG",
    "festival": "FESTIVAL",
    "obsession": "OHRWURM",
    "aura": "KLANG-AURA",
    "peak": "REKORD-TAG",
}


def _svg_palette_for_theme(report: WrappedReport, theme: WrappedCardTheme) -> _SvgPalette:
    if theme == "cover":
        if report.aura is not None:
            c1, c2, c3 = report.aura.colors
            return _SvgPalette(
                bg=c1,
                bg2="#101016",
                surface="#1B1A24",
                text="#F4F0E6",
                muted="#B8B2A8",
                accent=c3,
                accent2=c2,
                border="#323040",
            )
        return _SVG_THEMES["signal"]
    if theme not in _SVG_THEMES:
        raise ValueError(f"Unsupported SVG theme: {theme!r}")
    return _SVG_THEMES[theme]


def render_wrapped_card_svg(
    report: WrappedReport,
    template: WrappedCardTemplate,
    theme: WrappedCardTheme,
    fmt: WrappedCardFormat,
    *,
    show_user: bool = True,
    show_counts: bool = True,
) -> str:
    """Render a crisp 1080x1920 or 1080x1080 SVG share card from ``report``."""
    if report.totals.play_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Noch keine Wiedergaben in diesem Zeitraum",
        )
    if template not in _TEMPLATE_KICKERS:
        raise ValueError(f"Unsupported SVG template: {template!r}")
    if fmt not in ("story", "square"):
        raise ValueError(f"Unsupported SVG format: {fmt!r}")

    pal = _svg_palette_for_theme(report, theme)
    width = 1080
    height = 1920 if fmt == "story" else 1080

    if template == "summary":
        body = _render_summary_body(report, width, height, pal, show_counts=show_counts)
    elif template == "persona":
        body = _render_persona_body(report, width, height, pal, show_counts=show_counts)
    elif template == "receipt":
        body = _render_receipt_body(report, width, height, pal, show_counts=show_counts)
    elif template == "festival":
        body = _render_festival_body(report, width, height, pal, show_counts=show_counts)
    elif template == "obsession":
        body = _render_obsession_body(report, width, height, pal, show_counts=show_counts)
    elif template == "aura":
        body = _render_aura_body(report, width, height, pal, show_counts=show_counts)
    else:
        body = _render_peak_body(report, width, height, pal, show_counts=show_counts)

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" fill="none">'
        "<defs>"
        f'<linearGradient id="wrBg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="{pal.bg}"/>'
        f'<stop offset="100%" stop-color="{pal.bg2}"/>'
        "</linearGradient>"
        "</defs>"
        f'<rect width="{width}" height="{height}" fill="url(#wrBg)"/>'
        f'<circle cx="{width - 120}" cy="120" r="340" fill="{pal.accent}" opacity="0.06"/>'
        f'<circle cx="140" cy="{height - 180}" r="300" fill="{pal.accent2}" opacity="0.05"/>'
        + _svg_header(
            report,
            width,
            pal,
            show_user=show_user,
            kicker=_TEMPLATE_KICKERS[template],
        )
        + body
        + _svg_footer(report, width, height, pal, show_counts=show_counts)
        + "</svg>"
    )
