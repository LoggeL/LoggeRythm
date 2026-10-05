"""Discovery failures remain visible; metadata work is shared and bounded."""

from __future__ import annotations

import threading
import unittest
from concurrent.futures import Future, ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests
from fastapi import HTTPException

from app.routers import browse, home, radio
from app.services import deezer_client as dc
from app.services import discovery, lastfm, lastfm_client, recommend, singleflight_cache
from app.services.lastfm_client import LastfmError


def _response(payload: object) -> Mock:
    response = Mock()
    response.json.return_value = payload
    return response


def _track_metadata() -> dict:
    return {"track": {"playcount": "120", "listeners": "45"}}


def _artist_metadata() -> dict:
    return {
        "artist": {
            "stats": {"playcount": "120", "listeners": "45"},
            "bio": {"summary": 'Artist biography. <a href="https://last.fm">Read more</a>'},
            "tags": {"tag": [{"name": "rock"}, {"name": "indie"}]},
        }
    }


class LastfmTransportTests(unittest.TestCase):
    def test_request_has_required_auth_and_contextual_transport_failure(self) -> None:
        with patch.object(lastfm_client.requests, "get", side_effect=requests.ConnectionError("https://example.invalid/?api_key=test-key unreachable")) as request:
            with self.assertRaises(LastfmError) as caught:
                lastfm_client.get_json({"method": "track.getsimilar"}, api_key="test-key", context="seed discovery")

        self.assertIn("seed discovery", str(caught.exception))
        self.assertIn("ConnectionError", str(caught.exception))
        self.assertNotIn("test-key", str(caught.exception))
        self.assertEqual(request.call_args.kwargs["params"]["api_key"], "test-key")
        self.assertEqual(request.call_args.kwargs["params"]["format"], "json")
        self.assertEqual(request.call_args.kwargs["params"]["method"], "track.getsimilar")

    def test_explicit_provider_request_requires_a_key(self) -> None:
        with patch.object(lastfm_client.requests, "get") as request:
            with self.assertRaisesRegex(LastfmError, "LASTFM_API_KEY"):
                lastfm_client.get_json({}, api_key="", context="required provider")
        request.assert_not_called()

    def test_http_failure_is_lastfm_error(self) -> None:
        response = _response({})
        response.raise_for_status.side_effect = requests.HTTPError("503 Service Unavailable", response=Mock(status_code=503))
        with patch.object(lastfm_client.requests, "get", return_value=response):
            with self.assertRaises(LastfmError) as caught:
                lastfm_client.get_json({}, api_key="test-key", context="artist metadata")
        self.assertIn("artist metadata", str(caught.exception))
        self.assertIn("503", str(caught.exception))

    def test_invalid_json_and_non_object_responses_are_errors(self) -> None:
        invalid_json = _response(None)
        invalid_json.json.side_effect = ValueError("bad JSON")
        with patch.object(lastfm_client.requests, "get", return_value=invalid_json):
            with self.assertRaises(LastfmError) as caught:
                lastfm_client.get_json({}, api_key="test-key", context="JSON probe")
        self.assertIn("JSON probe", str(caught.exception))

        for payload in (None, [], "unexpected", 7):
            with self.subTest(payload=payload):
                with patch.object(lastfm_client.requests, "get", return_value=_response(payload)):
                    with self.assertRaises(LastfmError):
                        lastfm_client.get_json({}, api_key="test-key", context="shape probe")

    def test_api_error_includes_provider_error_and_does_not_become_empty_data(self) -> None:
        with patch.object(lastfm_client.requests, "get", return_value=_response({"error": 29, "message": "Rate limit exceeded"})):
            with self.assertRaises(LastfmError) as caught:
                lastfm_client.get_json({}, api_key="test-key", context="tag discovery")
        self.assertIn("Rate limit exceeded", str(caught.exception))
        self.assertIn("tag discovery", str(caught.exception))

    def test_not_found_is_none_only_when_explicitly_allowed(self) -> None:
        with patch.object(lastfm_client.requests, "get", return_value=_response({"error": 6, "message": "Track not found"})):
            with self.assertRaises(LastfmError):
                lastfm_client.get_json({}, api_key="test-key", context="similar tracks")
            self.assertIsNone(lastfm_client.get_json({}, api_key="test-key", context="track metadata", allow_not_found=True))

        with patch.object(lastfm_client.requests, "get", return_value=_response({"error": 29, "message": "Rate limit exceeded"})):
            with self.assertRaises(LastfmError):
                lastfm_client.get_json({}, api_key="test-key", context="track metadata", allow_not_found=True)

        with patch.object(lastfm_client.requests, "get", return_value=_response({"error": 6, "message": "Invalid parameters"})):
            with self.assertRaises(LastfmError):
                lastfm_client.get_json({}, api_key="test-key", context="track metadata", allow_not_found=True)


class RecommendationFailureTests(unittest.TestCase):
    def test_no_optional_key_does_not_call_provider(self) -> None:
        with (
            patch.object(recommend, "LASTFM_API_KEY", ""),
            patch.object(lastfm, "LASTFM_API_KEY", ""),
            patch.object(lastfm_client.requests, "get") as request,
        ):
            self.assertEqual(recommend.similar_tracks("Artist", "Track"), [])
            self.assertEqual(recommend.similar_artists("Artist"), [])
            self.assertEqual(recommend.tag_top_tracks(["rock"]), [])
            self.assertEqual(lastfm.plays_for([{"id": "1", "artist": "Artist", "title": "Track"}]), {})
            self.assertIsNone(lastfm.artist_info("Artist"))
        request.assert_not_called()

    def test_configured_provider_network_failure_propagates(self) -> None:
        with (
            patch.object(recommend, "LASTFM_API_KEY", "test-key"),
            patch.object(lastfm_client.requests, "get", side_effect=requests.Timeout("provider timed out")),
        ):
            for operation in (
                lambda: recommend.similar_tracks("Artist", "Track"),
                lambda: recommend.similar_artists("Artist"),
                lambda: recommend.tag_top_tracks(["rock", "indie"]),
            ):
                with self.subTest(operation=operation):
                    with self.assertRaises(LastfmError):
                        operation()

    def test_true_empty_similar_tracks_are_valid(self) -> None:
        for payload in ({"similartracks": {"track": []}},):
            with self.subTest(payload=payload):
                with (
                    patch.object(recommend, "LASTFM_API_KEY", "test-key"),
                    patch.object(lastfm_client.requests, "get", return_value=_response(payload)),
                    patch.object(dc, "search_tracks_public") as search,
                ):
                    self.assertEqual(recommend.similar_tracks("Artist", "Track"), [])
                search.assert_not_called()

    def test_unknown_similarity_seed_is_a_valid_empty_result(self) -> None:
        def missing(_url: str, *, params: dict, timeout: int) -> Mock:
            message = "Artist not found" if params["method"] == "artist.getsimilar" else "Track not found"
            return _response({"error": 6, "message": message})

        with (
            patch.object(recommend, "LASTFM_API_KEY", "test-key"),
            patch.object(lastfm_client.requests, "get", side_effect=missing),
        ):
            self.assertEqual(recommend.similar_tracks("Unknown", "Track"), [])
            self.assertEqual(recommend.similar_artists("Unknown"), [])
            with self.assertRaises(LastfmError):
                recommend.tag_top_tracks(["rock"])

    def test_malformed_similar_track_list_is_not_empty_success(self) -> None:
        payloads = [
            {},
            {"similartracks": None},
            {"similartracks": []},
            {"similartracks": {}},
            {"similartracks": {"track": None}},
            {"similartracks": {"track": {}}},
            {"similartracks": {"track": ["broken"]}},
        ]
        with patch.object(recommend, "LASTFM_API_KEY", "test-key"):
            for payload in payloads:
                with self.subTest(payload=payload):
                    with patch.object(lastfm_client.requests, "get", return_value=_response(payload)):
                        with self.assertRaises(LastfmError):
                            recommend.similar_tracks("Artist", "Track")

    def test_deezer_resolution_failure_propagates(self) -> None:
        failure = dc.DeezerClientError("search upstream unavailable")
        with patch.object(dc, "search_tracks_public", side_effect=failure):
            with self.assertRaises(discovery.DiscoveryError) as caught:
                recommend.resolve_queries(["Artist Track"])
        self.assertIs(caught.exception.__cause__, failure)
        self.assertIn("Artist Track", str(caught.exception))

    def test_empty_deezer_search_remains_legitimate(self) -> None:
        with patch.object(dc, "search_tracks_public", return_value=[]):
            self.assertEqual(recommend.resolve_queries(["Unknown Artist Track"]), [])


class LastfmMetadataCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key_patch = patch.object(lastfm, "LASTFM_API_KEY", "test-key")
        self.key_patch.start()
        self.addCleanup(self.key_patch.stop)
        self._clear_caches()
        self.addCleanup(self._clear_caches)

    def _clear_caches(self) -> None:
        for cache in (lastfm._track_cache, lastfm._artist_cache):
            with cache.lock:
                self.assertFalse(cache.inflight)
                cache.cache.clear()

    def test_duplicate_normalized_metadata_reuses_lookup_and_preserves_ids(self) -> None:
        items = [
            {"id": "11", "artist": "Artist", "title": "Track"},
            {"id": "12", "artist": " artist ", "title": " TRACK "},
        ]
        with patch.object(lastfm_client.requests, "get", return_value=_response(_track_metadata())) as request:
            self.assertEqual(lastfm.plays_for(items), {
                "11": {"plays": 120, "listeners": 45},
                "12": {"plays": 120, "listeners": 45},
            })
            self.assertEqual(lastfm.plays_for([{"id": "13", "artist": "ARTIST", "title": "track"}]), {
                "13": {"plays": 120, "listeners": 45},
            })
        request.assert_called_once()

    def test_metadata_failure_is_not_cached_and_next_call_retries(self) -> None:
        items = [{"id": "11", "artist": "Artist", "title": "Track"}]
        with patch.object(lastfm_client.requests, "get", side_effect=[requests.Timeout("provider timed out"), _response(_track_metadata())]) as request:
            with self.assertRaises(discovery.DiscoveryError) as caught:
                lastfm.plays_for(items)
            self.assertIsInstance(caught.exception.__cause__, LastfmError)
            self.assertFalse(lastfm._track_cache.cache)
            self.assertFalse(lastfm._track_cache.inflight)
            self.assertEqual(lastfm.plays_for(items), {"11": {"plays": 120, "listeners": 45}})
        self.assertEqual(request.call_count, 2)

    def test_invalid_metadata_does_not_enter_cache(self) -> None:
        items = [{"id": "11", "artist": "Artist", "title": "Track"}]
        payloads = [
            {},
            {"track": None},
            {"track": []},
            {"track": {}},
            {"track": {"playcount": "invalid", "listeners": "2"}},
            {"track": {"playcount": "-1", "listeners": "2"}},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                with patch.object(lastfm_client.requests, "get", return_value=_response(payload)):
                    with self.assertRaises(discovery.DiscoveryError) as caught:
                        lastfm.plays_for(items)
                self.assertIsInstance(caught.exception.__cause__, LastfmError)
                self.assertFalse(lastfm._track_cache.cache)

    def test_explicit_unknown_metadata_is_cached_as_absence(self) -> None:
        def missing(_url: str, *, params: dict, timeout: int) -> Mock:
            message = "Artist not found" if params["method"] == "artist.getInfo" else "Track not found"
            return _response({"error": 6, "message": message})

        with patch.object(lastfm_client.requests, "get", side_effect=missing) as request:
            items = [{"id": "11", "artist": "Unknown", "title": "Unknown"}]
            self.assertEqual(lastfm.plays_for(items), {})
            self.assertEqual(lastfm.plays_for(items), {})
            self.assertIsNone(lastfm.artist_info("Unknown"))
            self.assertIsNone(lastfm.artist_info("unknown"))
        self.assertEqual(request.call_count, 2)

    def test_valid_zero_counts_are_cached_as_no_listen_data(self) -> None:
        payload = {"track": {"playcount": "0", "listeners": "0"}}
        items = [{"id": "11", "artist": "Artist", "title": "Track"}]
        with patch.object(lastfm_client.requests, "get", return_value=_response(payload)) as request:
            self.assertEqual(lastfm.plays_for(items), {})
            self.assertEqual(lastfm.plays_for(items), {})
        request.assert_called_once()

    def test_simultaneous_metadata_requests_share_one_provider_load(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        joined = threading.Event()
        waiter_lock = threading.Lock()
        waiter_count = 0

        class MetadataFuture(Future):
            def result(self, timeout: float | None = None) -> object:
                nonlocal waiter_count
                with waiter_lock:
                    waiter_count += 1
                    if waiter_count == 3:
                        joined.set()
                return super().result(timeout)

        def fetch(*_args: object, **_kwargs: object) -> Mock:
            entered.set()
            self.assertTrue(release.wait(3))
            return _response(_track_metadata())

        with (
            patch.object(lastfm_client.requests, "get", side_effect=fetch) as request,
            patch.object(singleflight_cache, "Future", MetadataFuture),
            ThreadPoolExecutor(max_workers=4) as pool,
        ):
            futures = [pool.submit(lastfm.plays_for, [{"id": str(index), "artist": "Artist", "title": "Track"}]) for index in range(1, 5)]
            try:
                self.assertTrue(entered.wait(3))
                self.assertTrue(joined.wait(3))
            finally:
                release.set()
            results = [future.result(timeout=3) for future in futures]

        request.assert_called_once()
        self.assertEqual(results, [{str(index): {"plays": 120, "listeners": 45}} for index in range(1, 5)])

    def test_track_and_artist_caches_keep_configured_entry_bounds(self) -> None:
        with (
            patch.object(lastfm._track_cache, "max_entries", 2),
            patch.object(lastfm._artist_cache, "max_entries", 2),
            patch.object(lastfm_client.requests, "get") as request,
        ):
            request.return_value = _response(_track_metadata())
            for index in range(3):
                lastfm.plays_for([{"id": str(index + 1), "artist": "Artist", "title": f"Track {index}"}])
            self.assertEqual(len(lastfm._track_cache.cache), 2)
            self.assertNotIn(lastfm._key("Artist", "Track 0"), lastfm._track_cache.cache)

            request.return_value = _response(_artist_metadata())
            for index in range(3):
                lastfm.artist_info(f"Artist {index}")
            self.assertEqual(len(lastfm._artist_cache.cache), 2)
            self.assertNotIn("artist 0", lastfm._artist_cache.cache)

    def test_artist_metadata_failure_is_not_cached(self) -> None:
        with patch.object(lastfm_client.requests, "get", side_effect=[_response({"error": 29, "message": "Rate limit exceeded"}), _response(_artist_metadata())]) as request:
            with self.assertRaises(LastfmError):
                lastfm.artist_info("Artist")
            self.assertFalse(lastfm._artist_cache.cache)
            self.assertEqual(lastfm.artist_info("Artist"), {
                "bio": "Artist biography.",
                "listeners": 45,
                "playcount": 120,
                "tags": ["rock", "indie"],
            })
        self.assertEqual(request.call_count, 2)


class DiscoveryBatchTests(unittest.TestCase):
    def test_sources_load_concurrently_and_keep_declared_result_order(self) -> None:
        names = ["first", "second", "third"]
        started = threading.Barrier(4)
        releases = {name: threading.Event() for name in names}
        finished = {name: threading.Event() for name in names}

        def load(name: str) -> list[str]:
            started.wait(timeout=3)
            self.assertTrue(releases[name].wait(3))
            finished[name].set()
            return [name]

        jobs = {name: lambda name=name: load(name) for name in names}
        with ThreadPoolExecutor(max_workers=1) as caller:
            pending = caller.submit(discovery.run_jobs, jobs, max_workers=3)
            try:
                started.wait(timeout=3)
                for name in reversed(names):
                    releases[name].set()
                    self.assertTrue(finished[name].wait(3))
            finally:
                for event in releases.values():
                    event.set()
            results = pending.result(timeout=3)

        self.assertEqual(list(results), names)
        self.assertEqual(results, {name: [name] for name in names})

    def test_every_failed_source_is_reported_and_no_partial_result_is_returned(self) -> None:
        loaded: list[str] = []
        loaded_lock = threading.Lock()

        def load(name: str) -> list[str]:
            with loaded_lock:
                loaded.append(name)
            if name in ("first", "third"):
                raise LastfmError(f"{name} provider failed")
            return [name]

        jobs = {name: lambda name=name: load(name) for name in ("first", "second", "third")}
        with self.assertRaises(discovery.DiscoveryError) as caught:
            discovery.run_jobs(jobs)

        self.assertCountEqual(loaded, jobs)
        self.assertIn("2 of 3", str(caught.exception))
        self.assertIn("first: first provider failed", str(caught.exception))
        self.assertIn("third: third provider failed", str(caught.exception))
        self.assertLess(str(caught.exception).index("first:"), str(caught.exception).index("third:"))


class DiscoveryHttpBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_radio_resolution_preserves_provider_retry_and_resource_status(self) -> None:
        seed = {"title": "Seed", "artist": {"id": 1, "name": "Artist"}, "album": {"id": 1}}
        payload = {"similartracks": {"track": [{"name": "Similar", "artist": {"name": "Other"}}]}}
        for failure, status in ((dc.RateLimited("quota exhausted"), 429), (dc.TrackUnavailable("not found"), 404)):
            with self.subTest(failure_type=type(failure)):
                with (
                    patch.object(radio, "_seed_meta", return_value=seed),
                    patch.object(recommend, "LASTFM_API_KEY", "test-key"),
                    patch.object(lastfm_client.requests, "get", return_value=_response(payload)),
                    patch.object(dc, "search_tracks_public", side_effect=failure),
                    patch.object(radio, "_deezer_mix") as next_source,
                ):
                    with self.assertRaises(HTTPException) as caught:
                        await radio.radio("11")
                self.assertEqual(caught.exception.status_code, status)
                self.assertIn("Other Similar", caught.exception.detail)
                next_source.assert_not_called()

    async def test_configured_radio_missing_artist_name_is_a_clear_provider_error(self) -> None:
        seed = {"title": "Seed", "artist": {"id": 1}, "album": {"id": 1}}
        with (
            patch.object(radio, "_seed_meta", return_value=seed),
            patch.object(recommend, "LASTFM_API_KEY", "test-key"),
            patch.object(lastfm_client.requests, "get") as request,
        ):
            with self.assertRaises(HTTPException) as caught:
                await radio.radio("11")
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("requires artist and title", caught.exception.detail)
        request.assert_not_called()

    async def test_nested_home_provider_rate_limit_keeps_retry_status(self) -> None:
        with (
            patch.object(home, "_user_top_artists", return_value=["Artist"]),
            patch.object(recommend, "similar_artists", return_value=["Other"]),
            patch.object(dc, "search_tracks_public", side_effect=dc.RateLimited("quota exhausted")),
        ):
            with self.assertRaises(HTTPException) as caught:
                home.because_you_listened(SimpleNamespace(id=1), object())
        self.assertEqual(caught.exception.status_code, 429)
        self.assertIn("Other", caught.exception.detail)

    async def test_play_count_failure_becomes_clear_502(self) -> None:
        body = browse.PlaysRequest(tracks=[browse.PlayQuery(id="11", artist="Artist", title="Track")])
        for failure_type in (LastfmError, discovery.DiscoveryError):
            with self.subTest(failure_type=failure_type):
                failure = failure_type("Play count provider unavailable")
                with patch.object(lastfm, "plays_for", side_effect=failure):
                    with self.assertRaises(HTTPException) as caught:
                        await browse.track_plays(body, object())
                self.assertEqual(caught.exception.status_code, 502)
                self.assertIn("Play count provider unavailable", caught.exception.detail)
                self.assertIs(caught.exception.__cause__, failure)

    async def test_artist_metadata_failure_becomes_clear_502(self) -> None:
        for failure_type in (LastfmError, discovery.DiscoveryError):
            with self.subTest(failure_type=failure_type):
                failure = failure_type("Artist metadata provider unavailable")
                with patch.object(lastfm, "artist_info", side_effect=failure):
                    with self.assertRaises(HTTPException) as caught:
                        await browse.artist_about("Artist")
                self.assertEqual(caught.exception.status_code, 502)
                self.assertIn("Artist metadata provider unavailable", caught.exception.detail)
                self.assertIs(caught.exception.__cause__, failure)

    async def test_radio_failure_becomes_clear_502(self) -> None:
        for failure_type in (LastfmError, discovery.DiscoveryError):
            with self.subTest(failure_type=failure_type):
                failure = failure_type("Radio discovery provider unavailable")
                with patch.object(radio, "_radio", side_effect=failure):
                    with self.assertRaises(HTTPException) as caught:
                        await radio.radio("11")
                self.assertEqual(caught.exception.status_code, 502)
                self.assertIn("Radio discovery provider unavailable", caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
