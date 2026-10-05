from __future__ import annotations

import unittest
from datetime import date, timedelta
from unittest.mock import ANY, patch

from fastapi import HTTPException

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

    def test_radar_album_only_loads_performer_credits_for_needed_tracks(self) -> None:
        album = {
            "id": "album", "title": "Album", "nb_tracks": 20,
            "tracks": {"data": [{"id": str(index)} for index in range(20)]},
        }
        with (
            patch.object(dc, "_public_get", return_value=album),
            patch.object(dc, "normalize_public_tracks", side_effect=lambda tracks: tracks) as normalize,
        ):
            limited = dc.album_detail("album", track_limit=2)
            full = dc.album_detail("album")

        self.assertEqual([track["id"] for track in limited["tracks"]], ["0", "1"])
        self.assertEqual(limited["nb_tracks"], 20)
        self.assertEqual(len(normalize.call_args_list[0].args[0]), 2)
        self.assertEqual(len(full["tracks"]), 20)
        self.assertEqual(len(normalize.call_args_list[1].args[0]), 20)

    def test_artist_track_lookup_excludes_future_prerelease_album(self) -> None:
        today = date.today()
        current_release = today - timedelta(days=7)
        future_release = today + timedelta(days=30)
        albums = [
            {
                "id": "future-album",
                "title": "Massendefekt",
                "release_date": future_release.isoformat(),
            },
            {
                "id": "released-single",
                "title": "Voll daneben, halb OK!",
                "release_date": current_release.isoformat(),
            },
        ]

        with (
            patch.object(dc, "artist_albums", return_value=albums),
            patch.object(
                dc,
                "album_detail",
                return_value={
                    "release_date": current_release.isoformat(),
                    "tracks": [{"id": "released-track"}],
                },
            ) as album_detail,
        ):
            tracks = home._artist_new_tracks(
                "135023",
                (today - timedelta(days=90)).isoformat(),
                refresh=True,
            )

        self.assertEqual(
            tracks,
            [
                {
                    "id": "released-track",
                    "release_date": current_release.isoformat(),
                }
            ],
        )
        album_detail.assert_called_once_with("released-single", track_limit=2)

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
            with self.assertRaises(HTTPException) as caught:
                home.release_radar(
                    refresh=True,
                    user=object(),  # type: ignore[arg-type]
                    db=object(),  # type: ignore[arg-type]
                )

        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn(
            "Release Radar failed for 1 of 2 artists: artist 42: upstream unavailable",
            caught.exception.detail,
        )

    def test_radar_quota_failure_keeps_retry_status_and_never_returns_partial_tracks(self) -> None:
        def artist_tracks(artist_id: str, _cutoff: str, *, refresh: bool) -> list[dict]:
            if artist_id == "42":
                raise dc.RateLimited("Quota limit exceeded")
            return [{"id": "99", "title": "Partial result"}]

        with (
            patch.object(home, "_radar_artist_ids", return_value=["42", "43"]),
            patch.object(home, "_artist_new_tracks", side_effect=artist_tracks),
        ):
            with self.assertRaises(HTTPException) as caught:
                home.release_radar(user=object(), db=object())

        self.assertEqual(caught.exception.status_code, 429)
        self.assertIn("Quota limit exceeded", caught.exception.detail)
        self.assertIn("1 of 2 artists", caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
