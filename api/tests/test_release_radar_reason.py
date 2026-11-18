"""The release radar must say why each track is in it.

Every radar track carries ``radar_reason``: the watched source artist whose
release list produced the track, and whether that artist is watched because
the user follows them or because the user played them.
"""
from __future__ import annotations

import threading
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user_optional
from app.db.models import FollowedArtist, Play, User
from app.db.session import Base, get_db
from app.openapi_contract import build_schema
from app.routers import home
from app.schemas.track import RadarReason, RadarTrack, Track


def _track(track_id: str, *, artist: str, artist_id: str, release_date: str) -> dict:
    return {
        "id": track_id,
        "title": f"Song {track_id}",
        "artist": artist,
        "artist_id": artist_id,
        "artists": [{"id": artist_id, "name": artist}],
        "album": "Album",
        "album_id": "900",
        "cover": "",
        "duration_sec": 180,
        "preview_url": None,
        "rank": 1,
        "release_date": release_date,
    }


def setUpModule() -> None:
    # Serving a radar also queues its newest tracks for server pre-caching
    # (covered by test_release_radar_preload); these tests are about the reason.
    patcher = patch.object(home.radar_preload, "schedule")
    patcher.start()
    unittest.addModuleCleanup(patcher.stop)


class RadarDatabaseTestCase(unittest.TestCase):
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
        self.other_user = User(
            email="other@example.test",
            password_hash="unused",
            display_name="Other",
            is_approved=True,
        )
        self.db.add_all([self.user, self.other_user])
        self.db.commit()
        self.now = datetime.utcnow()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def play(
        self,
        artist_id: str,
        artist: str,
        *,
        days_ago: float = 1,
        user: User | None = None,
    ) -> None:
        self.db.add(
            Play(
                user_id=(user or self.user).id,
                deezer_id="1",
                title="Song",
                artist=artist,
                artist_id=artist_id,
                played_at=self.now - timedelta(days=days_ago),
            )
        )
        self.db.commit()

    def follow(
        self,
        artist_id: str,
        name: str,
        *,
        days_ago: float = 1,
        user: User | None = None,
    ) -> None:
        self.db.add(
            FollowedArtist(
                user_id=(user or self.user).id,
                artist_id=artist_id,
                name=name,
                created_at=self.now - timedelta(days=days_ago),
            )
        )
        self.db.commit()


class RadarWatchListTests(RadarDatabaseTestCase):
    def test_watch_list_orders_played_artists_first_and_explains_each_artist(self) -> None:
        for _ in range(3):
            self.play("10", "Most Played")
        for _ in range(2):
            self.play("20", "Played And Followed")
        self.play("30", "Followed, One Play")
        self.play("40", "Played Once, Not Followed")
        self.follow("20", "Played And Followed", days_ago=5)
        self.follow("30", "Followed, One Play", days_ago=2)
        self.follow("50", "Followed, Never Played", days_ago=3)

        self.assertEqual(
            home._radar_artists(self.db, self.user),
            [
                home.RadarArtist("10", "Most Played", 3, False),
                home.RadarArtist("20", "Played And Followed", 2, True),
                # Follow-only artists come after played ones, newest follow first.
                home.RadarArtist("30", "Followed, One Play", 1, True),
                home.RadarArtist("50", "Followed, Never Played", 0, True),
            ],
        )

    def test_only_this_users_plays_inside_the_90_day_window_count(self) -> None:
        self.play("10", "In Window", days_ago=89)
        self.play("10", "In Window", days_ago=1)
        # Outside the window: neither counted nor able to qualify the artist.
        self.play("10", "In Window", days_ago=91)
        self.play("20", "Too Old", days_ago=91)
        self.play("20", "Too Old", days_ago=120)
        for _ in range(5):
            self.play("30", "Someone Else's Artist", user=self.other_user)
        self.follow("60", "Someone Else's Follow", user=self.other_user)

        self.assertEqual(
            home._radar_artists(self.db, self.user),
            [home.RadarArtist("10", "In Window", 2, False)],
        )

    def test_equal_play_counts_are_ordered_deterministically_by_artist_id(self) -> None:
        for artist_id in ("30", "10", "20"):
            self.play(artist_id, f"Artist {artist_id}")
            self.play(artist_id, f"Artist {artist_id}")

        self.assertEqual(
            [artist.artist_id for artist in home._radar_artists(self.db, self.user)],
            ["10", "20", "30"],
        )

    def test_plays_under_several_names_count_together_and_use_the_latest_name(self) -> None:
        self.play("10", "Old Spelling", days_ago=30)
        self.play("10", "Old Spelling", days_ago=20)
        self.play("10", "", days_ago=2)
        self.play("10", "New Spelling", days_ago=3)

        self.assertEqual(
            home._radar_artists(self.db, self.user),
            [home.RadarArtist("10", "New Spelling", 4, False)],
        )

    def test_followed_name_wins_and_a_missing_followed_name_uses_the_played_name(self) -> None:
        self.play("10", "Played Name")
        self.play("10", "Played Name")
        self.follow("10", "Followed Name")
        self.play("20", "Only The Plays Know")
        self.follow("20", "")

        self.assertEqual(
            home._radar_artists(self.db, self.user),
            [
                home.RadarArtist("10", "Followed Name", 2, True),
                home.RadarArtist("20", "Only The Plays Know", 1, True),
            ],
        )

    def test_an_artist_without_any_stored_name_is_reported_with_an_empty_name(self) -> None:
        # Both columns default to "": legacy rows can hold an ID without a
        # name. The radar must neither invent a name nor fail for such a row.
        self.play("10", "")
        self.play("10", "   ")
        self.follow("20", "")

        self.assertEqual(
            home._radar_artists(self.db, self.user),
            [
                home.RadarArtist("10", "", 2, False),
                home.RadarArtist("20", "", 0, True),
            ],
        )

    def test_plays_and_follows_without_an_artist_id_are_never_watched(self) -> None:
        self.play("", "No ID")
        self.play("", "No ID")
        self.follow("", "No ID")

        self.assertEqual(home._radar_artists(self.db, self.user), [])

    def test_limit_caps_the_watch_list_but_still_knows_every_follow(self) -> None:
        for _ in range(2):
            self.play("10", "Played And Followed Long Ago")
        # The oldest follow is outside the two most recent follows, yet it must
        # still mark the played artist as followed.
        self.follow("10", "Played And Followed Long Ago", days_ago=50)
        self.follow("20", "Recent Follow", days_ago=1)
        self.follow("30", "Second Most Recent Follow", days_ago=2)
        self.follow("40", "Cut Off Follow", days_ago=3)

        self.assertEqual(
            home._radar_artists(self.db, self.user, limit=2),
            [
                home.RadarArtist("10", "Played And Followed Long Ago", 2, True),
                home.RadarArtist("20", "Recent Follow", 0, True),
            ],
        )


class RadarReasonTests(unittest.TestCase):
    def radar(self, artists: list[home.RadarArtist], produced: dict[str, list[dict]]) -> list[dict]:
        def artist_tracks(artist_id: str, _cutoff: str, *, refresh: bool) -> list[dict]:
            return [dict(track) for track in produced[artist_id]]

        with (
            patch.object(home, "_radar_artists", return_value=artists),
            patch.object(home, "_artist_new_tracks", side_effect=artist_tracks),
        ):
            return home.release_radar(
                user=object(),  # type: ignore[arg-type]
                db=object(),  # type: ignore[arg-type]
            )

    def test_every_track_names_the_watched_artist_that_produced_it(self) -> None:
        tracks = self.radar(
            [
                home.RadarArtist("10", "Played Artist", 7, False),
                home.RadarArtist("20", "Followed Artist", 0, True),
            ],
            {
                "10": [_track("1", artist="Played Artist", artist_id="10", release_date="2026-03-01")],
                "20": [_track("2", artist="Followed Artist", artist_id="20", release_date="2026-03-02")],
            },
        )

        self.assertEqual([track["id"] for track in tracks], ["2", "1"])
        self.assertEqual(
            tracks[0]["radar_reason"],
            {"kind": "followed", "artist_id": "20", "artist_name": "Followed Artist", "play_count": 0},
        )
        self.assertEqual(
            tracks[1]["radar_reason"],
            {"kind": "played", "artist_id": "10", "artist_name": "Played Artist", "play_count": 7},
        )

    def test_followed_wins_when_the_source_artist_is_both_followed_and_played(self) -> None:
        tracks = self.radar(
            [home.RadarArtist("10", "Both", 12, True)],
            {"10": [_track("1", artist="Both", artist_id="10", release_date="2026-03-01")]},
        )

        self.assertEqual(
            tracks[0]["radar_reason"],
            {"kind": "followed", "artist_id": "10", "artist_name": "Both", "play_count": 12},
        )

    def test_reason_names_the_watched_source_artist_not_the_tracks_primary_artist(self) -> None:
        # Deezer lists a release under a watched artist who only contributes to
        # it. The listener does not know the primary artist — the reason must
        # point at the artist they do know.
        tracks = self.radar(
            [home.RadarArtist("10", "Artist I Know", 4, False)],
            {"10": [_track("1", artist="Stranger", artist_id="999", release_date="2026-03-01")]},
        )

        self.assertEqual(tracks[0]["artist"], "Stranger")
        self.assertEqual(tracks[0]["artist_id"], "999")
        self.assertEqual(
            tracks[0]["radar_reason"],
            {"kind": "played", "artist_id": "10", "artist_name": "Artist I Know", "play_count": 4},
        )

    def test_shared_track_is_attributed_to_the_first_watched_artist_in_any_completion_order(self) -> None:
        shared = _track("1", artist="Stranger", artist_id="999", release_date="2026-03-01")
        artists = [
            home.RadarArtist("10", "First Watched", 9, False),
            home.RadarArtist("20", "Second Watched", 0, True),
        ]
        first_may_finish = threading.Event()

        def artist_tracks(artist_id: str, _cutoff: str, *, refresh: bool) -> list[dict]:
            if artist_id == "10":
                # Force the second watched artist's lookup to complete first.
                if not first_may_finish.wait(timeout=5):
                    raise AssertionError("second artist lookup never completed")
            else:
                first_may_finish.set()
            return [dict(shared)]

        with (
            patch.object(home, "_radar_artists", return_value=artists),
            patch.object(home, "_artist_new_tracks", side_effect=artist_tracks),
        ):
            tracks = home.release_radar(
                user=object(),  # type: ignore[arg-type]
                db=object(),  # type: ignore[arg-type]
            )

        self.assertEqual(len(tracks), 1)
        self.assertEqual(
            tracks[0]["radar_reason"],
            {"kind": "played", "artist_id": "10", "artist_name": "First Watched", "play_count": 9},
        )

    def test_attaching_a_reason_never_mutates_the_provider_track(self) -> None:
        provider_track = _track("1", artist="A", artist_id="10", release_date="2026-03-01")
        with (
            patch.object(
                home, "_radar_artists", return_value=[home.RadarArtist("10", "A", 2, False)]
            ),
            patch.object(home, "_artist_new_tracks", return_value=[provider_track]),
        ):
            tracks = home.release_radar(
                user=object(),  # type: ignore[arg-type]
                db=object(),  # type: ignore[arg-type]
            )

        self.assertIn("radar_reason", tracks[0])
        self.assertNotIn("radar_reason", provider_track)

    def test_a_watched_artist_without_any_reason_fails_loudly(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "watches artist 10 without a reason: not followed and only 1 plays",
        ):
            self.radar(
                [home.RadarArtist("10", "Neither", 1, False)],
                {"10": [_track("1", artist="Neither", artist_id="10", release_date="2026-03-01")]},
            )


class RadarEndpointContractTests(RadarDatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.api = FastAPI()
        self.api.include_router(home.router)
        self.api.dependency_overrides[get_current_user_optional] = lambda: self.user
        self.api.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(self.api)

    def test_endpoint_serializes_the_reason_from_real_play_and_follow_rows(self) -> None:
        for _ in range(3):
            self.play("10", "Artist I Play")
        self.follow("20", "Artist I Follow")
        produced = {
            "10": [_track("1", artist="Stranger", artist_id="999", release_date="2026-03-01")],
            "20": [_track("2", artist="Artist I Follow", artist_id="20", release_date="2026-02-01")],
        }

        def artist_tracks(artist_id: str, _cutoff: str, *, refresh: bool) -> list[dict]:
            return [dict(track) for track in produced[artist_id]]

        with patch.object(home, "_artist_new_tracks", side_effect=artist_tracks):
            response = self.client.get("/api/home/release-radar")

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual([track["id"] for track in body], ["1", "2"])
        self.assertEqual(body[0]["artist"], "Stranger")
        self.assertEqual(
            body[0]["radar_reason"],
            {"kind": "played", "artist_id": "10", "artist_name": "Artist I Play", "play_count": 3},
        )
        self.assertEqual(
            body[1]["radar_reason"],
            {"kind": "followed", "artist_id": "20", "artist_name": "Artist I Follow", "play_count": 0},
        )
        # The reason is additive: every pre-existing Track field is still sent.
        self.assertLessEqual(set(Track.model_fields), set(body[0]))

    def test_signed_out_radar_stays_an_empty_list(self) -> None:
        self.api.dependency_overrides[get_current_user_optional] = lambda: None

        response = self.client.get("/api/home/release-radar")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), [])

    def test_radar_track_requires_a_complete_reason(self) -> None:
        track = _track("1", artist="A", artist_id="10", release_date="2026-03-01")
        reason = {"kind": "played", "artist_id": "10", "artist_name": "A", "play_count": 2}
        self.assertEqual(
            RadarTrack.model_validate({**track, "radar_reason": reason}).radar_reason,
            RadarReason(**reason),
        )
        for broken in (
            track,
            {**track, "radar_reason": None},
            {**track, "radar_reason": {**reason, "kind": "liked"}},
            {**track, "radar_reason": {**reason, "play_count": -1}},
            {**track, "radar_reason": {key: value for key, value in reason.items() if key != "artist_name"}},
        ):
            with self.subTest(broken=broken.get("radar_reason", "missing")):
                with self.assertRaises(ValidationError):
                    RadarTrack.model_validate(broken)

    def test_reason_lives_on_the_radar_response_only_and_track_bodies_are_unchanged(self) -> None:
        schema = build_schema()
        schemas = schema["components"]["schemas"]

        radar = schema["paths"]["/api/home/release-radar"]["get"]
        self.assertEqual(
            radar["responses"]["200"]["content"]["application/json"]["schema"]["items"],
            {"$ref": "#/components/schemas/RadarTrack"},
        )
        self.assertIn("radar_reason", schemas["RadarTrack"]["required"])
        self.assertEqual(
            schemas["RadarTrack"]["properties"]["radar_reason"],
            {"$ref": "#/components/schemas/RadarReason"},
        )
        self.assertEqual(
            sorted(schemas["RadarReason"]["required"]),
            ["artist_id", "artist_name", "kind", "play_count"],
        )
        self.assertEqual(
            schemas["RadarReason"]["properties"]["kind"]["enum"], ["followed", "played"]
        )
        # Track is also the request body for likes, playlists and party queues.
        self.assertNotIn("radar_reason", schemas["Track"]["properties"])
        self.assertNotIn("radar_reason", Track.model_fields)
        # A client may send a radar track back unchanged (for example to like
        # it); the request model accepts it and drops the reason.
        liked = Track.model_validate(
            {
                **_track("1", artist="A", artist_id="10", release_date="2026-03-01"),
                "radar_reason": {"kind": "played", "artist_id": "10", "artist_name": "A", "play_count": 2},
            }
        )
        self.assertNotIn("radar_reason", liked.model_dump())


if __name__ == "__main__":
    unittest.main()
