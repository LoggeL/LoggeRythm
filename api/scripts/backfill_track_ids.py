"""Backfill ``album_id`` and artist IDs on stored playlist/liked tracks.

Older rows (e.g. imported playlists) were saved with empty ``album_id`` and
artist IDs, so their titles/artists can't link anywhere in the UI. This resolves
each track by its (real) Deezer ID via the **public** API — no ARL needed — and
fills in ``album_id`` + the full ``artists`` credit list.

No silent fallbacks: every track that fails to resolve is reported loudly at the
end and the script exits non-zero.

Run from ``api/``:  ./.venv/Scripts/python.exe -m scripts.backfill_track_ids
"""
from __future__ import annotations

import json
import sys

from app.db.models import Like, PlaylistTrack
from app.db.session import SessionLocal, init_db
from app.schemas.track import load_artists
from app.services import deezer_client as dc


def _needs_backfill(album_id: str, artists_json: str) -> bool:
    if not album_id:
        return True
    refs = load_artists(artists_json)
    return not refs or not any(r.id for r in refs)


def main() -> None:
    init_db()  # ensures the new album_id columns exist
    db = SessionLocal()
    cache: dict[str, dict] = {}
    failures: list[tuple[str, int, str, str, str]] = []
    updated = 0
    try:
        rows: list = list(db.query(PlaylistTrack).all()) + list(db.query(Like).all())
        todo = [r for r in rows if _needs_backfill(r.album_id, r.artists_json)]
        print(f"{len(rows)} stored tracks, {len(todo)} need backfill")
        for i, row in enumerate(todo, 1):
            did = str(row.deezer_id or "")
            if not did.isdigit():
                failures.append(
                    (type(row).__name__, row.id, did, row.title, "non-numeric deezer_id")
                )
                continue
            try:
                meta = cache.get(did) or dc.track_public(did)
                cache[did] = meta
            except Exception as e:  # noqa: BLE001 — recorded and reported loudly below
                failures.append((type(row).__name__, row.id, did, row.title, str(e)))
                continue
            row.album_id = str(meta.get("album_id") or "")
            if meta.get("artist"):
                row.artist = meta["artist"]
            row.artists_json = json.dumps(meta.get("artists") or [], ensure_ascii=False)
            updated += 1
            if i % 25 == 0:
                print(f"  …{i}/{len(todo)}")
        db.commit()
    finally:
        db.close()

    print(f"\nDONE: updated {updated} rows")
    if failures:
        print(f"\n{len(failures)} FAILED to resolve (NOT silently skipped):")
        for kind, rid, did, title, err in failures:
            print(f"  {kind}#{rid} id={did!r} {title!r}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
