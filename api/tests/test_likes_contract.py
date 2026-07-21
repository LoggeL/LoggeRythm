from __future__ import annotations

import asyncio
import json
import unittest

from fastapi import FastAPI
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.db.models import Like, User
from app.db.session import Base, get_db
from app.routers import likes


def _ghostkid_start_a_fight_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": "1120404372",
        "title": "START A FIGHT",
        "artist": "Ghøstkid",
        "artist_id": 92203912,
        "artists": [{"id": "92203912", "name": "Ghøstkid"}],
        "album": "GHØSTKID",
        "album_id": 181928502,
        "cover": "https://cdn-images.dzcdn.net/images/cover/73e41b91dd1a90c5090bbd49001bc4c9/250x250-000000-80-0-0.jpg",
        "duration_sec": 234,
        "preview_url": "https://cdnt-preview.dzcdn.net/api/1/1/3/0/7/0/30737f97caf4628e7cae9a3ee760dbad.mp3",
        "rank": 271587,
        "release_date": "",
        "loudness_gain_db": None,
        "loudness_lufs": None,
        "loudness_peak": None,
    }
    payload.update(overrides)
    return payload


async def _asgi_put_like(api: FastAPI, track_id: str, payload: dict[str, object]) -> tuple[int, bytes]:
    request_sent = False
    messages: list[dict[str, object]] = []

    async def receive() -> dict[str, object]:
        nonlocal request_sent
        if request_sent:
            return {"type": "http.disconnect"}
        request_sent = True
        return {
            "type": "http.request",
            "body": json.dumps(payload).encode("utf-8"),
            "more_body": False,
        }

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    path = f"/api/me/likes/{track_id}"
    await api(
        {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "PUT",
            "scheme": "https",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": [
                (b"host", b"api.example.test"),
                (b"content-type", b"application/json"),
            ],
            "client": ("127.0.0.1", 12345),
            "server": ("api.example.test", 443),
            "root_path": "",
        },
        receive,
        send,
    )
    status_message = next(message for message in messages if message["type"] == "http.response.start")
    body = b"".join(
        message.get("body", b"")  # type: ignore[arg-type]
        for message in messages
        if message["type"] == "http.response.body"
    )
    return int(status_message["status"]), body


class LikesApiContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(
            email="listener@example.test",
            password_hash="unused",
            display_name="Listener",
            is_approved=True,
        )
        self.db.add(self.user)
        self.db.commit()
        self.api = FastAPI()
        self.api.include_router(likes.router)
        self.api.dependency_overrides[get_current_user] = lambda: self.user
        self.api.dependency_overrides[get_db] = lambda: self.db

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_put_like_accepts_current_production_search_track_with_loudness_nulls(self) -> None:
        status_code, body = asyncio.run(
            _asgi_put_like(
                self.api,
                "1120404372",
                _ghostkid_start_a_fight_payload(),
            )
        )

        self.assertEqual(status_code, 204, body)
        self.assertEqual(body, b"")
        stored = self.db.scalar(select(Like).where(Like.deezer_id == "1120404372"))
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertEqual(stored.title, "START A FIGHT")
        self.assertEqual(stored.artist, "Ghøstkid")

    def test_put_like_tolerates_android_json_null_sentinels_for_optional_loudness(self) -> None:
        status_code, body = asyncio.run(
            _asgi_put_like(
                self.api,
                "1120404372",
                _ghostkid_start_a_fight_payload(
                    loudness_gain_db="null",
                    loudness_lufs="null",
                    loudness_peak="null",
                ),
            )
        )

        self.assertEqual(status_code, 204, body)
        self.assertEqual(body, b"")
        stored = self.db.scalar(select(Like).where(Like.deezer_id == "1120404372"))
        self.assertIsNotNone(stored)


if __name__ == "__main__":
    unittest.main()
