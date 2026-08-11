from __future__ import annotations

import asyncio
import json
import unittest
from unittest import mock

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.db.models import StoredLyrics, User
from app.db.session import Base, get_db
from app.routers import lyrics as lyrics_router
from app.services import groq


async def _asgi_get(api: FastAPI, path: str, query: str) -> tuple[int, bytes]:
    messages: list[dict[str, object]] = []

    async def receive() -> dict[str, object]:
        return {"type": "http.disconnect"}

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": query.encode(),
        "headers": [],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    await api(scope, receive, send)

    status = 0
    body = b""
    for message in messages:
        if message["type"] == "http.response.start":
            status = int(message["status"])
        elif message["type"] == "http.response.body":
            body += message.get("body", b"")
    return status, body


class LyricsVariantTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)

        self.api = FastAPI()
        self.api.include_router(lyrics_router.router)

        def override_db():
            with Session(self.engine) as session:
                yield session

        self.api.dependency_overrides[get_db] = override_db
        self.api.dependency_overrides[get_current_user] = lambda: User(
            email="listener@example.test",
            password_hash="unused",
            display_name="Listener",
            is_approved=True,
        )

    def tearDown(self) -> None:
        self.engine.dispose()

    def _get(self, query: str) -> tuple[int, dict]:
        status, body = asyncio.run(_asgi_get(self.api, "/api/lyrics", query))
        return status, json.loads(body)

    def _seed(self, **overrides: object) -> None:
        row = StoredLyrics(
            deezer_id="42",
            lines_json=json.dumps([{"t": 1.0, "text": "hello"}]),
            synced=True,
            source="lrclib",
            ai_generated=False,
        )
        for key, value in overrides.items():
            setattr(row, key, value)
        with Session(self.engine) as session:
            session.merge(row)
            session.commit()

    def test_ai_variant_requires_deezer_id(self) -> None:
        status, body = self._get("artist=a&title=b&variant=ai")
        self.assertEqual(status, 400)
        self.assertIn("deezer_id", body["detail"])

    def test_ai_variant_rejects_unknown_value(self) -> None:
        status, _ = self._get("artist=a&title=b&deezer_id=42&variant=nope")
        self.assertEqual(status, 422)

    def test_ai_variant_returns_cached_ai_primary(self) -> None:
        self._seed(
            lines_json=json.dumps([{"t": 2.0, "text": "ai line"}]),
            synced=False,
            source=groq.LYRICS_SOURCE,
            ai_generated=True,
        )
        status, body = self._get("artist=a&title=b&deezer_id=42&variant=ai")
        self.assertEqual(status, 200)
        self.assertTrue(body["cached"])
        self.assertTrue(body["ai_generated"])
        self.assertEqual(body["lines"], [{"t": 2.0, "text": "ai line"}])

    def test_ai_variant_returns_cached_whisper_columns(self) -> None:
        self._seed(
            whisper_lines_json=json.dumps([{"t": 3.0, "text": "whisper"}]),
            whisper_source=groq.LYRICS_SOURCE,
        )
        status, body = self._get("artist=a&title=b&deezer_id=42&variant=ai")
        self.assertEqual(status, 200)
        self.assertTrue(body["cached"])
        self.assertTrue(body["ai_generated"])
        self.assertEqual(body["source"], groq.LYRICS_SOURCE)
        self.assertEqual(body["lines"], [{"t": 3.0, "text": "whisper"}])

    def test_ai_variant_fails_loud_when_groq_unconfigured(self) -> None:
        self._seed()  # provider lyrics exist, but no whisper cache
        with mock.patch.object(groq, "configured", return_value=False):
            status, body = self._get("artist=a&title=b&deezer_id=42&variant=ai")
        self.assertEqual(status, 503)
        self.assertIn("GROQ_API_KEY", body["detail"])

    def test_ai_variant_transcribes_and_persists_next_to_primary(self) -> None:
        self._seed()
        transcribed = [{"t": 0.5, "text": "from whisper"}]
        with (
            mock.patch.object(groq, "configured", return_value=True),
            mock.patch.object(
                lyrics_router, "_groq_transcription", return_value=transcribed
            ),
        ):
            status, body = self._get("artist=a&title=b&deezer_id=42&variant=ai")
        self.assertEqual(status, 200)
        self.assertTrue(body["ai_generated"])
        self.assertFalse(body["synced"])
        self.assertEqual(body["lines"], transcribed)

        with Session(self.engine) as session:
            row = session.get(StoredLyrics, "42")
            assert row is not None
            # Primary (provider) lyrics stay untouched.
            self.assertEqual(row.source, "lrclib")
            self.assertFalse(row.ai_generated)
            self.assertEqual(json.loads(row.whisper_lines_json), transcribed)
            self.assertEqual(row.whisper_source, groq.LYRICS_SOURCE)

    def test_default_variant_still_serves_primary_cache(self) -> None:
        self._seed(whisper_lines_json=json.dumps([{"t": 3.0, "text": "whisper"}]))
        status, body = self._get("artist=a&title=b&deezer_id=42")
        self.assertEqual(status, 200)
        self.assertTrue(body["cached"])
        self.assertFalse(body["ai_generated"])
        self.assertEqual(body["lines"], [{"t": 1.0, "text": "hello"}])


if __name__ == "__main__":
    unittest.main()
