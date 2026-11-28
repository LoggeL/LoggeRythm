"""Regression tests for fast Deezer search, singleflight/boundary caching, pacing, and 429/Retry-After."""
from __future__ import annotations

import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from unittest.mock import Mock, patch

import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient
from requests.structures import CaseInsensitiveDict
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.db.models import Like, Playlist, PlaylistTrack, User
from app.db.session import Base, get_db
from app.main import app as full_app
from app.routers import browse, errors, likes, playlists
from app.schemas.track import Track
from app.services import deezer_client as dc
from app.services import likes_dedup, recommend
from app.services.deezer_rate_limit import (
    DeezerRateLimiter,
    RateLimitBudgetExceeded,
    parse_retry_after,
)
from app.services.discovery import DiscoveryError


def _http_response(
    *,
    status_code: int = 200,
    payload: dict | list | str = "",
    headers: dict[str, str] | None = None,
    url: str = "https://api.deezer.com/search",
) -> requests.Response:
    resp = requests.Response()
    resp.status_code = status_code
    resp.url = url
    resp.encoding = "utf-8"
    resp.headers = CaseInsensitiveDict(
        {"Content-Type": "application/json", **(headers or {})}
    )
    body = payload if isinstance(payload, str) else json.dumps(payload)
    resp._content = body.encode("utf-8")
    return resp


def _search_track(
    track_id: int,
    *,
    title: str = "Song",
    artist: str = "Artist",
    artist_id: int = 10,
    isrc: str = "USABC2500001",
) -> dict:
    return {
        "id": track_id,
        "title": title,
        "duration": 200,
        "rank": 500_000,
        "isrc": isrc,
        "explicit_lyrics": True,
        "preview": f"https://example.invalid/{track_id}.mp3",
        "artist": {"id": artist_id, "name": artist},
        "album": {
            "id": 100 + track_id,
            "title": f"Album {track_id}",
            "cover_medium": f"https://example.invalid/{track_id}.jpg",
        },
    }


def _reset_all_deezer_state() -> None:
    dc.clear_search_caches()
    dc.reset_public_rate_limiter()
    for flights in (
        dc._track_artists_flights,
        dc._track_isrc_flights,
        dc._track_detail_meta_flights,
        dc._album_record_type_flights,
    ):
        with flights.lock:
            flights.cache.clear()


class RetryAfterAndRateLimiterTests(unittest.TestCase):
    def test_parse_retry_after_preserves_full_explicit_values_without_clamping(self) -> None:
        self.assertEqual(parse_retry_after("7"), 7.0)
        self.assertEqual(parse_retry_after(" 2.5 "), 2.5)
        self.assertEqual(parse_retry_after("0"), 0.0)
        # Explicit long upstream Retry-After must NEVER be silently clamped/shortened.
        self.assertEqual(parse_retry_after("600"), 600.0)
        self.assertEqual(parse_retry_after("3600"), 3600.0)
        self.assertIsNone(parse_retry_after(None))
        self.assertIsNone(parse_retry_after(""))
        self.assertIsNone(parse_retry_after("-5"))
        self.assertIsNone(parse_retry_after("not-a-date"))
        self.assertIsNone(parse_retry_after(Mock()))

        now = datetime(2026, 11, 27, 12, 0, 0, tzinfo=timezone.utc)
        target = now + timedelta(seconds=900)
        parsed = parse_retry_after(
            format_datetime(target, usegmt=True),
            now_epoch=lambda: now.timestamp(),
        )
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertAlmostEqual(parsed, 900.0, places=3)

        past = now - timedelta(seconds=10)
        self.assertEqual(
            parse_retry_after(
                format_datetime(past, usegmt=True),
                now_epoch=lambda: now.timestamp(),
            ),
            0.0,
        )

    def test_proactive_pacing_adds_zero_delay_for_normal_searches_and_paces_bursts(self) -> None:
        clock = [100.0]
        sleeps: list[float] = []

        def advance(seconds: float) -> None:
            sleeps.append(seconds)
            clock[0] += seconds

        limiter = DeezerRateLimiter(
            burst_limit=4,
            burst_window_sec=1.0,
            sustained_limit=6,
            sustained_window_sec=5.0,
            clock=lambda: clock[0],
            sleep=advance,
        )

        # Normal 4-call combined search has 0 pacing delay.
        for _ in range(4):
            limiter.acquire(max_wait_sec=1.5)
        self.assertEqual(sleeps, [])

        # 5th call within 1.0s paces smoothly until burst window expires.
        limiter.acquire(max_wait_sec=1.5)
        self.assertEqual(sleeps, [1.0])

        # 6th call fits in sustained window (6 / 5s); 7th exceeds interactive wait budget and fails fast.
        limiter.acquire(max_wait_sec=1.5)
        with self.assertRaises(RateLimitBudgetExceeded) as caught:
            limiter.acquire(max_wait_sec=1.5)
        self.assertGreater(caught.exception.retry_after_sec, 3.0)
        # Failed fast without sleeping!
        self.assertEqual(sleeps, [1.0])

    def test_shared_cooldown_records_full_explicit_retry_after_and_resets_after_success(self) -> None:
        clock = [50.0]
        sleeps: list[float] = []
        limiter = DeezerRateLimiter(
            clock=lambda: clock[0],
            sleep=lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + s)),
        )

        # Explicit 600s Retry-After is recorded verbatim without truncation.
        self.assertEqual(limiter.record_rate_limit(600.0), 600.0)
        self.assertAlmostEqual(limiter.cooldown_remaining(), 600.0, places=3)
        with self.assertRaises(RateLimitBudgetExceeded) as caught:
            limiter.acquire(max_wait_sec=1.5)
        self.assertAlmostEqual(caught.exception.retry_after_sec, 600.0, places=3)
        self.assertEqual(sleeps, [])

        # After cooldown expires and a request succeeds, headerless escalation resets to 1s -> 2s.
        clock[0] += 600.0
        limiter.acquire(max_wait_sec=1.5)
        limiter.record_success()
        self.assertEqual(limiter.record_rate_limit(None), 1.0)
        clock[0] += 1.0
        self.assertEqual(limiter.record_rate_limit(None), 2.0)


class SearchCachingSingleflightAndBoundariesTests(unittest.TestCase):
    def setUp(self) -> None:
        _reset_all_deezer_state()

    def tearDown(self) -> None:
        _reset_all_deezer_state()

    def test_cold_search_makes_single_upstream_request_per_entity_and_preserves_order(self) -> None:
        tracks_payload = {
            "data": [
                _search_track(1, title="First Hit", isrc="USABC2500001"),
                _search_track(2, title="Second Hit", isrc="USABC2500002"),
            ]
        }
        albums_payload = {"data": [{"id": 10, "title": "Album A", "artist": {"name": "Artist"}}]}
        artists_payload = {"data": [{"id": 20, "name": "Artist A"}]}
        playlists_payload = {"data": [{"id": 30, "title": "Mix A", "nb_tracks": 12}]}

        with patch.object(dc, "_public_get", return_value=tracks_payload) as get:
            tracks = dc.search_tracks_public("daft punk")
        get.assert_called_once_with("/search?q=daft+punk&limit=40", interactive=True)
        self.assertEqual([t["id"] for t in tracks], ["1", "2"])
        self.assertEqual(tracks[0]["isrc"], "USABC2500001")
        self.assertIs(tracks[0]["explicit"], True)

        with patch.object(dc, "_public_get", return_value=albums_payload) as get:
            albums = dc.search_albums("daft punk")
        get.assert_called_once_with("/search/album?q=daft+punk&limit=25", interactive=True)
        self.assertEqual(albums[0]["id"], "10")

        with patch.object(dc, "_public_get", return_value=artists_payload) as get:
            artists = dc.search_artists("daft punk")
        get.assert_called_once_with("/search/artist?q=daft+punk&limit=24", interactive=True)
        self.assertEqual(artists[0]["id"], "20")

        with patch.object(dc, "_public_get", return_value=playlists_payload) as get:
            pls = dc.search_playlists("daft punk")
        get.assert_called_once_with("/search/playlist?q=daft+punk&limit=24", interactive=True)
        self.assertEqual(pls[0]["id"], "30")

    def test_concurrent_identical_searches_deduplicate_across_all_four_entities(self) -> None:
        cases = (
            ("track", dc.search_tracks_public, {"data": [_search_track(1)]}),
            ("album", dc.search_albums, {"data": [{"id": 10, "title": "A", "artist": {"name": "Art"}}]}),
            ("artist", dc.search_artists, {"data": [{"id": 20, "name": "Art"}]}),
            ("playlist", dc.search_playlists, {"data": [{"id": 30, "title": "P", "nb_tracks": 5}]}),
        )
        for kind, fn, payload in cases:
            with self.subTest(kind=kind):
                _reset_all_deezer_state()
                entered = threading.Event()
                release = threading.Event()

                def fetch(_path: str, **_kwargs: object) -> dict:
                    entered.set()
                    self.assertTrue(release.wait(2))
                    return payload

                with patch.object(dc, "_public_get", side_effect=fetch) as get:
                    with ThreadPoolExecutor(max_workers=6) as pool:
                        futures = [pool.submit(fn, "daft punk") for _ in range(6)]
                        try:
                            self.assertTrue(entered.wait(2))
                            threading.Event().wait(0.03)
                        finally:
                            release.set()
                        results = [f.result(timeout=2) for f in futures]

                self.assertEqual(get.call_count, 1)
                self.assertTrue(all(len(r) == 1 for r in results))
                results[0].clear()
                self.assertEqual(len(results[1]), 1)

    def test_cache_keys_preserve_case_internal_whitespace_limit_entity_and_enrich_boundaries(self) -> None:
        with patch.object(dc, "_public_get", return_value={"data": []}) as get:
            # Identical outer-trimmed queries share cache.
            dc.search_tracks_public("  daft punk  ", limit=10)
            dc.search_tracks_public("daft punk", limit=10)
            # Case and internal whitespace stay distinct.
            dc.search_tracks_public("Daft Punk", limit=10)
            dc.search_tracks_public("daft  punk", limit=10)
            # Limit and enrich stay distinct.
            dc.search_tracks_public("daft punk", limit=20)
            dc.search_tracks_public("daft punk", limit=10, enrich=True)
            # Other catalog entities stay isolated and share outer-trimmed hits.
            dc.search_albums("  daft punk  ")
            dc.search_albums("daft punk")
            dc.search_artists("  daft punk  ")
            dc.search_artists("daft punk")
            dc.search_playlists("  daft punk  ")
            dc.search_playlists("daft punk")

        paths = [call.args[0] for call in get.call_args_list]
        self.assertEqual(
            paths,
            [
                "/search?q=daft+punk&limit=10",
                "/search?q=Daft+Punk&limit=10",
                "/search?q=daft++punk&limit=10",
                "/search?q=daft+punk&limit=20",
                "/search?q=daft+punk&limit=10",
                "/search/album?q=daft+punk&limit=25",
                "/search/artist?q=daft+punk&limit=24",
                "/search/playlist?q=daft+punk&limit=24",
            ],
        )

    def test_public_session_rejects_cookies_and_reuses_pooled_session(self) -> None:
        seen_sessions: list[int] = []

        def fake_send(
            sess: requests.Session,
            prepared: requests.PreparedRequest,
            **_kwargs: object,
        ) -> requests.Response:
            seen_sessions.append(id(sess))
            self.assertNotIn("Cookie", prepared.headers)
            return _http_response(
                status_code=200,
                payload={"data": []},
                headers={"Set-Cookie": "arl=should-never-persist; Path=/"},
                url=prepared.url or "https://api.deezer.com/search",
            )

        with patch.object(requests.sessions.Session, "send", fake_send):
            dc.search_artists("first")
            dc.search_artists("second")

        self.assertEqual(len(seen_sessions), 2)
        self.assertEqual(len(set(seen_sessions)), 1)
        self.assertEqual(len(dc._public_session.cookies), 0)


class PublicTransportRateLimitHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        sub_app = FastAPI()
        sub_app.include_router(browse.router)
        cls.client = TestClient(sub_app)
        cls.full_client = TestClient(full_app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()
        cls.full_client.close()

    def setUp(self) -> None:
        _reset_all_deezer_state()

    def tearDown(self) -> None:
        _reset_all_deezer_state()

    def test_http_429_long_retry_after_fails_fast_preserves_full_duration_and_blocks_hammering(self) -> None:
        clock = [100.0]
        sleeps: list[float] = []
        limiter = DeezerRateLimiter(
            clock=lambda: clock[0],
            sleep=lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + s)),
        )
        responses = [
            _http_response(status_code=200, payload={"data": [{"id": 1, "name": "Cached Artist"}]}),
            _http_response(
                status_code=429,
                payload={"error": {"message": "Too Many Requests", "code": 4}},
                headers={"Retry-After": "600"},
            ),
        ]

        with (
            patch.object(dc, "_public_rate_limiter", limiter),
            patch.object(dc._public_session, "get", side_effect=responses) as session_get,
        ):
            seeded = self.client.get("/api/search/artist", params={"q": "cached"})
            self.assertEqual(seeded.status_code, 200)

            # Long explicit Retry-After (600s) fails fast without sleeping and is NEVER clamped.
            limited = self.client.get("/api/search/artist", params={"q": "uncached"})
            self.assertEqual(limited.status_code, 429)
            self.assertEqual(limited.headers.get("retry-after"), "600")
            self.assertIn("Deezer rate limit reached", limited.json()["detail"])
            self.assertIn("600s", limited.json()["detail"])
            self.assertEqual(sleeps, [])
            self.assertEqual(session_get.call_count, 2)

            # Another cache-miss during cooldown fails fast with full remaining Retry-After and 0 upstream calls.
            blocked = self.client.get("/api/search/artist", params={"q": "another"})
            self.assertEqual(blocked.status_code, 429)
            self.assertEqual(blocked.headers.get("retry-after"), "600")
            self.assertEqual(session_get.call_count, 2)

            # Cached query still succeeds during cooldown with 0 upstream requests.
            still_cached = self.client.get("/api/search/artist", params={"q": "cached"})
            self.assertEqual(still_cached.status_code, 200)
            self.assertEqual(session_get.call_count, 2)

    def test_http_429_short_retry_after_retries_once_and_recovers(self) -> None:
        clock = [100.0]
        sleeps: list[float] = []
        limiter = DeezerRateLimiter(
            clock=lambda: clock[0],
            sleep=lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + s)),
        )
        responses = [
            _http_response(status_code=429, payload="slow down", headers={"Retry-After": "1"}),
            _http_response(status_code=200, payload={"data": [{"id": 7, "name": "Recovered"}]}),
        ]

        with (
            patch.object(dc, "_public_rate_limiter", limiter),
            patch.object(dc._public_session, "get", side_effect=responses) as session_get,
        ):
            resp = self.client.get("/api/search/artist", params={"q": "daft"})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()[0]["name"], "Recovered")
        self.assertEqual(session_get.call_count, 2)
        self.assertEqual(sleeps, [1.0])

    def test_json_quota_error_propagates_429_and_retry_after_when_persistent(self) -> None:
        clock = [100.0]
        sleeps: list[float] = []
        limiter = DeezerRateLimiter(
            clock=lambda: clock[0],
            sleep=lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + s)),
        )
        quota_resp = _http_response(
            status_code=200,
            payload={"error": {"type": "Exception", "message": "Quota limit exceeded", "code": 4}},
        )

        with (
            patch.object(dc, "_public_rate_limiter", limiter),
            patch.object(dc._public_session, "get", return_value=quota_resp) as session_get,
        ):
            resp = self.client.get("/api/search", params={"q": "daft", "type": "track"})

        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.headers.get("retry-after"), "2")
        self.assertEqual(session_get.call_count, 2)
        self.assertEqual(sleeps, [1.0])

    def test_http_404_from_public_api_maps_to_404_not_502(self) -> None:
        with patch.object(
            dc._public_session,
            "get",
            return_value=_http_response(status_code=404, payload="{}"),
        ):
            resp = self.client.get("/api/tracks/9999999")
        self.assertEqual(resp.status_code, 404)

    def test_discovery_error_and_rewrap_preserve_retry_after_header(self) -> None:
        wrapped = DiscoveryError(
            "failed",
            failures=(
                dc.RateLimited("first", retry_after_sec=3.1),
                dc.RateLimited("second", retry_after_sec=7.2),
            ),
        )
        http_exc = errors.to_http(wrapped)
        self.assertEqual(http_exc.status_code, 429)
        self.assertEqual(http_exc.headers, {"Retry-After": "8"})

        with patch.object(dc, "_public_get", side_effect=dc.RateLimited("quota", retry_after_sec=9.0)):
            with self.assertRaises(dc.RateLimited) as caught:
                dc.album_record_type("12345")
        self.assertEqual(caught.exception.retry_after_sec, 9.0)

    def test_cors_exposes_retry_after_header(self) -> None:
        with patch.object(dc, "search_artists", side_effect=dc.RateLimited("quota", retry_after_sec=6.0)):
            resp = self.full_client.get(
                "/api/search/artist",
                params={"q": "daft"},
                headers={"Origin": "http://localhost:3000"},
            )
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.headers.get("retry-after"), "6")
        self.assertIn("Retry-After", resp.headers.get("access-control-expose-headers", ""))


class LazyCreditsReuseAndEnrichedCallersTests(unittest.TestCase):
    def setUp(self) -> None:
        _reset_all_deezer_state()

    def tearDown(self) -> None:
        _reset_all_deezer_state()

    def test_like_and_playlist_writes_reuse_cached_full_credits_and_loudness_with_zero_extra_calls(self) -> None:
        detail = {
            **_search_track(2947516331, title="Die With A Smile", artist="Lady Gaga", isrc="USUM72409273"),
            "gain": -7.5,
            "bpm": 158.0,
            "contributors": [
                {"id": 75491, "name": "Lady Gaga"},
                {"id": 429675, "name": "Bruno Mars"},
            ],
        }
        with patch.object(dc, "_public_get", return_value=detail):
            dc.track_public("2947516331")

        search_track = Track(
            id="2947516331",
            title="Die With A Smile",
            artist="Lady Gaga",
            artist_id="75491",
            artists=[{"id": "75491", "name": "Lady Gaga"}],
            album="Die With A Smile",
            album_id="629506181",
            duration_sec=250,
            isrc="USUM72409273",
        )

        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(engine)
        try:
            with Session(engine) as db:
                user = User(email="u@test.local", password_hash="x", is_approved=True)
                db.add(user)
                db.flush()
                pl = Playlist(user_id=user.id, name="Favorites")
                db.add(pl)
                db.commit()

                with patch.object(dc, "_public_get", side_effect=AssertionError("Must not call Deezer")):
                    saved_like = likes_dedup.upsert_deduped_like(db, user.id, "2947516331", search_track)
                    playlists.add_track(pl.id, search_track, user=user, db=db)

                self.assertEqual(
                    json.loads(saved_like.artists_json),
                    [
                        {"id": "75491", "name": "Lady Gaga"},
                        {"id": "429675", "name": "Bruno Mars"},
                    ],
                )
                self.assertEqual(saved_like.loudness_gain_db, -7.5)

                pt = db.scalar(select(PlaylistTrack).where(PlaylistTrack.playlist_id == pl.id))
                self.assertIsNotNone(pt)
                assert pt is not None
                self.assertEqual(
                    json.loads(pt.artists_json),
                    [
                        {"id": "75491", "name": "Lady Gaga"},
                        {"id": "429675", "name": "Bruno Mars"},
                    ],
                )
                self.assertEqual(pt.loudness_gain_db, -7.5)
        finally:
            engine.dispose()

    def test_cold_search_direct_like_hydrates_single_track_and_reuses_cache_for_playlist_add(self) -> None:
        search_hit = _search_track(
            2947516331,
            title="Die With A Smile",
            artist="Lady Gaga",
            artist_id=75491,
            isrc="USUM72409273",
        )
        full_detail = {
            **search_hit,
            "gain": -7.5,
            "bpm": 158.0,
            "contributors": [
                {"id": 75491, "name": "Lady Gaga"},
                {"id": 429675, "name": "Bruno Mars"},
            ],
        }
        calls: list[str] = []

        def fake_get(path: str, **_kwargs: object) -> dict:
            calls.append(path)
            if path.startswith("/search?"):
                return {"data": [search_hit]}
            if path == "/track/2947516331":
                return full_detail
            raise AssertionError(f"Unexpected upstream path {path}")

        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(engine)
        try:
            with Session(engine) as db:
                user = User(email="u@test.local", password_hash="x", is_approved=True)
                db.add(user)
                db.flush()
                pl = Playlist(user_id=user.id, name="Direct Save")
                db.add(pl)
                db.commit()

                api = FastAPI()
                api.include_router(browse.router)
                api.include_router(likes.router)
                api.include_router(playlists.router)
                api.dependency_overrides[get_current_user] = lambda: user
                api.dependency_overrides[get_db] = lambda: db

                with TestClient(api) as client, patch.object(dc, "_public_get", side_effect=fake_get):
                    # 1. Cold search makes strictly 1 Deezer core call (inline ISRC, primary artist only).
                    search_resp = client.get("/api/search", params={"q": "Die With A Smile", "type": "track"})
                    self.assertEqual(search_resp.status_code, 200)
                    self.assertEqual(calls, ["/search?q=Die+With+A+Smile&limit=40"])
                    cold_track = search_resp.json()[0]
                    self.assertEqual(cold_track["isrc"], "USUM72409273")
                    self.assertEqual(cold_track["artists"], [{"id": "75491", "name": "Lady Gaga"}])
                    self.assertEqual(dc._track_artists_flights.peek("2947516331"), (False, None))

                    # 2. Direct Like hydrates ONLY that 1 track and persists full multi-artist credits.
                    like_resp = client.put("/api/me/likes/2947516331", json=cold_track)
                    self.assertEqual(like_resp.status_code, 204)
                    self.assertEqual(
                        calls,
                        ["/search?q=Die+With+A+Smile&limit=40", "/track/2947516331"],
                    )

                    # 3. Follow-up Playlist-Add reuses the warm cache (0 extra upstream calls).
                    pl_resp = client.post(f"/api/playlists/{pl.id}/tracks", json=cold_track)
                    self.assertEqual(pl_resp.status_code, 204)
                    self.assertEqual(len(calls), 2)

                expected_artists = [
                    {"id": "75491", "name": "Lady Gaga"},
                    {"id": "429675", "name": "Bruno Mars"},
                ]
                saved_like = db.scalar(select(Like).where(Like.deezer_id == "2947516331"))
                self.assertIsNotNone(saved_like)
                assert saved_like is not None
                self.assertEqual(json.loads(saved_like.artists_json), expected_artists)
                self.assertEqual(saved_like.loudness_gain_db, -7.5)

                saved_pt = db.scalar(select(PlaylistTrack).where(PlaylistTrack.playlist_id == pl.id))
                self.assertIsNotNone(saved_pt)
                assert saved_pt is not None
                self.assertEqual(json.loads(saved_pt.artists_json), expected_artists)
                self.assertEqual(saved_pt.loudness_gain_db, -7.5)
        finally:
            engine.dispose()

    def test_cold_search_direct_playlist_add_hydrates_single_track_and_fails_loud_on_429(self) -> None:
        search_hit = _search_track(
            2947516331,
            title="Die With A Smile",
            artist="Lady Gaga",
            artist_id=75491,
            isrc="USUM72409273",
        )
        full_detail = {
            **search_hit,
            "gain": -6.8,
            "contributors": [
                {"id": 75491, "name": "Lady Gaga"},
                {"id": 429675, "name": "Bruno Mars"},
            ],
        }
        calls: list[str] = []

        def fake_get(path: str, **_kwargs: object) -> dict:
            calls.append(path)
            if path.startswith("/search?"):
                return {"data": [search_hit]}
            if path == "/track/2947516331":
                return full_detail
            raise AssertionError(f"Unexpected upstream path {path}")

        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(engine)
        try:
            with Session(engine) as db:
                user = User(email="u@test.local", password_hash="x", is_approved=True)
                db.add(user)
                db.flush()
                pl = Playlist(user_id=user.id, name="Direct Playlist")
                db.add(pl)
                db.commit()

                api = FastAPI()
                api.include_router(browse.router)
                api.include_router(likes.router)
                api.include_router(playlists.router)
                api.dependency_overrides[get_current_user] = lambda: user
                api.dependency_overrides[get_db] = lambda: db

                with TestClient(api) as client:
                    # Cold search (1 call) -> direct Playlist-Add (1 /track/{id} call) -> full credits persisted.
                    with patch.object(dc, "_public_get", side_effect=fake_get):
                        search_resp = client.get("/api/search", params={"q": "Die With A Smile", "type": "track"})
                        self.assertEqual(search_resp.status_code, 200)
                        cold_track = search_resp.json()[0]
                        self.assertEqual(calls, ["/search?q=Die+With+A+Smile&limit=40"])

                        pl_resp = client.post(f"/api/playlists/{pl.id}/tracks", json=cold_track)
                        self.assertEqual(pl_resp.status_code, 204)
                        self.assertEqual(
                            calls,
                            ["/search?q=Die+With+A+Smile&limit=40", "/track/2947516331"],
                        )

                        # Subsequent Like hits warm cache (0 extra upstream calls).
                        like_resp = client.put("/api/me/likes/2947516331", json=cold_track)
                        self.assertEqual(like_resp.status_code, 204)
                        self.assertEqual(len(calls), 2)

                    expected_artists = [
                        {"id": "75491", "name": "Lady Gaga"},
                        {"id": "429675", "name": "Bruno Mars"},
                    ]
                    saved_pt = db.scalar(select(PlaylistTrack).where(PlaylistTrack.playlist_id == pl.id))
                    self.assertIsNotNone(saved_pt)
                    assert saved_pt is not None
                    self.assertEqual(json.loads(saved_pt.artists_json), expected_artists)
                    self.assertEqual(saved_pt.loudness_gain_db, -6.8)

                    # Upstream 429 during cold hydration MUST fail loud (429 + Retry-After), never silently lose credits.
                    _reset_all_deezer_state()
                    cold_other = {**cold_track, "id": "3333333"}
                    with patch.object(
                        dc, "_public_get", side_effect=dc.RateLimited("quota", retry_after_sec=11.0)
                    ):
                        fail_pl = client.post(f"/api/playlists/{pl.id}/tracks", json=cold_other)
                        self.assertEqual(fail_pl.status_code, 429)
                        self.assertEqual(fail_pl.headers.get("retry-after"), "11")

                        fail_like = client.put("/api/me/likes/3333333", json=cold_other)
                        self.assertEqual(fail_like.status_code, 429)
                        self.assertEqual(fail_like.headers.get("retry-after"), "11")
        finally:
            engine.dispose()

    def test_match_track_and_recommend_preserve_full_credits_explicitly(self) -> None:
        search_hit = _search_track(2947516331, title="Die With A Smile", artist="Lady Gaga", isrc="USUM72409273")
        full_detail = {
            **search_hit,
            "contributors": [
                {"id": 75491, "name": "Lady Gaga"},
                {"id": 429675, "name": "Bruno Mars"},
            ],
        }

        def fake_get(path: str, **_kwargs: object) -> dict:
            if path.startswith("/search?"):
                return {"data": [search_hit]}
            if path == "/track/2947516331":
                return full_detail
            raise AssertionError(f"Unexpected path {path}")

        with patch.object(dc, "_public_get", side_effect=fake_get):
            matched = dc.match_track("Die With A Smile", "Lady Gaga")
        self.assertIsNotNone(matched)
        assert matched is not None
        self.assertEqual([a["name"] for a in matched["artists"]], ["Lady Gaga", "Bruno Mars"])

        _reset_all_deezer_state()
        with patch.object(dc, "_public_get", side_effect=fake_get):
            resolved = recommend.resolve_queries(["Lady Gaga Die With A Smile"], limit=1)
        self.assertEqual(len(resolved), 1)
        self.assertEqual([a["name"] for a in resolved[0]["artists"]], ["Lady Gaga", "Bruno Mars"])


if __name__ == "__main__":
    unittest.main()
