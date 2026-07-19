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

    def tearDown(self) -> None:
        with dc._track_artists_lock:
            dc._track_artists_cache.clear()

    def test_search_enriches_collection_items_from_full_track_details(self) -> None:
        search_response = {"data": [_summary()]}
        with patch.object(
            dc,
            "_public_get",
            side_effect=[search_response, _detail()],
        ) as public_get:
            tracks = dc.search_tracks_public("Die With A Smile", limit=1)

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
                call("/search?q=Die+With+A+Smile&limit=1"),
                call("/track/2947516331"),
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
