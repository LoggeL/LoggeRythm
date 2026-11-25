"""Tests for lrclib accuracy (album/duration/instrumental/plain) and word-level karaoke lyrics."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import create_token
from app.db.models import StoredLyrics, User
from app.db.session import Base, get_db
from app.main import app
from app.routers import lyrics as lyrics_router
from app.services import groq


class LyricsImprovementsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{Path(self.tmp.name) / 'lyrics.db'}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.SessionFactory = sessionmaker(
            bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False
        )
        with self.SessionFactory() as db:
            self.user = User(email="u@example.test", password_hash="x", is_approved=True)
            db.add(self.user)
            db.commit()
            db.refresh(self.user)

        def override_db():
            s = self.SessionFactory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        self.headers = {"Cookie": f"sf_session={create_token(self.user.id)}"}

    def tearDown(self) -> None:
        self.client.close()
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()
        self.tmp.cleanup()

    def test_lrclib_get_forwards_album_and_duration_params(self) -> None:
        get_resp = Mock(status_code=200)
        get_resp.json.return_value = {
            "syncedLyrics": "[00:05.50]Hello world\n[00:10.00]Second line",
            "instrumental": False,
        }
        with patch.object(lyrics_router.requests, "get", return_value=get_resp) as mock_get:
            resp = self.client.get(
                "/api/lyrics",
                params={
                    "artist": "Daft Punk",
                    "title": "Instant Crush",
                    "album": "Random Access Memories",
                    "duration_sec": 337,
                    "deezer_id": "1001",
                },
                headers=self.headers,
            )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["synced"])
        self.assertFalse(data["instrumental"])
        self.assertEqual(data["source"], "lrclib")
        self.assertEqual(len(data["lines"]), 2)
        sent_params = mock_get.call_args.kwargs["params"]
        self.assertEqual(sent_params["album_name"], "Random Access Memories")
        self.assertEqual(sent_params["duration"], 337)

    def test_instrumental_track_persisted_and_skips_groq(self) -> None:
        get_resp = Mock(status_code=200)
        get_resp.json.return_value = {
            "syncedLyrics": None,
            "plainLyrics": None,
            "instrumental": True,
        }
        with (
            patch.object(lyrics_router.requests, "get", return_value=get_resp) as mock_get,
            patch.object(lyrics_router.groq, "configured", return_value=True),
            patch.object(
                lyrics_router,
                "_groq_transcription",
                side_effect=AssertionError("Groq must not be called for instrumental tracks"),
            ),
        ):
            r1 = self.client.get(
                "/api/lyrics",
                params={"artist": "Boards of Canada", "title": "Roygbiv", "deezer_id": "2002"},
                headers=self.headers,
            )
        self.assertEqual(r1.status_code, 200)
        body = r1.json()
        self.assertTrue(body["instrumental"])
        self.assertEqual(body["lines"], [])
        self.assertFalse(body["synced"])
        self.assertFalse(body["ai_generated"])
        mock_get.assert_called_once()

        # Verify persisted row serves cached instrumental result without hitting network
        with self.SessionFactory() as db:
            row = db.get(StoredLyrics, "2002")
            self.assertIsNotNone(row)
            self.assertTrue(row.instrumental)

        with patch.object(lyrics_router.requests, "get", side_effect=AssertionError("should use DB cache")):
            r2 = self.client.get(
                "/api/lyrics",
                params={"artist": "Boards of Canada", "title": "Roygbiv", "deezer_id": "2002"},
                headers=self.headers,
            )
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json()["instrumental"])
        self.assertTrue(r2.json()["cached"])

    def test_plain_lyrics_returned_without_groq_fallback(self) -> None:
        get_resp = Mock(status_code=200)
        get_resp.json.return_value = {
            "syncedLyrics": None,
            "plainLyrics": "First verse\n\nSecond verse",
            "instrumental": False,
        }
        with (
            patch.object(lyrics_router.requests, "get", return_value=get_resp),
            patch.object(lyrics_router.groq, "configured", return_value=True),
            patch.object(
                lyrics_router,
                "_groq_transcription",
                side_effect=AssertionError("Should use plainLyrics instead of Groq"),
            ),
        ):
            r = self.client.get(
                "/api/lyrics",
                params={"artist": "Artist", "title": "Ballad", "deezer_id": "3003"},
                headers=self.headers,
            )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertFalse(body["synced"])
        self.assertFalse(body["instrumental"])
        self.assertEqual(body["source"], "lrclib-plain")
        self.assertEqual(
            body["lines"],
            [{"t": 0.0, "text": "First verse"}, {"t": 0.0, "text": "Second verse"}],
        )

    def test_groq_fallback_persists_word_level_timestamps(self) -> None:
        miss_resp = Mock(status_code=404)
        word_lines = [
            {
                "t": 1.2,
                "text": "Sing along",
                "words": [
                    {"t": 1.2, "end": 1.5, "text": "Sing"},
                    {"t": 1.55, "end": 2.0, "text": "along"},
                ],
            }
        ]
        with (
            patch.object(lyrics_router.requests, "get", return_value=miss_resp),
            patch.object(lyrics_router.groq, "configured", return_value=True),
            patch.object(lyrics_router, "_groq_transcription", return_value=word_lines),
        ):
            r1 = self.client.get(
                "/api/lyrics",
                params={"artist": "Indie", "title": "Rare", "deezer_id": "4004"},
                headers=self.headers,
            )
        self.assertEqual(r1.status_code, 200)
        body = r1.json()
        self.assertEqual(body["source"], groq.LYRICS_SOURCE)
        self.assertEqual(body["lines"][0]["words"][1]["end"], 2.0)

        # Cached read preserves word-level timestamps
        r2 = self.client.get(
            "/api/lyrics",
            params={"artist": "Indie", "title": "Rare", "deezer_id": "4004"},
            headers=self.headers,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json()["cached"])
        self.assertEqual(r2.json()["lines"], word_lines)


if __name__ == "__main__":
    unittest.main()
