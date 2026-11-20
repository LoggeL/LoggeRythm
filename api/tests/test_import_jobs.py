import json
import threading
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import ImportJob, User
from app.db.session import Base
from app.routers import resolve as resolve_router
from app.services import import_jobs, spotify, spotify_import

LINK = "https://open.spotify.com/playlist/abc123"


def deezer_track(track_id: str) -> dict:
    return {
        "id": track_id,
        "title": f"Title {track_id}",
        "artist": "Artist",
        "album": "Album",
        "cover": "",
        "duration": 180,
    }


class ImportJobTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        self.submitted: list[str] = []
        patches = [
            patch.object(import_jobs, "SessionLocal", self.Session),
            # Run jobs only when a test says so, on the test thread.
            patch.object(import_jobs._executor, "submit", lambda fn, job_id: self.submitted.append(job_id)),
            patch.object(spotify, "is_configured", lambda: True),
            patch.object(import_jobs, "PROGRESS_INTERVAL", 0),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.db = self.Session()
        self.user = self.add_user("owner@example.test")
        self.other = self.add_user("other@example.test")

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def add_user(self, email: str) -> User:
        user = User(email=email, password_hash="unused", is_approved=True)
        self.db.add(user)
        self.db.commit()
        return user

    def spotify_meta(self, count: int, total: int | None = None) -> dict:
        return {
            "type": "playlist",
            "name": "Big Playlist",
            "image": "https://img.test/cover.jpg",
            "total": total if total is not None else count,
            "tracks": [
                {"title": f"Song {i}", "artist": "Artist", "isrc": f"ISRC{i}"}
                for i in range(count)
            ],
        }

    def job(self, job_id: str) -> ImportJob | None:
        with self.Session() as db:
            return db.get(ImportJob, job_id)

    def test_job_runs_in_background_and_stores_result_in_source_order(self) -> None:
        progress: list[tuple[int, int]] = []
        job = import_jobs.start(self.db, self.user, f"  {LINK}  ")
        self.assertEqual(job.status, "queued")
        self.assertEqual(job.url, LINK)
        self.assertEqual(self.submitted, [job.id])

        def match(title, artist, isrc):
            index = int(title.split()[-1])
            return None if index == 2 else deezer_track(f"dz{index}")

        original_write = import_jobs._write

        def spy_write(job_id, **values):
            original_write(job_id, **values)
            if "processed" in values and "status" not in values:
                progress.append((values["processed"], values["matched"]))

        with (
            patch.object(spotify, "resolve", lambda url, limit: self.spotify_meta(4, total=9)),
            patch.object(spotify_import.dc, "match_track", match),
            patch.object(import_jobs, "_write", spy_write),
        ):
            import_jobs._run(job.id)

        stored = self.job(job.id)
        assert stored is not None
        self.assertEqual(stored.status, "done")
        self.assertEqual((stored.total, stored.source_total), (4, 9))
        self.assertEqual((stored.processed, stored.matched), (4, 3))
        self.assertEqual(stored.name, "Big Playlist")
        self.assertIsNotNone(stored.finished_at)
        self.assertEqual(progress[-1], (4, 3))
        result = json.loads(stored.result_json or "")
        self.assertEqual([t["id"] for t in result["tracks"]], ["dz0", "dz1", "dz3"])
        self.assertEqual(result["unmatched"], [{"title": "Song 2", "artist": "Artist"}])

        self.db.expire_all()  # a request would open a fresh session
        detail = resolve_router.get_import_job(job.id, user=self.user, db=self.db)
        self.assertEqual(detail.status, "done")
        assert detail.result is not None
        self.assertEqual(detail.result.matched, 3)
        self.assertEqual(detail.created_at.utcoffset().total_seconds(), 0)

    def test_failed_lookups_are_counted_and_named_instead_of_hidden(self) -> None:
        job = import_jobs.start(self.db, self.user, LINK)

        def match(title, artist, isrc):
            if title == "Song 1":
                raise RuntimeError("Deezer 500")
            return deezer_track(title)

        with (
            patch.object(spotify, "resolve", lambda url, limit: self.spotify_meta(3)),
            patch.object(spotify_import.dc, "match_track", match),
        ):
            import_jobs._run(job.id)

        stored = self.job(job.id)
        assert stored is not None
        self.assertEqual(stored.status, "done")
        self.assertEqual(stored.failed_lookups, 1)
        self.assertIn("Song 1", stored.lookup_error or "")
        self.assertIn("RuntimeError: Deezer 500", stored.lookup_error or "")

    def test_spotify_error_fails_the_job_with_its_cause(self) -> None:
        job = import_jobs.start(self.db, self.user, LINK)

        def missing(url, limit):
            raise spotify.SpotifyNotFound("Spotify-Ressource nicht gefunden.")

        with patch.object(spotify, "resolve", missing):
            import_jobs._run(job.id)

        stored = self.job(job.id)
        assert stored is not None
        self.assertEqual(stored.status, "failed")
        self.assertEqual(stored.error, "Spotify-Ressource nicht gefunden.")
        self.assertIsNone(stored.result_json)

    def test_unexpected_error_fails_the_job_with_type_and_message(self) -> None:
        job = import_jobs.start(self.db, self.user, LINK)

        def broken(url, limit):
            raise KeyError("tracks")

        with patch.object(spotify, "resolve", broken):
            import_jobs._run(job.id)

        stored = self.job(job.id)
        assert stored is not None
        self.assertEqual(stored.status, "failed")
        self.assertIn("KeyError", stored.error or "")

    def test_deleting_a_running_job_stops_matching_and_removes_it(self) -> None:
        job = import_jobs.start(self.db, self.user, LINK)
        first_lookup = threading.Event()
        release = threading.Event()
        calls: list[str] = []

        def slow_match(title, artist, isrc):
            calls.append(title)
            first_lookup.set()
            release.wait(5)
            return deezer_track(title)

        with (
            patch.object(spotify, "resolve", lambda url, limit: self.spotify_meta(200)),
            patch.object(spotify_import.dc, "match_track", slow_match),
        ):
            worker = threading.Thread(target=import_jobs._run, args=(job.id,))
            worker.start()
            self.assertTrue(first_lookup.wait(5))
            resolve_router.delete_import_job(job.id, user=self.user, db=self.db)
            release.set()
            worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertIsNone(self.job(job.id))
        self.assertLess(len(calls), 200)
        self.assertNotIn(job.id, import_jobs._cancelled)

    def test_restart_marks_unfinished_jobs_failed(self) -> None:
        running = import_jobs.start(self.db, self.user, LINK)
        queued = import_jobs.start(self.db, self.user, LINK)
        import_jobs._write(running.id, status="running")
        with self.Session() as db:
            done = ImportJob(id="done1", user_id=self.user.id, url=LINK, status="done", result_json="{}")
            db.add(done)
            db.commit()

        self.assertEqual(import_jobs.fail_interrupted(), 2)
        for job_id in (running.id, queued.id):
            stored = self.job(job_id)
            assert stored is not None
            self.assertEqual(stored.status, "failed")
            self.assertEqual(stored.error, import_jobs.INTERRUPTED_ERROR)
        self.assertEqual(self.job("done1").status, "done")

    def test_active_job_limit_and_link_validation_are_enforced_up_front(self) -> None:
        with self.assertRaises(spotify.SpotifyBadLink):
            import_jobs.start(self.db, self.user, "https://example.com/not-spotify")
        for _ in range(import_jobs.MAX_ACTIVE_JOBS_PER_USER):
            import_jobs.start(self.db, self.user, LINK)
        with self.assertRaises(HTTPException) as ctx:
            resolve_router.start_import_job(
                resolve_router.ImportJobCreate(url=LINK), user=self.user, db=self.db
            )
        self.assertEqual(ctx.exception.status_code, 429)
        # Another account is not affected by this user's jobs.
        import_jobs.start(self.db, self.other, LINK)

    def test_unconfigured_spotify_is_rejected_before_a_job_exists(self) -> None:
        with patch.object(spotify, "is_configured", lambda: False):
            with self.assertRaises(HTTPException) as ctx:
                resolve_router.start_import_job(
                    resolve_router.ImportJobCreate(url=LINK), user=self.user, db=self.db
                )
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(self.db.scalars(select(ImportJob)).all(), [])

    def test_jobs_are_private_to_their_owner(self) -> None:
        job = import_jobs.start(self.db, self.user, LINK)
        self.assertEqual(
            [j.id for j in resolve_router.list_import_jobs(user=self.other, db=self.db)], []
        )
        for call in (resolve_router.get_import_job, resolve_router.delete_import_job):
            with self.assertRaises(HTTPException) as ctx:
                call(job.id, user=self.other, db=self.db)
            self.assertEqual(ctx.exception.status_code, 404)
        self.assertIsNotNone(self.job(job.id))

    def test_old_finished_jobs_are_pruned_when_a_new_one_starts(self) -> None:
        with self.Session() as db:
            for i in range(import_jobs.KEEP_FINISHED_JOBS_PER_USER + 5):
                db.add(ImportJob(id=f"old{i:02d}", user_id=self.user.id, url=LINK, status="failed"))
            db.commit()
        import_jobs.start(self.db, self.user, LINK)
        with self.Session() as db:
            finished = db.scalars(
                select(ImportJob).where(ImportJob.user_id == self.user.id, ImportJob.status == "failed")
            ).all()
        self.assertEqual(len(finished), import_jobs.KEEP_FINISHED_JOBS_PER_USER)


if __name__ == "__main__":
    unittest.main()
