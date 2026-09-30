from __future__ import annotations

import threading
import unittest
from concurrent.futures import Future, ThreadPoolExecutor
from unittest.mock import patch

from app.services import deezer_client as dc
from app.services.singleflight_cache import SingleFlightTtlCache


def _summary(track_id: str = "10") -> dict:
    return {"id": track_id, "title": "Duet", "artist": {"id": 1, "name": "First"}}


def _detail(track_id: str = "10") -> dict:
    return {
        **_summary(track_id),
        "contributors": [
            {"id": 1, "name": "First"},
            {"id": 2, "name": "Second"},
        ],
    }


class DeezerSingleFlightTests(unittest.TestCase):
    def setUp(self) -> None:
        with dc._track_artists_lock:
            dc._track_artists_cache.clear()
            self.assertFalse(dc._track_artists_flights.inflight)
        with dc._search_tracks_flights.lock:
            dc._search_tracks_flights.cache.clear()
            self.assertFalse(dc._search_tracks_flights.inflight)

    def tearDown(self) -> None:
        with dc._track_artists_lock:
            dc._track_artists_cache.clear()
            self.assertFalse(dc._track_artists_flights.inflight)
        with dc._search_tracks_flights.lock:
            dc._search_tracks_flights.cache.clear()
            self.assertFalse(dc._search_tracks_flights.inflight)

    def test_simultaneous_credit_calls_fetch_detail_once(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        joined = threading.Event()
        waiter_lock = threading.Lock()
        waiter_count = 0
        original_result = Future.result

        def tracked_result(future: Future, *args: object, **kwargs: object) -> object:
            nonlocal waiter_count
            with waiter_lock:
                waiter_count += 1
                if waiter_count == 7:
                    joined.set()
            return original_result(future, *args, **kwargs)

        def fetch(path: str) -> dict:
            self.assertEqual(path, "/track/10")
            entered.set()
            self.assertTrue(release.wait(2))
            return _detail()

        with (
            patch.object(dc, "_public_get", side_effect=fetch) as public_get,
            patch.object(Future, "result", tracked_result),
        ):
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(dc._full_public_artist_refs, "10") for _ in range(8)]
                try:
                    self.assertTrue(entered.wait(2))
                    self.assertTrue(joined.wait(2))
                finally:
                    release.set()
                results = [future.result(timeout=2) for future in futures]

        self.assertEqual(public_get.call_count, 1)
        for result in results:
            self.assertEqual(result, [
                {"id": "1", "name": "First"},
                {"id": "2", "name": "Second"},
            ])
        self.assertEqual(dc.normalize_public_tracks([_summary()])[0]["artists"], results[0])

    def test_different_track_ids_load_concurrently(self) -> None:
        entered = {track_id: threading.Event() for track_id in ("10", "20")}
        release = threading.Event()

        def fetch(path: str) -> dict:
            track_id = path.rsplit("/", 1)[1]
            entered[track_id].set()
            self.assertTrue(release.wait(2))
            return _detail(track_id)

        with patch.object(dc, "_public_get", side_effect=fetch):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(dc._full_public_artist_refs, track_id) for track_id in ("10", "20")]
                try:
                    self.assertTrue(all(event.wait(2) for event in entered.values()))
                finally:
                    release.set()
                self.assertEqual([future.result(timeout=2) for future in futures], [
                    [{"id": "1", "name": "First"}, {"id": "2", "name": "Second"}],
                    [{"id": "1", "name": "First"}, {"id": "2", "name": "Second"}],
                ])

    def test_inflight_error_reaches_all_waiters_and_next_call_retries(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        joined = threading.Event()
        waiter_lock = threading.Lock()
        waiter_count = 0
        original_result = Future.result

        def tracked_result(future: Future, *args: object, **kwargs: object) -> object:
            nonlocal waiter_count
            with waiter_lock:
                waiter_count += 1
                if waiter_count == 4:
                    joined.set()
            return original_result(future, *args, **kwargs)

        def fetch(_path: str) -> dict:
            entered.set()
            self.assertTrue(release.wait(2))
            raise dc.DeezerClientError("upstream unavailable")

        with (
            patch.object(dc, "_public_get", side_effect=fetch) as public_get,
            patch.object(Future, "result", tracked_result),
        ):
            with ThreadPoolExecutor(max_workers=5) as pool:
                futures = [pool.submit(dc._full_public_artist_refs, "10") for _ in range(5)]
                try:
                    self.assertTrue(entered.wait(2))
                    self.assertTrue(joined.wait(2))
                finally:
                    release.set()
                errors = [future.exception(timeout=2) for future in futures]

        self.assertEqual(public_get.call_count, 1)
        self.assertTrue(all(error is errors[0] for error in errors))
        self.assertIsInstance(errors[0], dc.DeezerClientError)
        self.assertIn("track 10: upstream unavailable", str(errors[0]))
        self.assertNotIn("10", dc._track_artists_cache)

        with patch.object(dc, "_public_get", return_value=_detail()) as public_get:
            self.assertEqual(len(dc._full_public_artist_refs("10")), 2)
            public_get.assert_called_once_with("/track/10")

    def test_search_reuses_complete_result_for_exact_query_and_limit(self) -> None:
        def fetch(path: str) -> dict:
            if path.startswith("/search?"):
                return {"data": [_summary()]}
            return _detail()

        with patch.object(dc, "_public_get", side_effect=fetch) as public_get:
            first = dc.search_tracks_public("Duet", limit=1)
            second = dc.search_tracks_public("Duet", limit=1)
            first[0]["artists"].clear()
            self.assertEqual(len(second[0]["artists"]), 2)
            dc.search_tracks_public("duet", limit=1)
            dc.search_tracks_public("Duet", limit=2)

        paths = [call.args[0] for call in public_get.call_args_list]
        self.assertEqual(paths.count("/track/10"), 1)
        self.assertEqual(paths.count("/search?q=Duet&limit=1"), 1)
        self.assertEqual(paths.count("/search?q=duet&limit=1"), 1)
        self.assertEqual(paths.count("/search?q=Duet&limit=2"), 1)

    def test_simultaneous_identical_searches_share_one_request(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        joined = threading.Event()
        waiter_lock = threading.Lock()
        waiter_count = 0
        original_result = Future.result

        def tracked_result(future: Future, *args: object, **kwargs: object) -> object:
            nonlocal waiter_count
            with waiter_lock:
                waiter_count += 1
                if waiter_count == 3:
                    joined.set()
            return original_result(future, *args, **kwargs)

        def fetch(path: str) -> dict:
            self.assertEqual(path, "/search?q=Duet&limit=1")
            entered.set()
            self.assertTrue(release.wait(2))
            return {"data": []}

        with (
            patch.object(dc, "_public_get", side_effect=fetch) as public_get,
            patch.object(Future, "result", tracked_result),
        ):
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(dc.search_tracks_public, "Duet", 1) for _ in range(4)]
                try:
                    self.assertTrue(entered.wait(2))
                    self.assertTrue(joined.wait(2))
                finally:
                    release.set()
                self.assertEqual([future.result(timeout=2) for future in futures], [[], [], [], []])

        public_get.assert_called_once_with("/search?q=Duet&limit=1")

    def test_public_get_rejects_invalid_json_and_non_object_response(self) -> None:
        with patch.object(dc.requests, "get") as request:
            request.return_value.json.side_effect = ValueError("bad json")
            with self.assertRaisesRegex(dc.DeezerClientError, "invalid JSON for /search"):
                dc._public_get("/search")

            request.return_value.json.side_effect = None
            request.return_value.json.return_value = []
            with self.assertRaisesRegex(dc.DeezerClientError, "returned list for /search"):
                dc._public_get("/search")

    def test_invalid_contributor_shape_reports_track_and_is_not_cached(self) -> None:
        invalid = {**_summary(), "contributors": ["First", "Second"]}
        with patch.object(dc, "_public_get", return_value=invalid):
            with self.assertRaisesRegex(dc.DeezerClientError, "track 10 has an invalid contributor list"):
                dc._full_public_artist_refs("10")
        self.assertNotIn("10", dc._track_artists_cache)


class SingleFlightCacheTests(unittest.TestCase):
    def test_ttl_starts_after_load_and_entries_are_bounded(self) -> None:
        now = [0.0]
        cache = SingleFlightTtlCache[str, str](
            ttl_seconds=10,
            max_entries=2,
            max_inflight=2,
            clock=lambda: now[0],
        )
        loads: list[str] = []

        def load(key: str) -> str:
            loads.append(key)
            return key.upper()

        def initial_load() -> str:
            now[0] = 7
            return load("a")

        self.assertEqual(cache.get("a", initial_load), "A")
        now[0] = 16
        self.assertEqual(cache.get("a", lambda: load("a")), "A")
        self.assertEqual(loads, ["a"])
        now[0] = 17
        self.assertEqual(cache.get("a", lambda: load("a")), "A")
        self.assertEqual(loads, ["a", "a"])
        cache.get("b", lambda: load("b"))
        cache.get("c", lambda: load("c"))
        self.assertEqual(set(cache.cache), {"b", "c"})
        self.assertFalse(cache.inflight)

    def test_inflight_capacity_waits_without_holding_other_keys_lock(self) -> None:
        cache = SingleFlightTtlCache[str, str](ttl_seconds=10, max_entries=2, max_inflight=1)
        entered = threading.Event()
        release = threading.Event()

        def slow() -> str:
            entered.set()
            self.assertTrue(release.wait(2))
            return "A"

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(cache.get, "a", slow)
            self.assertTrue(entered.wait(2))
            second = pool.submit(cache.get, "b", lambda: "B")
            self.assertEqual(set(cache.inflight), {"a"})
            release.set()
            self.assertEqual(first.result(timeout=2), "A")
            self.assertEqual(second.result(timeout=2), "B")
        self.assertFalse(cache.inflight)


if __name__ == "__main__":
    unittest.main()
