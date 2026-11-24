"""Tests for the Admin Usage Dashboard endpoints, storage attribution, and tracking."""
from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.auth import create_token
from app.config import SESSION_COOKIE
from app.db.models import (
    FollowedArtist,
    ImportJob,
    Like,
    PartyMember,
    PartySession,
    PartyTrack,
    Play,
    Playlist,
    PlaylistTrack,
    StoredTrack,
    TrackRequest,
    User,
)
from app.db.session import Base, get_db
from app.routers import lyrics as lyrics_router
from app.routers import party as party_router
from app.schemas.connect import (
    ConnectPlaybackInput,
    DeviceCapabilities,
    RegisterMessage,
)
from app.schemas.track import Track
from app.services import (
    admin_usage,
    connect_hub,
    groq,
    party_preload,
    playlist_export,
    radar_preload,
    storage,
)


def _utc(days_ago: float = 0.0) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days_ago)


class AdminUsageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.storage_dir = os.path.join(self.tmpdir.name, "storage")
        os.makedirs(self.storage_dir, exist_ok=True)
        self.enterContext(patch.dict(os.environ, {"STORAGE_DIR": self.storage_dir}))

        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        self.enterContext(patch.object(storage, "SessionLocal", self.sessions))

        connect_hub.hub.reset_for_tests()
        self.addCleanup(connect_hub.hub.reset_for_tests)

        def override_db():
            with self.sessions() as db:
                yield db

        main.app.dependency_overrides[get_db] = override_db
        self.addCleanup(main.app.dependency_overrides.clear)
        self.client = TestClient(main.app)

    def _create_user(
        self,
        email: str,
        *,
        display_name: str | None = None,
        is_admin: bool = False,
        is_approved: bool = True,
    ) -> User:
        with self.sessions() as db:
            user = User(
                email=email,
                password_hash="unused",
                display_name=display_name,
                is_admin=is_admin,
                is_approved=is_approved,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            return user

    def _auth_headers(self, user: User) -> dict[str, str]:
        return {"Cookie": f"{SESSION_COOKIE}={create_token(user.id)}"}

    def test_auth_access_control_and_validation(self) -> None:
        admin = self._create_user("admin@example.test", is_admin=True, is_approved=True)
        member = self._create_user("member@example.test", is_admin=False, is_approved=True)
        pending = self._create_user("pending@example.test", is_admin=False, is_approved=False)

        # Unauthenticated -> 401
        self.assertEqual(self.client.get("/api/admin/usage").status_code, 401)
        self.assertEqual(self.client.get(f"/api/admin/usage/users/{member.id}").status_code, 401)

        # Approved non-admin -> 403
        res_member = self.client.get("/api/admin/usage", headers=self._auth_headers(member))
        self.assertEqual(res_member.status_code, 403)
        res_member_detail = self.client.get(
            f"/api/admin/usage/users/{member.id}", headers=self._auth_headers(member)
        )
        self.assertEqual(res_member_detail.status_code, 403)

        # Pending account -> 403
        self.assertEqual(
            self.client.get("/api/admin/usage", headers=self._auth_headers(pending)).status_code,
            403,
        )

        # Admin -> 200 on empty dataset, missing user -> 404, invalid range -> 422
        empty_res = self.client.get("/api/admin/usage", headers=self._auth_headers(admin))
        self.assertEqual(empty_res.status_code, 200)
        empty_body = empty_res.json()
        self.assertIsNone(empty_body["request_tracking_since"])
        self.assertEqual(empty_body["overview"]["total_users"], 3)
        self.assertEqual(empty_body["overview"]["active_users"], 0)
        self.assertEqual(empty_body["overview"]["storage"]["total_audio_bytes"], 0)
        self.assertEqual(
            self.client.get("/api/admin/usage?range=90d", headers=self._auth_headers(admin)).status_code,
            422,
        )
        self.assertEqual(
            self.client.get("/api/admin/usage/users/99999", headers=self._auth_headers(admin)).status_code,
            404,
        )

    def test_storage_attribution_invariants_ranges_and_cross_endpoint_consistency(self) -> None:
        admin = self._create_user("admin@example.test", display_name="Admin", is_admin=True)
        alice = self._create_user("alice@example.test", display_name="Alice")
        bob = self._create_user("bob@example.test", display_name="Bob")
        idle = self._create_user("idle@example.test", display_name="Idle", is_approved=False)

        with self.sessions() as db:
            # Playlists
            alice_pl = Playlist(user_id=alice.id, name="Alice Public", is_public=True)
            bob_pl = Playlist(user_id=bob.id, name="Bob Private", is_public=False)
            db.add_all([alice_pl, bob_pl])
            db.flush()

            # Stored tracks on disk (status='ready')
            db.add_all(
                [
                    # 1001: exclusive to alice (played + liked + materialized by alice)
                    StoredTrack(
                        deezer_id="1001",
                        file_path=f"{self.storage_dir}/1001.mp3",
                        title="Solo Alice",
                        artist="Artist A",
                        size_bytes=1000,
                        status="ready",
                        requested_by_user_id=alice.id,
                        request_source="stream",
                    ),
                    # 1002: shared between alice (played) and bob (playlist + materialized by bob)
                    StoredTrack(
                        deezer_id="1002",
                        file_path=f"{self.storage_dir}/1002.mp3",
                        title="Shared Hit",
                        artist="Artist B",
                        size_bytes=2000,
                        status="ready",
                        requested_by_user_id=bob.id,
                        request_source="preload",
                    ),
                    # 1003: legacy unattributed track (no user links)
                    StoredTrack(
                        deezer_id="1003",
                        file_path=f"{self.storage_dir}/1003.mp3",
                        title="Legacy Unattributed",
                        artist="Artist C",
                        size_bytes=3000,
                        status="ready",
                        requested_by_user_id=None,
                        request_source=None,
                    ),
                    # 1004: materialized by alice (radar_preload), never played/liked
                    StoredTrack(
                        deezer_id="1004",
                        file_path=f"{self.storage_dir}/1004.mp3",
                        title="Radar Fresh",
                        artist="Artist D",
                        size_bytes=4000,
                        status="ready",
                        requested_by_user_id=alice.id,
                        request_source="radar_preload",
                    ),
                    # 1005: exclusive to bob via party track addition
                    StoredTrack(
                        deezer_id="1005",
                        file_path=f"{self.storage_dir}/1005.mp3",
                        title="Party Jam",
                        artist="Artist E",
                        size_bytes=5000,
                        status="ready",
                        requested_by_user_id=bob.id,
                        request_source="party_preload",
                    ),
                    # 1006: anonymous party guest preload (unattributed on disk)
                    StoredTrack(
                        deezer_id="1006",
                        file_path=f"{self.storage_dir}/1006.mp3",
                        title="Guest Pick",
                        artist="Artist F",
                        size_bytes=6000,
                        status="ready",
                        requested_by_user_id=None,
                        request_source="party_preload",
                    ),
                ]
            )

            # Plays across timeframes: 2d (in 7d), 15d (in 30d), 45d (all only)
            db.add_all(
                [
                    Play(
                        user_id=alice.id,
                        deezer_id="1001",
                        title="Solo Alice",
                        artist="Artist A",
                        artist_id="a1",
                        album="Alb A",
                        duration_sec=180,
                        played_at=_utc(2),
                    ),
                    Play(
                        user_id=alice.id,
                        deezer_id="1001",
                        title="Solo Alice",
                        artist="Artist A",
                        artist_id="a1",
                        album="Alb A",
                        duration_sec=-50,  # legacy negative clamped to 0
                        played_at=_utc(15),
                    ),
                    Play(
                        user_id=alice.id,
                        deezer_id="1002",
                        title="Shared Hit",
                        artist="Artist B",
                        artist_id="b1",
                        album="Alb B",
                        duration_sec=240,
                        played_at=_utc(45),
                    ),
                    Play(
                        user_id=bob.id,
                        deezer_id="9999",  # uncached track play
                        title="Uncached",
                        artist="Artist Z",
                        artist_id="z1",
                        album="Alb Z",
                        duration_sec=200,
                        played_at=_utc(20),
                    ),
                ]
            )

            # Likes, playlists, follows, party, imports
            db.add(Like(user_id=alice.id, deezer_id="1001", title="Solo Alice", artist="Artist A", created_at=_utc(40)))
            db.add(PlaylistTrack(playlist_id=bob_pl.id, deezer_id="1002", title="Shared Hit", artist="Artist B", added_at=_utc(40)))
            db.add(FollowedArtist(user_id=alice.id, artist_id="a1", name="Artist A"))
            party = PartySession(code="JAM001", name="Friday Jam", host_id=bob.id)
            db.add(party)
            db.flush()
            db.add(PartyMember(session_code=party.code, user_id=bob.id, display_name="Bob", last_seen=_utc(40)))
            db.add_all(
                [
                    PartyTrack(
                        session_code=party.code,
                        deezer_id="1005",
                        title="Party Jam",
                        artist="Artist E",
                        added_by="Bob",
                        added_by_member=f"u:{bob.id}",
                        added_at=_utc(40),
                    ),
                    PartyTrack(
                        session_code=party.code,
                        deezer_id="1006",
                        title="Guest Pick",
                        artist="Artist F",
                        added_by="Guest",
                        added_by_member="g:1",
                        added_at=_utc(40),
                    ),
                ]
            )
            db.add(
                ImportJob(
                    id="job1",
                    user_id=alice.id,
                    url="https://open.spotify.com/playlist/xyz",
                    status="done",
                    matched=12,
                    created_at=_utc(40),
                )
            )

            # TrackRequest history (including evicted track 1007 and guest request 1006)
            db.add_all(
                [
                    TrackRequest(
                        user_id=alice.id,
                        deezer_id="1001",
                        source="stream",
                        materialized=True,
                        size_bytes=1000,
                        title="Solo Alice",
                        artist="Artist A",
                        requested_at=_utc(2),
                    ),
                    TrackRequest(
                        user_id=alice.id,
                        deezer_id="1004",
                        source="radar_preload",
                        materialized=True,
                        size_bytes=4000,
                        title="Radar Fresh",
                        artist="Artist D",
                        requested_at=_utc(3),
                    ),
                    TrackRequest(
                        user_id=alice.id,
                        deezer_id="1007",  # evicted, not in StoredTrack
                        source="playlist_export",
                        materialized=True,
                        size_bytes=7000,
                        title="Evicted Track",
                        artist="Artist G",
                        requested_at=_utc(45),
                    ),
                    TrackRequest(
                        user_id=bob.id,
                        deezer_id="1002",
                        source="preload",
                        materialized=True,
                        size_bytes=2000,
                        title="Shared Hit",
                        artist="Artist B",
                        requested_at=_utc(14),
                    ),
                    TrackRequest(
                        user_id=None,  # anonymous party guest
                        deezer_id="1006",
                        source="party_preload",
                        materialized=True,
                        size_bytes=6000,
                        title="Guest Pick",
                        artist="Artist F",
                        requested_at=_utc(1),
                    ),
                ]
            )
            db.commit()
            alice_pl_id = alice_pl.id
            bob_pl_id = bob_pl.id

        # Upload files on disk (avatars + covers + temp hidden file to ignore)
        avatars_dir = Path(self.storage_dir) / "avatars"
        covers_dir = Path(self.storage_dir) / "covers"
        avatars_dir.mkdir(parents=True, exist_ok=True)
        covers_dir.mkdir(parents=True, exist_ok=True)
        (avatars_dir / f"{alice.id}.png").write_bytes(b"a" * 512)
        (avatars_dir / ".upload-in-flight.png").write_bytes(b"x" * 999)
        (covers_dir / f"{alice_pl_id}.jpg").write_bytes(b"b" * 256)
        (covers_dir / f"{bob_pl_id}.webp").write_bytes(b"c" * 128)

        # Register live Connect devices for Bob (playing) + Alice (passive)
        async def _connect_devices() -> None:
            ws_bob = AsyncMock()
            await connect_hub.hub.register(
                bob.id,
                ws_bob,
                RegisterMessage(
                    type="register",
                    device_id="bob-phone",
                    name="Bob Pixel",
                    device_type="mobile",
                    capabilities=DeviceCapabilities(can_play_audio=True, can_control_volume=False),
                    party_code="JAM001",
                    take_active=True,
                    playback=ConnectPlaybackInput(
                        queue=[Track(id="1005", title="Party Jam", artist="Artist E", duration_sec=210)],
                        current_index=0,
                        is_playing=True,
                        position_sec=12.0,
                        duration_sec=210.0,
                    ),
                ),
            )
            ws_bob_web = AsyncMock()
            await connect_hub.hub.register(
                bob.id,
                ws_bob_web,
                RegisterMessage(
                    type="register",
                    device_id="bob-web",
                    name="Bob Browser",
                    device_type="web",
                ),
            )

        asyncio.run(_connect_devices())

        # --- Verify ALL range ---
        res_all = self.client.get("/api/admin/usage?range=all", headers=self._auth_headers(admin))
        self.assertEqual(res_all.status_code, 200)
        data = res_all.json()
        self.assertEqual(data["range"], "all")
        self.assertIsNotNone(data["request_tracking_since"])

        ov = data["overview"]
        self.assertEqual(ov["total_users"], 4)
        self.assertEqual(ov["approved_users"], 3)
        self.assertEqual(ov["pending_users"], 1)
        self.assertEqual(ov["active_users"], 2)  # alice + bob (admin & idle have zero activity)
        self.assertEqual(ov["total_plays"], 4)
        self.assertEqual(ov["total_listening_sec"], 180 + 0 + 240 + 200)
        self.assertEqual(ov["unique_tracks_played"], 3)  # 1001, 1002, 9999
        self.assertEqual(ov["tracks_requested"], 5)  # includes guest 1006
        self.assertEqual(ov["tracks_materialized"], 5)
        self.assertEqual(ov["materialized_bytes"], 1000 + 4000 + 7000 + 2000 + 6000)
        self.assertEqual(ov["online_connect_devices"], 2)
        self.assertEqual(ov["online_connect_users"], 1)
        self.assertEqual(ov["active_parties"], 1)

        st = ov["storage"]
        self.assertEqual(st["cached_tracks"], 6)
        self.assertEqual(st["total_audio_bytes"], 21000)
        # Exclusive: 1001 (1000) + 1004 (4000) [alice] + 1005 (5000) [bob] = 10000
        self.assertEqual(st["exclusive_audio_tracks"], 3)
        self.assertEqual(st["exclusive_audio_bytes"], 10000)
        # Shared: 1002 (2000) [alice & bob]
        self.assertEqual(st["shared_audio_tracks"], 1)
        self.assertEqual(st["shared_audio_bytes"], 2000)
        # Unattributed: 1003 (3000) + 1006 (6000) = 9000
        self.assertEqual(st["unattributed_audio_tracks"], 2)
        self.assertEqual(st["unattributed_audio_bytes"], 9000)
        # Exact byte conservation invariant
        self.assertEqual(
            st["exclusive_audio_bytes"] + st["shared_audio_bytes"] + st["unattributed_audio_bytes"],
            st["total_audio_bytes"],
        )
        self.assertEqual(
            st["exclusive_audio_tracks"] + st["shared_audio_tracks"] + st["unattributed_audio_tracks"],
            st["cached_tracks"],
        )
        # Directly attributed on disk: 1001 + 1002 + 1004 + 1005 = 12000
        self.assertEqual(st["directly_attributed_tracks"], 4)
        self.assertEqual(st["directly_attributed_bytes"], 12000)
        # Uploads (ignoring .upload-in-flight.png)
        self.assertEqual(st["upload_bytes"], 512 + 256 + 128)

        users_by_id = {u["id"]: u for u in data["users"]}
        self.assertEqual(
            sum(u["storage"]["exclusive_bytes"] for u in data["users"]),
            st["exclusive_audio_bytes"],
        )
        self.assertEqual(
            sum(u["storage"]["materialized_bytes"] for u in data["users"]),
            st["directly_attributed_bytes"],
        )

        # Alice assertions
        u_alice = users_by_id[alice.id]
        self.assertEqual(u_alice["plays"], 3)
        self.assertEqual(u_alice["listening_sec"], 420)
        self.assertEqual(u_alice["unique_tracks"], 2)
        self.assertEqual(u_alice["tracks_requested"], 3)
        self.assertEqual(u_alice["tracks_materialized"], 3)
        self.assertEqual(u_alice["materialized_bytes"], 12000)
        self.assertEqual(u_alice["storage"]["exclusive_bytes"], 5000)
        self.assertEqual(u_alice["storage"]["exclusive_tracks"], 2)
        self.assertEqual(u_alice["storage"]["shared_bytes"], 2000)
        self.assertEqual(u_alice["storage"]["shared_tracks"], 1)
        self.assertEqual(u_alice["storage"]["accessed_bytes"], 7000)
        self.assertEqual(u_alice["storage"]["accessed_tracks"], 3)
        self.assertEqual(u_alice["storage"]["materialized_bytes"], 5000)
        self.assertEqual(u_alice["storage"]["materialized_tracks"], 2)
        self.assertEqual(u_alice["storage"]["pinned_bytes"], 1000)
        self.assertEqual(u_alice["storage"]["pinned_tracks"], 1)
        self.assertEqual(u_alice["storage"]["upload_bytes"], 768)
        self.assertEqual(u_alice["library"]["likes"], 1)
        self.assertEqual(u_alice["library"]["playlists"], 1)
        self.assertEqual(u_alice["library"]["public_playlists"], 1)
        self.assertEqual(u_alice["library"]["follows"], 1)
        self.assertEqual(u_alice["library"]["import_jobs"], 1)
        self.assertEqual(u_alice["library"]["import_tracks_matched"], 12)
        self.assertEqual(u_alice["online_devices"], 0)
        self.assertFalse(u_alice["is_playing_now"])

        # Bob assertions (live Connect!)
        u_bob = users_by_id[bob.id]
        self.assertEqual(u_bob["online_devices"], 2)
        self.assertTrue(u_bob["is_playing_now"])
        self.assertEqual(u_bob["active_device_name"], "Bob Pixel")
        self.assertEqual(u_bob["active_party_code"], "JAM001")
        self.assertEqual(u_bob["storage"]["exclusive_bytes"], 5000)
        self.assertEqual(u_bob["storage"]["shared_bytes"], 2000)
        self.assertEqual(u_bob["storage"]["materialized_bytes"], 7000)
        self.assertEqual(u_bob["storage"]["pinned_bytes"], 2000)
        self.assertEqual(u_bob["storage"]["upload_bytes"], 128)
        self.assertEqual(u_bob["library"]["party_hosted"], 1)
        self.assertEqual(u_bob["library"]["party_tracks_added"], 1)

        # Idle pending user has zero activity and null last_active_at
        u_idle = users_by_id[idle.id]
        self.assertIsNone(u_idle["last_active_at"])
        self.assertEqual(u_idle["plays"], 0)
        self.assertEqual(u_idle["storage"]["accessed_bytes"], 0)

        # --- Verify 7d and 30d timeframe filtering ---
        res_7d = self.client.get("/api/admin/usage?range=7d", headers=self._auth_headers(admin))
        self.assertEqual(res_7d.status_code, 200)
        d7 = res_7d.json()
        self.assertEqual(d7["overview"]["total_plays"], 1)
        self.assertEqual(d7["overview"]["total_listening_sec"], 180)
        # Alice active (played 2d ago) + Bob active (online right now in Connect!)
        self.assertEqual(d7["overview"]["active_users"], 2)
        self.assertEqual(d7["overview"]["tracks_requested"], 3)  # 1001, 1004, guest 1006

        res_30d = self.client.get("/api/admin/usage?range=30d", headers=self._auth_headers(admin))
        self.assertEqual(res_30d.status_code, 200)
        d30 = res_30d.json()
        self.assertEqual(d30["overview"]["total_plays"], 3)  # 2d, 15d, 20d
        self.assertEqual(d30["overview"]["tracks_requested"], 4)  # excludes 45d evicted 1007

        # --- Verify cross-endpoint consistency & drill-down details ---
        for usage_range, overview_payload in (("all", data), ("30d", d30), ("7d", d7)):
            for overview_user in overview_payload["users"]:
                detail_res = self.client.get(
                    f"/api/admin/usage/users/{overview_user['id']}?range={usage_range}",
                    headers=self._auth_headers(admin),
                )
                self.assertEqual(detail_res.status_code, 200)
                detail = detail_res.json()
                self.assertEqual(detail["user"], overview_user)
                self.assertEqual(detail["storage_breakdown"]["total_cache_bytes"], 21000)
                for key, val in overview_user["storage"].items():
                    self.assertEqual(detail["storage_breakdown"][key], val)

        # Check Alice drill-down details (evicted track flag, sources, top tracks)
        alice_detail = self.client.get(
            f"/api/admin/usage/users/{alice.id}?range=all",
            headers=self._auth_headers(admin),
        ).json()
        sources = {s["source"]: s for s in alice_detail["requests_by_source"]}
        self.assertEqual(set(sources), {"stream", "radar_preload", "playlist_export"})
        self.assertEqual(sources["playlist_export"]["materialized_bytes"], 7000)
        recent_by_id = {r["deezer_id"]: r for r in alice_detail["recent_requests"]}
        self.assertTrue(recent_by_id["1001"]["is_currently_stored"])
        self.assertFalse(recent_by_id["1007"]["is_currently_stored"])
        self.assertEqual(alice_detail["top_tracks"][0]["key"], "1001")
        self.assertEqual(alice_detail["top_tracks"][0]["count"], 2)
        self.assertEqual(len(alice_detail["recent_plays"]), 3)

        # Check Bob drill-down live devices
        bob_detail = self.client.get(
            f"/api/admin/usage/users/{bob.id}?range=all",
            headers=self._auth_headers(admin),
        ).json()
        self.assertEqual(len(bob_detail["active_devices"]), 2)
        active_devs = [d for d in bob_detail["active_devices"] if d["is_active"]]
        self.assertEqual(len(active_devs), 1)
        self.assertEqual(active_devs[0]["name"], "Bob Pixel")

    def test_all_six_materialization_paths_and_stream_range_dedup(self) -> None:
        alice = self._create_user("alice@example.test", display_name="Alice")
        bob = self._create_user("bob@example.test", display_name="Bob")

        def fake_song(_typ: str, deezer_id: str) -> dict:
            return {
                "SNG_ID": deezer_id,
                "SNG_TITLE": f"Track {deezer_id}",
                "ART_NAME": "Tester",
                "ALB_TITLE": "Album",
                "DURATION": "180",
            }

        def fake_download(_song: dict, path: str) -> None:
            Path(path).write_bytes(b"0123456789" * 100)  # 1000 bytes

        with (
            patch.object(storage.deezer, "get_song_infos_from_deezer_website", side_effect=fake_song),
            patch.object(storage.deezer, "download_song", side_effect=fake_download),
        ):
            # 1) Stream: cache miss -> materialized=True; byte-0 hit within 30s -> deduped;
            #    non-zero Range hit -> ignored; Bob byte-0 hit -> materialized=False;
            #    Alice byte-0 hit after >30s -> materialized=False recorded again
            r1 = self.client.get(
                "/api/tracks/2001/stream",
                headers={**self._auth_headers(alice), "Range": "bytes=0-99"},
            )
            self.assertEqual(r1.status_code, 206)
            r2 = self.client.get(
                "/api/tracks/2001/stream",
                headers={**self._auth_headers(alice), "Range": "bytes=0-199"},
            )
            self.assertEqual(r2.status_code, 206)
            r3 = self.client.get(
                "/api/tracks/2001/stream",
                headers={**self._auth_headers(alice), "Range": "bytes=200-399"},
            )
            self.assertEqual(r3.status_code, 206)
            r4 = self.client.get(
                "/api/tracks/2001/stream",
                headers={**self._auth_headers(bob), "Range": "bytes=0-99"},
            )
            self.assertEqual(r4.status_code, 206)
            # Advance clock past the 30s stream dedup window for Alice's second listen
            future_now = datetime.now(timezone.utc) + timedelta(seconds=60)
            with patch.object(storage, "_now", return_value=future_now):
                r5 = self.client.get(
                    "/api/tracks/2001/stream",
                    headers={**self._auth_headers(alice), "Range": "bytes=0-99"},
                )
                self.assertEqual(r5.status_code, 206)

            # 2) Preload endpoint
            r_pre = self.client.post(
                "/api/tracks/2002/preload",
                headers=self._auth_headers(alice),
            )
            self.assertEqual(r_pre.status_code, 204)

            # 3) Playlist export
            archive_path, _filename = playlist_export.build_playlist_archive(
                "Mix",
                [playlist_export.PlaylistExportTrack("2003", "Tester", "Track 2003")],
                requested_by_user_id=bob.id,
            )
            os.remove(archive_path)

            # 4) Party preload (member u:<id> vs guest g:<id>)
            party_preload.reset_for_tests()
            self.addCleanup(party_preload.reset_for_tests)
            with (
                patch.object(party_preload, "_on_track_settled", lambda _did: None),
                patch.object(
                    party_preload._executor,
                    "submit",
                    side_effect=lambda fn, *args: fn(*args),
                ),
            ):
                party_router._preload_upcoming(
                    {
                        "current_index": 0,
                        "tracks": [
                            {"deezer_id": "2004", "added_by_member": f"u:{alice.id}"},
                            {"deezer_id": "2005", "added_by_member": "g:9"},
                        ],
                    }
                )

            # 5) Radar preload
            preloader = radar_preload.RadarPreloader()
            preloader.start()
            try:
                today_iso = datetime.now(timezone.utc).date().isoformat()
                run = preloader.schedule(
                    [{"id": "2006", "release_date": today_iso}],
                    user_id=bob.id,
                )
                self.assertIsNotNone(run)
                run.result(timeout=5)
            finally:
                preloader.stop()

            # 6) Lyrics AI transcription
            with (
                patch.object(groq, "configured", return_value=True),
                patch.object(groq, "transcribe_file", return_value=[{"t": 0.0, "text": "hi"}]),
            ):
                r_lyr = self.client.get(
                    "/api/lyrics?artist=Tester&title=Track+2007&deezer_id=2007&variant=ai",
                    headers=self._auth_headers(alice),
                )
                self.assertEqual(r_lyr.status_code, 200)

        with self.sessions() as db:
            reqs = list(db.scalars(select(TrackRequest).order_by(TrackRequest.id)).all())
            by_key = [(r.user_id, r.deezer_id, r.source, r.materialized) for r in reqs]
            self.assertEqual(
                by_key,
                [
                    (alice.id, "2001", "stream", True),
                    (bob.id, "2001", "stream", False),
                    (alice.id, "2001", "stream", False),
                    (alice.id, "2002", "preload", True),
                    (bob.id, "2003", "playlist_export", True),
                    (alice.id, "2004", "party_preload", True),
                    (None, "2005", "party_preload", True),
                    (bob.id, "2006", "radar_preload", True),
                    (alice.id, "2007", "lyrics_ai", True),
                ],
            )
            self.assertEqual(db.get(StoredTrack, "2001").requested_by_user_id, alice.id)
            self.assertEqual(db.get(StoredTrack, "2002").request_source, "preload")
            self.assertEqual(db.get(StoredTrack, "2003").requested_by_user_id, bob.id)
            self.assertEqual(db.get(StoredTrack, "2004").requested_by_user_id, alice.id)
            self.assertIsNone(db.get(StoredTrack, "2005").requested_by_user_id)
            self.assertEqual(db.get(StoredTrack, "2006").requested_by_user_id, bob.id)
            self.assertEqual(db.get(StoredTrack, "2007").requested_by_user_id, alice.id)

        # Invalid source must fail loud
        with self.assertRaisesRegex(ValueError, "Unsupported track request source"):
            storage.materialize("2001", requested_by_user_id=alice.id, source="bogus")

    def test_upload_scan_permission_error_fails_loud(self) -> None:
        with (
            patch.object(admin_usage.os, "scandir", side_effect=PermissionError("denied")),
            self.assertRaises(PermissionError),
        ):
            admin_usage._scan_numeric_uploads(os.path.join(self.storage_dir, "avatars"))

    def test_missing_timestamps_fail_loud_and_negative_stored_size_stays_consistent(self) -> None:
        alice = self._create_user("alice@example.test", display_name="Alice")
        with self.sessions() as db:
            db.add_all(
                [
                    StoredTrack(
                        deezer_id="3001",
                        file_path=f"{self.storage_dir}/3001.mp3",
                        title="Valid",
                        artist="A",
                        size_bytes=500,
                        status="ready",
                        requested_by_user_id=alice.id,
                    ),
                    StoredTrack(
                        deezer_id="3002",
                        file_path=f"{self.storage_dir}/3002.mp3",
                        title="Legacy Neg",
                        artist="B",
                        size_bytes=-100,
                        status="ready",
                        requested_by_user_id=alice.id,
                    ),
                ]
            )
            db.commit()
            overview = admin_usage.get_usage_overview(db, "all")
            detail = admin_usage.get_user_usage_detail(db, alice, "all")
            self.assertEqual(overview.overview.storage.total_audio_bytes, 500)
            self.assertEqual(detail.storage_breakdown.total_cache_bytes, 500)

        # Missing required timestamp must raise loudly, never fabricate `now`
        with self.assertRaisesRegex(RuntimeError, r"plays\.id=7\.played_at"):
            admin_usage._require_utc(None, "plays.id=7.played_at")
        with self.assertRaisesRegex(RuntimeError, r"track_requests\.id=9\.requested_at"):
            admin_usage._require_utc(None, "track_requests.id=9.requested_at")

    def test_portable_column_migration_adds_stored_track_attribution_columns(self) -> None:
        legacy_engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        self.addCleanup(legacy_engine.dispose)
        with legacy_engine.begin() as conn:
            conn.exec_driver_sql(
                """
                CREATE TABLE stored_tracks (
                    deezer_id VARCHAR(32) PRIMARY KEY,
                    file_path VARCHAR(1000) NOT NULL,
                    title VARCHAR(500) NOT NULL DEFAULT '',
                    artist VARCHAR(500) NOT NULL DEFAULT '',
                    album VARCHAR(500) NOT NULL DEFAULT '',
                    cover_url VARCHAR(500),
                    duration_sec INTEGER NOT NULL DEFAULT 0,
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    status VARCHAR(32) NOT NULL DEFAULT 'ready',
                    created_at DATETIME,
                    last_accessed DATETIME
                )
                """
            )
        with patch.object(main, "engine", legacy_engine):
            main._run_column_migrations()
            # Idempotent second run
            main._run_column_migrations()
        insp = inspect(legacy_engine)
        cols = {c["name"] for c in insp.get_columns("stored_tracks")}
        indexes = {ix["name"] for ix in insp.get_indexes("stored_tracks")}
        self.assertIn("requested_by_user_id", cols)
        self.assertIn("request_source", cols)
        self.assertIn("ix_stored_tracks_requested_by_user_id", indexes)


if __name__ == "__main__":
    unittest.main()
