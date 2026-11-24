"""Personal multi-device Connect mode: WebSocket auth, presence, active device,
transfer playback, remote commands, capability enforcement, heartbeat & cleanup.
"""
from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.auth import create_token
from app.db.models import User
from app.db.session import Base, get_db
from app.main import app
from app.routers import connect as connect_router
from app.services import connect_hub


def _sample_track(track_id: str = "101", title: str = "Track One") -> dict:
    return {
        "id": track_id,
        "title": title,
        "artist": "Artist A",
        "artist_id": "10",
        "artists": [{"id": "10", "name": "Artist A"}],
        "album": "Album A",
        "album_id": "20",
        "cover": "https://cdn.example/cover.jpg",
        "duration_sec": 210,
        "preview_url": None,
        "rank": 500000,
        "release_date": "2026-01-15",
    }


def _register_payload(
    device_id: str,
    name: str,
    device_type: str = "web",
    *,
    can_play_audio: bool = True,
    can_control_volume: bool = True,
    volume: float = 0.8,
    muted: bool = False,
    party_code: str | None = None,
    take_active: bool = False,
    playback: dict | None = None,
) -> dict:
    payload: dict = {
        "type": "register",
        "device_id": device_id,
        "name": name,
        "device_type": device_type,
        "capabilities": {
            "can_play_audio": can_play_audio,
            "can_control_volume": can_control_volume,
        },
        "volume": volume,
        "muted": muted,
        "party_code": party_code,
        "take_active": take_active,
    }
    if playback is not None:
        payload["playback"] = playback
    return payload


class ConnectModeTests(unittest.TestCase):
    def setUp(self) -> None:
        connect_hub.hub.reset_for_tests()
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{Path(self.directory.name) / 'connect.db'}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False
        )
        with self.session_factory() as db:
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
            self.pending = User(
                email="pending@example.test",
                password_hash="x",
                display_name="Pending",
                is_approved=False,
            )
            db.add_all([self.alice, self.bob, self.pending])
            db.commit()
            db.refresh(self.alice)
            db.refresh(self.bob)
            db.refresh(self.pending)

        def override_db():
            s = self.session_factory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        self.session_patch = patch.object(connect_router, "SessionLocal", self.session_factory)
        self.session_patch.start()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        self.session_patch.stop()
        app.dependency_overrides.pop(get_db, None)
        connect_hub.hub.reset_for_tests()
        self.engine.dispose()
        self.directory.cleanup()

    def _cookie_header(self, user_id: int) -> dict[str, str]:
        return {"Cookie": f"sf_session={create_token(user_id)}"}

    # --- Auth & REST helpers ----------------------------------------------

    def test_rest_endpoints_require_approved_user(self) -> None:
        self.assertEqual(self.client.get("/api/connect/state").status_code, 401)
        self.assertEqual(self.client.post("/api/connect/ticket").status_code, 401)

        pending_headers = self._cookie_header(self.pending.id)
        self.assertEqual(
            self.client.get("/api/connect/state", headers=pending_headers).status_code, 403
        )
        self.assertEqual(
            self.client.post("/api/connect/ticket", headers=pending_headers).status_code, 403
        )

        alice_headers = self._cookie_header(self.alice.id)
        state = self.client.get("/api/connect/state", headers=alice_headers)
        self.assertEqual(state.status_code, 200)
        body = state.json()
        self.assertEqual(body["revision"], 0)
        self.assertIsNone(body["active_device_id"])
        self.assertEqual(body["devices"], [])
        self.assertTrue(body["server_time"])

        ticket = self.client.post("/api/connect/ticket", headers=alice_headers)
        self.assertEqual(ticket.status_code, 200)
        self.assertTrue(ticket.json()["ticket"])
        self.assertEqual(ticket.json()["expires_in_sec"], connect_hub.TICKET_TTL_SEC)

    def test_ws_rejects_unauthenticated_and_pending_accounts_with_explicit_codes(self) -> None:
        with self.client.websocket_connect("/api/connect/ws") as ws:
            with self.assertRaises(WebSocketDisconnect) as exc:
                ws.receive_text()
            self.assertEqual(exc.exception.code, 4401)

        with self.client.websocket_connect(
            "/api/connect/ws", headers=self._cookie_header(self.pending.id)
        ) as ws:
            with self.assertRaises(WebSocketDisconnect) as exc:
                ws.receive_text()
            self.assertEqual(exc.exception.code, 4403)

        # Invalid ticket closes with 4401
        with self.client.websocket_connect("/api/connect/ws?ticket=bogus") as ws:
            with self.assertRaises(WebSocketDisconnect) as exc:
                ws.receive_text()
            self.assertEqual(exc.exception.code, 4401)

    def test_ws_ticket_authenticates_once_and_cannot_be_reused(self) -> None:
        resp = self.client.post(
            "/api/connect/ticket", headers=self._cookie_header(self.alice.id)
        )
        ticket = resp.json()["ticket"]

        with self.client.websocket_connect(f"/api/connect/ws?ticket={ticket}") as ws:
            ws.send_json(_register_payload("phone-1", "Pixel 9", "mobile", can_control_volume=False))
            welcome = ws.receive_json()
            self.assertEqual(welcome["type"], "welcome")
            self.assertEqual(welcome["self_device_id"], "phone-1")
            self.assertEqual(welcome["heartbeat_interval_sec"], 20)

        # Reusing the same single-use ticket fails loudly with 4401
        with self.client.websocket_connect(f"/api/connect/ws?ticket={ticket}") as ws2:
            with self.assertRaises(WebSocketDisconnect) as exc:
                ws2.receive_text()
            self.assertEqual(exc.exception.code, 4401)

    def test_registration_timeout_and_malformed_register_fail_loudly(self) -> None:
        connect_hub.hub.registration_timeout_sec = 0.05
        with self.client.websocket_connect(
            "/api/connect/ws", headers=self._cookie_header(self.alice.id)
        ) as ws:
            with self.assertRaises(WebSocketDisconnect) as exc:
                ws.receive_text()
            self.assertEqual(exc.exception.code, 4408)

        connect_hub.hub.registration_timeout_sec = 10
        with self.client.websocket_connect(
            "/api/connect/ws", headers=self._cookie_header(self.alice.id)
        ) as ws:
            ws.send_json({"type": "ping"})
            err = ws.receive_json()
            self.assertEqual(err["type"], "error")
            self.assertEqual(err["code"], "invalid_registration")
            with self.assertRaises(WebSocketDisconnect) as exc:
                ws.receive_text()
            self.assertEqual(exc.exception.code, 4400)

        # take_active on a non-audio-capable device fails loudly
        with self.client.websocket_connect(
            "/api/connect/ws", headers=self._cookie_header(self.alice.id)
        ) as ws:
            ws.send_json(
                _register_payload(
                    "remote-1",
                    "Remote Only",
                    "other",
                    can_play_audio=False,
                    take_active=True,
                )
            )
            err = ws.receive_json()
            self.assertEqual(err["type"], "error")
            self.assertEqual(err["code"], "invalid_registration")
            with self.assertRaises(WebSocketDisconnect) as exc:
                ws.receive_text()
            self.assertEqual(exc.exception.code, 4400)

    # --- Multi-device presence, active device, transfer, commands ---------

    def test_multi_device_presence_playback_claim_transfer_and_disconnect(self) -> None:
        headers = self._cookie_header(self.alice.id)
        track1 = _sample_track("101", "Song One")
        track2 = _sample_track("202", "Song Two")

        with self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_web:
            ws_web.send_json(
                _register_payload(
                    "web-1",
                    "Chrome MacBook",
                    "web",
                    volume=0.75,
                    playback={
                        "queue": [track1, track2],
                        "origins": ["context", "manual"],
                        "queue_context": "Daily Mix",
                        "current_index": 0,
                        "is_playing": True,
                        "position_sec": 30.0,
                        "duration_sec": 210.0,
                        "shuffle": False,
                        "repeat": "all",
                    },
                )
            )
            welcome_web = ws_web.receive_json()
            self.assertEqual(welcome_web["type"], "welcome")
            self.assertEqual(welcome_web["state"]["active_device_id"], "web-1")
            self.assertEqual(welcome_web["state"]["playback"]["origins"], ["context", "manual"])
            # Strict Track shape preserved
            self.assertEqual(welcome_web["state"]["playback"]["queue"][0]["id"], "101")
            self.assertEqual(welcome_web["state"]["playback"]["queue"][0]["rank"], 500000)

            with self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_phone:
                ws_phone.send_json(
                    _register_payload(
                        "phone-1",
                        "Pixel 9",
                        "mobile",
                        can_control_volume=False,
                        volume=1.0,
                    )
                )
                welcome_phone = ws_phone.receive_json()
                self.assertEqual(welcome_phone["type"], "welcome")
                self.assertEqual(welcome_phone["state"]["active_device_id"], "web-1")
                self.assertEqual(len(welcome_phone["state"]["devices"]), 2)

                # Web receives state broadcast announcing Pixel 9
                state_for_web = ws_web.receive_json()
                self.assertEqual(state_for_web["type"], "state")
                self.assertEqual(len(state_for_web["state"]["devices"]), 2)

                # Non-active device sending playback_state without claim_active fails loudly
                ws_phone.send_json(
                    {
                        "type": "playback_state",
                        "claim_active": False,
                        "state": {
                            "queue": [track1],
                            "current_index": 0,
                            "is_playing": True,
                            "position_sec": 5.0,
                            "duration_sec": 210.0,
                        },
                    }
                )
                not_active_err = ws_phone.receive_json()
                self.assertEqual(not_active_err["type"], "error")
                self.assertEqual(not_active_err["code"], "not_active_device")

                # Transfer playback from web-1 to phone-1
                time.sleep(0.05)
                ws_phone.send_json(
                    {
                        "type": "transfer",
                        "target_device_id": "phone-1",
                        "play": True,
                        "request_id": "tx-1",
                    }
                )
                deactivated = ws_web.receive_json()
                self.assertEqual(deactivated["type"], "deactivated")
                self.assertEqual(deactivated["new_active_device_id"], "phone-1")
                self.assertEqual(deactivated["reason"], "transferred")

                activated = ws_phone.receive_json()
                self.assertEqual(activated["type"], "activate")
                self.assertEqual(activated["from_device_id"], "web-1")
                self.assertTrue(activated["playback"]["is_playing"])
                self.assertGreaterEqual(activated["playback"]["position_sec"], 30.0)
                self.assertEqual(activated["playback"]["queue"][0]["id"], "101")

                state_web_after_tx = ws_web.receive_json()
                state_phone_after_tx = ws_phone.receive_json()
                self.assertEqual(state_web_after_tx["state"]["active_device_id"], "phone-1")
                self.assertEqual(state_phone_after_tx["state"]["active_device_id"], "phone-1")

                # REST GET /api/connect/state reflects the exact live room state
                rest_state = self.client.get("/api/connect/state", headers=headers).json()
                self.assertEqual(rest_state["active_device_id"], "phone-1")
                self.assertEqual(len(rest_state["devices"]), 2)

                # Web claims active back via playback_state(claim_active=True)
                ws_web.send_json(
                    {
                        "type": "playback_state",
                        "claim_active": True,
                        "state": {
                            "queue": [track2],
                            "current_index": 0,
                            "is_playing": True,
                            "position_sec": 0.0,
                            "duration_sec": 210.0,
                        },
                    }
                )
                phone_deactivated = ws_phone.receive_json()
                self.assertEqual(phone_deactivated["type"], "deactivated")
                self.assertEqual(phone_deactivated["reason"], "claimed_by_other_device")
                self.assertEqual(ws_web.receive_json()["state"]["active_device_id"], "web-1")
                self.assertEqual(ws_phone.receive_json()["state"]["active_device_id"], "web-1")

            # Phone disconnected -> web receives state with 1 device, web still active
            after_phone_left = ws_web.receive_json()
            self.assertEqual(after_phone_left["type"], "state")
            self.assertEqual([d["device_id"] for d in after_phone_left["state"]["devices"]], ["web-1"])
            self.assertEqual(after_phone_left["state"]["active_device_id"], "web-1")

        # Last device disconnected -> room cleaned up completely
        empty_state = self.client.get("/api/connect/state", headers=headers).json()
        self.assertEqual(empty_state["devices"], [])
        self.assertIsNone(empty_state["active_device_id"])

    def test_active_device_disconnect_pauses_and_preserves_queue(self) -> None:
        headers = self._cookie_header(self.alice.id)
        track1 = _sample_track("101")

        with self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_phone:
            ws_phone.send_json(_register_payload("phone-1", "Pixel 9", "mobile"))
            ws_phone.receive_json()  # welcome

            with self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_web:
                ws_web.send_json(
                    _register_payload(
                        "web-1",
                        "Chrome",
                        "web",
                        playback={
                            "queue": [track1],
                            "current_index": 0,
                            "is_playing": True,
                            "position_sec": 50.0,
                            "duration_sec": 210.0,
                        },
                    )
                )
                ws_web.receive_json()  # welcome
                state_joined = ws_phone.receive_json()
                self.assertEqual(state_joined["state"]["active_device_id"], "web-1")
                self.assertTrue(state_joined["state"]["playback"]["is_playing"])

                # Send a command that web-1 never acks before disconnecting
                ws_phone.send_json(
                    {"type": "command", "request_id": "cmd-drop", "action": "pause"}
                )
                ws_web.receive_json()  # forwarded command

            # Web disconnected: phone receives failed command_result AND updated paused state
            failed_result = ws_phone.receive_json()
            self.assertEqual(failed_result["type"], "command_result")
            self.assertEqual(failed_result["request_id"], "cmd-drop")
            self.assertFalse(failed_result["ok"])
            self.assertIn("disconnected", failed_result["error"])

            after_drop = ws_phone.receive_json()
            self.assertEqual(after_drop["type"], "state")
            self.assertIsNone(after_drop["state"]["active_device_id"])
            self.assertFalse(after_drop["state"]["playback"]["is_playing"])
            self.assertEqual(after_drop["state"]["playback"]["queue"][0]["id"], "101")
            self.assertGreaterEqual(after_drop["state"]["playback"]["position_sec"], 50.0)

    def test_remote_commands_capability_checks_and_acks(self) -> None:
        headers = self._cookie_header(self.alice.id)
        track1 = _sample_track("101")

        with (
            self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_web,
            self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_phone,
        ):
            ws_web.send_json(_register_payload("web-1", "Chrome", "web", take_active=True))
            ws_web.receive_json()  # welcome

            ws_phone.send_json(
                _register_payload("phone-1", "Pixel", "mobile", can_control_volume=False)
            )
            ws_phone.receive_json()  # welcome
            ws_web.receive_json()  # phone joined state

            # Valid commands forwarded to active web-1 and acked back to phone-1
            ws_phone.send_json(
                {
                    "type": "command",
                    "request_id": "r-play-tracks",
                    "action": "play_tracks",
                    "payload": {
                        "tracks": [track1],
                        "start_index": 0,
                        "queue_context": "Liked Songs",
                        "origins": ["context"],
                    },
                }
            )
            forwarded = ws_web.receive_json()
            self.assertEqual(forwarded["type"], "command")
            self.assertEqual(forwarded["from_device_id"], "phone-1")
            self.assertEqual(forwarded["action"], "play_tracks")
            self.assertEqual(forwarded["payload"]["tracks"][0]["id"], "101")
            self.assertEqual(forwarded["payload"]["tracks"][0]["duration_sec"], 210)

            ws_web.send_json(
                {"type": "command_ack", "command_id": forwarded["command_id"], "ok": True}
            )
            result = ws_phone.receive_json()
            self.assertEqual(
                result,
                {
                    "type": "command_result",
                    "request_id": "r-play-tracks",
                    "command_id": forwarded["command_id"],
                    "ok": True,
                    "error": None,
                },
            )

            # Volume command to mobile device (can_control_volume=False) fails loudly
            ws_web.send_json(
                {
                    "type": "command",
                    "request_id": "r-vol",
                    "target_device_id": "phone-1",
                    "action": "set_volume",
                    "payload": {"volume": 0.5},
                }
            )
            vol_err = ws_web.receive_json()
            self.assertEqual(vol_err["type"], "error")
            self.assertEqual(vol_err["code"], "unsupported_capability")
            self.assertEqual(vol_err["request_id"], "r-vol")

            # Invalid seek payload fails loudly
            ws_phone.send_json(
                {
                    "type": "command",
                    "request_id": "r-bad-seek",
                    "action": "seek",
                    "payload": {"position_sec": -5},
                }
            )
            seek_err = ws_phone.receive_json()
            self.assertEqual(seek_err["type"], "error")
            self.assertEqual(seek_err["code"], "invalid_payload")
            self.assertEqual(seek_err["request_id"], "r-bad-seek")

            # Target rejecting a command surfaces error back to sender
            ws_phone.send_json(
                {"type": "command", "request_id": "r-clear", "action": "clear_queue"}
            )
            fwd_clear = ws_web.receive_json()
            ws_web.send_json(
                {
                    "type": "command_ack",
                    "command_id": fwd_clear["command_id"],
                    "ok": False,
                    "error": "Device is locked in Party guest mode",
                }
            )
            clear_res = ws_phone.receive_json()
            self.assertFalse(clear_res["ok"])
            self.assertEqual(clear_res["error"], "Device is locked in Party guest mode")

            # Exercise every remaining locked command action
            remaining_commands = [
                ("play", {}),
                ("pause", {}),
                ("toggle", {}),
                ("next", {}),
                ("prev", {}),
                ("seek", {"position_sec": 42.5}),
                ("set_volume", {"volume": 0.65}),
                ("set_mute", {"muted": True}),
                ("set_shuffle", {"shuffle": True}),
                ("set_repeat", {"repeat": "one"}),
                ("queue_add", {"track": track1}),
                ("queue_play_next", {"track": track1}),
                ("queue_remove", {"index": 0}),
                ("queue_reorder", {"from_index": 0, "to_index": 1}),
                ("select_index", {"index": 0}),
            ]
            for action, payload in remaining_commands:
                ws_phone.send_json(
                    {
                        "type": "command",
                        "request_id": f"req-{action}",
                        "action": action,
                        "payload": payload,
                    }
                )
                fwd = ws_web.receive_json()
                self.assertEqual(fwd["type"], "command")
                self.assertEqual(fwd["action"], action)
                ws_web.send_json(
                    {"type": "command_ack", "command_id": fwd["command_id"], "ok": True}
                )
                ack = ws_phone.receive_json()
                self.assertTrue(ack["ok"])
                self.assertEqual(ack["request_id"], f"req-{action}")

            # Unknown message type, malformed JSON, empty update_device, and bad target fail loudly
            ws_phone.send_text("{not-json")
            self.assertEqual(ws_phone.receive_json()["code"], "invalid_json")

            ws_phone.send_json({"type": "mystery_frame", "request_id": "r-unk"})
            unk_err = ws_phone.receive_json()
            self.assertEqual(unk_err["code"], "unknown_message_type")
            self.assertEqual(unk_err["request_id"], "r-unk")

            ws_phone.send_json({"type": "update_device"})
            self.assertEqual(ws_phone.receive_json()["code"], "invalid_payload")

            ws_phone.send_json(
                {"type": "transfer", "target_device_id": "missing-dev", "request_id": "r-miss"}
            )
            miss_err = ws_phone.receive_json()
            self.assertEqual(miss_err["code"], "device_not_found")
            self.assertEqual(miss_err["request_id"], "r-miss")

    def test_command_without_active_device_fails_loudly(self) -> None:
        headers = self._cookie_header(self.alice.id)
        with self.client.websocket_connect("/api/connect/ws", headers=headers) as ws:
            ws.send_json(_register_payload("idle-1", "Idle Tab", "web"))
            welcome = ws.receive_json()
            self.assertIsNone(welcome["state"]["active_device_id"])

            ws.send_json({"type": "command", "request_id": "r-none", "action": "play"})
            err = ws.receive_json()
            self.assertEqual(err["type"], "error")
            self.assertEqual(err["code"], "no_active_device")
            self.assertEqual(err["request_id"], "r-none")

    def test_update_device_reconnection_replacement_heartbeat_and_user_isolation(self) -> None:
        alice_headers = self._cookie_header(self.alice.id)
        bob_headers = self._cookie_header(self.bob.id)

        with (
            self.client.websocket_connect("/api/connect/ws", headers=alice_headers) as ws_a1,
            self.client.websocket_connect("/api/connect/ws", headers=bob_headers) as ws_bob,
        ):
            ws_a1.send_json(_register_payload("dev-1", "Alice Laptop", "web", take_active=True))
            ws_a1.receive_json()  # welcome

            ws_bob.send_json(_register_payload("dev-1", "Bob Phone", "mobile"))
            welcome_bob = ws_bob.receive_json()
            # Bob only sees Bob's own device, never Alice's
            self.assertEqual(
                [d["name"] for d in welcome_bob["state"]["devices"]], ["Bob Phone"]
            )

            # Update device name, volume, and party_code (set then clear with null)
            ws_a1.send_json(
                {"type": "update_device", "name": "Studio Mac", "volume": 0.4, "party_code": "JAM123"}
            )
            updated = ws_a1.receive_json()
            dev = updated["state"]["devices"][0]
            self.assertEqual(dev["name"], "Studio Mac")
            self.assertEqual(dev["volume"], 0.4)
            self.assertEqual(dev["party_code"], "JAM123")
            self.assertEqual(updated["state"]["playback"]["volume"], 0.4)

            ws_a1.send_json({"type": "update_device", "party_code": None})
            cleared = ws_a1.receive_json()
            self.assertIsNone(cleared["state"]["devices"][0]["party_code"])
            self.assertEqual(cleared["state"]["devices"][0]["name"], "Studio Mac")

            # Ping / pong works
            ws_a1.send_json({"type": "ping"})
            pong = ws_a1.receive_json()
            self.assertEqual(pong["type"], "pong")
            self.assertTrue(pong["ts"])

            # Re-registering same device_id replaces old socket with 4409
            with self.client.websocket_connect("/api/connect/ws", headers=alice_headers) as ws_a2:
                ws_a2.send_json(_register_payload("dev-1", "Studio Mac Reconnected", "web"))
                welcome_a2 = ws_a2.receive_json()
                self.assertEqual(welcome_a2["type"], "welcome")
                self.assertEqual(welcome_a2["state"]["active_device_id"], "dev-1")
                self.assertEqual(len(welcome_a2["state"]["devices"]), 1)

                with self.assertRaises(WebSocketDisconnect) as replaced:
                    ws_a1.receive_text()
                self.assertEqual(replaced.exception.code, 4409)

                # Closing the old socket must NOT remove the replacement socket
                rest = self.client.get("/api/connect/state", headers=alice_headers).json()
                self.assertEqual(len(rest["devices"]), 1)
                self.assertEqual(rest["devices"][0]["name"], "Studio Mac Reconnected")

    def test_heartbeat_timeout_disconnects_silent_device(self) -> None:
        connect_hub.hub.heartbeat_interval_sec = 0.03
        connect_hub.hub.heartbeat_timeout_sec = 0.06
        headers = self._cookie_header(self.alice.id)

        with self.client.websocket_connect("/api/connect/ws", headers=headers) as ws:
            ws.send_json(_register_payload("silent-1", "Silent Tab", "web"))
            self.assertEqual(ws.receive_json()["type"], "welcome")
            # Server sends ping(s), then closes with 4408 when client never replies
            closed_code = None
            for _ in range(10):
                try:
                    msg = ws.receive_json()
                    self.assertEqual(msg["type"], "ping")
                except WebSocketDisconnect as exc:
                    closed_code = exc.code
                    break
            self.assertEqual(closed_code, 4408)

    def test_drop_during_register_welcome_does_not_leak_ghost_device(self) -> None:
        import asyncio

        from app.schemas.connect import RegisterMessage

        class _DroppingSocket:
            async def send_json(self, _payload: dict) -> None:
                raise WebSocketDisconnect(code=1006)

            async def close(self, code: int = 1000, reason: str = "") -> None:
                return None

        msg = RegisterMessage.model_validate(
            _register_payload("ghost-1", "Dropping Tab", "web", take_active=True)
        )
        with self.assertRaises(WebSocketDisconnect):
            asyncio.run(connect_hub.hub.register(self.alice.id, _DroppingSocket(), msg))

        state = connect_hub.hub.get_state(self.alice.id)
        self.assertEqual(state.devices, [])
        self.assertIsNone(state.active_device_id)

    def test_failed_transfer_delivery_leaves_active_device_intact_and_reports_error(self) -> None:
        import asyncio

        from app.schemas.connect import RegisterMessage, TransferMessage

        class _RecordingSocket:
            def __init__(self, *, fail_on_type: str | None = None) -> None:
                self.sent: list[dict] = []
                self.fail_on_type = fail_on_type

            async def send_json(self, payload: dict) -> None:
                if self.fail_on_type and payload.get("type") == self.fail_on_type:
                    raise RuntimeError("broken pipe")
                self.sent.append(payload)

            async def close(self, code: int = 1000, reason: str = "") -> None:
                return None

        async def scenario() -> tuple[_RecordingSocket, _RecordingSocket]:
            ws_a = _RecordingSocket()
            ws_b = _RecordingSocket(fail_on_type="activate")
            conn_a = await connect_hub.hub.register(
                self.alice.id,
                ws_a,
                RegisterMessage.model_validate(
                    _register_payload(
                        "dev-a",
                        "Laptop",
                        "web",
                        playback={
                            "queue": [_sample_track("101")],
                            "current_index": 0,
                            "is_playing": True,
                            "position_sec": 10.0,
                            "duration_sec": 210.0,
                        },
                    )
                ),
            )
            await connect_hub.hub.register(
                self.alice.id,
                ws_b,
                RegisterMessage.model_validate(_register_payload("dev-b", "Speaker", "speaker")),
            )
            ws_a.sent.clear()
            await connect_hub.hub.handle_transfer(
                conn_a,
                TransferMessage(type="transfer", target_device_id="dev-b", play=True, request_id="tx-fail"),
            )
            return ws_a, ws_b

        ws_a, _ws_b = asyncio.run(scenario())
        # Sender gets explicit device_unreachable error; dev-a was NEVER deactivated.
        self.assertEqual([m["type"] for m in ws_a.sent], ["error"])
        self.assertEqual(ws_a.sent[0]["code"], "device_unreachable")
        self.assertEqual(ws_a.sent[0]["request_id"], "tx-fail")

        state = connect_hub.hub.get_state(self.alice.id)
        self.assertEqual(state.active_device_id, "dev-a")
        self.assertTrue(state.playback.is_playing)

    def test_reconnect_replacement_fails_pending_commands_and_clears_non_audio_active(self) -> None:
        headers = self._cookie_header(self.alice.id)
        track1 = _sample_track("101")

        with (
            self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_web1,
            self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_phone,
        ):
            ws_web1.send_json(
                _register_payload(
                    "web-1",
                    "Chrome",
                    "web",
                    playback={
                        "queue": [track1],
                        "current_index": 0,
                        "is_playing": True,
                        "position_sec": 12.0,
                        "duration_sec": 210.0,
                    },
                )
            )
            ws_web1.receive_json()  # welcome

            ws_phone.send_json(_register_payload("phone-1", "Pixel", "mobile"))
            ws_phone.receive_json()  # welcome
            ws_web1.receive_json()  # state

            # Send a command to web-1 that stays in flight while web-1 reconnects
            ws_phone.send_json(
                {"type": "command", "request_id": "cmd-inflight", "action": "pause"}
            )
            forwarded = ws_web1.receive_json()
            self.assertEqual(forwarded["type"], "command")

            # Same device_id reconnects, now with can_play_audio=False
            with self.client.websocket_connect("/api/connect/ws", headers=headers) as ws_web2:
                ws_web2.send_json(
                    _register_payload(
                        "web-1",
                        "Chrome Remote-Only",
                        "web",
                        can_play_audio=False,
                    )
                )
                welcome2 = ws_web2.receive_json()
                self.assertEqual(welcome2["type"], "welcome")
                # Non-audio device must NOT stay active
                self.assertIsNone(welcome2["state"]["active_device_id"])
                self.assertFalse(welcome2["state"]["playback"]["is_playing"])

                # Caller receives explicit failed command_result (does not hang)
                res = ws_phone.receive_json()
                self.assertEqual(res["type"], "command_result")
                self.assertEqual(res["request_id"], "cmd-inflight")
                self.assertFalse(res["ok"])
                self.assertIn("reconnected", res["error"])

                # Phone also gets updated state showing active_device_id=None
                updated_state = ws_phone.receive_json()
                self.assertEqual(updated_state["type"], "state")
                self.assertIsNone(updated_state["state"]["active_device_id"])

                with self.assertRaises(WebSocketDisconnect) as replaced:
                    ws_web1.receive_text()
                self.assertEqual(replaced.exception.code, 4409)

    def test_internal_error_in_command_validation_propagates_loudly(self) -> None:
        import asyncio

        from app.schemas.connect import CommandMessage, RegisterMessage

        class _DummySocket:
            async def send_json(self, _payload: dict) -> None:
                return None

            async def close(self, code: int = 1000, reason: str = "") -> None:
                return None

        async def scenario() -> None:
            conn = await connect_hub.hub.register(
                self.alice.id,
                _DummySocket(),
                RegisterMessage.model_validate(
                    _register_payload("dev-1", "Laptop", "web", take_active=True)
                ),
            )
            with patch.object(
                connect_hub,
                "validate_command_payload",
                side_effect=RuntimeError("internal bug"),
            ):
                await connect_hub.hub.handle_command(
                    conn,
                    CommandMessage(type="command", action="play", payload={}),
                )

        with self.assertRaisesRegex(RuntimeError, "internal bug"):
            asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
