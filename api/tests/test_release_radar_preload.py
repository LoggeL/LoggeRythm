"""New Release Radar tracks are pre-cached on the server in the background.

The preloader must only download what is new and uncached, stay bounded
(cap, one run per track), go through the normal storage path, report failures
loudly and never hold up or break the radar response.
"""
from __future__ import annotations

import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main
from app.db.models import Like, PlaylistTrack, StoredTrack, TrackRequest
from app.routers import home
from app.services import radar_preload, storage
from app.services.radar_preload import RadarPreloader

_LOGGER = "app.services.radar_preload"
_RETENTION_DAYS = 30


def _radar_track(track_id: str, *, age_days: int = 0) -> dict:
    return {
        "id": track_id,
        "title": f"Song {track_id}",
        "release_date": (date.today() - timedelta(days=age_days)).isoformat(),
    }


class PreloadCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.enterContext(
            patch.object(radar_preload, "STORAGE_RETENTION_DAYS", _RETENTION_DAYS)
        )
        self.today = date(2026, 11, 18)

    def track(self, track_id: str, release_date: str) -> dict:
        return {"id": track_id, "release_date": release_date}

    def test_only_releases_inside_the_window_qualify_newest_first(self) -> None:
        radar = [
            self.track("today", "2026-11-18"),
            self.track("edge", "2026-11-04"),  # exactly 14 days old
            self.track("too-old", "2026-11-03"),
            self.track("future", "2026-11-19"),
            self.track("undated", ""),
            {"id": "no-date-field"},
            self.track("", "2026-11-18"),
            self.track("mid", "2026-11-10"),
            self.track("today", "2026-11-18"),  # duplicate id
        ]

        self.assertEqual(
            radar_preload.preload_candidates(radar, self.today),
            ["today", "mid", "edge"],
        )

    def test_only_the_newest_tracks_up_to_the_cap_qualify(self) -> None:
        # Deliberately oldest first: the cap must keep the newest releases.
        radar = [
            self.track(f"day-{day:02d}-{nth}", f"2026-11-{day:02d}")
            for day in range(5, 19)
            for nth in range(2)
        ]
        self.assertGreater(len(radar), radar_preload.RADAR_PRELOAD_MAX_TRACKS)

        candidates = radar_preload.preload_candidates(radar, self.today)

        self.assertEqual(len(candidates), radar_preload.RADAR_PRELOAD_MAX_TRACKS)
        self.assertEqual(candidates[:2], ["day-18-0", "day-18-1"])
        self.assertEqual(candidates[-2:], ["day-09-0", "day-09-1"])

    def test_preload_window_stays_below_the_storage_retention(self) -> None:
        for retention, expected in ((30, 14), (15, 14), (14, 13), (7, 6), (1, 0), (0, 14)):
            with (
                self.subTest(retention=retention),
                patch.object(radar_preload, "STORAGE_RETENTION_DAYS", retention),
            ):
                self.assertEqual(radar_preload.max_age_days(), expected)


class StorageBackedTestCase(unittest.TestCase):
    """Real storage service on a temp dir/DB; only Deezer itself is faked."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.engine = create_engine(
            f"sqlite:///{self.directory.name}/storage-test.db",
            connect_args={"check_same_thread": False},
        )
        self.addCleanup(self.engine.dispose)
        StoredTrack.__table__.create(self.engine)
        Like.__table__.create(self.engine)
        PlaylistTrack.__table__.create(self.engine)
        TrackRequest.__table__.create(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.enterContext(patch.object(storage, "SessionLocal", self.sessions))
        self.enterContext(
            patch.dict(os.environ, {"STORAGE_DIR": f"{self.directory.name}/audio"})
        )
        self.enterContext(
            patch.object(radar_preload, "STORAGE_RETENTION_DAYS", _RETENTION_DAYS)
        )
        self.song = {
            "SNG_TITLE": "Radar song",
            "ART_NAME": "Radar artist",
            "ALB_TITLE": "Radar album",
            "DURATION": "180",
        }
        self.enterContext(
            patch.object(
                storage.deezer,
                "get_song_infos_from_deezer_website",
                side_effect=lambda _kind, track_id: {**self.song, "SNG_ID": track_id},
            )
        )
        self.download = self.enterContext(
            patch.object(storage.deezer, "download_song", side_effect=self.write_audio)
        )
        # The success notice goes to stdout like the other storage notices.
        self.notice = self.enterContext(
            patch.object(radar_preload, "print", create=True)
        )
        self.clock_now = 0.0
        self.preloader = RadarPreloader(clock=lambda: self.clock_now)
        self.preloader.start()
        self.addCleanup(self.stop_preloader)

    def stop_preloader(self) -> None:
        executor = self.preloader._executor
        if executor is None:
            return
        self.preloader.stop()
        # Let the track in flight finish before the temp dir disappears.
        executor.shutdown(wait=True)

    def write_audio(self, _song: dict, path: str) -> None:
        Path(path).write_bytes(b"downloaded audio")

    def downloaded_ids(self) -> list[str]:
        return [call.args[0]["SNG_ID"] for call in self.download.call_args_list]

    def row(self, track_id: str) -> StoredTrack | None:
        with self.sessions() as db:
            return db.get(StoredTrack, track_id)

    def age_stored_track(self, track_id: str, days: int) -> None:
        with self.sessions() as db:
            row = db.get(StoredTrack, track_id)
            row.last_accessed = storage._now() - timedelta(days=days)
            db.commit()

    def gated_download(self) -> tuple[threading.Event, threading.Event]:
        """Make downloads block until released; returns (entered, release)."""
        entered = threading.Event()
        release = threading.Event()

        def download(_song: dict, path: str) -> None:
            entered.set()
            if not release.wait(timeout=5):
                raise AssertionError("gated download was never released")
            Path(path).write_bytes(b"downloaded audio")

        self.download.side_effect = download
        return entered, release


class RadarPreloaderTests(StorageBackedTestCase):
    def test_only_new_uncached_tracks_are_downloaded_through_storage(self) -> None:
        storage.materialize("201")
        self.age_stored_track("201", days=10)
        cached_access = self.row("201").last_accessed
        self.download.reset_mock()
        radar = [
            _radar_track("201"),  # cached already
            _radar_track("202"),
            _radar_track("203", age_days=60),  # in the radar, but not new
        ]

        run = self.preloader.schedule(radar).result(timeout=5)

        self.assertEqual(run.track_ids, ("202",))
        self.assertEqual(run.downloaded, ("202",))
        self.assertEqual(run.failures, ())
        self.assertEqual(self.downloaded_ids(), ["202"])
        # Same files and DB row a play would have produced.
        self.assertEqual(Path(storage.path_for("202")).read_bytes(), b"downloaded audio")
        self.assertEqual(storage.get_meta("202")["title"], "Radar song")
        stored = self.row("202")
        self.assertEqual(stored.status, "ready")
        self.assertEqual(stored.size_bytes, len(b"downloaded audio"))
        self.assertIn("202", storage.cached_ids())
        # A cached radar track is not "played" by the radar: retention unchanged.
        self.assertEqual(self.row("201").last_accessed, cached_access)
        self.assertFalse(storage.is_ready("203"))

    def test_fully_cached_radar_schedules_nothing(self) -> None:
        storage.materialize("211")
        storage.materialize("212")
        self.download.reset_mock()

        self.assertIsNone(
            self.preloader.schedule([_radar_track("211"), _radar_track("212")])
        )
        self.assertIsNone(self.preloader.schedule([]))
        self.download.assert_not_called()

    def test_one_radar_never_downloads_more_than_the_cap(self) -> None:
        cap = radar_preload.RADAR_PRELOAD_MAX_TRACKS
        # Radar order: newest first. Five tracks more than the cap.
        radar = [_radar_track(str(300 + index), age_days=index // 4) for index in range(cap + 5)]

        run = self.preloader.schedule(radar).result(timeout=5)

        expected = [str(300 + index) for index in range(cap)]
        self.assertEqual(list(run.downloaded), expected)
        self.assertEqual(self.downloaded_ids(), expected)
        # The same radar again: its newest tracks are cached, the rest stay out.
        self.assertIsNone(self.preloader.schedule(radar))

    def test_repeated_and_concurrent_radars_download_each_track_once(self) -> None:
        entered, release = self.gated_download()
        radar = [_radar_track("401"), _radar_track("402")]

        first = self.preloader.schedule(radar)
        self.assertTrue(entered.wait(timeout=5))
        # 401 is downloading, 402 is queued behind it.
        self.assertIsNone(self.preloader.schedule(radar))
        with ThreadPoolExecutor(max_workers=8) as clients:
            repeats = list(clients.map(lambda _: self.preloader.schedule(radar), range(8)))
        self.assertEqual(repeats, [None] * 8)
        # Another user's radar overlaps: only its additional track is queued.
        second = self.preloader.schedule([_radar_track("402"), _radar_track("403")])
        release.set()

        self.assertEqual(first.result(timeout=5).downloaded, ("401", "402"))
        self.assertEqual(second.result(timeout=5).track_ids, ("403",))
        self.assertEqual(self.downloaded_ids(), ["401", "402", "403"])
        self.assertIsNone(self.preloader.schedule(radar))

    def test_simultaneous_first_requests_queue_a_track_once(self) -> None:
        _entered, release = self.gated_download()
        radar = [_radar_track("411"), _radar_track("412")]
        start = threading.Barrier(8)

        def request(_: int):
            start.wait(timeout=5)
            return self.preloader.schedule(radar)

        with ThreadPoolExecutor(max_workers=8) as clients:
            runs = [run for run in clients.map(request, range(8)) if run is not None]
        release.set()

        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0].result(timeout=5).downloaded, ("411", "412"))
        self.assertEqual(self.downloaded_ids(), ["411", "412"])

    def test_a_play_during_the_preload_shares_the_single_download(self) -> None:
        entered, release = self.gated_download()
        run = self.preloader.schedule([_radar_track("421")])
        self.assertTrue(entered.wait(timeout=5))

        with ThreadPoolExecutor(max_workers=1) as player:
            play = player.submit(storage.materialize, "421")
            release.set()
            self.assertEqual(play.result(timeout=5), storage.path_for("421"))

        self.assertEqual(run.result(timeout=5).downloaded, ("421",))
        self.assertEqual(self.downloaded_ids(), ["421"])

    def test_track_played_while_queued_is_not_downloaded_or_touched_again(self) -> None:
        entered, release = self.gated_download()
        run = self.preloader.schedule([_radar_track("431"), _radar_track("432")])
        self.assertTrue(entered.wait(timeout=5))
        # 432 is queued; the user plays it before the preloader gets to it.
        Path(storage.path_for("432")).write_bytes(b"played audio")
        release.set()

        result = run.result(timeout=5)

        self.assertEqual(result.downloaded, ("431",))
        self.assertEqual(result.already_cached, ("432",))
        self.assertEqual(self.downloaded_ids(), ["431"])

    def test_failed_preload_is_logged_summarized_and_paused(self) -> None:
        def download(song: dict, path: str) -> None:
            if song["SNG_ID"] == "502":
                Path(path).write_bytes(b"partial")
                raise storage.deezer.DeezerApiException(
                    "Track 502 could not be downloaded after 3 attempt(s)"
                )
            self.write_audio(song, path)

        self.download.side_effect = download
        radar = [_radar_track("501"), _radar_track("502"), _radar_track("503")]

        with self.assertLogs(_LOGGER, level="ERROR") as logs:
            run = self.preloader.schedule(radar).result(timeout=5)

        # One failure does not stop the rest of the run.
        self.assertEqual(run.downloaded, ("501", "503"))
        self.assertEqual([failure.track_id for failure in run.failures], ["502"])
        cause = "DeezerApiException: Track 502 could not be downloaded after 3 attempt(s)"
        self.assertEqual(run.failures[0].cause, cause)
        per_track, summary = logs.records
        self.assertEqual(per_track.levelname, "ERROR")
        self.assertIn(f"FAILED for track 502: {cause}", per_track.getMessage())
        self.assertIsNotNone(per_track.exc_info)
        self.assertEqual(summary.levelname, "ERROR")
        self.assertIn("1 of 3 track(s) FAILED", summary.getMessage())
        self.assertIn("2 downloaded", summary.getMessage())
        self.assertIn(f"track 502: {cause}", summary.getMessage())
        # Nothing half-written is left behind or served.
        self.assertFalse(storage.is_ready("502"))
        self.assertFalse(Path(storage.path_for("502") + ".part").exists())
        self.assertIsNone(self.row("502"))
        self.assertEqual(
            [(failure.track_id, failure.cause) for failure in self.preloader.failures()],
            [("502", cause)],
        )

        # The failed track is not hammered on every radar load ...
        self.assertIsNone(self.preloader.schedule(radar))
        self.assertEqual(self.downloaded_ids(), ["501", "502", "503"])

        # ... but is tried again once the pause is over.
        self.clock_now += radar_preload.RADAR_PRELOAD_RETRY_AFTER_SEC
        self.assertEqual(self.preloader.failures(), [])
        self.download.side_effect = self.write_audio
        retry = self.preloader.schedule(radar).result(timeout=5)
        self.assertEqual(retry.downloaded, ("502",))
        self.assertTrue(storage.is_ready("502"))

    def test_successful_run_logs_no_error(self) -> None:
        with self.assertNoLogs(_LOGGER, level="WARNING"):
            run = self.preloader.schedule([_radar_track("511")]).result(timeout=5)
        self.assertEqual(run.downloaded, ("511",))
        self.notice.assert_called_once_with(
            "Release Radar preload: 1 downloaded, 0 already cached, "
            "0 not attempted (server stopping).",
            flush=True,
        )

    def test_unplayed_preload_is_evicted_by_normal_retention_and_not_refetched(self) -> None:
        self.preloader.schedule([_radar_track("601")]).result(timeout=5)
        self.assertEqual(storage.cleanup_old(_RETENTION_DAYS)["removed"], 0)

        # The retention window passes without a play, like or playlist add.
        self.age_stored_track("601", days=_RETENTION_DAYS + 1)
        self.assertEqual(storage.cleanup_old(_RETENTION_DAYS)["removed"], 1)
        self.assertFalse(storage.is_ready("601"))

        # By then the release is no longer "new": the radar does not bring the
        # evicted file back, at any release age an eviction can happen at.
        self.download.reset_mock()
        for age_days in (_RETENTION_DAYS, _RETENTION_DAYS + 1, 89):
            with self.subTest(age_days=age_days):
                self.assertIsNone(
                    self.preloader.schedule([_radar_track("601", age_days=age_days)])
                )
        self.download.assert_not_called()

    def test_stop_drops_queued_work_and_refuses_new_radars(self) -> None:
        entered, release = self.gated_download()
        executor = self.preloader._executor
        first = self.preloader.schedule([_radar_track("701"), _radar_track("702")])
        self.assertTrue(entered.wait(timeout=5))
        queued = self.preloader.schedule([_radar_track("703")])

        self.preloader.stop()
        release.set()
        executor.shutdown(wait=True)

        result = first.result(timeout=5)
        # The download in flight finishes its track; nothing new is started.
        self.assertEqual(result.downloaded, ("701",))
        self.assertEqual(result.not_attempted, ("702",))
        self.assertTrue(queued.cancelled())
        self.assertEqual(self.downloaded_ids(), ["701"])
        with self.assertRaisesRegex(RuntimeError, "preloader is not running"):
            self.preloader.schedule([_radar_track("704")])

    def test_preloader_cannot_be_started_twice_or_used_before_start(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "already running"):
            self.preloader.start()
        fresh = RadarPreloader()
        with self.assertRaisesRegex(RuntimeError, "preloader is not running"):
            fresh.schedule([])
        with self.assertRaisesRegex(RuntimeError, "preloader is not running"):
            fresh.stop()


class ReleaseRadarEndpointPreloadTests(StorageBackedTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.enterContext(patch.object(radar_preload, "_preloader", self.preloader))
        self.runs: list = []
        schedule = self.preloader.schedule

        def recording_schedule(radar: list[dict], **kwargs):
            run = schedule(radar, **kwargs)
            self.runs.append(run)
            return run

        self.enterContext(
            patch.object(self.preloader, "schedule", side_effect=recording_schedule)
        )
        produced = {
            "10": [
                {**_radar_track("801"), "artist": "A", "artist_id": "10"},
                {**_radar_track("802", age_days=40), "artist": "A", "artist_id": "10"},
            ],
            "20": [{**_radar_track("803", age_days=1), "artist": "B", "artist_id": "20"}],
        }
        self.enterContext(
            patch.object(
                home,
                "_radar_artists",
                return_value=[
                    home.RadarArtist("10", "A", 3, False),
                    home.RadarArtist("20", "B", 0, True),
                ],
            )
        )
        self.enterContext(
            patch.object(
                home,
                "_artist_new_tracks",
                side_effect=lambda artist_id, _cutoff, *, refresh: [
                    dict(track) for track in produced[artist_id]
                ],
            )
        )

    def radar(self) -> list[dict]:
        return home.release_radar(
            user=SimpleNamespace(id=1),  # type: ignore[arg-type]
            db=object(),  # type: ignore[arg-type]
        )

    def test_radar_answers_before_its_new_tracks_are_downloaded(self) -> None:
        entered, release = self.gated_download()

        tracks = self.radar()

        # The response is complete while the first download is still blocked.
        self.assertEqual([track["id"] for track in tracks], ["801", "803", "802"])
        self.assertTrue(entered.wait(timeout=5))
        self.assertFalse(self.runs[0].done())
        self.assertEqual(storage.cached_ids(), [])
        # A second client asks meanwhile: same answer, no second run.
        self.assertEqual([track["id"] for track in self.radar()], ["801", "803", "802"])
        self.assertIsNone(self.runs[1])
        release.set()

        run = self.runs[0].result(timeout=5)
        # Only the new releases; the 40-day-old radar track stays uncached.
        self.assertEqual(run.downloaded, ("801", "803"))
        self.assertEqual(sorted(storage.cached_ids()), ["801", "803"])
        self.assertEqual(self.downloaded_ids(), ["801", "803"])

    def test_failed_preload_never_reaches_the_radar_response(self) -> None:
        self.download.side_effect = OSError("No space left on device")

        with self.assertLogs(_LOGGER, level="ERROR") as logs:
            tracks = self.radar()
            run = self.runs[0].result(timeout=5)

        self.assertEqual([track["id"] for track in tracks], ["801", "803", "802"])
        self.assertEqual([failure.track_id for failure in run.failures], ["801", "803"])
        messages = [record.getMessage() for record in logs.records]
        self.assertIn("FAILED for track 801: OSError: No space left on device", messages[0])
        self.assertIn("FAILED for track 803: OSError: No space left on device", messages[1])
        self.assertIn("2 of 2 track(s) FAILED", messages[2])
        # The radar keeps working while the failed tracks are paused.
        self.assertEqual([track["id"] for track in self.radar()], ["801", "803", "802"])
        self.assertIsNone(self.runs[1])
        self.assertEqual(self.download.call_count, 2)


class ApiLifecycleTests(unittest.TestCase):
    def test_api_startup_starts_the_preloader_and_shutdown_stops_it(self) -> None:
        preloader = RadarPreloader()
        with (
            patch.object(radar_preload, "_preloader", preloader),
            patch.object(main, "validate_runtime_config"),
            patch.object(main, "init_db"),
            patch.object(main, "_run_column_migrations"),
            patch.object(main, "_bootstrap_admin"),
            patch.object(main.import_jobs, "fail_interrupted"),
            patch.object(main.deezer_client, "init_session"),
            patch.object(main.storage, "reconcile"),
            patch.object(main.storage, "cleanup_old"),
            patch("threading.Thread") as cleanup_daemon,
            patch.object(main, "print", create=True),
        ):
            main._startup()
            cleanup_daemon.assert_called_once()
            # Running: an empty radar is accepted (nothing to queue).
            self.assertIsNone(radar_preload.schedule([]))

            main._shutdown()
            with self.assertRaisesRegex(RuntimeError, "preloader is not running"):
                radar_preload.schedule([])


if __name__ == "__main__":
    unittest.main()
