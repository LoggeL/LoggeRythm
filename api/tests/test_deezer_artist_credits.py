from __future__ import annotations

import unittest
from unittest.mock import call, patch

from app.services import deezer_client as dc


def _summary(track_id: str = "2947516331") -> dict:
    return {
        "id": track_id,
        "title": "Die With A Smile",
        "artist": {"id": 75491, "name": "Lady Gaga"},
        "album": {"id": 629506181, "title": "Die With A Smile"},
        "duration": 250,
    }


def _detail(track_id: str = "2947516331") -> dict:
    return {
        **_summary(track_id),
        "contributors": [
            {"id": 75491, "name": "Lady Gaga", "role": "Main"},
            {"id": 429675, "name": "Bruno Mars", "role": "Main"},
        ],
    }


class DeezerArtistCreditTests(unittest.TestCase):
    def setUp(self) -> None:
        with dc._track_artists_lock:
            dc._track_artists_cache.clear()
        with dc._track_isrc_flights.lock:
            dc._track_isrc_flights.cache.clear()
        with dc._track_detail_meta_flights.lock:
            dc._track_detail_meta_flights.cache.clear()
        dc.clear_search_caches()
        dc.reset_public_rate_limiter()

    def tearDown(self) -> None:
        with dc._track_artists_lock:
            dc._track_artists_cache.clear()
        with dc._track_isrc_flights.lock:
            dc._track_isrc_flights.cache.clear()
        with dc._track_detail_meta_flights.lock:
            dc._track_detail_meta_flights.cache.clear()
        dc.clear_search_caches()
        dc.reset_public_rate_limiter()

    def test_cold_search_uses_single_core_request_without_blocking_on_track_details(self) -> None:
        search_response = {"data": [_summary()]}
        with patch.object(
            dc,
            "_public_get",
            return_value=search_response,
        ) as public_get:
            tracks = dc.search_tracks_public("Die With A Smile", limit=1)

        self.assertEqual(
            tracks[0]["artists"],
            [{"id": "75491", "name": "Lady Gaga"}],
        )
        public_get.assert_called_once_with("/search?q=Die+With+A+Smile&limit=1", interactive=True)

    def test_search_reuses_cached_full_credits_without_extra_upstream_calls(self) -> None:
        with patch.object(dc, "_public_get", return_value=_detail()):
            hydrated = dc.track_public("2947516331")
        self.assertEqual(len(hydrated["artists"]), 2)

        with patch.object(
            dc,
            "_public_get",
            return_value={"data": [_summary()]},
        ) as public_get:
            tracks = dc.search_tracks_public("Die With A Smile", limit=1)

        self.assertEqual(
            tracks[0]["artists"],
            [
                {"id": "75491", "name": "Lady Gaga"},
                {"id": "429675", "name": "Bruno Mars"},
            ],
        )
        public_get.assert_called_once_with("/search?q=Die+With+A+Smile&limit=1", interactive=True)

    def test_enriched_search_and_detail_endpoints_preserve_full_credits(self) -> None:
        search_response = {"data": [_summary()]}
        with patch.object(
            dc,
            "_public_get",
            side_effect=[search_response, _detail()],
        ) as public_get:
            tracks = dc.search_tracks_public("Die With A Smile", limit=1, enrich=True)

        self.assertEqual(
            tracks[0]["artists"],
            [
                {"id": "75491", "name": "Lady Gaga"},
                {"id": "429675", "name": "Bruno Mars"},
            ],
        )
        self.assertEqual(
            public_get.call_args_list,
            [
                call("/search?q=Die+With+A+Smile&limit=1", interactive=False),
                call("/track/2947516331"),
            ],
        )

    def test_album_and_playlist_details_still_enrich_full_artist_credits(self) -> None:
        album_payload = {
            "id": 629506181,
            "title": "Die With A Smile",
            "artist": {"id": 75491, "name": "Lady Gaga"},
            "genres": {"data": []},
            "tracks": {"data": [_summary()]},
        }
        playlist_payload = {
            "id": 555,
            "title": "Top Hits",
            "tracks": {"data": [_summary()]},
        }
        with patch.object(
            dc,
            "_public_get",
            side_effect=[album_payload, _detail(), playlist_payload],
        ) as public_get:
            album = dc.album_detail("629506181")
            playlist = dc.playlist_detail("555")

        expected_credits = [
            {"id": "75491", "name": "Lady Gaga"},
            {"id": "429675", "name": "Bruno Mars"},
        ]
        self.assertEqual(album["tracks"][0]["artists"], expected_credits)
        self.assertEqual(playlist["tracks"][0]["artists"], expected_credits)
        # Second detail view reuses cached contributors from the first without re-fetching /track/{id}.
        self.assertEqual(
            public_get.call_args_list,
            [
                call("/album/629506181"),
                call("/track/2947516331"),
                call("/playlist/555"),
            ],
        )

    def test_repeated_summary_uses_cached_complete_credits(self) -> None:
        with patch.object(dc, "_public_get", return_value=_detail()) as public_get:
            first = dc.normalize_public_tracks([_summary()])
            second = dc.normalize_public_tracks([_summary()])

        self.assertEqual(first[0]["artists"], second[0]["artists"])
        public_get.assert_called_once_with("/track/2947516331")

    def test_inline_contributors_need_no_detail_request(self) -> None:
        with patch.object(dc, "_public_get") as public_get:
            tracks = dc.normalize_public_tracks([_detail()])

        self.assertEqual(len(tracks[0]["artists"]), 2)
        public_get.assert_not_called()

    def test_missing_full_contributors_fails_with_track_context(self) -> None:
        with patch.object(dc, "_public_get", return_value=_summary()):
            with self.assertRaisesRegex(
                dc.DeezerClientError,
                "track 2947516331 has no contributor list",
            ):
                dc.normalize_public_tracks([_summary()])


if __name__ == "__main__":
    unittest.main()
