import os
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from app.services.playlist_export import (
    PlaylistExportError,
    PlaylistExportTrack,
    build_playlist_archive,
)


class PlaylistExportTests(unittest.TestCase):
    def setUp(self) -> None:
        fd, self.audio_path = tempfile.mkstemp(suffix=".mp3")
        with os.fdopen(fd, "wb") as audio:
            audio.write(b"test-mp3")

    def tearDown(self) -> None:
        os.remove(self.audio_path)

    @patch("app.services.playlist_export.storage.materialize")
    def test_builds_ordered_mp3_archive_with_safe_names(self, materialize) -> None:
        materialize.return_value = self.audio_path
        tracks = [
            PlaylistExportTrack("123", "AC/DC", "Thunder:Struck"),
            PlaylistExportTrack("456", "AC/DC", "Thunder:Struck"),
        ]

        archive_path, filename = build_playlist_archive("Road/Trip", tracks)
        self.addCleanup(os.remove, archive_path)

        self.assertEqual(filename, "Road_Trip.zip")
        self.assertEqual(materialize.call_count, 2)
        with zipfile.ZipFile(archive_path) as archive:
            self.assertEqual(
                archive.namelist(),
                [
                    "01 - AC_DC - Thunder_Struck.mp3",
                    "02 - AC_DC - Thunder_Struck.mp3",
                ],
            )
            self.assertEqual(archive.read(archive.namelist()[0]), b"test-mp3")

    def test_rejects_empty_playlist(self) -> None:
        with self.assertRaisesRegex(
            PlaylistExportError,
            "empty playlist",
        ):
            build_playlist_archive("Empty", [])

    @patch("app.services.playlist_export.storage.materialize")
    def test_names_failed_track_without_returning_partial_archive(
        self,
        materialize,
    ) -> None:
        materialize.side_effect = RuntimeError("upstream unavailable")
        with tempfile.TemporaryDirectory() as temp_dir:
            archive_path = os.path.join(temp_dir, "export.zip")
            fd = os.open(archive_path, os.O_CREAT | os.O_RDWR)
            with patch(
                "app.services.playlist_export.tempfile.mkstemp",
                return_value=(fd, archive_path),
            ):
                with self.assertRaisesRegex(
                    PlaylistExportError,
                    "Could not export track 1.*Song",
                ):
                    build_playlist_archive(
                        "Broken",
                        [PlaylistExportTrack("123", "Artist", "Song")],
                    )
            self.assertFalse(os.path.exists(archive_path))
