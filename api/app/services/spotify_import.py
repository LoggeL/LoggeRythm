"""Match the tracks of a Spotify link against Deezer.

Shared by the synchronous ``GET /api/resolve`` endpoint and the background
import jobs (``services/import_jobs``). Matching keeps the source order, drops
duplicates and reports progress so a long job can show how far it got.
"""
from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field

from . import deezer_client as dc
from . import spotify

# Modest concurrency + backoff (in deezer_client._public_get) keeps big imports
# under Deezer's public rate limit.
MATCH_WORKERS = 6


class ImportCancelled(Exception):
    """The caller asked to stop matching (the import job was deleted)."""


@dataclass
class LookupFailures:
    """Tracks whose Deezer lookup raised instead of answering hit/no-hit."""

    count: int = 0
    first_error: str | None = None

    def record(self, sp: dict, exc: BaseException) -> None:
        self.count += 1
        if self.first_error is None:
            self.first_error = (
                f"{sp.get('artist', '')} – {sp.get('title', '')}: "
                f"{type(exc).__name__}: {exc}"
            )


@dataclass
class ResolvedImport:
    type: str
    name: str
    image: str
    total: int
    source_total: int
    tracks: list[dict]
    unmatched: list[dict]
    lookup_failures: LookupFailures = field(default_factory=LookupFailures)

    def as_result(self) -> dict:
        """The ``ResolveResult`` payload."""
        return {
            "type": self.type,
            "name": self.name,
            "image": self.image,
            "total": self.total,
            "source_total": self.source_total,
            "matched": len(self.tracks),
            "tracks": self.tracks,
            "unmatched": self.unmatched,
        }


def dedupe(sp_tracks: list[dict]) -> list[dict]:
    """Drop duplicate tracks (long playlists repeat songs) — key by ISRC else artist|title."""
    seen: set[str] = set()
    out: list[dict] = []
    for sp in sp_tracks:
        key = (sp.get("isrc") or f"{sp.get('artist', '')}|{sp.get('title', '')}").lower()
        if key and key not in seen:
            seen.add(key)
            out.append(sp)
    return out


@dataclass(frozen=True)
class SourceInfo:
    """Spotify metadata, known before matching starts."""

    type: str
    name: str
    image: str
    total: int
    source_total: int


def resolve_link(
    url: str,
    *,
    limit: int,
    on_source: Callable[[SourceInfo], None] | None = None,
    on_progress: Callable[[int, int], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> ResolvedImport:
    """Read ``url`` from Spotify and match every track on Deezer.

    ``on_source`` runs once the Spotify metadata is known, ``on_progress``
    after each matched-or-not track with ``(processed, matched)``. When
    ``should_cancel`` answers True, pending lookups are dropped and
    ``ImportCancelled`` is raised.
    """
    meta = spotify.resolve(url, limit)
    raw = meta.get("tracks") or []
    sp_tracks = dedupe(raw)
    source = SourceInfo(
        type=meta.get("type", ""),
        name=meta.get("name", ""),
        image=meta.get("image", ""),
        total=len(sp_tracks),
        source_total=int(meta.get("total", len(raw)) or len(raw)),
    )
    if on_source is not None:
        on_source(source)

    failures = LookupFailures()

    def _match(sp: dict) -> tuple[dict, dict | None, BaseException | None]:
        try:
            return sp, dc.match_track(
                sp.get("title", ""), sp.get("artist", ""), sp.get("isrc", "")
            ), None
        except Exception as exc:  # noqa: BLE001 — counted and reported below
            return sp, None, exc

    matched: list[dict] = []
    unmatched: list[dict] = []
    seen_deezer: set[str] = set()
    if sp_tracks:
        pool = ThreadPoolExecutor(max_workers=MATCH_WORKERS)
        try:
            futures: list[Future] = [pool.submit(_match, sp) for sp in sp_tracks]
            # Walk the futures in source order so the result keeps playlist order.
            for processed, future in enumerate(futures, start=1):
                if should_cancel is not None and should_cancel():
                    raise ImportCancelled(url)
                sp, deezer, exc = future.result()
                if exc is not None:
                    failures.record(sp, exc)
                if deezer and deezer["id"] not in seen_deezer:
                    seen_deezer.add(deezer["id"])
                    matched.append(deezer)
                elif not deezer:
                    unmatched.append(
                        {"title": sp.get("title", ""), "artist": sp.get("artist", "")}
                    )
                if on_progress is not None:
                    on_progress(processed, len(matched))
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    if failures.count:
        print(
            f"Spotify import {url}: {failures.count} of {len(sp_tracks)} Deezer "
            f"lookups FAILED and are listed as unmatched. First: {failures.first_error}",
            flush=True,
        )

    return ResolvedImport(
        type=source.type,
        name=source.name,
        image=source.image,
        total=source.total,
        source_total=source.source_total,
        tracks=matched,
        unmatched=unmatched,
        lookup_failures=failures,
    )
