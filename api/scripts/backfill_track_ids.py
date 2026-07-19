"""Refresh stored track metadata, including complete performer credits.

Older rows (e.g. imported playlists) were saved with empty ``album_id`` and
artist IDs. Rows written before complete credit enrichment can also contain a
valid-looking single primary artist even when a track has several performers.
Because that incomplete state cannot be distinguished locally from a real
single-artist track, this script deliberately refreshes every stored row from
the authoritative public track endpoint.

No silent fallbacks: every track that fails to resolve is reported loudly at the
end and the script exits non-zero.

Run from ``api/``:  ./.venv/Scripts/python.exe -m scripts.backfill_track_ids
"""
from __future__ import annotations

import json
import sys

from app.db.models import Like, PartyTrack, Play, PlaylistTrack
from app.db.session import SessionLocal, init_db
from app.services import deezer_client as dc


def main() -> None:
    init_db()  # ensures the new album_id columns exist
    db = SessionLocal()
    cache: dict[str, dict] = {}
    failures: list[tuple[str, int, str, str, str]] = []
    updated = 0
    try:
        rows: list = (
            list(db.query(PlaylistTrack).all())
            + list(db.query(Like).all())
            + list(db.query(Play).all())
            + list(db.query(PartyTrack).all())
        )
        print(f"Refreshing complete metadata for {len(rows)} stored track rows")
        todo = rows
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
