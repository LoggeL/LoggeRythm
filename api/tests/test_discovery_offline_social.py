"""Tests for Offline 2.0 Sync Manifest, Discovery/Library API, and Private-Server Social/Insights."""
from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker

from app.auth import create_token
from app.db.models import (
    FollowedArtist,
    ImportJob,
    Like,
    Play,
    Playlist,
    PlaylistCollaborator,
    PlaylistTrack,
    StoredLyrics,
    StoredTrack,
    User,
)
from app.db.session import Base, get_db
from app.main import _run_column_migrations, app
from app.routers import playlists as playlists_router
from app.routers import radio as radio_router
from app.routers import social as social_router
from app.schemas.connect import RegisterMessage
from app.services import connect_hub, import_jobs, playlist_bus, recommend, social_bus, storage
from app.services.spotify_import import ResolvedImport


class DiscoveryOfflineSocialTests(unittest.TestCase):
    def setUp(self) -> None:
        connect_hub.hub.reset_for_tests()
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.engine = create_engine(
            f"sqlite:///{self.tmp_path / 'wave1.db'}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.SessionFactory = sessionmaker(
            bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False
        )
        with self.SessionFactory() as db:
            self.alice = User(
                email="alice@example.test",
                password_hash="x",
                display_name="Alice",
                is_approved=True,
            )
            self.bob = User(
                email="bob@example.test",
                password_hash="x",
                display_name="Bob",
                is_approved=True,
            )
            db.add_all([self.alice, self.bob])
            db.commit()
            db.refresh(self.alice)
            db.refresh(self.bob)

        def override_db():
            s = self.SessionFactory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        self.alice_headers = {"Cookie": f"sf_session={create_token(self.alice.id)}"}
        self.bob_headers = {"Cookie": f"sf_session={create_token(self.bob.id)}"}
        from app.services import deezer_client as dc

        self._credits_patch = patch.object(dc, "_full_public_artist_refs", return_value=[])
        self._credits_patch.start()

    def tearDown(self) -> None:
        self._credits_patch.stop()
        self.client.close()
        app.dependency_overrides.pop(get_db, None)
        connect_hub.hub.reset_for_tests()
        self.engine.dispose()
        self.tmp.cleanup()

    # --- Deliverable 7: Sync Manifest --------------------------------------

    def test_playlist_sync_manifest_with_sizes_loudness_lyrics_and_preload(self) -> None:
        with self.SessionFactory() as db:
            pl = Playlist(user_id=self.alice.id, name="Offline Pack", revision=4)
            db.add(pl)
            db.flush()
            db.add_all(
                [
                    PlaylistTrack(
                        playlist_id=pl.id,
                        deezer_id="101",
                        title="Cached Song",
                        artist="A",
                        duration_sec=200,
                        position=0,
                    ),
                    PlaylistTrack(
                        playlist_id=pl.id,
                        deezer_id="202",
                        title="Uncached Song",
                        artist="B",
                        duration_sec=180,
                        loudness_gain_db=-5.0,
                        position=1,
                    ),
                ]
            )
            db.add(
                StoredTrack(
                    deezer_id="101",
                    file_path="/tmp/101.mp3",
                    size_bytes=5_000_000,
                    status="ready",
                    audio_format="mp3",
                    loudness_gain_db=-6.5,
                    loudness_lufs=-7.5,
                    loudness_peak=0.95,
                )
            )
            db.add(
                StoredLyrics(
                    deezer_id="101",
                    lines_json=json.dumps([{"t": 1.0, "text": "Hello"}]),
                    synced=True,
                    source="lrclib",
                    ai_generated=False,
                    instrumental=False,
                )
            )
            db.commit()
            pl_id = pl.id

        with (
            patch.object(storage, "is_ready", side_effect=lambda tid: tid == "101"),
            patch.object(storage, "schedule_preload") as mock_preload,
        ):
            resp = self.client.get(
                f"/api/playlists/{pl_id}/sync-manifest?include_lyrics=true&preload=true",
                headers=self.alice_headers,
            )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["playlist_id"], pl_id)
        self.assertEqual(body["revision"], 4)
        self.assertEqual(body["track_count"], 2)
        self.assertEqual(body["stored_count"], 1)
        self.assertEqual(body["total_known_bytes"], 5_000_000)
        self.assertTrue(body["tracks"][0]["is_stored"])
        self.assertEqual(body["tracks"][0]["size_bytes"], 5_000_000)
        self.assertEqual(body["tracks"][0]["loudness_gain_db"], -6.5)
        self.assertTrue(body["tracks"][0]["has_lyrics"])
        self.assertFalse(body["tracks"][1]["is_stored"])
        self.assertEqual(body["tracks"][1]["loudness_gain_db"], -5.0)
        self.assertIn("101", body["lyrics"])
        self.assertEqual(body["lyrics"]["101"]["lines"], [{"t": 1.0, "text": "Hello"}])
        mock_preload.assert_called_once_with(["202"], user_id=self.alice.id, source="preload")

    # --- Deliverable 8: Personal Mixes, Seeded Radio, Direct Import, Dedupe -

    def test_home_personal_mixes_zero_latency_shelves(self) -> None:
        now = datetime.utcnow()
        with self.SessionFactory() as db:
            # On-repeat plays in last 30d
            for _ in range(3):
                db.add(
                    Play(
                        user_id=self.alice.id,
                        deezer_id="10",
                        title="Repeat Hit",
                        artist="Fav Artist",
                        cover_url="https://img/10.jpg",
                        duration_sec=180,
                        played_at=now - timedelta(days=2),
                    )
                )
            # Forgotten favorite: played twice >90d ago, never in last 60d
            for d in (120, 110):
                db.add(
                    Play(
                        user_id=self.alice.id,
                        deezer_id="20",
                        title="Old Gem",
                        artist="Retro",
                        cover_url="https://img/20.jpg",
                        duration_sec=200,
                        played_at=now - timedelta(days=d),
                    )
                )
            # Followed artist + unheard liked track
            db.add(FollowedArtist(user_id=self.alice.id, artist_id="55", name="Followed Band"))
            db.add(
                Like(
                    user_id=self.alice.id,
                    deezer_id="30",
                    title="Deep Cut",
                    artist="Followed Band",
                    cover_url="https://img/30.jpg",
                    duration_sec=220,
                    created_at=now - timedelta(days=5),
                )
            )
            db.commit()

        resp = self.client.get("/api/home/personal-mixes", headers=self.alice_headers)
        self.assertEqual(resp.status_code, 200)
        shelves = {s["key"]: s for s in resp.json()}
        self.assertEqual(set(shelves), {"on-repeat", "forgotten-favorites", "unheard-cuts"})
        self.assertEqual([t["id"] for t in shelves["on-repeat"]["tracks"]], ["10"])
        self.assertEqual([t["id"] for t in shelves["forgotten-favorites"]["tracks"]], ["20"])
        self.assertEqual([t["id"] for t in shelves["unheard-cuts"]["tracks"]], ["30"])

        # Signed-out returns empty list
        anon = self.client.get("/api/home/personal-mixes")
        self.assertEqual(anon.status_code, 200)
        self.assertEqual(anon.json(), [])

    def test_seeded_radio_excludes_recent_7d_plays_and_explicit_excludes(self) -> None:
        now = datetime.utcnow()
        with self.SessionFactory() as db:
            db.add(
                Play(
                    user_id=self.alice.id,
                    deezer_id="501",
                    title="Recent",
                    artist="A",
                    played_at=now - timedelta(days=1),
                )
            )
            db.commit()

        # Empty seed rejected with 422
        empty = self.client.post("/api/radio/seed", json={}, headers=self.alice_headers)
        self.assertEqual(empty.status_code, 422)

        def fake_seed_meta(tid: str) -> dict:
            return {
                "id": tid,
                "title": f"Seed {tid}",
                "artist": {"id": "1", "name": "Seed Artist"},
                "album": {"id": "10", "title": "Alb"},
            }

        fake_candidates = [
            {"id": "501", "title": "Played Yesterday", "artist": "X", "artist_id": "11"},
            {"id": "502", "title": "Explicitly Excluded", "artist": "Y", "artist_id": "12"},
            {"id": "503", "title": "Fresh Track 1", "artist": "Z", "artist_id": "13"},
            {"id": "504", "title": "Fresh Track 2", "artist": "W", "artist_id": "14"},
        ]
        with (
            patch.object(radio_router, "_seed_meta", side_effect=fake_seed_meta),
            patch.object(radio_router, "_lastfm_similar", return_value=fake_candidates),
            patch.object(radio_router, "_deezer_mix", return_value=[]),
            patch.object(radio_router, "_genre_charts", return_value=[]),
            patch.object(radio_router.dc, "charts", return_value=[]),
        ):
            resp = self.client.post(
                "/api/radio/seed",
                json={"track_ids": ["100"], "exclude_ids": ["502"], "limit": 10},
                headers=self.alice_headers,
            )
        self.assertEqual(resp.status_code, 200)
        ids = {t["id"] for t in resp.json()}
        self.assertEqual(ids, {"503", "504"})

    def test_playlist_duplicates_and_deduplicate(self) -> None:
        with self.SessionFactory() as db:
            pl = Playlist(user_id=self.alice.id, name="Dupes", revision=1)
            db.add(pl)
            db.flush()
            db.add_all(
                [
                    PlaylistTrack(
                        playlist_id=pl.id,
                        deezer_id="1001",
                        isrc="USAAA2400001",
                        title="Hit Song",
                        artist="Band",
                        album_id="50",
                        duration_sec=200,
                        position=0,
                    ),
                    PlaylistTrack(
                        playlist_id=pl.id,
                        deezer_id="1002",
                        isrc="USAAA2400001",
                        title="Hit Song",
                        artist="Band",
                        album_id="51",
                        duration_sec=200,
                        position=1,
                    ),
                    PlaylistTrack(
                        playlist_id=pl.id,
                        deezer_id="2000",
                        title="Unique",
                        artist="Other",
                        album_id="52",
                        duration_sec=190,
                        position=2,
                    ),
                ]
            )
            db.commit()
            pl_id = pl.id

        # Album 51 is "album", Album 50 is "single" -> survivor should be 1002
        record_types = {"50": "single", "51": "album"}
        with patch.object(
            playlists_router.dc,
            "album_record_type",
            side_effect=lambda aid: record_types.get(str(aid), ""),
        ):
            preview = self.client.get(
                f"/api/playlists/{pl_id}/duplicates", headers=self.alice_headers
            )
            self.assertEqual(preview.status_code, 200)
            pbody = preview.json()
            self.assertEqual(pbody["total_duplicates"], 1)
            self.assertEqual(len(pbody["groups"]), 1)

            dedup = self.client.post(
                f"/api/playlists/{pl_id}/deduplicate", headers=self.alice_headers
            )
            self.assertEqual(dedup.status_code, 200)
            dbody = dedup.json()
            self.assertEqual(dbody["groups_merged"], 1)
            self.assertEqual(dbody["removed_count"], 1)
            self.assertEqual(dbody["revision"], 2)

        detail = self.client.get(f"/api/playlists/{pl_id}", headers=self.alice_headers).json()
        self.assertEqual([t["id"] for t in detail["tracks"]], ["1002", "2000"])

    def test_import_job_auto_creates_and_appends_to_playlist(self) -> None:
        with (
            patch.object(import_jobs.spotify, "is_configured", return_value=True),
            patch.object(import_jobs, "_executor") as mock_exec,
        ):
            # Both target_playlist_id and create_playlist_name rejected loudly
            bad = self.client.post(
                "/api/resolve/jobs",
                json={
                    "url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
                    "target_playlist_id": 1,
                    "create_playlist_name": "Nope",
                },
                headers=self.alice_headers,
            )
            self.assertEqual(bad.status_code, 422)
            mock_exec.submit.assert_not_called()

            # Direct create_playlist_name auto-creates playlist when job finishes
            fake_resolved = ResolvedImport(
                type="playlist",
                name="Spotify Mix",
                image="https://img/mix.jpg",
                total=1,
                source_total=1,
                tracks=[
                    {
                        "id": "999",
                        "title": "Imported Track",
                        "artist": "Band",
                        "artist_id": "1",
                        "artists": [{"id": "1", "name": "Band"}],
                        "album": "LP",
                        "album_id": "2",
                        "cover": "https://img/999.jpg",
                        "duration_sec": 210,
                        "isrc": "USXYZ2400001",
                        "loudness_gain_db": -5.5,
                    }
                ],
                unmatched=[],
            )
            with (
                patch.object(import_jobs, "SessionLocal", self.SessionFactory),
                patch.object(import_jobs, "resolve_link", return_value=fake_resolved),
            ):
                start_resp = self.client.post(
                    "/api/resolve/jobs",
                    json={
                        "url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
                        "create_playlist_name": "Imported From Spotify",
                    },
                    headers=self.alice_headers,
                )
                self.assertEqual(start_resp.status_code, 202)
                job_id = start_resp.json()["id"]
                import_jobs._execute(job_id)

            with self.SessionFactory() as db:
                saved_job = db.get(ImportJob, job_id)
                self.assertEqual(saved_job.status, "done")
                self.assertIsNotNone(saved_job.created_playlist_id)
                created_pl = db.get(Playlist, saved_job.created_playlist_id)
                self.assertIsNotNone(created_pl)
                self.assertEqual(created_pl.name, "Imported From Spotify")
                tracks = db.scalars(
                    select(PlaylistTrack).where(PlaylistTrack.playlist_id == created_pl.id)
                ).all()
                self.assertEqual([t.deezer_id for t in tracks], ["999"])
                self.assertEqual(tracks[0].loudness_gain_db, -5.5)

            # Bob cannot target Alice's private playlist -> 403 upfront
            unauth = self.client.post(
                "/api/resolve/jobs",
                json={
                    "url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
                    "target_playlist_id": created_pl.id,
                },
                headers=self.bob_headers,
            )
            self.assertEqual(unauth.status_code, 403)

    # --- Deliverable 10: Insights, Social Activity, Playlist SSE, Blend, Profile Top Artists -

    def test_stats_insights_streaks_distributions_new_artists_and_top_albums(self) -> None:
        now = datetime.utcnow().replace(hour=14, minute=0, second=0, microsecond=0)
        with self.SessionFactory() as db:
            # Older play outside 7d window to verify new_artists_count
            db.add(
                Play(
                    user_id=self.alice.id,
                    deezer_id="1",
                    title="Old",
                    artist="Legacy Artist",
                    album="Old Album",
                    album_id="a1",
                    duration_sec=180,
                    played_at=now - timedelta(days=20),
                )
            )
            # 3-day consecutive streak ending today (days 0, 1, 2 ago)
            for offset, artist in ((2, "Legacy Artist"), (1, "New Artist"), (0, "New Artist")):
                db.add(
                    Play(
                        user_id=self.alice.id,
                        deezer_id=f"10{offset}",
                        title=f"Track {offset}",
                        artist=artist,
                        album="Best Album",
                        album_id="a2",
                        duration_sec=200,
                        played_at=now - timedelta(days=offset),
                    )
                )
            db.commit()

        resp = self.client.get("/api/me/stats/insights?range=7d", headers=self.alice_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["range"], "7d")
        self.assertEqual(data["play_count"], 3)
        self.assertEqual(data["listening_sec"], 600)
        self.assertEqual(data["unique_tracks"], 3)
        self.assertEqual(data["unique_artists"], 2)
        self.assertEqual(data["current_streak_days"], 3)
        self.assertEqual(data["longest_streak_days"], 3)
        self.assertEqual(data["new_artists_count"], 1)  # "New Artist" only
        self.assertEqual(len(data["hourly_distribution"]), 24)
        self.assertEqual(data["hourly_distribution"][14], 3)
        self.assertEqual(len(data["weekday_distribution"]), 7)
        self.assertEqual(data["top_albums"][0]["label"], "Best Album")
        self.assertEqual(data["top_albums"][0]["count"], 3)
        self.assertTrue(data["recent_plays"][0]["played_at"])

    def test_social_activity_opt_in_privacy_and_sse_stream(self) -> None:
        class _DummySocket:
            async def send_json(self, _payload: dict) -> None:
                return None

            async def close(self, code: int = 1000, reason: str = "") -> None:
                return None

        async def register_bob() -> None:
            await connect_hub.hub.register(
                self.bob.id,
                _DummySocket(),
                RegisterMessage.model_validate(
                    {
                        "type": "register",
                        "device_id": "bob-phone",
                        "name": "Bob Pixel",
                        "device_type": "mobile",
                        "party_code": "JAM123",
                        "take_active": True,
                        "playback": {
                            "queue": [{"id": "77", "title": "Live Jam", "artist": "DJ"}],
                            "current_index": 0,
                            "is_playing": True,
                            "position_sec": 10.0,
                            "duration_sec": 180.0,
                        },
                    }
                ),
            )

        asyncio.run(register_bob())

        # Default share_listening_activity is False -> Bob is NOT visible to Alice
        hidden = self.client.get("/api/social/activity", headers=self.alice_headers)
        self.assertEqual(hidden.status_code, 200)
        self.assertEqual(hidden.json()["items"], [])

        # Bob opts in via PATCH /api/me/settings -> immediately visible!
        opt_in = self.client.patch(
            "/api/me/settings",
            json={"share_listening_activity": True},
            headers=self.bob_headers,
        )
        self.assertEqual(opt_in.status_code, 200)
        self.assertTrue(opt_in.json()["share_listening_activity"])

        visible = self.client.get("/api/social/activity", headers=self.alice_headers)
        self.assertEqual(visible.status_code, 200)
        items = visible.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["user_id"], self.bob.id)
        self.assertTrue(items[0]["is_playing"])
        self.assertEqual(items[0]["track"]["id"], "77")
        self.assertEqual(items[0]["party_code"], "JAM123")

        # SSE endpoint delivers initial frame + live update on social_bus.notify()
        async def test_sse() -> list[dict]:
            with patch.object(social_router, "SessionLocal", self.SessionFactory):
                response = await social_router.social_activity_events(_user=self.alice)
                try:
                    first = json.loads(
                        (await anext(response.body_iterator)).removeprefix("data: ").strip()
                    )
                    social_bus.notify()
                    second = json.loads(
                        (await anext(response.body_iterator)).removeprefix("data: ").strip()
                    )
                    return [first, second]
                finally:
                    await response.body_iterator.aclose()

        frames = asyncio.run(test_sse())
        self.assertEqual(len(frames[0]["items"]), 1)
        self.assertEqual(len(frames[1]["items"]), 1)

    def test_collaborative_playlist_sse_events(self) -> None:
        with self.SessionFactory() as db:
            pl = Playlist(user_id=self.alice.id, name="Live Collab", is_collaborative=True, revision=1)
            db.add(pl)
            db.flush()
            db.add(
                PlaylistCollaborator(
                    playlist_id=pl.id,
                    user_id=self.bob.id,
                    role="editor",
                    added_by_user_id=self.alice.id,
                )
            )
            db.commit()
            pl_id = pl.id

        async def test_stream() -> list[dict]:
            with patch.object(playlists_router, "SessionLocal", self.SessionFactory):
                response = await playlists_router.playlist_events(pl_id, user=self.alice)
                try:
                    first = json.loads(
                        (await anext(response.body_iterator)).removeprefix("data: ").strip()
                    )
                    # Bob adds a track -> bumps revision to 2 and publishes SSE frame
                    add_resp = self.client.post(
                        f"/api/playlists/{pl_id}/tracks",
                        json={"id": "555", "title": "Collab Track", "artist": "Artist"},
                        headers=self.bob_headers,
                    )
                    self.assertEqual(add_resp.status_code, 204)
                    second = json.loads(
                        (await anext(response.body_iterator)).removeprefix("data: ").strip()
                    )
                    return [first, second]
                finally:
                    await response.body_iterator.aclose()

        frames = asyncio.run(test_stream())
        self.assertEqual(frames[0], {"playlist_id": pl_id, "revision": 1, "event": "snapshot"})
        self.assertEqual(frames[1], {"playlist_id": pl_id, "revision": 2, "event": "updated"})
        self.assertEqual(playlist_bus.subscriber_count(pl_id), 0)

        # Removing collaborator terminates Bob's open SSE stream with event="revoked"
        async def test_revocation() -> list[dict]:
            with patch.object(playlists_router, "SessionLocal", self.SessionFactory):
                response = await playlists_router.playlist_events(pl_id, user=self.bob)
                received: list[dict] = []
                received.append(
                    json.loads((await anext(response.body_iterator)).removeprefix("data: ").strip())
                )
                rem = self.client.delete(
                    f"/api/playlists/{pl_id}/collaborators/{self.bob.id}",
                    headers=self.alice_headers,
                )
                self.assertEqual(rem.status_code, 204)
                async for chunk in response.body_iterator:
                    if chunk.startswith("data: "):
                        received.append(json.loads(chunk.removeprefix("data: ").strip()))
                return received

        rev_frames = asyncio.run(test_revocation())
        self.assertEqual(len(rev_frames), 2)
        self.assertEqual(rev_frames[1]["event"], "revoked")
        self.assertEqual(playlist_bus.subscriber_count(pl_id), 0)

        # Deleting playlist terminates Alice's open SSE stream with event="deleted"
        async def test_deletion() -> list[dict]:
            with patch.object(playlists_router, "SessionLocal", self.SessionFactory):
                response = await playlists_router.playlist_events(pl_id, user=self.alice)
                received: list[dict] = []
                received.append(
                    json.loads((await anext(response.body_iterator)).removeprefix("data: ").strip())
                )
                del_resp = self.client.delete(
                    f"/api/playlists/{pl_id}", headers=self.alice_headers
                )
                self.assertEqual(del_resp.status_code, 204)
                async for chunk in response.body_iterator:
                    if chunk.startswith("data: "):
                        received.append(json.loads(chunk.removeprefix("data: ").strip()))
                return received

        del_frames = asyncio.run(test_deletion())
        self.assertEqual(len(del_frames), 2)
        self.assertEqual(del_frames[1]["event"], "deleted")
        self.assertEqual(playlist_bus.subscriber_count(pl_id), 0)

    def test_playlist_blend_and_public_profile_top_played_artists(self) -> None:
        with self.SessionFactory() as db:
            # Shared track + unique tracks for Alice and Bob
            db.add_all(
                [
                    Play(user_id=self.alice.id, deezer_id="1", title="Shared", artist="Daft Punk", artist_id="27", duration_sec=200),
                    Play(user_id=self.alice.id, deezer_id="1", title="Shared", artist="Daft Punk", artist_id="27", duration_sec=200),
                    Play(user_id=self.alice.id, deezer_id="2", title="Alice Cut", artist="Justice", artist_id="28", duration_sec=190),
                    Play(user_id=self.bob.id, deezer_id="1", title="Shared", artist="Daft Punk", artist_id="27", duration_sec=200),
                    Play(user_id=self.bob.id, deezer_id="3", title="Bob Cut", artist="Kavinsky", artist_id="29", duration_sec=210),
                ]
            )
            db.commit()

        # Self-blend fails loudly with 400
        self_blend = self.client.post(
            f"/api/playlists/blend/{self.alice.id}", headers=self.alice_headers
        )
        self.assertEqual(self_blend.status_code, 400)

        with patch.object(recommend, "LASTFM_API_KEY", ""):
            resp = self.client.post(
                f"/api/playlists/blend/{self.bob.id}", headers=self.alice_headers
            )
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertGreater(body["match_percent"], 0)
        self.assertEqual(body["shared_artists"], ["Daft Punk"])
        self.assertEqual(body["shared_tracks_count"], 1)
        self.assertTrue(body["playlist"]["is_collaborative"])
        self.assertEqual([t["id"] for t in body["playlist"]["tracks"]], ["1", "2", "3"])
        self.assertEqual([c["user_id"] for c in body["playlist"]["collaborators"]], [self.bob.id])

        # Public profile top_artists uses actual Play table counts
        prof = self.client.get(f"/api/users/{self.alice.id}", headers=self.bob_headers)
        self.assertEqual(prof.status_code, 200)
        top_names = [a["name"] for a in prof.json()["top_artists"]]
        self.assertEqual(top_names, ["Daft Punk", "Justice"])

    def test_portable_column_migrations_add_all_wave1_columns_idempotently(self) -> None:
        legacy_engine = create_engine(f"sqlite:///{self.tmp_path / 'legacy_wave1.db'}")
        try:
            with legacy_engine.begin() as conn:
                conn.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(320))")
                conn.exec_driver_sql("CREATE TABLE stored_tracks (deezer_id VARCHAR(32) PRIMARY KEY, file_path VARCHAR(1000), created_at DATETIME)")
                conn.exec_driver_sql("CREATE TABLE likes (id INTEGER PRIMARY KEY, user_id INTEGER, deezer_id VARCHAR(32))")
                conn.exec_driver_sql("CREATE TABLE playlists (id INTEGER PRIMARY KEY, user_id INTEGER, name VARCHAR(200))")
                conn.exec_driver_sql("CREATE TABLE playlist_tracks (id INTEGER PRIMARY KEY, playlist_id INTEGER, deezer_id VARCHAR(32))")
                conn.exec_driver_sql("CREATE TABLE party_tracks (id INTEGER PRIMARY KEY, session_code VARCHAR(12), deezer_id VARCHAR(32))")
                conn.exec_driver_sql("CREATE TABLE party_sessions (code VARCHAR(12) PRIMARY KEY, host_id INTEGER)")
                conn.exec_driver_sql("CREATE TABLE stored_lyrics (deezer_id VARCHAR(32) PRIMARY KEY, lines_json TEXT)")
                conn.exec_driver_sql("CREATE TABLE import_jobs (id VARCHAR(32) PRIMARY KEY, user_id INTEGER, url TEXT)")

            with patch("app.main.engine", legacy_engine):
                _run_column_migrations()
                _run_column_migrations()  # idempotent second run

            insp = inspect(legacy_engine)
            self.assertTrue({"share_listening_activity", "preferred_quality"} <= {c["name"] for c in insp.get_columns("users")})
            self.assertTrue({"audio_format", "loudness_gain_db", "loudness_lufs", "loudness_peak", "bpm"} <= {c["name"] for c in insp.get_columns("stored_tracks")})
            self.assertIn("loudness_gain_db", {c["name"] for c in insp.get_columns("likes")})
            self.assertIn("loudness_gain_db", {c["name"] for c in insp.get_columns("playlist_tracks")})
            self.assertIn("loudness_gain_db", {c["name"] for c in insp.get_columns("party_tracks")})
            self.assertIn("auto_dj", {c["name"] for c in insp.get_columns("party_sessions")})
            self.assertIn("instrumental", {c["name"] for c in insp.get_columns("stored_lyrics")})
            self.assertTrue({"target_playlist_id", "create_playlist_name", "created_playlist_id"} <= {c["name"] for c in insp.get_columns("import_jobs")})
        finally:
            legacy_engine.dispose()


if __name__ == "__main__":
    unittest.main()
