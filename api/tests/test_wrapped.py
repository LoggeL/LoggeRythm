"""Comprehensive tests for LoggeRythm Wrapped analytics, artwork proxy, SVG cards, and contracts."""
from __future__ import annotations

import os
import tempfile
import unittest
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import requests
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import create_token
from app.config import SESSION_COOKIE
from app.db.models import Play, StoredTrack, User
from app.db.session import Base, get_db
from app.main import app
from app.openapi_contract import build_schema
from app.schemas.stats import MAX_SAFE_WIRE_INTEGER
from app.schemas.wrapped import (
    WrappedAura,
    WrappedPersona,
    WrappedReport,
    WrappedRhythm,
)
from app.services.wrapped import build_wrapped_report, render_wrapped_card_svg
from app.uploads import MAX_IMAGE_UPLOAD_BYTES

_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc```\x00\x00"
    b"\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82"
)


class WrappedSchemaTests(unittest.TestCase):
    def test_aura_requires_three_valid_hex_colors_and_tags(self) -> None:
        valid = WrappedAura(
            id="test",
            title="Test Aura",
            description="Drei Farben",
            colors=["#09090B", "#7F5AF0", "#D6FF4B"],
            mood_tags=["Ruhig", "Fokussiert", "Warm"],
        )
        self.assertEqual(len(valid.colors), 3)

        with self.assertRaises(ValidationError):
            WrappedAura(
                id="bad_hex",
                title="Bad",
                description="Invalid hex",
                colors=["red", "#7F5AF0", "#D6FF4B"],
                mood_tags=["A", "B", "C"],
            )

        with self.assertRaises(ValidationError):
            WrappedAura(
                id="short",
                title="Bad",
                description="Too few tags",
                colors=["#09090B", "#7F5AF0", "#D6FF4B"],
                mood_tags=["A", "B"],
            )

    def test_persona_and_rhythm_enforce_exact_lengths_and_bounds(self) -> None:
        with self.assertRaises(ValidationError):
            WrappedPersona(
                id="p",
                title="Title",
                subtitle="Sub",
                tagline="Tag",
                emblem="moon_wave",
                traits=["One", "Two"],
            )

        with self.assertRaises(ValidationError):
            WrappedRhythm(
                chronotype="night_owl",
                chronotype_label="Nachtschwärmer",
                peak_hour=24,
                peak_weekday=0,
                weekend_share_pct=10,
                discovery_score_pct=50,
                repeat_score_pct=50,
                hourly_distribution=[0] * 24,
                weekday_distribution=[0] * 7,
            )

        with self.assertRaises(ValidationError):
            WrappedRhythm(
                chronotype="night_owl",
                chronotype_label="Nachtschwärmer",
                peak_hour=22,
                peak_weekday=0,
                weekend_share_pct=10,
                discovery_score_pct=50,
                repeat_score_pct=50,
                hourly_distribution=[0] * 23,
                weekday_distribution=[0] * 7,
            )


class WrappedReportServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(
            email="listener@example.test",
            password_hash="not-used",
            display_name="Lena Beat",
            avatar_url="/api/users/1/avatar?v=1",
            is_approved=True,
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _add_play(
        self,
        *,
        deezer_id: str,
        title: str,
        artist: str,
        artist_id: str = "10",
        album: str = "Album",
        album_id: str = "100",
        cover_url: str | None = "https://img.example/cover.jpg",
        duration_sec: int = 200,
        played_at: datetime,
    ) -> None:
        self.db.add(
            Play(
                user_id=self.user.id,
                deezer_id=deezer_id,
                title=title,
                artist=artist,
                artist_id=artist_id,
                artists_json="[]",
                album=album,
                album_id=album_id,
                cover_url=cover_url,
                duration_sec=duration_sec,
                played_at=played_at.replace(tzinfo=None) if played_at.tzinfo else played_at,
            )
        )

    def test_empty_plays_returns_zeroed_report_with_none_optional_sections(self) -> None:
        now = datetime(2026, 11, 27, 15, 0, tzinfo=timezone.utc)
        report_30d = build_wrapped_report(self.db, self.user, "30d", now=now)

        self.assertEqual(report_30d.totals.play_count, 0)
        self.assertEqual(report_30d.totals.total_days, 30)
        self.assertEqual(report_30d.totals.avg_daily_sec, 0)
        self.assertIsNotNone(report_30d.period_start)
        self.assertIsNone(report_30d.persona)
        self.assertIsNone(report_30d.aura)
        self.assertIsNone(report_30d.obsession)
        self.assertIsNone(report_30d.peak_day)
        self.assertIsNone(report_30d.tempo)
        self.assertEqual(report_30d.equivalents, [])
        self.assertEqual(report_30d.top_tracks, [])
        self.assertEqual(report_30d.top_artists, [])
        self.assertEqual(report_30d.top_albums, [])
        self.assertEqual(report_30d.rhythm.hourly_distribution, [0] * 24)
        self.assertEqual(report_30d.rhythm.weekday_distribution, [0] * 7)

        report_all = build_wrapped_report(self.db, self.user, "all", now=now)
        self.assertIsNone(report_all.period_start)
        self.assertEqual(report_all.totals.total_days, 0)

    def test_rich_multiday_report_bpm_streaks_peak_day_and_range_filtering(self) -> None:
        now = datetime(2026, 11, 27, 18, 0, tzinfo=timezone.utc)
        # Pre-range artist played 45 days ago -> must NOT count as new in 30d.
        self._add_play(
            deezer_id="old1",
            title="Old Song",
            artist="Veteran Artist",
            artist_id="a-old",
            album="Legacy LP",
            album_id="alb-old",
            duration_sec=240,
            played_at=now - timedelta(days=45),
        )
        # Veteran Artist also played inside 30d window
        self._add_play(
            deezer_id="t1",
            title="Midnight Drive",
            artist="Veteran Artist",
            artist_id="a-old",
            album="Night Tapes",
            album_id="alb-1",
            cover_url="https://img.example/t1.jpg",
            duration_sec=240,
            played_at=datetime(2026, 11, 25, 21, 0, tzinfo=timezone.utc),
        )
        # Peak day: 2026-11-26 with 4 plays (total 1100 sec)
        for idx in range(3):
            self._add_play(
                deezer_id="t2",
                title="Pulse Rider",
                artist="Nova Echo",
                artist_id="a-nova",
                album="Neon Horizon",
                album_id="alb-2",
                cover_url="https://img.example/t2.jpg",
                duration_sec=300,
                played_at=datetime(2026, 11, 26, 20, idx * 10, tzinfo=timezone.utc),
            )
        self._add_play(
            deezer_id="t3",
            title="Solar Drift",
            artist="Klangwerk",
            artist_id="a-klang",
            album="Neon Horizon",
            album_id="alb-2",
            cover_url="https://img.example/t3.jpg",
            duration_sec=200,
            played_at=datetime(2026, 11, 26, 22, 0, tzinfo=timezone.utc),
        )
        # Today (2026-11-27) -> 3-day active streak (25, 26, 27)
        self._add_play(
            deezer_id="t2",
            title="Pulse Rider",
            artist="Nova Echo",
            artist_id="a-nova",
            album="Neon Horizon",
            album_id="alb-2",
            cover_url="https://img.example/t2.jpg",
            duration_sec=300,
            played_at=datetime(2026, 11, 27, 14, 0, tzinfo=timezone.utc),
        )

        self.db.add_all(
            [
                StoredTrack(
                    deezer_id="t1",
                    file_path="/tmp/t1.mp3",
                    bpm=100.0,
                ),
                StoredTrack(
                    deezer_id="t2",
                    file_path="/tmp/t2.mp3",
                    bpm=130.0,
                ),
            ]
        )
        self.db.commit()

        report = build_wrapped_report(self.db, self.user, "30d", now=now)
        self.assertEqual(report.totals.play_count, 6)
        self.assertEqual(report.totals.listening_sec, 1640)
        self.assertEqual(report.totals.unique_tracks, 3)
        self.assertEqual(report.totals.unique_artists, 3)
        self.assertEqual(report.totals.unique_albums, 2)
        self.assertEqual(report.totals.new_artists_count, 2)
        self.assertEqual(report.totals.active_days, 3)
        self.assertEqual(report.totals.total_days, 30)
        self.assertEqual(report.totals.current_streak_days, 3)
        self.assertEqual(report.totals.longest_streak_days, 3)

        self.assertIsNotNone(report.obsession)
        assert report.obsession is not None
        self.assertEqual(report.obsession.track_key, "t2")
        self.assertEqual(report.obsession.play_count, 4)
        self.assertEqual(report.obsession.peak_day_date, "2026-11-26")
        self.assertEqual(report.obsession.peak_day_plays, 3)

        self.assertIsNotNone(report.peak_day)
        assert report.peak_day is not None
        self.assertEqual(report.peak_day.date, "2026-11-26")
        self.assertEqual(report.peak_day.weekday, 3)  # Thursday
        self.assertEqual(report.peak_day.play_count, 4)
        self.assertEqual(report.peak_day.listening_sec, 1100)
        self.assertEqual(report.peak_day.top_track_title, "Pulse Rider")

        # Weighted BPM: (1*100 + 4*130) / 5 = 124
        self.assertIsNotNone(report.tempo)
        assert report.tempo is not None
        self.assertEqual(report.tempo.analyzed_plays, 5)
        self.assertEqual(report.tempo.avg_bpm, 124)
        self.assertEqual(report.tempo.min_bpm, 100)
        self.assertEqual(report.tempo.max_bpm, 130)
        self.assertEqual(report.tempo.vibe_label, "Club-Puls")

        self.assertEqual(len(report.equivalents), 3)
        self.assertIsNotNone(report.aura)
        assert report.aura is not None
        self.assertEqual(len(report.aura.colors), 3)
        self.assertEqual(len(report.aura.mood_tags), 3)

        # All-time includes the 45-day-old play too.
        report_all = build_wrapped_report(self.db, self.user, "all", now=now)
        self.assertEqual(report_all.totals.play_count, 7)

    def test_all_eight_persona_branches_are_reachable(self) -> None:
        now = datetime(2026, 11, 27, 18, 0, tzinfo=timezone.utc)

        def reset_plays() -> None:
            self.db.query(Play).delete()
            self.db.commit()

        # 1. loop_architect
        reset_plays()
        for i in range(6):
            self._add_play(
                deezer_id="loop1",
                title="Loop Track",
                artist="Loop Artist",
                album="Loop LP",
                played_at=now - timedelta(hours=i),
            )
        self.db.commit()
        p = build_wrapped_report(self.db, self.user, "30d", now=now).persona
        self.assertIsNotNone(p)
        assert p is not None
        self.assertEqual((p.id, p.title, p.emblem), ("loop_architect", "Endlosschleifen-Architekt", "infinite_vinyl"))
        self.assertEqual(len(p.traits), 3)

        # 2. streak_runner (7 distinct days, distinct tracks so loop_architect doesn't win)
        reset_plays()
        for d in range(7):
            self._add_play(
                deezer_id=f"s{d}",
                title=f"Streak {d}",
                artist=f"Artist {d}",
                album=f"Album {d}",
                played_at=datetime(2026, 11, 21 + d, 14, 0, tzinfo=timezone.utc),
            )
        self.db.commit()
        p = build_wrapped_report(self.db, self.user, "30d", now=now).persona
        assert p is not None
        self.assertEqual((p.id, p.title, p.emblem), ("streak_runner", "Dauerbrenner", "flame_metro"))

        # 3. night_owl
        reset_plays()
        for i in range(4):
            self._add_play(
                deezer_id=f"n{i}",
                title=f"Night {i}",
                artist=f"NightArt {i}",
                album=f"NightAlb {i}",
                played_at=datetime(2026, 11, 26, (23 + i) % 24, 15, tzinfo=timezone.utc),
            )
        self.db.commit()
        p = build_wrapped_report(self.db, self.user, "30d", now=now).persona
        assert p is not None
        self.assertEqual((p.id, p.title, p.emblem), ("night_owl", "Nachtschwärmer", "moon_wave"))

        # 4. morning_freq
        reset_plays()
        for i in range(4):
            self._add_play(
                deezer_id=f"m{i}",
                title=f"Morning {i}",
                artist=f"MornArt {i}",
                album=f"MornAlb {i}",
                played_at=datetime(2026, 11, 25, 7 + (i % 3), 0, tzinfo=timezone.utc),
            )
        self.db.commit()
        p = build_wrapped_report(self.db, self.user, "30d", now=now).persona
        assert p is not None
        self.assertEqual((p.id, p.title, p.emblem), ("morning_freq", "Morgen-Frequenz", "sunrise_pulse"))

        # 5. weekend_headliner (plays mostly on Saturday 2026-11-21 & Sunday 2026-11-22 in afternoon)
        reset_plays()
        for i in range(3):
            self._add_play(
                deezer_id=f"w{i}",
                title=f"Weekend {i}",
                artist=f"WkArt {i}",
                album=f"WkAlb {i}",
                played_at=datetime(2026, 11, 21 + (i % 2), 14 + i, 0, tzinfo=timezone.utc),
            )
        self._add_play(
            deezer_id="wd1",
            title="Weekday",
            artist="WdArt",
            album="WdAlb",
            played_at=datetime(2026, 11, 25, 14, 0, tzinfo=timezone.utc),
        )
        self.db.commit()
        p = build_wrapped_report(self.db, self.user, "30d", now=now).persona
        assert p is not None
        self.assertEqual((p.id, p.title, p.emblem), ("weekend_headliner", "Wochenend-Headliner", "strobe_bars"))

        # 6. explorer (weekday afternoon, >= 4 distinct artists, high discovery)
        reset_plays()
        for i in range(5):
            self._add_play(
                deezer_id=f"e{i}",
                title=f"Exp {i}",
                artist=f"ExpArt {i}",
                album=f"ExpAlb {i}",
                played_at=datetime(2026, 11, 24 + (i % 2), 13 + (i % 3), 0, tzinfo=timezone.utc),
            )
        self.db.commit()
        p = build_wrapped_report(self.db, self.user, "30d", now=now).persona
        assert p is not None
        self.assertEqual((p.id, p.title, p.emblem), ("explorer", "Trüffelschwein", "compass_radar"))

        # 7. album_purist (same album across distinct tracks, <= 3 artists so explorer doesn't fire)
        reset_plays()
        for i in range(4):
            self._add_play(
                deezer_id=f"ap{i}",
                title=f"Track {i}",
                artist="Album Artist",
                album="Masterpiece LP",
                album_id="lp-1",
                played_at=datetime(2026, 11, 25, 13 + (i % 3), i * 5, tzinfo=timezone.utc),
            )
        self.db.commit()
        p = build_wrapped_report(self.db, self.user, "30d", now=now).persona
        assert p is not None
        self.assertEqual((p.id, p.title, p.emblem), ("album_purist", "Album-Purist", "tonearm_disc"))

        # 8. sound_alchemist (balanced weekday mix, 3 artists, < 65% discovery or < 4 artists, no album dominance)
        reset_plays()
        combos = [
            ("sa1", "A1", "Alb1"),
            ("sa1", "A1", "Alb1"),
            ("sa2", "A2", "Alb2"),
            ("sa2", "A2", "Alb2"),
            ("sa3", "A3", "Alb3"),
            ("sa4", "A1", "Alb4"),
            ("sa5", "A2", "Alb5"),
        ]
        for idx, (tid, art, alb) in enumerate(combos):
            self._add_play(
                deezer_id=tid,
                title=f"Song {tid}",
                artist=art,
                album=alb,
                album_id=alb,
                played_at=datetime(2026, 11, 24 + (idx % 3), 13 + (idx % 4), 0, tzinfo=timezone.utc),
            )
        self.db.commit()
        p = build_wrapped_report(self.db, self.user, "30d", now=now).persona
        assert p is not None
        self.assertEqual((p.id, p.title, p.emblem), ("sound_alchemist", "Klang-Alchemist", "prism_beat"))


class WrappedApiAndSvgTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        self.db = self.SessionLocal()

        self.user = User(
            email="wrapped@example.test",
            password_hash="not-used",
            display_name='Max & <Studio> "DJ"',
            avatar_url="/api/users/1/avatar?v=42",
            is_approved=True,
        )
        self.other = User(
            email="other@example.test",
            password_hash="not-used",
            display_name="Other",
            avatar_url="/api/users/2/avatar?v=7",
            is_approved=True,
        )
        self.pending = User(
            email="pending@example.test",
            password_hash="not-used",
            display_name="Pending",
            is_approved=False,
        )
        self.db.add_all([self.user, self.other, self.pending])
        self.db.commit()

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        self._prev_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        self.user_headers = {"Cookie": f"{SESSION_COOKIE}={create_token(self.user.id)}"}
        self.other_headers = {"Cookie": f"{SESSION_COOKIE}={create_token(self.other.id)}"}
        self.pending_headers = {"Cookie": f"{SESSION_COOKIE}={create_token(self.pending.id)}"}

    def tearDown(self) -> None:
        app.dependency_overrides = self._prev_overrides
        self.db.close()
        self.engine.dispose()

    def _seed_sample_plays(self) -> None:
        now = datetime.now(timezone.utc)
        self.db.add_all(
            [
                Play(
                    user_id=self.user.id,
                    deezer_id="1001",
                    title="Track <One> & More",
                    artist='Artist "Alpha"',
                    artist_id="10",
                    artists_json="[]",
                    album="LP 'One'",
                    album_id="100",
                    cover_url="https://cdn.example/cover1.jpg",
                    duration_sec=210,
                    played_at=(now - timedelta(hours=3)).replace(tzinfo=None),
                ),
                Play(
                    user_id=self.user.id,
                    deezer_id="1001",
                    title="Track <One> & More",
                    artist='Artist "Alpha"',
                    artist_id="10",
                    artists_json="[]",
                    album="LP 'One'",
                    album_id="100",
                    cover_url="https://cdn.example/cover1.jpg",
                    duration_sec=210,
                    played_at=(now - timedelta(hours=2)).replace(tzinfo=None),
                ),
                Play(
                    user_id=self.user.id,
                    deezer_id="1002",
                    title="Second Wave",
                    artist="Artist Beta",
                    artist_id="20",
                    artists_json="[]",
                    album="LP Two",
                    album_id="200",
                    cover_url="/api/uploads/custom-cover.png",
                    duration_sec=180,
                    played_at=(now - timedelta(days=1)).replace(tzinfo=None),
                ),
                Play(
                    user_id=self.other.id,
                    deezer_id="9999",
                    title="Secret Track",
                    artist="Other Artist",
                    artist_id="99",
                    artists_json="[]",
                    album="Private LP",
                    album_id="999",
                    cover_url="https://cdn.example/other-secret.jpg",
                    duration_sec=200,
                    played_at=now.replace(tzinfo=None),
                ),
            ]
        )
        self.db.add(StoredTrack(deezer_id="1001", file_path="/tmp/1001.mp3", bpm=118.5))
        self.db.commit()

    def test_auth_and_wrapped_endpoint_contract(self) -> None:
        self.assertEqual(self.client.get("/api/me/stats/wrapped").status_code, 401)
        self.assertEqual(
            self.client.get("/api/me/stats/wrapped", headers=self.pending_headers).status_code,
            403,
        )

        self._seed_sample_plays()
        resp = self.client.get("/api/me/stats/wrapped?range=30d", headers=self.user_headers)
        self.assertEqual(resp.status_code, 200)
        parsed = WrappedReport.model_validate(resp.json())
        self.assertEqual(parsed.totals.play_count, 3)
        self.assertEqual(parsed.top_tracks[0].key, "1001")

        # Existing stats endpoints stay 100% backwards-compatible.
        stats_resp = self.client.get("/api/me/stats", headers=self.user_headers)
        self.assertEqual(stats_resp.status_code, 200)
        self.assertEqual(
            set(stats_resp.json()),
            {
                "total_plays",
                "top_tracks",
                "top_artists",
                "recent",
                "total_plays_month",
                "top_tracks_month",
                "top_artists_month",
            },
        )
        insights_resp = self.client.get("/api/me/stats/insights?range=30d", headers=self.user_headers)
        self.assertEqual(insights_resp.status_code, 200)
        self.assertEqual(insights_resp.json()["play_count"], 3)

    def test_artwork_allowlist_ssrf_local_and_remote_errors(self) -> None:
        self._seed_sample_plays()

        # SSRF & cross-user rejections -> 403
        for forbidden_url in (
            "https://evil.example/ssrf.jpg",
            "http://169.254.169.254/latest/meta-data",
            "https://cdn.example/other-secret.jpg",
            "/api/users/2/avatar?v=7",
            "file:///etc/passwd",
            "//evil.example/protocol-relative.png",
        ):
            with self.subTest(url=forbidden_url):
                r = self.client.get(
                    "/api/me/stats/wrapped/artwork",
                    params={"url": forbidden_url},
                    headers=self.user_headers,
                )
                self.assertEqual(r.status_code, 403)

        # Even if a traversal path were stored in Play.cover_url, local loader rejects it with 403.
        self.db.add(
            Play(
                user_id=self.user.id,
                deezer_id="trav",
                title="Trav",
                artist="A",
                cover_url="/api/uploads/../../etc/passwd",
                duration_sec=10,
            )
        )
        self.db.commit()
        trav_resp = self.client.get(
            "/api/me/stats/wrapped/artwork",
            params={"url": "/api/uploads/../../etc/passwd"},
            headers=self.user_headers,
        )
        self.assertEqual(trav_resp.status_code, 403)

        # Local avatar & local /api/uploads/... serving
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "avatars"), exist_ok=True)
            os.makedirs(os.path.join(tmp, "uploads"), exist_ok=True)
            with open(os.path.join(tmp, "avatars", f"{self.user.id}.png"), "wb") as fh:
                fh.write(_TINY_PNG)
            with open(os.path.join(tmp, "uploads", "custom-cover.png"), "wb") as fh:
                fh.write(_TINY_PNG)

            with patch.dict(os.environ, {"STORAGE_DIR": tmp}):
                avatar_resp = self.client.get(
                    "/api/me/stats/wrapped/artwork",
                    params={"url": self.user.avatar_url},
                    headers=self.user_headers,
                )
                self.assertEqual(avatar_resp.status_code, 200)
                self.assertEqual(avatar_resp.content, _TINY_PNG)
                self.assertEqual(avatar_resp.headers["content-type"], "image/png")
                self.assertEqual(avatar_resp.headers["cache-control"], "private, max-age=3600")

                upload_resp = self.client.get(
                    "/api/me/stats/wrapped/artwork",
                    params={"url": "/api/uploads/custom-cover.png"},
                    headers=self.user_headers,
                )
                self.assertEqual(upload_resp.status_code, 200)
                self.assertEqual(upload_resp.content, _TINY_PNG)

        # Remote valid fetch
        mock_ok = MagicMock()
        mock_ok.status_code = 200
        mock_ok.headers = {"Content-Type": "image/jpeg; charset=utf-8", "Content-Length": "4"}
        mock_ok.iter_content.return_value = [b"\xff\xd8\xff\xe0"]
        with patch("app.services.wrapped.requests.get", return_value=mock_ok) as mocked_get:
            ok_resp = self.client.get(
                "/api/me/stats/wrapped/artwork",
                params={"url": "https://cdn.example/cover1.jpg"},
                headers=self.user_headers,
            )
        self.assertEqual(ok_resp.status_code, 200)
        self.assertEqual(ok_resp.content, b"\xff\xd8\xff\xe0")
        self.assertEqual(ok_resp.headers["content-type"], "image/jpeg")
        self.assertEqual(ok_resp.headers["cache-control"], "private, max-age=3600")
        mocked_get.assert_called_once_with(
            "https://cdn.example/cover1.jpg",
            timeout=10,
            stream=True,
        )

        # Upstream failures -> 502 Bad Gateway
        with patch(
            "app.services.wrapped.requests.get",
            side_effect=requests.Timeout("timed out"),
        ):
            r_timeout = self.client.get(
                "/api/me/stats/wrapped/artwork",
                params={"url": "https://cdn.example/cover1.jpg"},
                headers=self.user_headers,
            )
        self.assertEqual(r_timeout.status_code, 502)

        mock_html = MagicMock()
        mock_html.status_code = 200
        mock_html.headers = {"Content-Type": "text/html"}
        with patch("app.services.wrapped.requests.get", return_value=mock_html):
            r_ct = self.client.get(
                "/api/me/stats/wrapped/artwork",
                params={"url": "https://cdn.example/cover1.jpg"},
                headers=self.user_headers,
            )
        self.assertEqual(r_ct.status_code, 502)

        mock_huge = MagicMock()
        mock_huge.status_code = 200
        mock_huge.headers = {
            "Content-Type": "image/png",
            "Content-Length": str(MAX_IMAGE_UPLOAD_BYTES + 1),
        }
        with patch("app.services.wrapped.requests.get", return_value=mock_huge):
            r_huge = self.client.get(
                "/api/me/stats/wrapped/artwork",
                params={"url": "https://cdn.example/cover1.jpg"},
                headers=self.user_headers,
            )
        self.assertEqual(r_huge.status_code, 502)

    def test_svg_card_rendering_409_on_empty_and_xml_escaping(self) -> None:
        # Empty plays -> 409 Conflict
        empty_resp = self.client.get(
            "/api/me/stats/wrapped/card.svg?range=30d",
            headers=self.user_headers,
        )
        self.assertEqual(empty_resp.status_code, 409)
        self.assertEqual(empty_resp.json()["detail"], "Noch keine Wiedergaben in diesem Zeitraum")

        self._seed_sample_plays()
        # Test HTTP endpoint + XML validity + escaping
        svg_resp = self.client.get(
            "/api/me/stats/wrapped/card.svg?range=30d&template=summary&theme=signal&format=story",
            headers=self.user_headers,
        )
        self.assertEqual(svg_resp.status_code, 200)
        self.assertEqual(svg_resp.headers["content-type"], "image/svg+xml")
        svg_text = svg_resp.text
        self.assertIn("&lt;One&gt; &amp; More", svg_text)
        self.assertNotIn("<One>", svg_text)
        root = ET.fromstring(svg_text)
        self.assertEqual(root.attrib["width"], "1080")
        self.assertEqual(root.attrib["height"], "1920")

        # Matrix over every template x theme x format
        report = build_wrapped_report(self.db, self.user, "30d")
        for template in ("summary", "persona", "receipt", "festival", "obsession", "aura", "peak"):
            for theme in ("signal", "cover", "vinyl", "neon", "paper"):
                for fmt, expected_h in (("story", "1920"), ("square", "1080")):
                    with self.subTest(template=template, theme=theme, fmt=fmt):
                        svg = render_wrapped_card_svg(report, template, theme, fmt)
                        parsed = ET.fromstring(svg)
                        self.assertEqual(parsed.attrib["width"], "1080")
                        self.assertEqual(parsed.attrib["height"], expected_h)

    def test_openapi_schema_includes_wrapped_routes_and_schemas(self) -> None:
        schema = build_schema()
        for path in (
            "/api/me/stats/wrapped",
            "/api/me/stats/wrapped/artwork",
            "/api/me/stats/wrapped/card.svg",
        ):
            self.assertIn(path, schema["paths"])
        self.assertIn("WrappedReport", schema["components"]["schemas"])


if __name__ == "__main__":
    unittest.main()
