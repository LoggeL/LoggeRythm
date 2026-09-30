from __future__ import annotations

import threading
import time
import unittest
from concurrent.futures import Future, ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.routers import home
from app.services import deezer_client as dc


class ChartCollectionsTests(unittest.TestCase):
    def test_fetches_all_charts_concurrently_and_keeps_curated_order(self) -> None:
        chart_ids = [int(chart["id"]) for chart in home._CHART_COLLECTIONS]
        started = threading.Barrier(len(chart_ids) + 1)
        releases = {chart_id: threading.Event() for chart_id in chart_ids}
        completed = {chart_id: threading.Event() for chart_id in chart_ids}

        def chart_tracks(chart_id: int) -> list[dict]:
            started.wait(timeout=3)
            self.assertTrue(releases[chart_id].wait(timeout=3))
            completed[chart_id].set()
            if chart_id == chart_ids[2]:
                return []
            return [{"id": str(chart_id), "title": str(chart_id)}]

        with patch.object(home, "_chart_tracks", side_effect=chart_tracks):
            with ThreadPoolExecutor(max_workers=1) as caller:
                result = caller.submit(home.charts_collections)
                started.wait(timeout=3)  # Every lookup has started before one can finish.
                for chart_id in reversed(chart_ids):
                    releases[chart_id].set()
                    self.assertTrue(completed[chart_id].wait(timeout=3))
                shelves = result.result(timeout=3)

        self.assertEqual(
            [shelf.key for shelf in shelves],
            [chart["key"] for chart in home._CHART_COLLECTIONS if chart["id"] != chart_ids[2]],
        )
        self.assertEqual(
            [shelf.tracks[0].id for shelf in shelves],
            [str(chart_id) for chart_id in chart_ids if chart_id != chart_ids[2]],
        )

    def test_collects_all_upstream_failures_and_never_returns_partial_shelves(self) -> None:
        def chart_tracks(chart_id: int) -> list[dict]:
            if chart_id in (132, 152):
                raise dc.DeezerClientError(f"upstream {chart_id} unavailable")
            return [{"id": str(chart_id)}]

        with patch.object(home, "_chart_tracks", side_effect=chart_tracks):
            with self.assertRaises(HTTPException) as caught:
                home.charts_collections()

        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("2 of 5 charts", caught.exception.detail)
        self.assertIn("chart 132: upstream 132 unavailable", caught.exception.detail)
        self.assertIn("chart 152: upstream 152 unavailable", caught.exception.detail)

    def test_chart_payload_requires_tracks_data_list(self) -> None:
        malformed = [None, {}, {"tracks": None}, {"tracks": {}},
                     {"tracks": {"data": None}}, {"tracks": {"data": [None]}}]
        for payload in malformed:
            with self.subTest(payload=payload):
                with (
                    patch.object(dc, "_public_get", return_value=payload),
                    patch.object(dc, "normalize_public_tracks") as normalize,
                ):
                    with self.assertRaisesRegex(dc.DeezerClientError, "Chart 132"):
                        home._chart_tracks(132)
                    normalize.assert_not_called()

    def test_real_empty_chart_is_valid(self) -> None:
        with patch.object(dc, "_public_get", return_value={"tracks": {"data": []}}):
            self.assertEqual(home._chart_tracks(132), [])


class CountingFuture(Future[list[home.Shelf]]):
    entered = 0
    entered_lock = threading.Lock()
    all_waiting = threading.Event()

    def result(self, timeout: float | None = None) -> list[home.Shelf]:
        with self.entered_lock:
            type(self).entered += 1
            if type(self).entered == 2:
                type(self).all_waiting.set()
        return super().result(timeout)


class MixesSingleFlightTests(unittest.TestCase):
    def setUp(self) -> None:
        with home._mixes_lock:
            home._mixes_cache.clear()
            home._mixes_inflight.clear()
        CountingFuture.entered = 0
        CountingFuture.all_waiting.clear()

    def tearDown(self) -> None:
        with home._mixes_lock:
            home._mixes_cache.clear()
            home._mixes_inflight.clear()

    def test_same_user_builds_once_and_uses_only_leader_db(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        calls: list[object] = []
        shelf = home.Shelf(key="mix", title="Mix", tracks=[])

        def build(_user: object, db: object) -> list[home.Shelf]:
            calls.append(db)
            entered.set()
            self.assertTrue(release.wait(timeout=3))
            return [shelf]

        with (
            patch.object(home, "Future", CountingFuture),
            patch.object(home, "_build_mixes", side_effect=build),
            ThreadPoolExecutor(max_workers=3) as pool,
        ):
            dbs = [object() for _ in range(3)]
            leader = pool.submit(home.mixes, SimpleNamespace(id=7), dbs[0])
            self.assertTrue(entered.wait(timeout=3))
            waiters = [pool.submit(home.mixes, SimpleNamespace(id=7), db) for db in dbs[1:]]
            self.assertTrue(CountingFuture.all_waiting.wait(timeout=3))
            release.set()
            self.assertEqual(leader.result(timeout=3), [shelf])
            self.assertEqual([future.result(timeout=3) for future in waiters], [[shelf], [shelf]])

        self.assertEqual(calls, [dbs[0]])

    def test_different_users_build_independently(self) -> None:
        barrier = threading.Barrier(3)

        def build(user: object, _db: object) -> list[home.Shelf]:
            barrier.wait(timeout=3)
            return [home.Shelf(key=str(user.id), title="Mix", tracks=[])]

        with (
            patch.object(home, "_build_mixes", side_effect=build),
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            one = pool.submit(home.mixes, SimpleNamespace(id=1), object())
            two = pool.submit(home.mixes, SimpleNamespace(id=2), object())
            barrier.wait(timeout=3)
            self.assertEqual(one.result(timeout=3)[0].key, "1")
            self.assertEqual(two.result(timeout=3)[0].key, "2")

    def test_failure_reaches_waiters_and_next_request_retries(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        failure = ValueError("mix build failed")
        calls = 0

        def build(_user: object, _db: object) -> list[home.Shelf]:
            nonlocal calls
            calls += 1
            if calls == 1:
                entered.set()
                self.assertTrue(release.wait(timeout=3))
                raise failure
            return []

        with (
            patch.object(home, "Future", CountingFuture),
            patch.object(home, "_build_mixes", side_effect=build),
            ThreadPoolExecutor(max_workers=3) as pool,
        ):
            leader = pool.submit(home.mixes, SimpleNamespace(id=7), object())
            self.assertTrue(entered.wait(timeout=3))
            waiters = [pool.submit(home.mixes, SimpleNamespace(id=7), object()) for _ in range(2)]
            self.assertTrue(CountingFuture.all_waiting.wait(timeout=3))
            release.set()
            for pending in [leader, *waiters]:
                with self.assertRaises(ValueError) as caught:
                    pending.result(timeout=3)
                self.assertIs(caught.exception, failure)
            self.assertEqual(home.mixes(SimpleNamespace(id=7), object()), [])

        self.assertEqual(calls, 2)

    def test_ttl_starts_when_build_completes(self) -> None:
        clock = [100.0]
        calls = 0

        def build(_user: object, _db: object) -> list[home.Shelf]:
            nonlocal calls
            calls += 1
            clock[0] = 200.0 if calls == 1 else clock[0]
            return [home.Shelf(key=str(calls), title="Mix", tracks=[])]

        with (
            patch.object(home, "time", SimpleNamespace(monotonic=lambda: clock[0])),
            patch.object(home, "_build_mixes", side_effect=build),
        ):
            user = SimpleNamespace(id=7)
            self.assertEqual(home.mixes(user, object())[0].key, "1")
            clock[0] = 200.0 + home._MIXES_TTL_SEC - 1
            self.assertEqual(home.mixes(user, object())[0].key, "1")
            clock[0] = 200.0 + home._MIXES_TTL_SEC + 1
            self.assertEqual(home.mixes(user, object())[0].key, "2")

        self.assertEqual(calls, 2)

    def test_cache_evicts_oldest_entry_at_limit(self) -> None:
        now = time.monotonic()
        with home._mixes_lock:
            for index in range(home._MIXES_CACHE_MAX):
                home._mixes_cache[str(index)] = (now - 256 + index, [])

        with patch.object(home, "_build_mixes", return_value=[]):
            home.mixes(SimpleNamespace(id=999), object())

        with home._mixes_lock:
            self.assertEqual(len(home._mixes_cache), home._MIXES_CACHE_MAX)
            self.assertNotIn("0", home._mixes_cache)
            self.assertIn("1", home._mixes_cache)
            self.assertIn("999", home._mixes_cache)


if __name__ == "__main__":
    unittest.main()
