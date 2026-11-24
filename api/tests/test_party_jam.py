"""Spotify Jam-aligned party features: active lookup, settings, shared controls,
play-next, kick, end Jam terminal SSE frame, stored status & guest cached-tracks.
"""
from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, Response
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session, sessionmaker

from app.auth import create_token
from app.db.models import PartyGuest, PartyMember, PartySession, PartyTrack, User
from app.db.session import Base, get_db
from app.main import _run_column_migrations, app
from app.party_auth import PartyActor, get_party_actor
from app.routers import party
from app.schemas.party import PartyGuestJoin, PartySettingsUpdate
from app.schemas.track import Track
from app.services import party_bus, party_preload


class PartyJamTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.db_path = Path(self.directory.name) / "jam.db"
        self.engine = create_engine(
            f"sqlite:///{self.db_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False
        )
        self.db = self.session_factory()
        self.host = User(
            email="host@example.test",
            password_hash="x",
            display_name="Host User",
            avatar_url="/api/profile/avatars/host.png",
            is_approved=True,
        )
        self.member = User(
            email="member@example.test",
            password_hash="x",
            display_name="Member User",
            avatar_url="/api/profile/avatars/member.png",
            is_approved=True,
        )
        self.outsider = User(
            email="outsider@example.test",
            password_hash="x",
            display_name="Outsider",
            is_approved=True,
        )
        self.db.add_all([self.host, self.member, self.outsider])
        self.db.commit()

        self.ready_ids: set[str] = {"100"}
        self.patches = (
            patch.object(party.party_preload, "schedule"),
            patch.object(
                party_preload.storage,
                "is_ready",
                side_effect=lambda did: did in self.ready_ids,
            ),
            patch.object(
                party.storage,
                "cached_ids",
                side_effect=lambda: sorted(self.ready_ids),
            ),
        )
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.directory.cleanup()

    def _create_jam(self, *, guests_can_control: bool = False):
        body = party.PartyCreate(
            name="Friday Jam",
            tracks=[
                Track(id="100", title="First", artist="A", artist_id="1"),
                Track(id="200", title="Second", artist="B", artist_id="2"),
            ],
            current_index=0,
            is_playing=True,
            position_sec=12.0,
            guests_can_control=guests_can_control,
        )
        return party.create_party(body, self.host, self.db)

    def _join_guest(self, code: str, nickname: str) -> tuple[PartyActor, str]:
        resp = Response()
        party.join_as_guest(code, PartyGuestJoin(nickname=nickname), resp, self.db)
        header = resp.headers["set-cookie"]
        token = header.split(";", 1)[0].split("=", 1)[1]
        return get_party_actor(code, None, token, self.db), token

    def test_stored_status_member_keys_and_contributor_avatars(self) -> None:
        state = self._create_jam()
        self.assertEqual(state.name, "Friday Jam")
        self.assertFalse(state.guests_can_control)
        self.assertEqual(state.playback_changed_by, f"u:{self.host.id}")
        self.assertEqual(state.playback_revision, 1)
        self.assertFalse(state.ended)
        self.assertTrue(state.server_time)

        # Stored flag matches authoritative storage.is_ready (100 ready, 200 not)
        self.assertTrue(state.tracks[0].is_stored)
        self.assertEqual(state.tracks[0].load_state, "ready")
        self.assertFalse(state.tracks[1].is_stored)
        self.assertEqual(state.tracks[1].load_state, "idle")
        self.assertEqual(state.tracks[0].added_by_avatar_url, "/api/profile/avatars/host.png")

        # Member joins and adds a track; guest joins and adds a track
        party.join_party(state.code, self.member, self.db)
        party.add_track(
            state.code,
            Track(id="300", title="Third"),
            PartyActor(user=self.member),
            self.db,
        )
        guest_actor, _ = self._join_guest(state.code, "Mia")
        party.add_track(
            state.code,
            Track(id="400", title="Fourth"),
            guest_actor,
            self.db,
        )
        refreshed = party.get_party(state.code, PartyActor(user=self.host), self.db)
        by_key = {m.key: m for m in refreshed.members}
        self.assertTrue(by_key[f"u:{self.host.id}"].is_host)
        self.assertFalse(by_key[f"u:{self.member.id}"].is_host)
        self.assertEqual(by_key[f"u:{self.member.id}"].avatar_url, "/api/profile/avatars/member.png")
        self.assertTrue(by_key[guest_actor.key].is_guest)
        self.assertFalse(by_key[guest_actor.key].is_host)

        self.assertEqual(refreshed.tracks[2].added_by_avatar_url, "/api/profile/avatars/member.png")
        self.assertIsNone(refreshed.tracks[3].added_by_avatar_url)

        # Transitioning track 200 to stored reflects immediately on next read
        self.ready_ids.add("200")
        updated = party.get_party(state.code, guest_actor, self.db)
        self.assertTrue(updated.tracks[1].is_stored)
        self.assertEqual(updated.tracks[1].load_state, "ready")

    def test_party_cached_tracks_works_for_members_and_guests_and_rejects_unauth(self) -> None:
        state = self._create_jam()
        guest_actor, guest_token = self._join_guest(state.code, "Mia")

        result_member = party.party_cached_tracks(
            state.code, PartyActor(user=self.host), self.db
        )
        result_guest = party.party_cached_tracks(state.code, guest_actor, self.db)
        self.assertEqual(result_member.ids, ["100"])
        self.assertEqual(result_guest.ids, ["100"])

        with self.assertRaises(HTTPException) as missing:
            party.party_cached_tracks("NOPE99", PartyActor(user=self.host), self.db)
        self.assertEqual(missing.exception.status_code, 404)

        # End-to-end HTTP check including route ordering with /active
        def override_db():
            s = self.session_factory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        try:
            client = TestClient(app)
            unauth = client.get(f"/api/party/{state.code}/cached-tracks")
            self.assertEqual(unauth.status_code, 401)

            client.cookies.set("sf_party_guest", guest_token, path=f"/api/party/{state.code}")
            guest_resp = client.get(f"/api/party/{state.code}/cached-tracks")
            self.assertEqual(guest_resp.status_code, 200)
            self.assertEqual(guest_resp.json(), {"ids": ["100"]})
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_active_party_lookup_and_route_precedence(self) -> None:
        self.assertIsNone(party.get_active_party(self.host, self.db))
        state = self._create_jam()
        active_host = party.get_active_party(self.host, self.db)
        self.assertIsNotNone(active_host)
        self.assertEqual(active_host.code, state.code)
        self.assertTrue(active_host.is_host)

        self.assertIsNone(party.get_active_party(self.member, self.db))
        party.join_party(state.code, self.member, self.db)
        active_member = party.get_active_party(self.member, self.db)
        self.assertIsNotNone(active_member)
        self.assertEqual(active_member.code, state.code)
        self.assertFalse(active_member.is_host)

        # Leaving clears active party for member
        party.leave_party(state.code, PartyActor(user=self.member), self.db)
        self.assertIsNone(party.get_active_party(self.member, self.db))

        # HTTP check confirms GET /api/party/active is NOT swallowed by /{code}
        def override_db():
            s = self.session_factory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        try:
            client = TestClient(app)
            client.cookies.set("sf_session", create_token(self.host.id))
            resp = client.get("/api/party/active")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["code"], state.code)

            client.cookies.set("sf_session", create_token(self.outsider.id))
            resp_none = client.get("/api/party/active")
            self.assertEqual(resp_none.status_code, 200)
            self.assertIsNone(resp_none.json())
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_settings_and_shared_guest_control_permissions(self) -> None:
        state = self._create_jam(guests_can_control=False)
        party.join_party(state.code, self.member, self.db)
        guest_actor, _ = self._join_guest(state.code, "Mia")
        member_actor = PartyActor(user=self.member)

        # Non-host cannot update settings
        with self.assertRaises(HTTPException) as denied:
            party.update_party_settings(
                state.code, PartySettingsUpdate(name="Hack"), self.member, self.db
            )
        self.assertEqual(denied.exception.status_code, 403)

        # Empty settings update fails loudly with 422
        with self.assertRaises(HTTPException) as empty:
            party.update_party_settings(state.code, PartySettingsUpdate(), self.host, self.db)
        self.assertEqual(empty.exception.status_code, 422)

        # Host enables guests_can_control and renames Jam
        updated = party.update_party_settings(
            state.code,
            PartySettingsUpdate(name="  Saturday Jam  ", guests_can_control=True),
            self.host,
            self.db,
        )
        self.assertEqual(updated.name, "Saturday Jam")
        self.assertTrue(updated.guests_can_control)

        # Now member & guest can control playback, jump tracks, reorder, and remove upcoming
        party.set_playback(
            state.code,
            party.PlaybackUpdate(is_playing=False, position_sec=25.0),
            guest_actor,
            self.db,
        )
        after_pb = party.get_party(state.code, PartyActor(user=self.host), self.db)
        self.assertFalse(after_pb.is_playing)
        self.assertEqual(after_pb.position_sec, 25.0)
        self.assertEqual(after_pb.playback_changed_by, guest_actor.key)
        self.assertEqual(after_pb.playback_revision, 2)

        party.set_current(state.code, party.CurrentUpdate(index=1), member_actor, self.db)
        after_cur = party.get_party(state.code, PartyActor(user=self.host), self.db)
        self.assertEqual(after_cur.current_index, 1)
        self.assertEqual(after_cur.playback_changed_by, member_actor.key)
        self.assertEqual(after_cur.playback_revision, 3)

        ids = [t.id for t in after_cur.tracks]
        party.reorder_tracks(
            state.code, party.OrderUpdate(ids=list(reversed(ids))), guest_actor, self.db
        )
        after_reorder = party.get_party(state.code, PartyActor(user=self.host), self.db)
        self.assertEqual([t.id for t in after_reorder.tracks], list(reversed(ids)))
        self.assertEqual(after_reorder.current_index, 0)

        # Non-host still cannot remove currently playing track even with guests_can_control=True
        current_item_id = after_reorder.tracks[0].id
        upcoming_item_id = after_reorder.tracks[1].id
        with self.assertRaises(HTTPException) as curr_err:
            party.remove_track(state.code, current_item_id, member_actor, self.db)
        self.assertEqual(curr_err.exception.status_code, 403)

        # But non-host CAN remove host's upcoming non-playing track when guests_can_control=True
        party.remove_track(state.code, upcoming_item_id, member_actor, self.db)
        after_remove = party.get_party(state.code, PartyActor(user=self.host), self.db)
        self.assertEqual([t.id for t in after_remove.tracks], [current_item_id])

    def test_insert_next_places_track_right_after_current(self) -> None:
        state = self._create_jam()
        host_actor = PartyActor(user=self.host)
        party.add_track(state.code, Track(id="300", title="Third"), host_actor, self.db)
        # Queue is [100 (current=0), 200, 300]
        party.add_track(
            state.code, Track(id="999", title="Play Next"), host_actor, self.db, insert="next"
        )
        after = party.get_party(state.code, host_actor, self.db)
        self.assertEqual([t.deezer_id for t in after.tracks], ["100", "999", "200", "300"])
        self.assertEqual(after.current_index, 0)

        # When nothing is selected (current_index == -1), insert=next places at front
        party.set_current(state.code, party.CurrentUpdate(index=-1), host_actor, self.db)
        party.add_track(
            state.code, Track(id="888", title="Front"), host_actor, self.db, insert="next"
        )
        after_front = party.get_party(state.code, host_actor, self.db)
        self.assertEqual(
            [t.deezer_id for t in after_front.tracks], ["888", "100", "999", "200", "300"]
        )
        self.assertEqual(after_front.current_index, -1)

    def test_kick_member_and_guest_and_reject_kicking_host(self) -> None:
        state = self._create_jam()
        party.join_party(state.code, self.member, self.db)
        guest_actor, guest_token = self._join_guest(state.code, "Mia")

        # Non-host cannot kick
        with self.assertRaises(HTTPException) as non_host:
            party.kick_member(state.code, guest_actor.key, self.member, self.db)
        self.assertEqual(non_host.exception.status_code, 403)

        # Host cannot kick self
        with self.assertRaises(HTTPException) as self_kick:
            party.kick_member(state.code, f"u:{self.host.id}", self.host, self.db)
        self.assertEqual(self_kick.exception.status_code, 400)

        # Invalid key format fails with 422
        with self.assertRaises(HTTPException) as bad_key:
            party.kick_member(state.code, "bad-key", self.host, self.db)
        self.assertEqual(bad_key.exception.status_code, 422)

        # Kick guest revokes their token immediately
        resp_g = party.kick_member(state.code, guest_actor.key, self.host, self.db)
        self.assertEqual(resp_g.status_code, 204)
        with self.assertRaises(HTTPException) as revoked:
            get_party_actor(state.code, None, guest_token, self.db)
        self.assertEqual(revoked.exception.status_code, 401)

        # Kick member removes membership
        resp_m = party.kick_member(state.code, f"u:{self.member.id}", self.host, self.db)
        self.assertEqual(resp_m.status_code, 204)
        self.assertIsNone(party.get_active_party(self.member, self.db))

        # Kicking already-absent member returns 404
        with self.assertRaises(HTTPException) as missing:
            party.kick_member(state.code, f"u:{self.member.id}", self.host, self.db)
        self.assertEqual(missing.exception.status_code, 404)

    def test_end_party_deletes_session_and_broadcasts_terminal_sse_frame(self) -> None:
        state = self._create_jam()
        party.join_party(state.code, self.member, self.db)

        # Non-host cannot end party
        with self.assertRaises(HTTPException) as denied:
            party.end_party(state.code, self.member, self.db)
        self.assertEqual(denied.exception.status_code, 403)

        async def run_stream_and_end() -> list[dict]:
            with patch.object(party, "SessionLocal", self.session_factory):
                response = await party.party_events(state.code, PartyActor(user=self.member))
                received: list[dict] = []
                first = json.loads(
                    (await anext(response.body_iterator)).removeprefix("data: ").strip()
                )
                received.append(first)
                self.assertFalse(first["ended"])

                # Host ends Jam; SSE stream must yield ended=True frame then terminate
                end_resp = party.end_party(state.code, self.host, self.db)
                self.assertEqual(end_resp.status_code, 204)

                async for chunk in response.body_iterator:
                    if chunk.startswith("data: "):
                        received.append(json.loads(chunk.removeprefix("data: ").strip()))
                return received

        frames = asyncio.run(run_stream_and_end())
        self.assertEqual(len(frames), 2)
        self.assertTrue(frames[1]["ended"])
        self.assertFalse(frames[1]["is_playing"])
        self.assertEqual(party_bus.subscriber_count(state.code), 0)

        # DB session and cascading children are gone
        self.assertIsNone(self.db.get(PartySession, state.code))
        self.assertEqual(self.db.scalars(select(PartyTrack)).all(), [])
        self.assertEqual(self.db.scalars(select(PartyMember)).all(), [])
        self.assertEqual(self.db.scalars(select(PartyGuest)).all(), [])

    def test_portable_column_migrations_add_new_party_columns_to_legacy_db(self) -> None:
        legacy_path = Path(self.directory.name) / "legacy.db"
        legacy_engine = create_engine(f"sqlite:///{legacy_path}")
        try:
            with legacy_engine.begin() as conn:
                conn.exec_driver_sql(
                    """
                    CREATE TABLE party_sessions (
                        code VARCHAR(12) PRIMARY KEY,
                        name VARCHAR(200) NOT NULL DEFAULT '',
                        host_id INTEGER NOT NULL,
                        current_index INTEGER NOT NULL DEFAULT -1,
                        is_playing BOOLEAN NOT NULL DEFAULT 0,
                        position_sec FLOAT NOT NULL DEFAULT 0,
                        playback_updated_at DATETIME,
                        created_at DATETIME,
                        updated_at DATETIME
                    )
                    """
                )
            with patch("app.main.engine", legacy_engine):
                _run_column_migrations()
                # Running twice must be idempotent
                _run_column_migrations()
            cols = {c["name"] for c in inspect(legacy_engine).get_columns("party_sessions")}
            self.assertTrue(
                {"guests_can_control", "playback_changed_by", "playback_revision"} <= cols
            )
        finally:
            legacy_engine.dispose()


if __name__ == "__main__":
    unittest.main()
