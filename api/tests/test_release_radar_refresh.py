from __future__ import annotations

import unittest
from unittest.mock import ANY, patch

from app.routers import home
from app.services import deezer_client as dc


class ReleaseRadarRefreshTests(unittest.TestCase):
    def setUp(self) -> None:
        with dc._artist_albums_lock:
            dc._artist_albums_cache.clear()

    def tearDown(self) -> None:
        with dc._artist_albums_lock:
            dc._artist_albums_cache.clear()

    def test_artist_album_refresh_bypasses_and_replaces_cached_value(self) -> None:
        first_response = {"data": [{"id": "1", "title": "Old"}]}
        fresh_response = {"data": [{"id": "2", "title": "Fresh"}]}

        with patch.object(
            dc,
            "_public_get",
            side_effect=[first_response, fresh_response],
        ) as public_get:
            first = dc.artist_albums("42")
            cached = dc.artist_albums("42")
            fresh = dc.artist_albums("42", refresh=True)
            refreshed_cache = dc.artist_albums("42")

        self.assertEqual(first[0]["id"], "1")
        self.assertIs(cached, first)
        self.assertEqual(fresh[0]["id"], "2")
        self.assertIs(refreshed_cache, fresh)
        self.assertEqual(public_get.call_count, 2)

    def test_artist_track_lookup_forwards_explicit_refresh(self) -> None:
        with (
            patch.object(dc, "artist_albums", return_value=[]) as artist_albums,
            patch.object(dc, "album_detail") as album_detail,
        ):
            tracks = home._artist_new_tracks(
                "42",
                "2026-01-01",
                refresh=True,
            )

        self.assertEqual(tracks, [])
        artist_albums.assert_called_once_with("42", refresh=True)
        album_detail.assert_not_called()

    def test_radar_forwards_manual_refresh_to_every_artist_lookup(self) -> None:
        with (
            patch.object(home, "_radar_artist_ids", return_value=["42"]),
            patch.object(home, "_artist_new_tracks", return_value=[]) as new_tracks,
        ):
            tracks = home.release_radar(
                refresh=True,
                user=object(),  # type: ignore[arg-type]
                db=object(),  # type: ignore[arg-type]
            )

        self.assertEqual(tracks, [])
        new_tracks.assert_called_once_with("42", ANY, refresh=True)

    def test_radar_fails_instead_of_returning_partial_refresh(self) -> None:
        def artist_tracks(artist_id: str, _cutoff: str, *, refresh: bool) -> list[dict]:
            self.assertTrue(refresh)
            if artist_id == "42":
                raise dc.DeezerClientError("upstream unavailable")
            return [{"id": "99", "title": "Partial result"}]

        with (
            patch.object(home, "_radar_artist_ids", return_value=["42", "43"]),
            patch.object(home, "_artist_new_tracks", side_effect=artist_tracks),
        ):
            with self.assertRaisesRegex(
                dc.DeezerClientError,
                "Release Radar failed for 1 of 2 artists: "
                "artist 42: upstream unavailable",
            ):
                home.release_radar(
                    refresh=True,
                    user=object(),  # type: ignore[arg-type]
                    db=object(),  # type: ignore[arg-type]
                )


if __name__ == "__main__":
    unittest.main()
