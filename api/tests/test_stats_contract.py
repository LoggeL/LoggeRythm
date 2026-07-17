import json
import unittest
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import Play, User
from app.db.session import Base
from app.openapi_contract import build_schema
from app.routers import stats
from app.schemas.stats import (
    MAX_SAFE_WIRE_INTEGER,
    RecentPlay,
    StatEntry,
    UserStats,
)


class StatsResponseModelTests(unittest.TestCase):
    @staticmethod
    def entry(key: str | int = "11", count: int = 1) -> StatEntry:
        return StatEntry(key=key, label="Title", sublabel="Artist", count=count)

    @staticmethod
    def recent(deezer_id: str | int = "11") -> RecentPlay:
        return RecentPlay(id=deezer_id, title="Title", artist="Artist")

    def test_legacy_ids_and_optional_media_defaults_are_explicit(self) -> None:
        entry = self.entry(key=42)
        recent = RecentPlay(
            id=42,
            title="Legacy",
            artist="Artist",
            artist_id=7,
            album_id=9,
        )
        response = UserStats(
            total_plays=1,
            top_tracks=[entry],
            top_artists=[entry],
            recent=[recent],
            total_plays_month=0,
            top_tracks_month=[],
            top_artists_month=[],
        )

        self.assertEqual(response.top_tracks[0].key, 42)
        self.assertEqual(response.top_tracks[0].cover, "")
        self.assertEqual(response.recent[0].id, 42)
        self.assertEqual(response.recent[0].artist_id, 7)
        self.assertEqual(response.recent[0].album_id, 9)
        self.assertEqual(response.recent[0].cover, "")
        self.assertEqual(response.recent[0].artists, [])
        self.assertEqual(response.recent[0].duration_sec, 0)

    def test_text_legacy_ids_and_empty_copy_remain_wire_compatible(self) -> None:
        response = UserStats(
            total_plays=1,
            top_tracks=[StatEntry(key="legacy-track", label="", count=1)],
            top_artists=[StatEntry(key="", label="", count=1)],
            recent=[
                RecentPlay(
                    id="legacy-track",
                    title="",
                    artists=[{"id": "", "name": ""}],
                )
            ],
            total_plays_month=0,
            top_tracks_month=[],
            top_artists_month=[],
        )

        self.assertEqual(response.top_tracks[0].key, "legacy-track")
        self.assertEqual(response.top_artists[0].label, "")
        self.assertEqual(response.recent[0].artists[0].name, "")

    def test_negative_numeric_legacy_ids_and_oversized_artist_lists_fail(self) -> None:
        with self.assertRaises(ValidationError):
            RecentPlay(id=-1, title="Invalid")
        with self.assertRaises(ValidationError):
            RecentPlay(id=MAX_SAFE_WIRE_INTEGER + 1, title="Unsafe")
        with self.assertRaises(ValidationError):
            RecentPlay(
                id="legacy",
                title="Unsafe duration",
                duration_sec=MAX_SAFE_WIRE_INTEGER + 1,
            )
        with self.assertRaises(ValidationError):
            StatEntry(
                key="legacy",
                label="Unsafe count",
                count=MAX_SAFE_WIRE_INTEGER + 1,
            )
        with self.assertRaises(ValidationError):
            RecentPlay(
                id="legacy",
                title="Invalid credit",
                artists=[{"id": -1, "name": "Artist"}],
            )
        with self.assertRaises(ValidationError):
            RecentPlay(
                id="legacy",
                title="Too many credits",
                artists=[
                    {"id": index, "name": f"Artist {index}"}
                    for index in range(101)
                ],
            )

    def test_period_totals_and_collections_must_agree(self) -> None:
        entry = self.entry()
        recent = self.recent()

        invalid_values = (
            {
                "total_plays": 1,
                "top_tracks": [entry],
                "top_artists": [entry],
                "recent": [recent],
                "total_plays_month": 2,
                "top_tracks_month": [entry],
                "top_artists_month": [entry],
            },
            {
                "total_plays": 0,
                "top_tracks": [entry],
                "top_artists": [],
                "recent": [],
                "total_plays_month": 0,
                "top_tracks_month": [],
                "top_artists_month": [],
            },
            {
                "total_plays": 1,
                "top_tracks": [],
                "top_artists": [entry],
                "recent": [recent],
                "total_plays_month": 0,
                "top_tracks_month": [],
                "top_artists_month": [],
            },
            {
                "total_plays": 1,
                "top_tracks": [self.entry(count=2)],
                "top_artists": [entry],
                "recent": [recent],
                "total_plays_month": 0,
                "top_tracks_month": [],
                "top_artists_month": [],
            },
        )

        for value in invalid_values:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                UserStats.model_validate(value)

    def test_openapi_uses_structured_stats_response(self) -> None:
        schema = build_schema()
        operation = schema["paths"]["/api/me/stats"]["get"]
        response_schema = operation["responses"]["200"]["content"]["application/json"][
            "schema"
        ]
        self.assertEqual(response_schema["$ref"], "#/components/schemas/UserStats")

        schemas = schema["components"]["schemas"]
        user_stats = schemas["UserStats"]
        self.assertEqual(
            set(user_stats["required"]),
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
        self.assertEqual(user_stats["properties"]["top_tracks"]["maxItems"], 10)
        self.assertEqual(user_stats["properties"]["recent"]["maxItems"], 20)
        self.assertEqual(
            schemas["RecentPlay"]["properties"]["artists"]["maxItems"],
            100,
        )
        stats_artist_id = schemas["StatsArtistRef"]["properties"]["id"]
        stats_artist_integer_id = next(
            branch
            for branch in stats_artist_id["anyOf"]
            if branch["type"] == "integer"
        )
        self.assertEqual(stats_artist_integer_id["minimum"], 0)
        self.assertEqual(
            schemas["RecentPlay"]["properties"]["cover"]["default"],
            "",
        )
        self.assertEqual(
            schemas["RecentPlay"]["properties"]["duration_sec"]["minimum"],
            0,
        )
        self.assertEqual(
            schemas["RecentPlay"]["properties"]["duration_sec"]["maximum"],
            MAX_SAFE_WIRE_INTEGER,
        )
        self.assertEqual(
            schemas["StatEntry"]["properties"]["count"]["exclusiveMinimum"],
            0,
        )
        self.assertEqual(
            schemas["StatEntry"]["properties"]["count"]["maximum"],
            MAX_SAFE_WIRE_INTEGER,
        )
        self.assertEqual(
            schemas["UserStats"]["properties"]["total_plays"]["maximum"],
            MAX_SAFE_WIRE_INTEGER,
        )
        recent_id_types = {
            branch["type"]
            for branch in schemas["RecentPlay"]["properties"]["id"]["anyOf"]
        }
        self.assertEqual(recent_id_types, {"string", "integer"})
        integer_id_schema = next(
            branch
            for branch in schemas["RecentPlay"]["properties"]["id"]["anyOf"]
            if branch["type"] == "integer"
        )
        self.assertEqual(integer_id_schema["minimum"], 0)
        self.assertEqual(integer_id_schema["maximum"], MAX_SAFE_WIRE_INTEGER)


class StatsRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(
            email="stats@example.test",
            password_hash="not-used-by-this-test",
            display_name="Stats",
            is_approved=True,
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_empty_database_returns_the_complete_typed_shape(self) -> None:
        response = stats.get_stats(user=self.user, db=self.db)

        self.assertIsInstance(response, UserStats)
        self.assertEqual(
            response.model_dump(),
            {
                "total_plays": 0,
                "top_tracks": [],
                "top_artists": [],
                "recent": [],
                "total_plays_month": 0,
                "top_tracks_month": [],
                "top_artists_month": [],
            },
        )

    def test_router_builds_all_time_month_and_recent_projections(self) -> None:
        now = datetime.now(timezone.utc)
        self.db.add_all(
            [
                Play(
                    user_id=self.user.id,
                    deezer_id="101",
                    title="Older",
                    artist="First",
                    artist_id="1",
                    artists_json='[{"id": 1, "name": "First"}]',
                    album="Archive",
                    album_id="10",
                    cover_url=None,
                    duration_sec=180,
                    played_at=now - timedelta(days=45),
                ),
                Play(
                    user_id=self.user.id,
                    deezer_id="202",
                    title="Current",
                    artist="Second",
                    artist_id="2",
                    artists_json='[{"id": "2", "name": "Second"}]',
                    album="Present",
                    album_id="20",
                    cover_url="https://img.example/current.jpg",
                    duration_sec=240,
                    played_at=now,
                ),
            ]
        )
        self.db.commit()

        response = stats.get_stats(user=self.user, db=self.db)

        self.assertEqual(response.total_plays, 2)
        self.assertEqual(response.total_plays_month, 1)
        self.assertEqual(sum(item.count for item in response.top_tracks), 2)
        self.assertEqual(sum(item.count for item in response.top_artists), 2)
        self.assertEqual(
            [item.key for item in response.top_tracks_month],
            ["202"],
        )
        self.assertEqual(
            [item.key for item in response.top_artists_month],
            ["2"],
        )
        self.assertEqual([item.id for item in response.recent], ["202", "101"])
        self.assertEqual(response.recent[0].cover, "https://img.example/current.jpg")
        self.assertEqual(response.recent[1].cover, "")
        self.assertEqual(response.recent[0].artists[0].id, "2")
        self.assertEqual(response.recent[1].artists[0].id, "1")

    def test_router_normalizes_legacy_duration_range_and_bounds_credits(self) -> None:
        now = datetime.now(timezone.utc)
        self.db.add_all(
            [
                Play(
                    user_id=self.user.id,
                    deezer_id="oversized-track",
                    title="Oversized",
                    artist="Primary",
                    artist_id="legacy-artist",
                    artists_json="[]",
                    album="Archive",
                    album_id="legacy-album",
                    cover_url=None,
                    duration_sec=MAX_SAFE_WIRE_INTEGER + 1,
                    played_at=now,
                ),
                Play(
                    user_id=self.user.id,
                    deezer_id="legacy-track",
                    title="Legacy",
                    artist="Primary",
                    artist_id="legacy-artist",
                    artists_json=json.dumps(
                        [
                            {"id": f"legacy-{index}", "name": f"Artist {index}"}
                            for index in range(101)
                        ]
                    ),
                    album="Archive",
                    album_id="legacy-album",
                    cover_url=None,
                    duration_sec=-1,
                    played_at=now - timedelta(seconds=1),
                ),
            ]
        )
        self.db.commit()

        response = stats.get_stats(user=self.user, db=self.db)
        recent = {item.id: item for item in response.recent}

        self.assertEqual(recent["legacy-track"].duration_sec, 0)
        self.assertEqual(
            recent["oversized-track"].duration_sec,
            MAX_SAFE_WIRE_INTEGER,
        )
        self.assertEqual(len(recent["legacy-track"].artists), 100)


if __name__ == "__main__":
    unittest.main()
