"""Public catalog searches distinguish empty results from invalid upstream data."""

from __future__ import annotations

import unittest
from copy import deepcopy
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import browse
from app.services import deezer_client as dc
from app.services.singleflight_cache import SingleFlightTtlCache


_MISSING = object()
_CATALOGS = (
    (
        "album", "search_albums", "/search/album", 25,
        {"id": 101, "title": "Album", "artist": {"name": "Artist"}},
        "title", ("cover_medium", "cover_big", "cover"), "cover",
    ),
    (
        "artist", "search_artists", "/search/artist", 24,
        {"id": 102, "name": "Artist"},
        "name", ("picture_medium", "picture_big", "picture"), "picture",
    ),
    (
        "playlist", "search_playlists", "/search/playlist", 24,
        {"id": 103, "title": "Playlist", "nb_tracks": 8},
        "title", ("picture_medium", "picture_big", "picture"), "cover",
    ),
)


def _with_field(entity: dict, field: str, value: object) -> dict:
    entity = deepcopy(entity)
    if value is _MISSING:
        entity.pop(field, None)
    else:
        entity[field] = value
    return entity


class CatalogSearchProviderTests(unittest.TestCase):
    def test_queries_are_trimmed_and_encoded_for_public_catalog_transport(self) -> None:
        for kind, method, path, limit, entity, *_rest in _CATALOGS:
            with self.subTest(kind=kind):
                with (
                    patch.object(dc, "_public_get", return_value={"data": [entity]}) as get,
                    patch.object(dc.deezer, "deezer_search", side_effect=AssertionError("Catalog search must use shared public transport")),
                ):
                    self.assertEqual(len(getattr(dc, method)("  artist & title  ")), 1)
                get.assert_called_once_with(f"{path}?q=artist+%26+title&limit={limit}")

    def test_blank_catalog_queries_do_not_contact_provider(self) -> None:
        for kind, method, *_rest in _CATALOGS:
            for query in ("", "  ", "\t\n"):
                with self.subTest(kind=kind, query=query):
                    with patch.object(dc, "_public_get") as get:
                        self.assertEqual(getattr(dc, method)(query), [])
                    get.assert_not_called()

    def test_real_empty_collections_are_valid(self) -> None:
        for kind, method, *_rest in _CATALOGS:
            with self.subTest(kind=kind):
                with patch.object(dc, "_public_get", return_value={"data": []}):
                    self.assertEqual(getattr(dc, method)("needle"), [])

    def test_missing_malformed_collections_and_non_object_entities_raise(self) -> None:
        payloads = (
            {}, {"data": None}, {"data": {}},
            {"data": "unexpected"}, {"data": [None]}, {"data": [[]]},
            {"data": [False]}, {"data": ["unexpected"]},
        )
        for kind, method, *_rest in _CATALOGS:
            for payload in payloads:
                with self.subTest(kind=kind, payload=payload):
                    with patch.object(dc, "_public_get", return_value=payload):
                        with self.assertRaises(dc.DeezerClientError):
                            getattr(dc, method)("needle")

    def test_non_object_catalog_responses_fail_at_public_transport(self) -> None:
        for kind, method, *_rest in _CATALOGS:
            for payload in (None, [], "unexpected"):
                with self.subTest(kind=kind, payload=payload):
                    response = Mock()
                    response.json.return_value = payload
                    with patch.object(dc.requests, "get", return_value=response):
                        with self.assertRaises(dc.DeezerClientError):
                            getattr(dc, method)("needle")

    def test_ids_must_be_positive_numeric_values(self) -> None:
        invalid = (_MISSING, None, "", "unknown", 0, "0", -1, "-1", True, False, 12.5, [], {})
        for kind, method, _path, _limit, entity, *_rest in _CATALOGS:
            for value in invalid:
                with self.subTest(kind=kind, value=value):
                    payload = {"data": [_with_field(entity, "id", value)]}
                    with patch.object(dc, "_public_get", return_value=payload):
                        with self.assertRaises(dc.DeezerClientError):
                            getattr(dc, method)("needle")

            for value in (9, "9"):
                with self.subTest(kind=kind, value=value):
                    payload = {"data": [_with_field(entity, "id", value)]}
                    with patch.object(dc, "_public_get", return_value=payload):
                        self.assertEqual(getattr(dc, method)("needle")[0]["id"], "9")

    def test_required_catalog_labels_are_nonempty_text(self) -> None:
        invalid = (_MISSING, None, "", " \t", 0, True, [], {})
        for kind, method, _path, _limit, entity, label, *_rest in _CATALOGS:
            for value in invalid:
                with self.subTest(kind=kind, value=value):
                    payload = {"data": [_with_field(entity, label, value)]}
                    with patch.object(dc, "_public_get", return_value=payload):
                        with self.assertRaises(dc.DeezerClientError):
                            getattr(dc, method)("needle")

    def test_numeric_ids_and_counts_must_fit_exact_json_integer_range(self) -> None:
        maximum = 2**53 - 1
        for kind, method, _path, _limit, entity, *_rest in _CATALOGS:
            with self.subTest(kind=kind):
                with patch.object(dc, "_public_get", return_value={"data": [_with_field(entity, "id", maximum)]}):
                    self.assertEqual(getattr(dc, method)("needle")[0]["id"], str(maximum))
                with patch.object(dc, "_public_get", return_value={"data": [_with_field(entity, "id", maximum + 1)]}):
                    with self.assertRaises(dc.DeezerClientError):
                        getattr(dc, method)("needle")

        playlist = _CATALOGS[2][4]
        with patch.object(dc, "_public_get", return_value={"data": [_with_field(playlist, "nb_tracks", maximum)]}):
            self.assertEqual(dc.search_playlists("needle")[0]["track_count"], maximum)
        with patch.object(dc, "_public_get", return_value={"data": [_with_field(playlist, "nb_tracks", maximum + 1)]}):
            with self.assertRaises(dc.DeezerClientError):
                dc.search_playlists("needle")

    def test_large_ascii_string_ids_stay_strings_without_integer_conversion(self) -> None:
        track_id = "9" * 5000
        for kind, method, _path, _limit, entity, *_rest in _CATALOGS:
            with self.subTest(kind=kind):
                with patch.object(dc, "_public_get", return_value={"data": [_with_field(entity, "id", track_id)]}):
                    result = getattr(dc, method)("needle")[0]
                self.assertEqual(result["id"], track_id)
                if kind == "album":
                    self.assertEqual(result["album_id"], track_id)

    def test_album_artist_requires_an_object_and_nonempty_name(self) -> None:
        invalid = (
            _MISSING, None, [], "Artist", {}, {"name": None},
            {"name": ""}, {"name": " \t"}, {"name": True}, {"name": []},
        )
        album = _CATALOGS[0][4]
        for value in invalid:
            with self.subTest(value=value):
                with patch.object(dc, "_public_get", return_value={"data": [_with_field(album, "artist", value)]}):
                    with self.assertRaises(dc.DeezerClientError):
                        dc.search_albums("needle")

    def test_playlist_track_count_requires_nonnegative_integer(self) -> None:
        playlist = _CATALOGS[2][4]
        for value in (_MISSING, None, True, False, -1, "8", 8.5, "", [], {}):
            with self.subTest(value=value):
                payload = {"data": [_with_field(playlist, "nb_tracks", value)]}
                with patch.object(dc, "_public_get", return_value=payload):
                    with self.assertRaises(dc.DeezerClientError):
                        dc.search_playlists("needle")

        for value in (0, 8):
            with self.subTest(value=value):
                payload = {"data": [_with_field(playlist, "nb_tracks", value)]}
                with patch.object(dc, "_public_get", return_value=payload):
                    self.assertEqual(dc.search_playlists("needle")[0]["track_count"], value)

    def test_optional_artwork_may_be_absent_none_or_empty(self) -> None:
        for kind, method, _path, _limit, entity, _label, artwork_fields, artwork_output in _CATALOGS:
            for value in (_MISSING, None, ""):
                with self.subTest(kind=kind, value=value):
                    item = deepcopy(entity)
                    for field in artwork_fields:
                        item = _with_field(item, field, value)
                    with patch.object(dc, "_public_get", return_value={"data": [item]}):
                        self.assertEqual(getattr(dc, method)("needle")[0][artwork_output], "")

    def test_malformed_supplied_artwork_raises_even_below_valid_preferred_field(self) -> None:
        for kind, method, _path, _limit, entity, _label, artwork_fields, _output in _CATALOGS:
            for field in artwork_fields:
                for value in (0, False, [], {}, 7):
                    with self.subTest(kind=kind, field=field, value=value):
                        item = _with_field(entity, artwork_fields[0], "https://example.invalid/preferred.jpg")
                        item[field] = value
                        with patch.object(dc, "_public_get", return_value={"data": [item]}):
                            with self.assertRaises(dc.DeezerClientError):
                                getattr(dc, method)("needle")

    def test_optional_artwork_selection_keeps_existing_priority(self) -> None:
        for kind, method, _path, _limit, entity, _label, artwork_fields, artwork_output in _CATALOGS:
            for offset, field in enumerate(artwork_fields):
                with self.subTest(kind=kind, field=field):
                    item = deepcopy(entity)
                    item.update({candidate: None for candidate in artwork_fields[:offset]})
                    item.update({candidate: f"https://example.invalid/{candidate}.jpg" for candidate in artwork_fields[offset:]})
                    with patch.object(dc, "_public_get", return_value={"data": [item]}):
                        self.assertEqual(getattr(dc, method)("needle")[0][artwork_output], f"https://example.invalid/{field}.jpg")

    def test_album_search_keeps_existing_track_shaped_projection(self) -> None:
        for album_id in (101, "101"):
            with self.subTest(album_id=album_id):
                album = {"id": album_id, "title": "Album", "artist": {"name": "Artist"}, "cover_medium": "https://example.invalid/album.jpg"}
                with patch.object(dc, "_public_get", return_value={"data": [album]}):
                    self.assertEqual(dc.search_albums("needle"), [{
                        "id": "101", "title": "Album", "artist": "Artist",
                        "album": "Album", "album_id": album_id,
                        "cover": "https://example.invalid/album.jpg",
                        "duration_sec": 0, "preview_url": None,
                    }])

    def test_track_query_whitespace_does_not_create_separate_cached_search(self) -> None:
        cache = SingleFlightTtlCache[tuple[str, int], list[dict]](ttl_seconds=15, max_entries=4, max_inflight=2)
        with (
            patch.object(dc, "_search_tracks_flights", cache),
            patch.object(dc, "_public_get", return_value={"data": []}) as get,
        ):
            self.assertEqual(dc.search_tracks_public("  needle  ", 1), [])
            self.assertEqual(dc.search_tracks_public("needle", 1), [])
            self.assertEqual(dc.search_tracks_public(" \t ", 1), [])
        get.assert_called_once_with("/search?q=needle&limit=1")


class CatalogSearchHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        app = FastAPI()
        app.include_router(browse.router)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()

    def test_unsupported_search_type_is_422_even_with_empty_query(self) -> None:
        with (
            patch.object(dc, "search_tracks_public") as tracks,
            patch.object(dc, "search_albums") as albums,
        ):
            for query in ("", "needle"):
                for kind in ("artist", "ALBUM", "unknown"):
                    with self.subTest(query=query, kind=kind):
                        response = self.client.get("/api/search", params={"q": query, "type": kind})
                        self.assertEqual(response.status_code, 422)
                        self.assertEqual(response.json()["detail"][0]["loc"], ["query", "type"])
        tracks.assert_not_called()
        albums.assert_not_called()

    def test_router_trims_queries_before_all_search_operations(self) -> None:
        cases = (
            ("/api/search", {}, "search_tracks_public", [{"id": "1"}]),
            ("/api/search", {"type": "album"}, "search_albums", [{"id": "2"}]),
            ("/api/search/artist", {}, "search_artists", [{"id": "3", "name": "Artist"}]),
            ("/api/search/playlist", {}, "search_playlists", [{"id": "4", "title": "Playlist", "track_count": 0}]),
        )
        for path, params, method, result in cases:
            with self.subTest(path=path, params=params):
                with patch.object(dc, method, return_value=result) as search:
                    response = self.client.get(path, params={**params, "q": "  needle & title \t"})
                self.assertEqual(response.status_code, 200)
                search.assert_called_once_with("needle & title")

    def test_blank_queries_are_empty_without_search_operations(self) -> None:
        with (
            patch.object(dc, "search_tracks_public") as tracks,
            patch.object(dc, "search_albums") as albums,
            patch.object(dc, "search_artists") as artists,
            patch.object(dc, "search_playlists") as playlists,
        ):
            cases = (("/api/search", {}), ("/api/search", {"type": "album"}), ("/api/search/artist", {}), ("/api/search/playlist", {}))
            for path, params in cases:
                with self.subTest(path=path, params=params):
                    response = self.client.get(path, params={**params, "q": " \t "})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), [])
        for search in (tracks, albums, artists, playlists):
            search.assert_not_called()

    def test_invalid_upstream_catalog_shape_becomes_clear_502(self) -> None:
        cases = (("/api/search", {"type": "album"}), ("/api/search/artist", {}), ("/api/search/playlist", {}))
        for path, params in cases:
            with self.subTest(path=path):
                with patch.object(dc, "_public_get", return_value={"data": None}):
                    response = self.client.get(path, params={**params, "q": "needle"})
                self.assertEqual(response.status_code, 502)
                self.assertIn("Deezer error", response.json()["detail"])
                self.assertIn("data", response.json()["detail"])

    def test_catalogs_without_artwork_serialize_successfully(self) -> None:
        cases = (
            ("/api/search", {"type": "album"}, _CATALOGS[0][4], "cover"),
            ("/api/search/artist", {}, _CATALOGS[1][4], "picture"),
            ("/api/search/playlist", {}, _CATALOGS[2][4], "cover"),
        )
        for path, params, entity, artwork in cases:
            with self.subTest(path=path):
                with patch.object(dc, "_public_get", return_value={"data": [entity]}):
                    response = self.client.get(path, params={**params, "q": "needle"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()[0][artwork], "")

    def test_openapi_documents_only_supported_search_types(self) -> None:
        operation = self.client.app.openapi()["paths"]["/api/search"]["get"]
        parameter = next(parameter for parameter in operation["parameters"] if parameter["name"] == "type")
        self.assertEqual(parameter["schema"]["enum"], ["track", "album"])
        self.assertEqual(parameter["schema"]["default"], "track")
        self.assertIn("422", operation["responses"])


if __name__ == "__main__":
    unittest.main()
