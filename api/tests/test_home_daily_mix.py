"""The chill home mix is a per-listener, per-day draw from a larger tag pool."""

from __future__ import annotations

import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app.routers import home
from app.services import deezer_client as dc
from app.services import discovery, lastfm_client, recommend, singleflight_cache
from app.services.lastfm_client import LastfmError


def _query(index: int) -> str:
    return f"Artist {index} Title {index}"


def _track_id(query: str) -> str:
    return f"dz:{query}"


class FakeLastfm:
    """`requests.get` stand-in: each tag has a ranked catalog or a raw payload."""

    def __init__(self, tags: dict[str, int | dict]):
        self.tags = tags
        self.calls: list[dict] = []

    def __call__(self, _url: str, *, params: dict, timeout: int) -> Mock:
        self.calls.append(dict(params))
        source = self.tags[params["tag"]]
        if isinstance(source, int):
            count = min(source, int(params["limit"]))
            source = {"tracks": {"track": [
                {"name": f"Title {index}", "artist": {"name": f"Artist {index}"}}
                for index in range(count)
            ]}}
        response = Mock()
        response.json.return_value = source
        return response


class FakeDeezer:
    """`search_tracks_public` stand-in with configurable misses and duplicates."""

    def __init__(self, *, misses: set[str] = frozenset(), same_track: dict[str, str] | None = None):
        self.misses = misses
        self.same_track = same_track or {}
        self.calls: list[str] = []

    def __call__(self, query: str, limit: int = 1) -> list[dict]:
        self.calls.append(query)
        if query in self.misses:
            return []
        return [{"id": _track_id(self.same_track.get(query, query)), "title": query}]


def _date_on(year: int, month: int, day: int) -> type[date]:
    class FixedDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(year, month, day)

    return FixedDate


class ProviderFakesTestCase(unittest.TestCase):
    def use_providers(self, lastfm: FakeLastfm, deezer: FakeDeezer) -> None:
        for patcher in (
            patch.object(recommend, "LASTFM_API_KEY", "test-key"),
            patch.object(lastfm_client.requests, "get", side_effect=lastfm),
            patch.object(dc, "search_tracks_public", side_effect=deezer),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)


class TagTrackDrawTests(ProviderFakesTestCase):
    seed = "home-mix:chill:2026-11-18:user:7"

    def draw(self, seed: str | None = None) -> list[str]:
        tracks = recommend.tag_track_draw(["chill", "relax"], 30, seed=seed or self.seed)
        return [track["id"] for track in tracks]

    def draw_order(self, pool: int = 200) -> list[str]:
        return recommend._draw_order([_query(index) for index in range(pool)], self.seed)

    def test_draw_order_is_fixed_by_the_seed_text_in_every_process(self) -> None:
        # Pinned literal: a per-process salt (like `hash()`) or the global RNG
        # could not reproduce it.
        self.assertEqual(
            recommend._draw_order(["a", "b", "c", "d", "e", "b"], "seed"),
            ["a", "e", "d", "c", "b"],
        )
        self.assertNotEqual(
            recommend._draw_order(["a", "b", "c", "d", "e"], "other seed"),
            ["a", "e", "d", "c", "b"],
        )

    def test_one_pool_fetch_and_exactly_limit_resolves_without_misses(self) -> None:
        lastfm, deezer = FakeLastfm({"chill": 500}), FakeDeezer()
        self.use_providers(lastfm, deezer)

        ids = self.draw()

        self.assertEqual(len(lastfm.calls), 1)
        self.assertEqual(lastfm.calls[0]["method"], "tag.gettoptracks")
        self.assertEqual(lastfm.calls[0]["tag"], "chill")
        self.assertEqual(lastfm.calls[0]["limit"], recommend.TAG_DRAW_POOL_SIZE)
        self.assertEqual(recommend.TAG_DRAW_POOL_SIZE, 200)
        expected = self.draw_order()[:30]
        self.assertCountEqual(deezer.calls, expected)
        self.assertEqual(ids, [_track_id(query) for query in expected])
        self.assertEqual(len(set(ids)), 30)
        # A draw from the pool, not the tag's top 30 that every listener got.
        self.assertNotEqual(set(ids), {_track_id(_query(index)) for index in range(30)})
        self.assertTrue(any(int(query.split()[1]) >= 100 for query in expected))

    def test_same_seed_repeats_the_same_tracks_in_the_same_order(self) -> None:
        self.use_providers(FakeLastfm({"chill": 200}), FakeDeezer())
        self.assertEqual(self.draw(), self.draw())

    def test_other_day_and_other_user_draw_other_tracks(self) -> None:
        self.use_providers(FakeLastfm({"chill": 200}), FakeDeezer())
        today = self.draw("home-mix:chill:2026-11-18:user:7")
        tomorrow = self.draw("home-mix:chill:2026-11-19:user:7")
        other_user = self.draw("home-mix:chill:2026-11-18:user:8")
        for other in (tomorrow, other_user):
            self.assertEqual(len(other), 30)
            self.assertNotEqual(set(other), set(today))
        self.assertNotEqual(set(tomorrow), set(other_user))

    def test_misses_and_duplicate_hits_are_backfilled_in_draw_order(self) -> None:
        order = self.draw_order()
        deezer = FakeDeezer(
            misses={order[3], order[10]},
            same_track={order[5]: order[4]},
        )
        self.use_providers(FakeLastfm({"chill": 200}), deezer)

        ids = self.draw()

        self.assertEqual(
            ids,
            [_track_id(query) for index, query in enumerate(order[:33]) if index not in (3, 5, 10)],
        )
        self.assertEqual(len(ids), 30)
        self.assertEqual(len(set(ids)), 30)
        self.assertCountEqual(deezer.calls, order[:33])

    def test_resolve_attempts_stop_at_the_cap_and_return_a_shorter_mix(self) -> None:
        order = self.draw_order()
        deezer = FakeDeezer(misses=set(order[:20]))
        self.use_providers(FakeLastfm({"chill": 200}), deezer)

        ids = self.draw()

        cap = 30 + recommend.TAG_DRAW_SPARE_RESOLVES
        self.assertEqual(cap, 40)
        self.assertCountEqual(deezer.calls, order[:cap])
        self.assertEqual(ids, [_track_id(query) for query in order[20:cap]])

    def test_pool_smaller_than_the_mix_returns_the_whole_pool(self) -> None:
        lastfm, deezer = FakeLastfm({"chill": 12}), FakeDeezer()
        self.use_providers(lastfm, deezer)

        ids = self.draw()

        self.assertEqual(ids, [_track_id(query) for query in self.draw_order(12)])
        self.assertEqual(len(ids), 12)
        self.assertEqual(len(lastfm.calls), 1)
        self.assertEqual(len(deezer.calls), 12)

    def test_a_name_leaving_the_pool_keeps_the_rest_of_the_draw(self) -> None:
        order = self.draw_order()
        dropped = order[7]
        index = int(dropped.split()[1])
        payload = {"tracks": {"track": [
            {"name": f"Title {i}", "artist": {"name": f"Artist {i}"}}
            for i in range(200) if i != index
        ]}}
        self.use_providers(FakeLastfm({"chill": payload}), FakeDeezer())

        ids = self.draw()

        self.assertEqual(
            ids,
            [_track_id(query) for query in order[:31] if query != dropped],
        )

    def test_empty_first_tag_uses_the_next_tag_like_tag_top_tracks(self) -> None:
        lastfm, deezer = FakeLastfm({"chill": 0, "relax": 200}), FakeDeezer()
        self.use_providers(lastfm, deezer)

        ids = self.draw()

        self.assertEqual([call["tag"] for call in lastfm.calls], ["chill", "relax"])
        self.assertEqual([call["limit"] for call in lastfm.calls], [200, 200])
        self.assertEqual(ids, [_track_id(query) for query in self.draw_order()[:30]])

    def test_first_tag_without_playable_tracks_uses_the_next_tag(self) -> None:
        lastfm = FakeLastfm({"chill": {"tracks": {"track": [
            {"name": "Unplayable", "artist": {"name": "Nobody"}},
        ]}}, "relax": 200})
        deezer = FakeDeezer(misses={"Nobody Unplayable"})
        self.use_providers(lastfm, deezer)

        self.assertEqual(len(self.draw()), 30)
        self.assertEqual([call["tag"] for call in lastfm.calls], ["chill", "relax"])
        self.assertEqual(len(deezer.calls), 31)

    def test_real_empty_pools_are_an_explicit_empty_result_without_deezer_calls(self) -> None:
        lastfm, deezer = FakeLastfm({"chill": 0, "relax": 0}), FakeDeezer()
        self.use_providers(lastfm, deezer)

        self.assertEqual(self.draw(), [])
        self.assertEqual(recommend.tag_top_tracks(["chill", "relax"], 30), [])
        self.assertEqual(deezer.calls, [])

    def test_malformed_or_failed_pool_is_a_lastfm_error_not_an_empty_mix(self) -> None:
        payloads = [
            {},
            {"tracks": None},
            {"tracks": {}},
            {"tracks": {"track": None}},
            {"tracks": {"track": ["broken"]}},
            {"tracks": {"track": [{"name": "Title without artist"}]}},
            {"tracks": {"track": [{"name": "", "artist": {"name": "Artist"}}]}},
            {"error": 29, "message": "Rate limit exceeded"},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                deezer = FakeDeezer()
                with (
                    patch.object(recommend, "LASTFM_API_KEY", "test-key"),
                    patch.object(lastfm_client.requests, "get", side_effect=FakeLastfm({"chill": payload, "relax": 200})),
                    patch.object(dc, "search_tracks_public", side_effect=deezer),
                ):
                    with self.assertRaisesRegex(LastfmError, "chill"):
                        self.draw()
                self.assertEqual(deezer.calls, [])

    def test_deezer_failure_propagates(self) -> None:
        failure = dc.DeezerClientError("search upstream unavailable")
        self.use_providers(FakeLastfm({"chill": 200}), FakeDeezer())
        with patch.object(dc, "search_tracks_public", side_effect=failure):
            with self.assertRaises(discovery.DiscoveryError) as caught:
                self.draw()
        self.assertIn(failure, caught.exception.failures)

    def test_unconfigured_lastfm_is_empty_without_provider_calls(self) -> None:
        lastfm, deezer = FakeLastfm({"chill": 200}), FakeDeezer()
        self.use_providers(lastfm, deezer)
        with patch.object(recommend, "LASTFM_API_KEY", ""):
            self.assertEqual(self.draw(), [])
        self.assertEqual(lastfm.calls, [])
        self.assertEqual(deezer.calls, [])

    def test_missing_seed_and_impossible_bounds_are_rejected(self) -> None:
        lastfm, deezer = FakeLastfm({"chill": 200}), FakeDeezer()
        self.use_providers(lastfm, deezer)
        with self.assertRaisesRegex(ValueError, "seed"):
            recommend.tag_track_draw(["chill"], 30, seed=" ")
        for bounds in (
            {"limit": 0},
            {"limit": 30, "pool_size": 29},
            {"limit": 30, "spare_resolves": -1},
        ):
            with self.subTest(bounds=bounds):
                with self.assertRaisesRegex(ValueError, "bounds"):
                    recommend.tag_track_draw(["chill"], seed=self.seed, **bounds)
        self.assertEqual(lastfm.calls, [])


class UnchangedTagTopTracksTests(ProviderFakesTestCase):
    def test_tag_top_tracks_still_resolves_the_top_names_in_lastfm_order(self) -> None:
        lastfm, deezer = FakeLastfm({"chill": 500}), FakeDeezer()
        self.use_providers(lastfm, deezer)

        tracks = recommend.tag_top_tracks(["chill", "relax"], 30)

        self.assertEqual(len(lastfm.calls), 1)
        self.assertEqual(lastfm.calls[0]["tag"], "chill")
        self.assertEqual(lastfm.calls[0]["limit"], 30)
        self.assertEqual([track["id"] for track in tracks], [_track_id(_query(index)) for index in range(30)])
        self.assertCountEqual(deezer.calls, [_query(index) for index in range(30)])

    def test_mood_route_still_returns_the_top_forty_in_lastfm_order(self) -> None:
        lastfm, deezer = FakeLastfm({"chill": 500}), FakeDeezer()
        self.use_providers(lastfm, deezer)

        first = home.mood("chill")
        second = home.mood("chill")

        self.assertEqual([call["tag"] for call in lastfm.calls], ["chill", "chill"])
        self.assertEqual([call["limit"] for call in lastfm.calls], [40, 40])
        self.assertEqual([track["id"] for track in first], [_track_id(_query(index)) for index in range(40)])
        self.assertEqual(second, first)
        self.assertEqual(len(deezer.calls), 80)


class ChillMixShelfTests(ProviderFakesTestCase):
    def setUp(self) -> None:
        self.lastfm, self.deezer = FakeLastfm({"chill": 200, "relax": 200}), FakeDeezer()
        self.use_providers(self.lastfm, self.deezer)
        for patcher in (
            # No listening history: the chill job is the only provider job.
            patch.object(home, "_user_seed_tracks", return_value=[]),
            patch.object(home, "_user_top_artists", return_value=[]),
            # The discover shelf's party fallback is not under test here.
            patch.object(recommend, "tag_top_tracks", return_value=[]),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def chill_ids(self, user: object | None, day: tuple[int, int, int]) -> list[str]:
        with patch.object(home, "date", _date_on(*day)):
            shelves = home._build_mixes(user, object())
        self.assertEqual([shelf.key for shelf in shelves], ["chill"])
        self.assertEqual(shelves[0].title, "Entspannt am Abend")
        return [track.id for track in shelves[0].tracks]

    def test_seed_names_the_day_and_the_listener(self) -> None:
        day = date(2026, 11, 18)
        self.assertEqual(
            home._chill_draw_seed(SimpleNamespace(id=7), day),
            "home-mix:chill:2026-11-18:user:7",
        )
        self.assertEqual(home._chill_draw_seed(None, day), "home-mix:chill:2026-11-18:anon")
        with self.assertRaisesRegex(RuntimeError, "user.id is None"):
            home._chill_draw_seed(SimpleNamespace(id=None), day)

    def test_rebuild_on_the_same_day_keeps_the_users_thirty_tracks(self) -> None:
        user = SimpleNamespace(id=7)
        first = self.chill_ids(user, (2026, 11, 18))
        second = self.chill_ids(user, (2026, 11, 18))

        self.assertEqual(len(first), 30)
        self.assertEqual(len(set(first)), 30)
        self.assertEqual(second, first)
        # Each build: one pool request and thirty Deezer searches, as before.
        self.assertEqual([call["limit"] for call in self.lastfm.calls], [200, 200])
        self.assertEqual(len(self.deezer.calls), 60)

    def test_next_day_and_other_user_get_other_tracks(self) -> None:
        today = self.chill_ids(SimpleNamespace(id=7), (2026, 11, 18))
        tomorrow = self.chill_ids(SimpleNamespace(id=7), (2026, 11, 19))
        other_user = self.chill_ids(SimpleNamespace(id=8), (2026, 11, 18))

        self.assertEqual(len(tomorrow), 30)
        self.assertEqual(len(other_user), 30)
        self.assertNotEqual(set(tomorrow), set(today))
        self.assertNotEqual(set(other_user), set(today))

    def test_signed_out_visitors_share_one_daily_draw(self) -> None:
        first = self.chill_ids(None, (2026, 11, 18))
        second = self.chill_ids(None, (2026, 11, 18))
        tomorrow = self.chill_ids(None, (2026, 11, 19))
        signed_in = self.chill_ids(SimpleNamespace(id=7), (2026, 11, 18))

        self.assertEqual(len(first), 30)
        self.assertEqual(second, first)
        self.assertNotEqual(set(tomorrow), set(first))
        self.assertNotEqual(set(signed_in), set(first))

    def test_real_empty_pools_omit_the_shelf(self) -> None:
        self.lastfm.tags = {"chill": 0, "relax": 0}
        with patch.object(home, "_chart_tracks", return_value=[]) as chart:
            self.assertEqual(home._build_mixes(SimpleNamespace(id=7), object()), [])
        chart.assert_called_once_with(0)
        self.assertEqual(self.deezer.calls, [])

    def test_malformed_pool_fails_the_mixes_request_and_is_not_cached(self) -> None:
        cache = singleflight_cache.SingleFlightTtlCache[str, list[home.Shelf]](
            ttl_seconds=3600, max_entries=4, max_inflight=2,
        )
        user = SimpleNamespace(id=7)
        with patch.object(home, "_mixes_cache", cache):
            self.lastfm.tags = {"chill": {"tracks": {"track": None}}, "relax": 200}
            with self.assertRaises(HTTPException) as caught:
                home.mixes(user, object())
            self.assertEqual(caught.exception.status_code, 502)
            self.assertIn("chill: Tag 'chill'", caught.exception.detail)
            self.assertIn("tracks.track", caught.exception.detail)
            self.assertFalse(cache.cache)
            self.assertEqual(self.deezer.calls, [])

            self.lastfm.tags = {"chill": 200}
            shelves = home.mixes(user, object())
            self.assertEqual([shelf.key for shelf in shelves], ["chill"])
            self.assertEqual(len(shelves[0].tracks), 30)


if __name__ == "__main__":
    unittest.main()
