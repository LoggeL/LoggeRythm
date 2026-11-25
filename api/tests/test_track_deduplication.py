"""Tests for cross-release song deduplication across Likes, Search, and Discovery."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.db.models import Like, Playlist, PlaylistTrack, User
from app.db.session import Base, get_db
from app.main import _run_column_migrations
from app.routers import admin, home, likes, radio
from app.schemas.track import Track
from app.services import deezer_client as dc
from app.services import likes_dedup
from app.services.track_identity import (
    dedupe_tracks,
    descriptor_from_mapping,
    normalize_isrc,
    same_recording,
)


def _track_dict(
    tid: str,
    *,
    title: str = "The Emptiness Machine",
    artist: str = "Linkin Park",
    artist_id: str = "92",
    album: str = "From Zero",
    album_id: str = "100",
    duration_sec: int = 190,
    rank: int = 500000,
    isrc: str = "USWB12403464",
    release_date: str = "",
) -> dict:
    return {
        "id": tid,
        "title": title,
        "artist": artist,
        "artist_id": artist_id,
        "artists": [{"id": artist_id, "name": artist}],
        "album": album,
        "album_id": album_id,
        "cover": f"https://example.test/{album_id}.jpg",
        "duration_sec": duration_sec,
        "preview_url": None,
        "rank": rank,
        "release_date": release_date,
        "isrc": isrc,
    }


class TrackIdentityTests(unittest.TestCase):
    def test_normalize_isrc_cleans_formatting_and_rejects_placeholders(self) -> None:
        self.assertEqual(normalize_isrc("us-wb1-24-03464"), "USWB12403464")
        self.assertEqual(normalize_isrc("  gbdhc2017801 "), "GBDHC2017801")
        self.assertEqual(normalize_isrc(""), "")
        self.assertEqual(normalize_isrc(None), "")
        self.assertEqual(normalize_isrc("000000000000"), "")
        self.assertEqual(normalize_isrc("123"), "")

    def test_same_recording_prefers_isrc_and_keeps_distinct_isrcs_separate(self) -> None:
        single = descriptor_from_mapping(
            _track_dict("2978105041", album="The Emptiness Machine", album_id="10", isrc="USWB12403464")
        )
        album = descriptor_from_mapping(
            _track_dict("3068802261", album="From Zero", album_id="20", isrc="us-wb1-24-03464")
        )
        other_recording = descriptor_from_mapping(
            _track_dict("1343748042", album="Hypa Hypa", album_id="30", isrc="GBDHC2017808")
        )
        self.assertTrue(same_recording(single, album))
        self.assertFalse(same_recording(single, other_recording))

    def test_same_recording_fallback_applies_only_when_isrc_is_missing(self) -> None:
        no_isrc_a = descriptor_from_mapping(
            _track_dict("1", title="Über den Wolken", artist="Reinhard Mey", duration_sec=210, isrc="")
        )
        no_isrc_b = descriptor_from_mapping(
            _track_dict("2", title="Uber den Wolken!", artist="reinhard mey", duration_sec=212, isrc="")
        )
        far_duration = descriptor_from_mapping(
            _track_dict("3", title="Über den Wolken", artist="Reinhard Mey", duration_sec=240, isrc="")
        )
        has_isrc_unknown_dur = descriptor_from_mapping(
            _track_dict("4", title="Über den Wolken", artist="Reinhard Mey", duration_sec=0, isrc="DE1234567890")
        )
        self.assertTrue(same_recording(no_isrc_a, no_isrc_b))
        self.assertFalse(same_recording(no_isrc_a, far_duration))
        self.assertFalse(same_recording(no_isrc_a, has_isrc_unknown_dur))

    def test_dedupe_tracks_prefers_album_over_ep_over_single_and_keeps_first_slot(self) -> None:
        single = _track_dict(
            "984138262", title="Hypa Hypa", artist="Electric Callboy",
            album="Hypa Hypa", album_id="153", rank=577760, isrc="GBDHC2017801",
        )
        other = _track_dict(
            "2309509085", title="Everytime We Touch", artist="Electric Callboy",
            album="Everytime We Touch", album_id="448", rank=607306, isrc="GBDHC2227213",
        )
        ep = _track_dict(
            "1059805452", title="Hypa Hypa", artist="Electric Callboy",
            album="MMXX - EP", album_id="168", rank=250888, isrc="GBDHC2017801",
        )
        album = _track_dict(
            "1345077882", title="Hypa Hypa", artist="Electric Callboy",
            album="MMXX - Hypa Hypa Edition", album_id="223", rank=325531, isrc="GBDHC2017801",
        )
        alt_recording = _track_dict(
            "1343748042", title="Hypa Hypa", artist="Electric Callboy",
            album="Hypa Hypa", album_id="222", duration_sec=184, rank=353223, isrc="GBDHC2017808",
        )
        types = {"153": "single", "168": "ep", "223": "album"}
        queried: list[str] = []

        def resolve_type(aid: str) -> str:
            queried.append(aid)
            return types[aid]

        result = dedupe_tracks(
            [single, other, ep, album, alt_recording],
            resolve_record_type=resolve_type,
        )

        self.assertEqual([t["id"] for t in result], ["1345077882", "2309509085", "1343748042"])
        # Non-colliding albums ("448", "222") must never be queried.
        self.assertEqual(set(queried), {"153", "168", "223"})

    def test_dedupe_tracks_breaks_album_ties_by_deezer_rank(self) -> None:
        single = _track_dict("2978105041", album="The Emptiness Machine", album_id="1", rank=947166)
        deluxe = _track_dict("3363599221", album="From Zero (Deluxe)", album_id="3", rank=631416)
        standard = _track_dict("3068802261", album="From Zero", album_id="2", rank=787002)
        types = {"1": "single", "2": "album", "3": "album"}

        result = dedupe_tracks([single, deluxe, standard], resolve_record_type=types.__getitem__)
        self.assertEqual([t["id"] for t in result], ["3068802261"])


class DeezerCatalogDedupeTests(unittest.TestCase):
    def setUp(self) -> None:
        with dc._track_artists_lock:
            dc._track_artists_cache.clear()
        with dc._track_isrc_flights.lock:
            dc._track_isrc_flights.cache.clear()
        with dc._album_record_type_flights.lock:
            dc._album_record_type_flights.cache.clear()
        with dc._search_tracks_flights.lock:
            dc._search_tracks_flights.cache.clear()

    def test_search_tracks_public_deduplicates_single_and_album_keeping_album(self) -> None:
        search_payload = {
            "data": [
                {
                    "id": 2978105041,
                    "title": "The Emptiness Machine",
                    "duration": 190,
                    "rank": 947166,
                    "isrc": "USWB12403464",
                    "artist": {"id": 92, "name": "Linkin Park"},
                    "album": {"id": 1001, "title": "The Emptiness Machine"},
                },
                {
                    "id": 3068802261,
                    "title": "The Emptiness Machine",
                    "duration": 190,
                    "rank": 787002,
                    "isrc": "USWB12403464",
                    "artist": {"id": 92, "name": "Linkin Park"},
                    "album": {"id": 1002, "title": "From Zero"},
                },
            ]
        }

        def fake_get(path: str) -> dict:
            if path.startswith("/search?"):
                return search_payload
            if path == "/track/2978105041":
                return {
                    "id": 2978105041,
                    "isrc": "USWB12403464",
                    "contributors": [{"id": 92, "name": "Linkin Park"}],
                }
            if path == "/track/3068802261":
                return {
                    "id": 3068802261,
                    "isrc": "USWB12403464",
                    "contributors": [{"id": 92, "name": "Linkin Park"}],
                }
            if path == "/album/1001":
                return {"id": 1001, "record_type": "single"}
            if path == "/album/1002":
                return {"id": 1002, "record_type": "album"}
            raise AssertionError(f"Unexpected path {path}")

        with patch.object(dc, "_public_get", side_effect=fake_get):
            tracks = dc.search_tracks_public("Linkin Park Emptiness Machine", limit=10)

        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["id"], "3068802261")
        self.assertEqual(tracks[0]["album"], "From Zero")
        self.assertEqual(tracks[0]["isrc"], "USWB12403464")

    def test_artist_detail_enriches_isrc_even_when_contributors_are_inline(self) -> None:
        def fake_get(path: str) -> dict:
            if path == "/artist/92":
                return {"id": 92, "name": "Linkin Park", "nb_fan": 1000, "nb_album": 10}
            if path == "/artist/92/top?limit=25":
                return {
                    "data": [
                        {
                            "id": 2978105041,
                            "title": "The Emptiness Machine",
                            "duration": 190,
                            "rank": 947166,
                            "artist": {"id": 92, "name": "Linkin Park"},
                            "contributors": [{"id": 92, "name": "Linkin Park"}],
                            "album": {"id": 1001, "title": "The Emptiness Machine"},
                        }
                    ]
                }
            if path == "/track/2978105041":
                return {
                    "id": 2978105041,
                    "isrc": "USWB12403464",
                    "contributors": [{"id": 92, "name": "Linkin Park"}],
                }
            if path.startswith("/artist/92/albums") or path.startswith("/artist/92/related"):
                return {"data": []}
            raise AssertionError(f"Unexpected path {path}")

        with patch.object(dc, "_public_get", side_effect=fake_get):
            detail = dc.artist_detail("92")

        self.assertEqual(len(detail["top"]), 1)
        self.assertEqual(detail["top"][0]["isrc"], "USWB12403464")


class LikesDeduplicationDatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )
        self.db: Session = self.SessionLocal()
        self.user = User(
            email="listener@example.test",
            password_hash="unused",
            display_name="Listener",
            is_admin=True,
            is_approved=True,
        )
        self.other = User(
            email="other@example.test",
            password_hash="unused",
            display_name="Other",
            is_approved=True,
        )
        self.db.add_all([self.user, self.other])
        self.db.commit()

        self.api = FastAPI()
        self.api.include_router(likes.router)
        self.api.include_router(admin.router)
        self.api.dependency_overrides[get_current_user] = lambda: self.user
        self.api.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(self.api)

    def tearDown(self) -> None:
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def test_cannot_double_like_across_single_and_album_and_upgrades_to_album(self) -> None:
        single = _track_dict(
            "2978105041", album="The Emptiness Machine", album_id="1001", rank=947166, isrc="USWB12403464"
        )
        album = _track_dict(
            "3068802261", album="From Zero", album_id="1002", rank=787002, isrc="USWB12403464"
        )
        types = {"1001": "single", "1002": "album"}

        with patch.object(dc, "album_record_type", side_effect=types.__getitem__):
            r1 = self.client.put("/api/me/likes/2978105041", json=single)
            self.assertEqual(r1.status_code, 204)
            r2 = self.client.put("/api/me/likes/3068802261", json=album)
            self.assertEqual(r2.status_code, 204)

        rows = self.db.scalars(select(Like).where(Like.user_id == self.user.id)).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].deezer_id, "3068802261")
        self.assertEqual(rows[0].album, "From Zero")
        self.assertEqual(rows[0].isrc, "USWB12403464")

        # Attempting to like the Single afterwards keeps the Album row and stays 1 row.
        with patch.object(dc, "album_record_type", side_effect=types.__getitem__):
            r3 = self.client.put("/api/me/likes/2978105041", json=single)
            self.assertEqual(r3.status_code, 204)

        rows = self.db.scalars(select(Like).where(Like.user_id == self.user.id)).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].deezer_id, "3068802261")

    def test_contains_and_delete_work_via_alternate_release_id(self) -> None:
        album = _track_dict(
            "3068802261", album="From Zero", album_id="1002", isrc="USWB12403464"
        )
        single = _track_dict(
            "2978105041", album="The Emptiness Machine", album_id="1001", isrc="USWB12403464"
        )
        live = _track_dict(
            "4175528112", title="The Emptiness Machine (Live)", album="Live", album_id="1003", isrc="USWB12601056"
        )
        self.assertEqual(self.client.put("/api/me/likes/3068802261", json=album).status_code, 204)

        isrcs = {"2978105041": "USWB12403464", "4175528112": "USWB12601056"}
        with patch.object(dc, "track_isrc", side_effect=isrcs.__getitem__):
            res = self.client.get("/api/me/likes/contains?ids=3068802261,2978105041,4175528112")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json(),
            {"3068802261": True, "2978105041": True, "4175528112": False},
        )

        # Unliking the Single ID removes the stored Album like!
        with patch.object(dc, "track_public", return_value=single):
            del_res = self.client.delete("/api/me/likes/2978105041")
        self.assertEqual(del_res.status_code, 204)
        self.assertEqual(
            self.db.scalars(select(Like).where(Like.user_id == self.user.id)).all(),
            [],
        )

    def test_distinct_isrcs_with_same_title_can_both_be_liked(self) -> None:
        orig = _track_dict("984138262", title="Hypa Hypa", artist="Electric Callboy", duration_sec=213, isrc="GBDHC2017801")
        alt = _track_dict("1343748042", title="Hypa Hypa", artist="Electric Callboy", duration_sec=184, isrc="GBDHC2017808")
        self.assertEqual(self.client.put("/api/me/likes/984138262", json=orig).status_code, 204)
        self.assertEqual(self.client.put("/api/me/likes/1343748042", json=alt).status_code, 204)

        rows = self.db.scalars(select(Like).where(Like.user_id == self.user.id)).all()
        self.assertEqual(len(rows), 2)

    def test_merge_existing_library_duplicates_backfills_and_merges_per_user(self) -> None:
        t1 = datetime(2025, 1, 1, tzinfo=timezone.utc)
        t2 = datetime(2025, 6, 1, tzinfo=timezone.utc)
        t3 = datetime(2025, 9, 1, tzinfo=timezone.utc)

        # User 1 has 3 legacy ISRC-less likes of the same recording (Single, EP, Album)
        # plus 1 withdrawn track that 404s on Deezer.
        self.db.add_all(
            [
                Like(
                    user_id=self.user.id, deezer_id="984138262", isrc="",
                    title="Hypa Hypa", artist="Electric Callboy", album="Hypa Hypa",
                    album_id="153", duration_sec=213, created_at=t1,
                ),
                Like(
                    user_id=self.user.id, deezer_id="1059805452", isrc="",
                    title="Hypa Hypa", artist="Electric Callboy", album="MMXX - EP",
                    album_id="168", duration_sec=213, created_at=t2,
                ),
                Like(
                    user_id=self.user.id, deezer_id="1345077882", isrc="",
                    title="Hypa Hypa", artist="Electric Callboy", album="MMXX - Hypa Hypa Edition",
                    album_id="223", duration_sec=213, created_at=t1,
                ),
                Like(
                    user_id=self.user.id, deezer_id="999999999", isrc="",
                    title="Withdrawn Song", artist="Old Band", album="Old",
                    album_id="999", duration_sec=200, created_at=t3,
                ),
                # User 2 also liked the Single — must stay isolated to User 2!
                Like(
                    user_id=self.other.id, deezer_id="984138262", isrc="",
                    title="Hypa Hypa", artist="Electric Callboy", album="Hypa Hypa",
                    album_id="153", duration_sec=213, created_at=t1,
                ),
            ]
        )
        pl = Playlist(user_id=self.user.id, name="Rock")
        self.db.add(pl)
        self.db.flush()
        self.db.add(
            PlaylistTrack(
                playlist_id=pl.id, deezer_id="984138262", isrc="",
                title="Hypa Hypa", artist="Electric Callboy", album="Hypa Hypa",
                album_id="153", duration_sec=213, position=0,
            )
        )
        self.db.commit()

        meta_map = {
            "984138262": _track_dict("984138262", title="Hypa Hypa", artist="Electric Callboy", album="Hypa Hypa", album_id="153", duration_sec=213, rank=577760, isrc="GBDHC2017801"),
            "1059805452": _track_dict("1059805452", title="Hypa Hypa", artist="Electric Callboy", album="MMXX - EP", album_id="168", duration_sec=213, rank=250888, isrc="GBDHC2017801"),
            "1345077882": _track_dict("1345077882", title="Hypa Hypa", artist="Electric Callboy", album="MMXX - Hypa Hypa Edition", album_id="223", duration_sec=213, rank=325531, isrc="GBDHC2017801"),
        }
        album_types = {"153": "single", "168": "ep", "223": "album"}

        def fake_track(did: str) -> dict:
            if did == "999999999":
                raise dc.TrackUnavailable("withdrawn")
            return meta_map[did]

        report = likes_dedup.merge_existing_library_duplicates(
            self.SessionLocal,
            resolve_track=fake_track,
            resolve_record_type=album_types.__getitem__,
        )

        self.assertEqual(report.users_processed, 2)
        self.assertEqual(report.duplicate_groups_merged, 1)
        self.assertEqual(report.likes_removed, 2)
        self.assertEqual(report.playlist_tracks_backfilled, 1)
        self.assertEqual(len(report.unresolved_tracks), 1)
        self.assertEqual(report.errors, [])

        self.db.expire_all()
        user_likes = self.db.scalars(
            select(Like).where(Like.user_id == self.user.id).order_by(Like.deezer_id)
        ).all()
        self.assertEqual([row.deezer_id for row in user_likes], ["1345077882", "999999999"])
        album_row = user_likes[0]
        self.assertEqual(album_row.isrc, "GBDHC2017801")
        # Kept most recent created_at across merged rows (t2).
        self.assertEqual(album_row.created_at.replace(tzinfo=None), t2.replace(tzinfo=None))

        other_likes = self.db.scalars(select(Like).where(Like.user_id == self.other.id)).all()
        self.assertEqual(len(other_likes), 1)
        self.assertEqual(other_likes[0].isrc, "GBDHC2017801")

        pt = self.db.scalar(select(PlaylistTrack).where(PlaylistTrack.playlist_id == pl.id))
        self.assertIsNotNone(pt)
        assert pt is not None
        self.assertEqual(pt.isrc, "GBDHC2017801")

    def test_admin_deduplicate_endpoint_returns_report(self) -> None:
        with patch.object(
            likes_dedup,
            "merge_existing_library_duplicates",
            return_value=likes_dedup.DeduplicationReport(
                users_processed=1,
                likes_scanned=5,
                isrc_backfilled=3,
                duplicate_groups_merged=1,
                likes_removed=2,
                playlist_tracks_backfilled=4,
            ),
        ):
            res = self.client.post("/api/admin/likes/deduplicate")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["likes_removed"], 2)
        self.assertEqual(res.json()["duplicate_groups_merged"], 1)

    def test_portable_migration_adds_isrc_and_partial_unique_index_to_legacy_db(self) -> None:
        legacy_engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        try:
            with legacy_engine.begin() as conn:
                conn.exec_driver_sql(
                    "CREATE TABLE playlists ("
                    "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
                    "name VARCHAR(200) NOT NULL DEFAULT '', is_public BOOLEAN NOT NULL DEFAULT 0)"
                )
                conn.exec_driver_sql(
                    "CREATE TABLE likes ("
                    "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
                    "deezer_id VARCHAR(32) NOT NULL, title VARCHAR(500) NOT NULL DEFAULT '', "
                    "artist VARCHAR(500) NOT NULL DEFAULT '', album VARCHAR(500) NOT NULL DEFAULT '', "
                    "album_id VARCHAR(32) NOT NULL DEFAULT '', cover_url VARCHAR(500), "
                    "duration_sec INTEGER NOT NULL DEFAULT 0, created_at DATETIME)"
                )
                conn.exec_driver_sql(
                    "CREATE TABLE playlist_tracks ("
                    "id INTEGER PRIMARY KEY, playlist_id INTEGER NOT NULL, "
                    "deezer_id VARCHAR(32) NOT NULL, title VARCHAR(500) NOT NULL DEFAULT '', "
                    "artist VARCHAR(500) NOT NULL DEFAULT '', album VARCHAR(500) NOT NULL DEFAULT '', "
                    "album_id VARCHAR(32) NOT NULL DEFAULT '', cover_url VARCHAR(500), "
                    "duration_sec INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, "
                    "added_at DATETIME)"
                )
                # Insert two legacy rows (will get default isrc='') to prove partial
                # unique index does not reject multiple empty ISRCs.
                conn.exec_driver_sql(
                    "INSERT INTO likes (user_id, deezer_id, title) VALUES (1, '10', 'A'), (1, '20', 'B')"
                )

            _run_column_migrations(legacy_engine)

            inspector = inspect(legacy_engine)
            like_cols = {c["name"] for c in inspector.get_columns("likes")}
            pt_cols = {c["name"] for c in inspector.get_columns("playlist_tracks")}
            like_indexes = {idx["name"] for idx in inspector.get_indexes("likes")}
            self.assertIn("isrc", like_cols)
            self.assertIn("isrc", pt_cols)
            self.assertIn("uq_like_user_isrc", like_indexes)
            self.assertIn("ix_likes_user_isrc", like_indexes)
        finally:
            legacy_engine.dispose()


class DiscoveryDedupeTests(unittest.TestCase):
    def test_release_radar_merges_single_and_album_keeping_album_and_first_reason(self) -> None:
        single = _track_dict(
            "2978105041", album="The Emptiness Machine", album_id="1001",
            rank=947166, isrc="USWB12403464", release_date="2026-11-20",
        )
        album = _track_dict(
            "3068802261", album="From Zero", album_id="1002",
            rank=787002, isrc="USWB12403464", release_date="2026-11-18",
        )
        artists = [
            home.RadarArtist("92", "Linkin Park", 10, True),
            home.RadarArtist("99", "Collaborator", 3, False),
        ]
        produced = {"92": [single], "99": [album]}
        types = {"1001": "single", "1002": "album"}

        with (
            patch.object(home, "_radar_artists", return_value=artists),
            patch.object(home, "_artist_new_tracks", side_effect=lambda aid, *_a, **_k: [dict(t) for t in produced[aid]]),
            patch.object(home.radar_preload, "schedule"),
            patch.object(dc, "album_record_type", side_effect=types.__getitem__),
        ):
            tracks = home.release_radar(
                user=SimpleNamespace(id=1),  # type: ignore[arg-type]
                db=object(),  # type: ignore[arg-type]
            )

        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["id"], "3068802261")
        self.assertEqual(tracks[0]["radar_reason"]["artist_id"], "92")

    def test_radio_excludes_alternate_release_of_seed_and_deduplicates_pool(self) -> None:
        seed = {
            "id": "2978105041",
            "title": "The Emptiness Machine",
            "duration": 190,
            "isrc": "USWB12403464",
            "artist": {"id": 92, "name": "Linkin Park"},
            "album": {"id": 1001},
        }
        album_copy_of_seed = _track_dict(
            "3068802261", album="From Zero", album_id="1002", isrc="USWB12403464"
        )
        dup_single = _track_dict(
            "501", title="Other Hit", artist="Band B", artist_id="200",
            album="Other Hit", album_id="2001", rank=900000, isrc="USXXX2400001",
        )
        dup_album = _track_dict(
            "502", title="Other Hit", artist="Band B", artist_id="200",
            album="Full Album", album_id="2002", rank=500000, isrc="USXXX2400001",
        )
        extras = [
            _track_dict(
                f"70{i}", title=f"Track {i}", artist=f"Artist {i}", artist_id=str(300 + i),
                album=f"Alb {i}", album_id=str(3000 + i), isrc=f"USZZZ24000{i:02d}",
            )
            for i in range(15)
        ]
        types = {"2001": "single", "2002": "album"}

        with (
            patch.object(radio, "_seed_meta", return_value=seed),
            patch.object(radio, "_lastfm_similar", return_value=[album_copy_of_seed, dup_single, dup_album, *extras]),
            patch.object(dc, "album_record_type", side_effect=types.__getitem__),
        ):
            mix = radio._radio("2978105041")

        ids = {t["id"] for t in mix}
        self.assertNotIn("2978105041", ids)
        self.assertNotIn("3068802261", ids)
        self.assertIn("502", ids)
        self.assertNotIn("501", ids)


if __name__ == "__main__":
    unittest.main()
