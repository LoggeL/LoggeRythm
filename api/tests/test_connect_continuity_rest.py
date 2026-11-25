"""Tests for Connect async continuity (UserPlaybackState) and stateless REST control."""
from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import create_token
from app.db.models import User, UserPlaybackState
from app.db.session import Base, get_db
from app.main import app
from app.routers import connect as connect_router
from app.routers import profile as profile_router
from app.services import connect_hub


def _track(tid: str, title: str = "Song") -> dict:
    return {
        "id": tid,
        "title": f"{title} {tid}",
        "artist": "Artist",
        "artist_id": "1",
        "artists": [{"id": "1", "name": "Artist"}],
        "album": "Album",
        "album_id": "10",
        "cover": f"https://img.example/{tid}.jpg",
        "duration_sec": 200,
    }


class ConnectContinuityAndRestTests(unittest.TestCase):
    def setUp(self) -> None:
        connect_hub.hub.reset_for_tests()
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{Path(self.tmp.name) / 'connect_rest.db'}",
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
            db.add(self.alice)
            db.commit()
            db.refresh(self.alice)

        def override_db():
            s = self.SessionFactory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        self.session_patch = patch.object(connect_router, "SessionLocal", self.SessionFactory)
        self.preload_patch = patch.object(connect_hub.storage, "schedule_preload")
        self.session_patch.start()
        self.mock_preload = self.preload_patch.start()
        self.client = TestClient(app)
        self.headers = {"Cookie": f"sf_session={create_token(self.alice.id)}"}

    def tearDown(self) -> None:
        self.client.close()
        self.preload_patch.stop()
        self.session_patch.stop()
        app.dependency_overrides.pop(get_db, None)
        connect_hub.hub.reset_for_tests()
        self.engine.dispose()
        self.tmp.cleanup()

    def test_async_continuity_persists_across_disconnect_and_hydrates_next_device(self) -> None:
        t1 = _track("101")
        t2 = _track("202")
        with self.client.websocket_connect("/api/connect/ws", headers=self.headers) as ws_web:
            ws_web.send_json(
                {
                    "type": "register",
                    "device_id": "web-1",
                    "name": "Chrome Desktop",
                    "device_type": "web",
                    "take_active": True,
                    "playback": {
                        "queue": [t1, t2],
                        "origins": ["context", "manual"],
                        "queue_context": "Playlist Mix",
                        "current_index": 0,
                        "is_playing": True,
                        "position_sec": 42.5,
                        "duration_sec": 200.0,
                        "shuffle": True,
                        "repeat": "all",
                    },
                }
            )
            welcome = ws_web.receive_json()
            self.assertEqual(welcome["type"], "welcome")

        # All devices are now offline: GET /api/connect/state returns persisted resumable state
        state_resp = self.client.get("/api/connect/state", headers=self.headers)
        self.assertEqual(state_resp.status_code, 200)
        state = state_resp.json()
        self.assertEqual(state["devices"], [])
        self.assertIsNone(state["active_device_id"])
        pb = state["playback"]
        self.assertFalse(pb["is_playing"])
        self.assertEqual([t["id"] for t in pb["queue"]], ["101", "202"])
        self.assertEqual(pb["origins"], ["context", "manual"])
        self.assertEqual(pb["queue_context"], "Playlist Mix")
        self.assertEqual(pb["current_index"], 0)
        self.assertGreaterEqual(pb["position_sec"], 42.5)
        self.assertTrue(pb["shuffle"])
        self.assertEqual(pb["repeat"], "all")

        # A brand-new mobile device connects later with no local queue -> hydrated from DB!
        with self.client.websocket_connect("/api/connect/ws", headers=self.headers) as ws_phone:
            ws_phone.send_json(
                {
                    "type": "register",
                    "device_id": "phone-1",
                    "name": "Pixel 9",
                    "device_type": "mobile",
                }
            )
            welcome_phone = ws_phone.receive_json()
            self.assertEqual(welcome_phone["type"], "welcome")
            hydrated = welcome_phone["state"]["playback"]
            self.assertEqual([t["id"] for t in hydrated["queue"]], ["101", "202"])
            self.assertEqual(hydrated["current_index"], 0)
            self.assertFalse(hydrated["is_playing"])
            self.assertGreaterEqual(hydrated["position_sec"], 42.5)

        # Purging user deletes persisted playback state AND evicts any live Connect room/hosted party
        with self.client.websocket_connect("/api/connect/ws", headers=self.headers) as ws_live:
            ws_live.send_json(
                {
                    "type": "register",
                    "device_id": "web-live",
                    "name": "Chrome",
                    "device_type": "web",
                    "take_active": True,
                    "playback": {
                        "queue": [t1],
                        "current_index": 0,
                        "is_playing": True,
                        "position_sec": 10.0,
                        "duration_sec": 200.0,
                    },
                }
            )
            ws_live.receive_json()
            self.assertIn(self.alice.id, connect_hub.hub.snapshot_all())

            with self.SessionFactory() as db:
                alice_row = db.get(User, self.alice.id)
                self.assertIsNotNone(db.get(UserPlaybackState, self.alice.id))
                profile_router.purge_user_account(db, alice_row)
                self.assertIsNone(db.get(UserPlaybackState, self.alice.id))

            self.assertNotIn(self.alice.id, connect_hub.hub.snapshot_all())

        # Disconnecting the evicted socket must NOT recreate an orphaned UserPlaybackState row
        with self.SessionFactory() as db:
            self.assertIsNone(db.get(UserPlaybackState, self.alice.id))

    def test_rest_command_dispatch_ack_errors_and_timeout(self) -> None:
        # No connected device -> 409
        no_dev = self.client.post(
            "/api/connect/command",
            json={"action": "play", "payload": {}},
            headers=self.headers,
        )
        self.assertEqual(no_dev.status_code, 409)

        with self.client.websocket_connect("/api/connect/ws", headers=self.headers) as ws_web:
            ws_web.send_json(
                {
                    "type": "register",
                    "device_id": "web-1",
                    "name": "Chrome",
                    "device_type": "web",
                    "capabilities": {"can_play_audio": True, "can_control_volume": False},
                    "take_active": True,
                }
            )
            ws_web.receive_json()

            # Unsupported capability rejected before dispatching
            vol_err = self.client.post(
                "/api/connect/command",
                json={"action": "set_volume", "payload": {"volume": 0.5}},
                headers=self.headers,
            )
            self.assertEqual(vol_err.status_code, 400)

            # Unknown explicit target -> 404
            missing = self.client.post(
                "/api/connect/command",
                json={"action": "pause", "payload": {}, "target_device_id": "nope"},
                headers=self.headers,
            )
            self.assertEqual(missing.status_code, 404)

            # Successful REST command + WS ack round-trip
            rest_result: dict = {}

            def call_rest() -> None:
                resp = self.client.post(
                    "/api/connect/command",
                    json={"action": "next", "payload": {}, "timeout_sec": 3.0},
                    headers=self.headers,
                )
                rest_result["status"] = resp.status_code
                rest_result["body"] = resp.json()

            thread = threading.Thread(target=call_rest)
            thread.start()
            cmd_frame = ws_web.receive_json()
            self.assertEqual(cmd_frame["type"], "command")
            self.assertEqual(cmd_frame["action"], "next")
            self.assertEqual(cmd_frame["from_device_id"], "rest-api")
            ws_web.send_json(
                {"type": "command_ack", "command_id": cmd_frame["command_id"], "ok": True}
            )
            thread.join(timeout=3)
            self.assertFalse(thread.is_alive())
            self.assertEqual(rest_result["status"], 200)
            self.assertTrue(rest_result["body"]["ok"])
            self.assertEqual(rest_result["body"]["target_device_id"], "web-1")

            # Unacknowledged command times out loudly with 504
            timeout_resp = self.client.post(
                "/api/connect/command",
                json={"action": "pause", "payload": {}, "timeout_sec": 0.5},
                headers=self.headers,
            )
            self.assertEqual(timeout_resp.status_code, 504)
            ws_web.receive_json()  # drain timed-out forwarded command

    def test_rest_transfer_swaps_active_device_and_preloads_current_plus_next(self) -> None:
        t1 = _track("301")
        t2 = _track("302")
        t3 = _track("303")
        with (
            self.client.websocket_connect("/api/connect/ws", headers=self.headers) as ws_web,
            self.client.websocket_connect("/api/connect/ws", headers=self.headers) as ws_phone,
        ):
            ws_web.send_json(
                {
                    "type": "register",
                    "device_id": "web-1",
                    "name": "Chrome",
                    "device_type": "web",
                    "take_active": True,
                    "playback": {
                        "queue": [t1, t2, t3],
                        "current_index": 0,
                        "is_playing": True,
                        "position_sec": 15.0,
                        "duration_sec": 200.0,
                    },
                }
            )
            ws_web.receive_json()
            ws_phone.send_json(
                {
                    "type": "register",
                    "device_id": "phone-1",
                    "name": "Pixel",
                    "device_type": "mobile",
                }
            )
            ws_phone.receive_json()
            ws_web.receive_json()  # phone joined state

            resp = self.client.post(
                "/api/connect/transfer",
                json={"target_device_id": "phone-1", "play": True},
                headers=self.headers,
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body["active_device_id"], "phone-1")
            self.assertTrue(body["playback"]["is_playing"])

            # Verify handoff frames delivered to both devices
            self.assertEqual(ws_phone.receive_json()["type"], "activate")
            self.assertEqual(ws_web.receive_json()["type"], "deactivated")

            # Verify server preloaded current + next tracks (301 and 302, not 303)
            self.mock_preload.assert_called_once_with(
                ["301", "302"], user_id=self.alice.id, source="preload"
            )


if __name__ == "__main__":
    unittest.main()
