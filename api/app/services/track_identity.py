"""Canonical track recording identity, release preference, and deduplication.

Music catalogs expose the exact same studio recording under separate track IDs
across Singles, EPs, Albums, Deluxe Editions, and Compilations. This module
defines one deterministic identity rule shared across Likes, Search, and
Discovery:

1. Primary key: normalized ISRC (same studio recording -> same ISRC, while
   Live / Acoustic / Instrumental / Remix / alternate versions carry distinct
   ISRCs and remain separate).
2. Fallback (only when ISRC is missing on at least one side): folded primary
   artist + folded title + duration within ``DURATION_TOLERANCE_SEC``. When one
   side has an ISRC and the other does not, both durations must be positive and
   within tolerance so unknown durations never cause false merges.
3. Release winner preference: ``album`` > ``ep`` > ``single`` > ``compile`` >
   unknown, breaking ties by highest Deezer popularity ``rank``, then earlier
   input position.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, TypeVar

T = TypeVar("T")

DURATION_TOLERANCE_SEC = 3

RECORD_TYPE_PRIORITY: dict[str, int] = {
    "album": 4,
    "ep": 3,
    "single": 2,
    "compile": 1,
}

_ISRC_NON_ALNUM_RE = re.compile(r"[^A-Za-z0-9]+")
_APOSTROPHES_RE = re.compile(r"['’‘`´]+")
_NON_WORD_RE = re.compile(r"[^\w]+", re.UNICODE)
_PLAIN_LETTERS: dict[str, str] = {
    "ß": "ss",
    "æ": "ae",
    "œ": "oe",
    "ø": "o",
    "đ": "d",
    "ð": "d",
    "ł": "l",
    "þ": "th",
    "ı": "i",
}


def normalize_isrc(raw: object) -> str:
    """Return an uppercase alphanumeric ISRC, or ``""`` when absent/placeholder."""
    if not isinstance(raw, str):
        return ""
    cleaned = _ISRC_NON_ALNUM_RE.sub("", raw).upper()
    if len(cleaned) < 4 or set(cleaned) == {"0"}:
        return ""
    return cleaned


def fold_text(value: object) -> str:
    """Case-, diacritic-, and punctuation-insensitive text comparison form."""
    if not isinstance(value, str) or not value.strip():
        return ""
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    lowered = stripped.lower()
    mapped = "".join(_PLAIN_LETTERS.get(ch, ch) for ch in lowered)
    no_apostrophes = _APOSTROPHES_RE.sub("", mapped)
    # Treat underscores as word separators too (matching JS `[^\p{L}\p{N}]+`).
    spaced = _NON_WORD_RE.sub(" ", no_apostrophes).replace("_", " ")
    return " ".join(spaced.split())


def fallback_signature(title: object, artist: object) -> tuple[str, str] | None:
    """Normalized ``(artist, title)`` fallback key when ISRC is absent."""
    folded_artist = fold_text(artist)
    folded_title = fold_text(title)
    if not folded_artist or not folded_title:
        return None
    return (folded_artist, folded_title)


def release_priority(record_type: str | None) -> int:
    """Higher score means more preferred release type (album > ep > single > compile)."""
    return RECORD_TYPE_PRIORITY.get((record_type or "").strip().lower(), 0)


@dataclass(frozen=True)
class TrackDescriptor:
    """Minimal recording identity fields extracted from a track dict or ORM row."""

    deezer_id: str
    isrc: str
    title: str
    artist: str
    duration_sec: int
    album_id: str = ""
    rank: int = 0


def descriptor_from_mapping(item: Mapping[str, Any]) -> TrackDescriptor:
    raw_id = item.get("id")
    if raw_id in (None, ""):
        raw_id = item.get("deezer_id")
    album_id = item.get("album_id")
    if album_id in (None, "") and isinstance(item.get("album"), Mapping):
        album_id = item["album"].get("id")
    artist = item.get("artist")
    if isinstance(artist, Mapping):
        artist = artist.get("name", "")
    try:
        duration_sec = int(item.get("duration_sec") or item.get("duration") or 0)
    except (TypeError, ValueError):
        duration_sec = 0
    try:
        rank = int(item.get("rank") or 0)
    except (TypeError, ValueError):
        rank = 0
    return TrackDescriptor(
        deezer_id=str(raw_id or "").strip(),
        isrc=normalize_isrc(item.get("isrc")),
        title=str(item.get("title") or ""),
        artist=str(artist or ""),
        duration_sec=max(duration_sec, 0),
        album_id=str(album_id or "").strip(),
        rank=max(rank, 0),
    )


def same_recording(a: TrackDescriptor, b: TrackDescriptor) -> bool:
    """Whether two tracks represent the same studio recording."""
    if a.deezer_id and b.deezer_id and a.deezer_id == b.deezer_id:
        return True
    if a.isrc and b.isrc:
        return a.isrc == b.isrc

    sig_a = fallback_signature(a.title, a.artist)
    sig_b = fallback_signature(b.title, b.artist)
    if sig_a is None or sig_a != sig_b:
        return False

    if a.isrc or b.isrc:
        # One side carries an ISRC and the other does not (e.g. legacy DB row
        # before backfill): require positive durations within tolerance.
        return (
            a.duration_sec > 0
            and b.duration_sec > 0
            and abs(a.duration_sec - b.duration_sec) <= DURATION_TOLERANCE_SEC
        )

    if a.duration_sec > 0 and b.duration_sec > 0:
        return abs(a.duration_sec - b.duration_sec) <= DURATION_TOLERANCE_SEC
    return True


@dataclass
class DuplicateGroup:
    """Tracks representing one recording, in original input order."""

    items: list[tuple[int, Any, TrackDescriptor]]
    isrc: str = ""
    fallback_sig: tuple[str, str] | None = None

    def matches(self, desc: TrackDescriptor) -> bool:
        if desc.deezer_id and any(
            existing.deezer_id == desc.deezer_id for _, _, existing in self.items
        ):
            return True
        if self.isrc and desc.isrc:
            return self.isrc == desc.isrc
        # Never bridge two distinct ISRCs through an ISRC-less track.
        if self.isrc and not desc.isrc:
            return any(same_recording(existing, desc) for _, _, existing in self.items)
        if not self.isrc and desc.isrc:
            return any(same_recording(existing, desc) for _, _, existing in self.items)
        return any(same_recording(existing, desc) for _, _, existing in self.items)

    def add(self, index: int, item: Any, desc: TrackDescriptor) -> None:
        self.items.append((index, item, desc))
        if not self.isrc and desc.isrc:
            self.isrc = desc.isrc
        if self.fallback_sig is None:
            self.fallback_sig = fallback_signature(desc.title, desc.artist)


def group_duplicates(
    items: Sequence[T],
    describe: Callable[[T], TrackDescriptor],
) -> list[DuplicateGroup]:
    """Partition ``items`` into duplicate recording groups, preserving first-seen order."""
    groups: list[DuplicateGroup] = []
    by_id: dict[str, DuplicateGroup] = {}
    by_isrc: dict[str, DuplicateGroup] = {}
    by_fallback: dict[tuple[str, str], list[DuplicateGroup]] = {}

    for index, item in enumerate(items):
        desc = describe(item)
        sig = fallback_signature(desc.title, desc.artist)
        target: DuplicateGroup | None = None

        if desc.deezer_id and desc.deezer_id in by_id:
            target = by_id[desc.deezer_id]
        elif desc.isrc and desc.isrc in by_isrc:
            target = by_isrc[desc.isrc]
        elif sig is not None and sig in by_fallback:
            for candidate in by_fallback[sig]:
                if candidate.matches(desc):
                    target = candidate
                    break

        if target is None:
            target = DuplicateGroup(items=[], isrc=desc.isrc, fallback_sig=sig)
            groups.append(target)

        target.add(index, item, desc)
        if desc.deezer_id:
            by_id.setdefault(desc.deezer_id, target)
        if target.isrc:
            by_isrc.setdefault(target.isrc, target)
        if sig is not None:
            bucket = by_fallback.setdefault(sig, [])
            if target not in bucket:
                bucket.append(target)

    return groups


def resolve_record_types_for_groups(
    groups: Sequence[DuplicateGroup],
    resolve_record_type: Callable[[str], str] | None,
) -> dict[str, str]:
    """Fetch album ``record_type`` values ONLY for albums competing across releases."""
    if resolve_record_type is None:
        return {}
    album_ids: list[str] = []
    seen: set[str] = set()
    for group in groups:
        if len(group.items) < 2:
            continue
        distinct_ids = {desc.deezer_id for _, _, desc in group.items if desc.deezer_id}
        distinct_albums = {desc.album_id for _, _, desc in group.items if desc.album_id}
        # Exact same track or tracks from the exact same album never need
        # cross-release record_type tie-breaking.
        if len(distinct_ids) <= 1 or len(distinct_albums) <= 1:
            continue
        for _, _, desc in group.items:
            aid = desc.album_id
            if aid and aid.isdigit() and aid not in seen:
                seen.add(aid)
                album_ids.append(aid)
    if not album_ids:
        return {}
    if len(album_ids) == 1:
        return {album_ids[0]: resolve_record_type(album_ids[0])}
    workers = min(4, len(album_ids))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(resolve_record_type, album_ids))
    return dict(zip(album_ids, results, strict=True))


def pick_preferred_entry(
    group: DuplicateGroup,
    record_types: Mapping[str, str],
) -> tuple[int, Any, TrackDescriptor]:
    """Choose the winning release in a duplicate group: album > ep > single > rank."""
    return max(
        group.items,
        key=lambda entry: (
            release_priority(record_types.get(entry[2].album_id)),
            entry[2].rank,
            -entry[0],
        ),
    )


def dedupe_tracks(
    tracks: Sequence[dict[str, Any]],
    *,
    resolve_record_type: Callable[[str], str] | None = None,
    preserve_fields: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    """Deduplicate tracks by recording identity, keeping first-seen slot order.

    For duplicate groups of size >= 2, chooses the best release (Album > EP >
    Single, tiebreak by highest Deezer ``rank``) and places it in the slot of
    the first occurrence so search relevance / recency order is preserved.

    ``preserve_fields`` lists keys (e.g. ``("radar_reason",)``) that should be
    kept from the first occurrence when a later duplicate wins.
    """
    if len(tracks) <= 1:
        return list(tracks)

    groups = group_duplicates(tracks, descriptor_from_mapping)
    record_types = resolve_record_types_for_groups(groups, resolve_record_type)

    out: list[dict[str, Any]] = []
    for group in groups:
        if len(group.items) == 1:
            out.append(group.items[0][1])
            continue
        first_item = group.items[0][1]
        _, winner, winner_desc = pick_preferred_entry(group, record_types)
        merged = dict(winner)
        if not winner_desc.isrc and group.isrc:
            merged["isrc"] = group.isrc
        for field_name in preserve_fields:
            if field_name in first_item:
                merged[field_name] = first_item[field_name]
        out.append(merged)
    return out
