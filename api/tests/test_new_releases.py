"""New releases merge Deezer's editorial selections and never go silently empty."""

from __future__ import annotations

import threading
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import browse
from app.services import deezer_client as dc


_SOURCE_PATHS = [f"/editorial/{editorial_id}/selection" for editorial_id, _limit in dc._NEW_RELEASES_SOURCES]


def _days_ago(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


def _pick(album_id: int | str, title: str | None = None) -> dict:
    return {
        "id": album_id,
        "title": title or f"Album {album_id}",
        "artist": {"id": 9000, "name": f"Artist {album_id}"},
        "cover_medium": f"https://example.invalid/{album_id}.jpg",
        "record_type": "album",
    }


class _Deezer:
    """In-memory public Deezer API; every unlisted selection is a real empty list."""

    def __init__(self, selections: dict[str, object], release_dates: dict[int, object]):
        self.selections = selections
        self.release_dates = release_dates
        self.calls: list[str] = []
        self._lock = threading.Lock()

    def get(self, path: str) -> dict:
        with self._lock:
            self.calls.append(path)
        if path in _SOURCE_PATHS:
            payload = self.selections.get(path, {"data": []})
            if isinstance(payload, Exception):
                raise payload
            return payload  # type: ignore[return-value]
        prefix = "/album/"
        if not path.startswith(prefix):
            raise AssertionError(f"Unexpected public Deezer request: {path}")
        release_date = self.release_dates[int(path[len(prefix):])]
        if isinstance(release_date, Exception):
            raise release_date
        return {"id": int(path[len(prefix):]), "release_date": release_date}


class NewReleasesTests(unittest.TestCase):
    def setUp(self) -> None:
        self._clear_caches()

    def tearDown(self) -> None:
        self._clear_caches()

    def _clear_caches(self) -> None:
        for flights in (dc._new_releases_flights, dc._album_release_date_flights):
            with flights.lock:
                flights.cache.clear()
                self.assertFalse(flights.inflight)

    def _new_releases(self, deezer: _Deezer) -> list[dict]:
        with patch.object(dc, "_public_get", side_effect=deezer.get):
            return dc.new_releases()

    def test_merges_sources_without_duplicates_newest_first(self) -> None:
        deezer = _Deezer(
            {
                "/editorial/0/selection": {"data": [_pick(1), _pick(2), _pick(3)]},
                # Album 2 is also a Pop pick; album 4 shares a release day with album 1.
                "/editorial/132/selection": {"data": [_pick("2", "Pop copy"), _pick(4), _pick(5)]},
                "/editorial/116/selection": {"data": [_pick(6)]},
            },
            {1: _days_ago(10), 2: _days_ago(3), 3: _days_ago(400), 4: _days_ago(10), 5: _days_ago(0), 6: _days_ago(90)},
        )

        albums = self._new_releases(deezer)

        # The 400-day-old pick is dropped; same-day picks keep source order.
        self.assertEqual([album["id"] for album in albums], ["5", "2", "1", "4", "6"])
        self.assertEqual(
            albums[1],
            {
                "id": "2",
                "title": "Album 2",
                "artist": "Artist 2",
                "cover": "https://example.invalid/2.jpg",
                "release_date": _days_ago(3),
            },
        )
        self.assertCountEqual(
            deezer.calls,
            _SOURCE_PATHS + [f"/album/{album_id}" for album_id in range(1, 7)],
        )

    def test_takes_only_the_leading_picks_of_each_source_and_caps_the_result(self) -> None:
        selections = {
            path: {"data": [_pick(1000 * index + rank) for rank in range(12)]}
            for index, path in enumerate(_SOURCE_PATHS, start=1)
        }
        expected_ids = [
            1000 * index + rank
            for index, (_editorial_id, limit) in enumerate(dc._NEW_RELEASES_SOURCES, start=1)
            for rank in range(limit)
        ]
        deezer = _Deezer(selections, {album_id: _days_ago(1) for album_id in expected_ids})

        albums = self._new_releases(deezer)

        self.assertGreater(len(expected_ids), dc._NEW_RELEASES_LIMIT)
        self.assertEqual(
            [album["id"] for album in albums],
            [str(album_id) for album_id in expected_ids[: dc._NEW_RELEASES_LIMIT]],
        )
        self.assertEqual(len(deezer.calls), len(_SOURCE_PATHS) + len(expected_ids))

    def test_result_is_cached_and_callers_get_independent_copies(self) -> None:
        deezer = _Deezer({"/editorial/0/selection": {"data": [_pick(1)]}}, {1: _days_ago(1)})

        first = self._new_releases(deezer)
        first[0]["title"] = "mutated"
        calls_after_first = len(deezer.calls)
        second = self._new_releases(deezer)

        self.assertEqual(second[0]["title"], "Album 1")
        self.assertEqual(len(deezer.calls), calls_after_first)

    def test_malformed_selection_raises_and_names_the_source(self) -> None:
        payloads = (
            {}, {"data": None}, {"data": {}}, {"data": "unexpected"}, {"total": 0},
            {"data": [None]}, {"data": [[]]}, {"data": ["unexpected"]},
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                self._clear_caches()
                deezer = _Deezer(
                    {
                        "/editorial/0/selection": {"data": [_pick(1)]},
                        "/editorial/152/selection": payload,
                    },
                    {1: _days_ago(1)},
                )
                with self.assertRaises(dc.DeezerClientError) as raised:
                    self._new_releases(deezer)
                self.assertIn("/editorial/152/selection", str(raised.exception))

    def test_picks_need_an_id_title_and_artist(self) -> None:
        invalid = (
            {**_pick(1), "id": 0}, {**_pick(1), "id": None}, {**_pick(1), "title": ""},
            {**_pick(1), "artist": None}, {**_pick(1), "artist": {"name": " "}},
        )
        for item in invalid:
            with self.subTest(item=item):
                self._clear_caches()
                deezer = _Deezer({"/editorial/0/selection": {"data": [item]}}, {1: _days_ago(1)})
                with self.assertRaises(dc.DeezerClientError) as raised:
                    self._new_releases(deezer)
                self.assertIn("/editorial/0/selection: data[0]", str(raised.exception))

    def test_failing_source_is_not_treated_as_empty(self) -> None:
        deezer = _Deezer(
            {
                "/editorial/0/selection": {"data": [_pick(1)]},
                "/editorial/464/selection": dc.RateLimited("Quota limit exceeded"),
            },
            {1: _days_ago(1)},
        )
        with self.assertRaises(dc.RateLimited):
            self._new_releases(deezer)

    def test_single_empty_source_is_fine(self) -> None:
        deezer = _Deezer(
            {
                "/editorial/0/selection": {"data": []},
                "/editorial/197/selection": {"data": [_pick(7)]},
            },
            {7: _days_ago(2)},
        )
        self.assertEqual([album["id"] for album in self._new_releases(deezer)], ["7"])

    def test_all_sources_empty_raises_and_names_every_source(self) -> None:
        deezer = _Deezer({}, {})
        with self.assertRaises(dc.DeezerClientError) as raised:
            self._new_releases(deezer)
        message = str(raised.exception)
        for path in _SOURCE_PATHS:
            self.assertIn(path, message)
        self.assertCountEqual(deezer.calls, _SOURCE_PATHS)

    def test_only_outdated_picks_raise_instead_of_an_empty_section(self) -> None:
        deezer = _Deezer(
            {"/editorial/0/selection": {"data": [_pick(1), _pick(2)]}},
            {1: _days_ago(91), 2: "2019-06-14"},
        )
        with self.assertRaises(dc.DeezerClientError) as raised:
            self._new_releases(deezer)
        message = str(raised.exception)
        self.assertIn("last 90 days", message)
        self.assertIn(_days_ago(91), message)
        self.assertIn("/editorial/0/selection", message)

    def test_invalid_release_date_raises_and_names_the_album(self) -> None:
        for value in (None, "", "0000-00-00", "2026", "20261113", 20261113):
            with self.subTest(value=value):
                self._clear_caches()
                deezer = _Deezer(
                    {"/editorial/0/selection": {"data": [_pick(1), _pick(2)]}},
                    {1: _days_ago(1), 2: value},
                )
                with self.assertRaises(dc.DeezerClientError) as raised:
                    self._new_releases(deezer)
                self.assertIn("album 2", str(raised.exception))

    def test_release_date_lookup_failures_keep_their_kind_and_name_the_album(self) -> None:
        cases = (
            (dc.RateLimited("Quota limit exceeded"), dc.RateLimited),
            (dc.DeezerClientError("boom"), dc.DeezerClientError),
        )
        for failure, expected in cases:
            with self.subTest(failure=failure):
                self._clear_caches()
                deezer = _Deezer({"/editorial/0/selection": {"data": [_pick(1)]}}, {1: failure})
                with self.assertRaises(expected) as raised:
                    self._new_releases(deezer)
                self.assertIs(type(raised.exception), expected)
                self.assertIn("album 1", str(raised.exception))

    def test_removed_album_is_an_upstream_error_not_a_missing_resource(self) -> None:
        deezer = _Deezer(
            {"/editorial/0/selection": {"data": [_pick(1)]}},
            {1: dc.TrackUnavailable("no data")},
        )
        with self.assertRaises(dc.DeezerClientError) as raised:
            self._new_releases(deezer)
        self.assertNotIsInstance(raised.exception, dc.TrackUnavailable)
        self.assertIn("album 1", str(raised.exception))


class NewReleasesHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        app = FastAPI()
        app.include_router(browse.router)
        cls.client = TestClient(app)

    def setUp(self) -> None:
        self._clear_caches()

    def tearDown(self) -> None:
        self._clear_caches()

    def _clear_caches(self) -> None:
        for flights in (dc._new_releases_flights, dc._album_release_date_flights):
            with flights.lock:
                flights.cache.clear()

    def test_route_returns_album_summaries(self) -> None:
        deezer = _Deezer({"/editorial/0/selection": {"data": [_pick(1)]}}, {1: _days_ago(1)})
        with patch.object(dc, "_public_get", side_effect=deezer.get):
            response = self.client.get("/api/new-releases")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [{
                "id": "1", "title": "Album 1", "artist": "Artist 1",
                "cover": "https://example.invalid/1.jpg", "release_date": _days_ago(1),
            }],
        )

    def test_route_reports_an_empty_feed_as_upstream_failure(self) -> None:
        deezer = _Deezer({}, {})
        with patch.object(dc, "_public_get", side_effect=deezer.get):
            response = self.client.get("/api/new-releases")
        self.assertEqual(response.status_code, 502)
        self.assertIn("/editorial/0/selection", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
