import unittest
from unittest.mock import patch

from app.services import deezer_client as dc


def _album(genres):
    return {"id": 7, "title": "Album", "nb_tracks": 0, "genres": genres, "tracks": {"data": []}}


class AlbumGenreTests(unittest.TestCase):
    def test_album_detail_lists_deezer_genres_in_order(self) -> None:
        album = _album({"data": [{"id": 132, "name": "Pop", "picture": "x"}, {"id": 106, "name": "Electro"}]})
        with patch.object(dc, "_public_get", return_value=album):
            detail = dc.album_detail("7")
        self.assertEqual(detail["genres"], [{"id": "132", "name": "Pop"}, {"id": "106", "name": "Electro"}])

    def test_album_without_genres_has_an_empty_list(self) -> None:
        with patch.object(dc, "_public_get", return_value=_album({"data": []})):
            self.assertEqual(dc.album_detail("7")["genres"], [])

    def test_missing_or_malformed_genres_fail_loudly(self) -> None:
        for genres, message in (
            (None, "no valid genres object"),
            ({"data": "Pop"}, "no valid genres object"),
            ({"data": [{"id": 132}]}, "invalid genre at index 0"),
        ):
            with self.subTest(genres=genres), patch.object(dc, "_public_get", return_value=_album(genres)):
                with self.assertRaisesRegex(dc.DeezerClientError, message):
                    dc.album_detail("7")


if __name__ == "__main__":
    unittest.main()
