"""Withdrawn Deezer tracks: never matched on import, reported as 404 on play.

Regression: a Spotify import matched "Sweet Dreams" by ISRC to Deezer track
8260, a dead compilation entry (``readable: false``). Preloading it raised
Deezer404Exception, the stream router answered 502, and Cloudflare replaced
that 502 body with its HTML error page, which the web player showed verbatim.
"""
import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.routers import stream
from app.services import deezer
from app.services import deezer_client as dc


def public_track(track_id: int, *, readable: bool) -> dict:
    return {
        "id": track_id,
        "readable": readable,
        "title": "Sweet Dreams (Are Made of This)",
        "duration": 184,
        "artist": {"id": 175, "name": "Eurythmics"},
        "contributors": [{"id": 175, "name": "Eurythmics"}],
        "album": {"id": 5052, "title": "Album", "cover_medium": ""},
    }


class TrackByIsrcTest(unittest.TestCase):
    def test_withdrawn_isrc_hit_is_no_match(self) -> None:
        with patch.object(dc, "_public_get", return_value=public_track(8260, readable=False)):
            self.assertIsNone(dc.track_by_isrc("GBARL0300589"))

    def test_playable_isrc_hit_is_returned(self) -> None:
        with patch.object(dc, "_public_get", return_value=public_track(561836, readable=True)):
            self.assertEqual(dc.track_by_isrc("GBARL0300589")["id"], "561836")

    def test_unknown_isrc_is_no_match(self) -> None:
        with patch.object(dc, "_public_get", side_effect=dc.TrackUnavailable("no data")):
            self.assertIsNone(dc.track_by_isrc("XX0000000000"))

    def test_other_upstream_failures_raise(self) -> None:
        with patch.object(dc, "_public_get", side_effect=dc.RateLimited("quota")):
            with self.assertRaises(dc.RateLimited):
                dc.track_by_isrc("GBARL0300589")

    def test_missing_readable_flag_raises(self) -> None:
        data = public_track(8260, readable=True)
        del data["readable"]
        with patch.object(dc, "_public_get", return_value=data):
            with self.assertRaisesRegex(dc.DeezerClientError, "readable"):
                dc.track_by_isrc("GBARL0300589")


class MatchTrackTest(unittest.TestCase):
    def test_withdrawn_isrc_hit_falls_back_to_search(self) -> None:
        playable = {"id": "561836", "title": "Sweet Dreams"}
        with (
            patch.object(dc, "_public_get", return_value=public_track(8260, readable=False)),
            patch.object(dc, "search_tracks_public", return_value=[playable]) as search,
        ):
            self.assertEqual(
                dc.match_track("Sweet Dreams (Are Made of This)", "Eurythmics", "GBARL0300589"),
                playable,
            )
        search.assert_called_once_with(
            "Eurythmics Sweet Dreams (Are Made of This)",
            limit=1,
            enrich=True,
        )

    def test_search_failure_raises_instead_of_unmatched(self) -> None:
        with patch.object(dc, "search_tracks_public", side_effect=dc.RateLimited("quota")):
            with self.assertRaises(dc.RateLimited):
                dc.match_track("Sweet Dreams", "Eurythmics")


class MaterializeStatusTest(unittest.TestCase):
    def test_withdrawn_track_is_404_with_detail(self) -> None:
        missing = deezer.Deezer404Exception("Deezer track 8260 page not found (HTTP 404)")
        with patch.object(stream.storage, "materialize", side_effect=missing):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(stream._materialize_track("8260"))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertIn("8260 is not available on Deezer", caught.exception.detail)

    def test_other_failures_stay_502(self) -> None:
        with patch.object(stream.storage, "materialize", side_effect=deezer.DeezerApiException("boom")):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(stream._materialize_track("8260"))
        self.assertEqual(caught.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
