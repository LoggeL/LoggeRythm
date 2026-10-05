from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import StoredTrack
from app.services import storage


class StorageIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.engine = create_engine(
            f"sqlite:///{self.directory.name}/storage-test.db",
            connect_args={"check_same_thread": False},
        )
        self.addCleanup(self.engine.dispose)
        StoredTrack.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.enterContext(patch.object(storage, "SessionLocal", self.sessions))
        self.enterContext(patch.dict(os.environ, {"STORAGE_DIR": f"{self.directory.name}/audio"}))
        self.song = {
            "SNG_TITLE": "Stored song",
            "ART_NAME": "Test artist",
            "ALB_TITLE": "Test album",
            "DURATION": "120",
        }

    def store_old_track(self, track_id: str, *, days: int = 40) -> int:
        audio = Path(storage.path_for(track_id))
        audio.write_bytes(b"audio bytes")
        metadata = Path(storage.meta_path_for(track_id))
        metadata.write_text(json.dumps({"title": "Stored song"}), encoding="utf-8")
        storage._upsert_record(track_id, self.song, str(audio))
        with self.sessions() as db:
            row = db.get(StoredTrack, track_id)
            row.last_accessed = storage._now() - timedelta(days=days)
            db.commit()
        return audio.stat().st_size + metadata.stat().st_size

    def row(self, track_id: str) -> StoredTrack | None:
        with self.sessions() as db:
            return db.get(StoredTrack, track_id)

    def download(self, _song: dict, path: str) -> None:
        Path(path).write_bytes(b"downloaded audio")

    def test_materialize_publishes_complete_audio_metadata_and_retention_once(self) -> None:
        with (
            patch.object(storage.deezer, "get_song_infos_from_deezer_website", return_value=self.song),
            patch.object(storage.deezer, "download_song", side_effect=self.download) as download,
        ):
            final = storage.materialize("101")
            self.assertEqual(storage.materialize("101"), final)
        download.assert_called_once()
        self.assertEqual(Path(final).read_bytes(), b"downloaded audio")
        self.assertEqual(storage.get_meta("101")["title"], "Stored song")
        self.assertEqual(self.row("101").size_bytes, len(b"downloaded audio"))
        self.assertFalse(Path(final + ".part").exists())
        self.assertFalse(Path(storage.meta_path_for("101") + ".part").exists())

    def test_concurrent_materialize_downloads_once(self) -> None:
        entered = threading.Event()
        release = threading.Event()

        def download(song: dict, path: str) -> None:
            entered.set()
            self.assertTrue(release.wait(3))
            self.download(song, path)

        with (
            patch.object(storage.deezer, "get_song_infos_from_deezer_website", return_value=self.song),
            patch.object(storage.deezer, "download_song", side_effect=download) as mocked,
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            first = pool.submit(storage.materialize, "102")
            try:
                self.assertTrue(entered.wait(3))
                second = pool.submit(storage.materialize, "102")
            finally:
                release.set()
            self.assertEqual(first.result(timeout=3), second.result(timeout=3))
        mocked.assert_called_once()

    def test_failed_download_removes_partial_and_never_records_ready_track(self) -> None:
        def fail(_song: dict, path: str) -> None:
            Path(path).write_bytes(b"incomplete")
            raise RuntimeError("upstream disconnected")

        with (
            patch.object(storage.deezer, "get_song_infos_from_deezer_website", return_value=self.song),
            patch.object(storage.deezer, "download_song", side_effect=fail),
            self.assertRaisesRegex(RuntimeError, "upstream disconnected"),
        ):
            storage.materialize("103")
        self.assertFalse(Path(storage.path_for("103") + ".part").exists())
        self.assertFalse(storage.is_ready("103"))
        self.assertIsNone(self.row("103"))

    def test_failed_promotion_removes_audio_and_sidecar_partials(self) -> None:
        with (
            patch.object(storage.deezer, "get_song_infos_from_deezer_website", return_value=self.song),
            patch.object(storage.deezer, "download_song", side_effect=self.download),
            patch.object(storage.os, "replace", side_effect=PermissionError("promotion denied")),
            self.assertRaisesRegex(PermissionError, "promotion denied"),
        ):
            storage.materialize("104")
        self.assertFalse(storage.is_ready("104"))
        self.assertFalse(Path(storage.path_for("104") + ".part").exists())
        self.assertFalse(Path(storage.meta_path_for("104") + ".part").exists())
        self.assertIsNone(self.row("104"))

    def test_cancelled_download_removes_partial_audio(self) -> None:
        def cancel(_song: dict, path: str) -> None:
            Path(path).write_bytes(b"incomplete")
            raise KeyboardInterrupt("download cancelled")

        with (
            patch.object(storage.deezer, "get_song_infos_from_deezer_website", return_value=self.song),
            patch.object(storage.deezer, "download_song", side_effect=cancel),
            self.assertRaisesRegex(KeyboardInterrupt, "download cancelled"),
        ):
            storage.materialize("117")
        self.assertFalse(Path(storage.path_for("117") + ".part").exists())
        self.assertFalse(storage.is_ready("117"))
        self.assertIsNone(self.row("117"))

    def test_empty_download_and_invalid_duration_do_not_publish_audio(self) -> None:
        for track_id, song, downloader, message in (
            ("105", self.song, lambda _song, path: Path(path).touch(), "empty audio for track 105"),
            ("106", {**self.song, "DURATION": "invalid"}, self.download, "invalid literal"),
        ):
            with (
                self.subTest(track_id=track_id),
                patch.object(storage.deezer, "get_song_infos_from_deezer_website", return_value=song),
                patch.object(storage.deezer, "download_song", side_effect=downloader),
                self.assertRaisesRegex((ValueError, RuntimeError), message),
            ):
                storage.materialize(track_id)
            self.assertFalse(storage.is_ready(track_id))
            self.assertFalse(Path(storage.path_for(track_id) + ".part").exists())

    def test_failed_db_bookkeeping_is_reported_and_retry_backfills_from_sidecar(self) -> None:
        with (
            patch.object(storage.deezer, "get_song_infos_from_deezer_website", return_value=self.song),
            patch.object(storage.deezer, "download_song", side_effect=self.download) as download,
        ):
            with (
                patch.object(Session, "commit", side_effect=RuntimeError("database offline")),
                self.assertRaisesRegex(RuntimeError, "record stored track 107: database offline"),
            ):
                storage.materialize("107")
            self.assertIsNone(self.row("107"))
            self.assertEqual(storage.materialize("107"), storage.path_for("107"))
        download.assert_called_once()
        self.assertEqual(self.row("107").title, "Stored song")

    def test_touch_failure_is_reported_without_refreshing_retention(self) -> None:
        self.store_old_track("108")
        original_access = self.row("108").last_accessed
        with (
            patch.object(Session, "commit", side_effect=RuntimeError("database offline")),
            self.assertRaisesRegex(RuntimeError, "reset retention for stored track 108: database offline"),
        ):
            storage.touch("108")
        self.assertEqual(self.row("108").last_accessed, original_access)

    def test_touch_missing_audio_fails_with_track_context(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "track 109.*audio for track 109 is missing"):
            storage.touch("109")

    def test_cleanup_deletes_stale_tracks_and_keeps_recent_plays(self) -> None:
        expected_bytes = self.store_old_track("110")
        self.store_old_track("111", days=1)
        self.assertEqual(storage.cleanup_old(30), {"removed": 1, "freed_bytes": expected_bytes})
        self.assertFalse(storage.is_ready("110"))
        self.assertIsNone(self.row("110"))
        self.assertTrue(storage.is_ready("111"))
        self.assertIsNotNone(self.row("111"))

    def test_cleanup_rechecks_retention_after_candidate_scan(self) -> None:
        self.store_old_track("112")
        original_lock_for = storage._lock_for

        def play_before_lock(track_id: str) -> threading.Lock:
            with original_lock_for(track_id):
                storage._touch_record(track_id)
            return original_lock_for(track_id)

        with patch.object(storage, "_lock_for", side_effect=play_before_lock):
            self.assertEqual(storage.cleanup_old(30), {"removed": 0, "freed_bytes": 0})
        self.assertTrue(storage.is_ready("112"))
        self.assertIsNotNone(self.row("112"))

    def test_cleanup_reports_deletion_failures_and_keeps_failed_db_row(self) -> None:
        self.store_old_track("113")
        self.store_old_track("114")
        real_remove = os.remove

        def remove(path: str) -> None:
            if path == storage.path_for("113"):
                raise PermissionError("audio deletion denied")
            real_remove(path)

        with (
            patch.object(storage.os, "remove", side_effect=remove),
            self.assertRaisesRegex(ExceptionGroup, "Track 113.*audio deletion denied"),
        ):
            storage.cleanup_old(30)
        self.assertTrue(storage.is_ready("113"))
        self.assertIsNotNone(self.row("113"))
        self.assertFalse(storage.is_ready("114"))
        self.assertIsNone(self.row("114"))

    def test_cleanup_daemon_stops_on_failure_instead_of_continuing(self) -> None:
        from app.main import _cleanup_loop

        with (
            patch("time.sleep") as sleep,
            patch.object(storage, "cleanup_old", side_effect=RuntimeError("cleanup denied")) as cleanup,
            self.assertRaisesRegex(RuntimeError, "cleanup denied"),
        ):
            _cleanup_loop()
        sleep.assert_called_once_with(6 * 3600)
        cleanup.assert_called_once_with()

    def test_retention_zero_keeps_forever_and_negative_retention_is_rejected(self) -> None:
        self.store_old_track("115")
        self.assertEqual(storage.cleanup_old(0), {"removed": 0, "freed_bytes": 0})
        self.assertTrue(storage.is_ready("115"))
        with self.assertRaisesRegex(ValueError, "retention days must be zero or positive"):
            storage.cleanup_old(-1)

    def test_malformed_metadata_reports_track_and_invalid_shape(self) -> None:
        sidecar = Path(storage.meta_path_for("116"))
        sidecar.write_text("not JSON", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Invalid metadata JSON for stored track 116"):
            storage.get_meta("116")
        sidecar.write_text("[]", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "track 116 must be a JSON object"):
            storage.get_meta("116")


if __name__ == "__main__":
    unittest.main()
