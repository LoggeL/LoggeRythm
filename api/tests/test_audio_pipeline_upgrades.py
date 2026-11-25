"""Tests for audio pipeline upgrades: cold-play speed, quality tiers, ETag/preload, and ffmpeg audio analysis."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import create_token
from app.db.models import Like, Playlist, PlaylistTrack, StoredTrack, User
from app.db.session import Base, get_db
from app.main import app
from app.services import audio_analysis, deezer, playlist_export, storage


def _generate_test_mp3(path: Path) -> None:
    """Create a real 1.5s MP3 with 0.3s leading silence, 0.9s 440Hz tone, 0.3s trailing silence."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise unittest.SkipTest("ffmpeg not installed on test host")
    cmd = [
        ffmpeg,
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono:d=0.3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100:duration=0.9",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono:d=0.3",
        "-filter_complex",
        "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
        "-map",
        "[out]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg test fixture failed: {proc.stderr.decode()}")


class AudioPipelineUpgradeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.engine = create_engine(
            f"sqlite:///{self.tmp_path / 'audio.db'}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.SessionFactory = sessionmaker(
            bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False
        )
        with self.SessionFactory() as db:
            self.user = User(
                email="listener@example.test",
                password_hash="x",
                display_name="Listener",
                is_approved=True,
            )
            db.add(self.user)
            db.commit()
            db.refresh(self.user)

        def override_db():
            s = self.SessionFactory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        self.patches = (
            patch.object(storage, "_storage_dir", return_value=str(self.tmp_path / "tracks")),
            patch.object(storage, "SessionLocal", self.SessionFactory),
            patch.object(audio_analysis, "SessionLocal", self.SessionFactory),
        )
        os.makedirs(self.tmp_path / "tracks", exist_ok=True)
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(app)
        self.headers = {"Cookie": f"sf_session={create_token(self.user.id)}"}

    def tearDown(self) -> None:
        self.client.close()
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()
        self.tmp.cleanup()

    def test_download_song_skips_cover_fetch_by_default_and_skips_id3_for_flac(self) -> None:
        song = {
            "SNG_ID": "12345",
            "TRACK_TOKEN": "tok-12345",
            "SNG_TITLE": "Test Track",
            "ART_NAME": "Test Artist",
            "ALB_TITLE": "Test Album",
            "ALB_PICTURE": "abcdef",
            "DURATION": "180",
            "TRACK_NUMBER": "1",
            "DISK_NUMBER": "1",
            "FILESIZE_MP3_320": "5000",
            "FILESIZE_FLAC": "5000",
            "MD5_ORIGIN": "0" * 32,
            "MEDIA_VERSION": "1",
        }

        class _DummyHttpStream:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def raise_for_status(self) -> None:
                return None

        class _DummySession:
            def get(self, *_args, **_kwargs):
                return _DummyHttpStream()

        mp3_out = self.tmp_path / "out.mp3"
        mp3_body = b"\xff\xfb" + b"\x00" * 5000

        def fake_decrypt_mp3(_resp, _key, fo) -> int:
            fo.write(mp3_body)
            return len(mp3_body)

        with (
            patch.object(deezer, "sound_format", "MP3_320"),
            patch.object(deezer, "get_song_url", return_value="https://cdn.example/a"),
            patch.object(deezer, "session", _DummySession()),
            patch.object(deezer, "decryptfile", side_effect=fake_decrypt_mp3),
            patch.object(deezer, "downloadpicture") as mock_cover,
        ):
            fmt = deezer.download_song(song, str(mp3_out))
        self.assertEqual(fmt, "MP3_320")
        mock_cover.assert_not_called()
        raw_mp3 = mp3_out.read_bytes()
        self.assertTrue(raw_mp3.startswith(b"ID3"))
        self.assertNotIn(b"APIC", raw_mp3)

        # FLAC must NOT get ID3v2/v1.1 tags prepended or appended
        flac_out = self.tmp_path / "out.flac"
        flac_bytes = b"fLaC" + b"\x00\x00\x00\x22" + b"\x11" * 5000

        def fake_decrypt_flac(_resp, _key, fo) -> int:
            fo.write(flac_bytes)
            return len(flac_bytes)

        with (
            patch.object(deezer, "get_song_url", return_value="https://cdn.example/f"),
            patch.object(deezer, "session", _DummySession()),
            patch.object(deezer, "decryptfile", side_effect=fake_decrypt_flac),
            patch.object(deezer, "writeid3v2") as mock_v2,
            patch.object(deezer, "writeid3v1_1") as mock_v1,
        ):
            fmt_flac = deezer.download_song(song, str(flac_out), fmt_override="FLAC")
        self.assertEqual(fmt_flac, "FLAC")
        mock_v2.assert_not_called()
        mock_v1.assert_not_called()
        self.assertEqual(flac_out.read_bytes(), flac_bytes)
        self.assertEqual(storage.media_type_for_path(str(flac_out)), "audio/flac")
        self.assertEqual(storage.media_type_for_path(str(mp3_out)), "audio/mpeg")

    def test_playlist_export_embeds_cover_art_on_mp3_and_preserves_flac_extension(self) -> None:
        mp3_src = self.tmp_path / "tracks" / "111.mp3"
        mp3_src.write_bytes(b"\xff\xfb\x90\x00" + b"\x00" * 2048)
        flac_src = self.tmp_path / "tracks" / "222.mp3"
        flac_src.write_bytes(b"fLaC" + b"\x00" * 2048)

        def fake_materialize(tid: str, **_kw) -> str:
            return str(mp3_src if tid == "111" else flac_src)

        fake_jpeg = b"\xff\xd8\xff\xe0" + b"\xaa" * 64 + b"\xff\xd9"
        fake_resp = type(
            "R",
            (),
            {"status_code": 200, "content": fake_jpeg, "raise_for_status": lambda self: None},
        )()
        with (
            patch.object(playlist_export.storage, "materialize", side_effect=fake_materialize),
            patch.object(playlist_export.requests, "get", return_value=fake_resp),
        ):
            zip_path, filename = playlist_export.build_playlist_archive(
                "Export Mix",
                [
                    playlist_export.PlaylistExportTrack("111", "Artist A", "Song One", cover_url="https://img.example/1.jpg"),
                    playlist_export.PlaylistExportTrack("222", "Artist B", "Lossless Two", cover_url="https://img.example/2.jpg"),
                ],
            )
        self.addCleanup(os.remove, zip_path)
        self.assertTrue(filename.endswith(".zip"))
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            self.assertEqual(names, ["01 - Artist A - Song One.mp3", "02 - Artist B - Lossless Two.flac"])
            mp3_data = zf.read(names[0])
            self.assertTrue(mp3_data.startswith(b"ID3"))
            self.assertIn(b"APIC", mp3_data)
            self.assertIn(fake_jpeg, mp3_data)
            flac_data = zf.read(names[1])
            self.assertTrue(flac_data.startswith(b"fLaC"))

    def test_stream_quality_tiers_etag_304_range_and_settings_preference(self) -> None:
        # Update user's preferred_quality via PATCH /api/me/settings
        s_resp = self.client.patch(
            "/api/me/settings",
            json={"preferred_quality": "lossless"},
            headers=self.headers,
        )
        self.assertEqual(s_resp.status_code, 200)
        self.assertEqual(s_resp.json()["preferred_quality"], "lossless")

        # Invalid quality rejected loudly
        bad_q = self.client.patch(
            "/api/me/settings",
            json={"preferred_quality": "ultra-fake"},
            headers=self.headers,
        )
        self.assertEqual(bad_q.status_code, 422)

        flac_file = self.tmp_path / "tracks" / "555.flac"
        flac_payload = b"fLaC" + b"0123456789" * 200
        flac_file.write_bytes(flac_payload)

        mp3_saver = self.tmp_path / "tracks" / "555.saver.mp3"
        mp3_payload = b"\xff\xfb" + b"abcdefghij" * 100
        mp3_saver.write_bytes(mp3_payload)

        def fake_mat(did: str, **kw):
            q = kw.get("quality", "high")
            return str(flac_file if q == "lossless" else mp3_saver)

        with patch.object(storage, "materialize", side_effect=fake_mat):
            # Bare stream URL resolves user's preferred_quality="lossless" -> private, no-cache + ETag
            r1 = self.client.get("/api/tracks/555/stream", headers=self.headers)
            self.assertEqual(r1.status_code, 200)
            self.assertEqual(r1.headers["content-type"], "audio/flac")
            self.assertEqual(r1.headers["x-audio-quality"], "lossless")
            self.assertEqual(r1.headers["cache-control"], "private, no-cache")
            etag = r1.headers["etag"]
            self.assertTrue(etag.startswith('"'))
            self.assertEqual(r1.content, flac_payload)

            # Matching If-None-Match returns 304 Not Modified with empty body
            r_304 = self.client.get(
                "/api/tracks/555/stream",
                headers={**self.headers, "If-None-Match": etag},
            )
            self.assertEqual(r_304.status_code, 304)
            self.assertEqual(r_304.content, b"")

            # Changing preferred_quality invalidates the bare URL's ETag (returns 200 with new quality)
            self.client.patch(
                "/api/me/settings",
                json={"preferred_quality": "saver"},
                headers=self.headers,
            )
            r_switched = self.client.get(
                "/api/tracks/555/stream",
                headers={**self.headers, "If-None-Match": etag},
            )
            self.assertEqual(r_switched.status_code, 200)
            self.assertEqual(r_switched.headers["content-type"], "audio/mpeg")
            self.assertEqual(r_switched.headers["x-audio-quality"], "saver")
            self.assertNotEqual(r_switched.headers["etag"], etag)

            # Explicit ?quality=saver emits immutable Cache-Control + Range 206
            r_206 = self.client.get(
                "/api/tracks/555/stream?quality=saver",
                headers={**self.headers, "Range": "bytes=0-15"},
            )
            self.assertEqual(r_206.status_code, 206)
            self.assertEqual(r_206.headers["content-type"], "audio/mpeg")
            self.assertEqual(r_206.headers["x-audio-quality"], "saver")
            self.assertIn("immutable", r_206.headers["cache-control"])
            self.assertEqual(r_206.content, mp3_payload[:16])

    def test_reconcile_row_from_disk_and_quality_rank_preserve_higher_tier(self) -> None:
        tracks_dir = self.tmp_path / "tracks"
        flac_only = tracks_dir / "701.flac"
        flac_only.write_bytes(b"fLaC" + b"\x00" * 4096)
        saver_only = tracks_dir / "702.saver.mp3"
        saver_only.write_bytes(b"\xff\xfb" + b"\x00" * 2048)
        high_and_saver_high = tracks_dir / "703.mp3"
        high_and_saver_high.write_bytes(b"\xff\xfb" + b"\x11" * 4096)
        high_and_saver_low = tracks_dir / "703.saver.mp3"
        high_and_saver_low.write_bytes(b"\xff\xfb" + b"\x22" * 1024)

        created = storage.reconcile()
        self.assertEqual(created, 3)

        with self.SessionFactory() as db:
            ids = sorted(r.deezer_id for r in db.query(StoredTrack).all())
            # No bogus "{id}.saver" rows; flac-only track reconciled properly!
            self.assertEqual(ids, ["701", "702", "703"])
            self.assertEqual(db.get(StoredTrack, "701").audio_format, "flac")
            self.assertEqual(db.get(StoredTrack, "702").file_path, str(saver_only))
            self.assertEqual(db.get(StoredTrack, "703").file_path, str(high_and_saver_high))

        # _touch_record on a flac-only track without DB row must not raise FileNotFoundError
        with self.SessionFactory() as db:
            db.delete(db.get(StoredTrack, "701"))
            db.commit()
        storage.touch("701")
        with self.SessionFactory() as db:
            rebuilt = db.get(StoredTrack, "701")
            self.assertIsNotNone(rebuilt)
            self.assertEqual(rebuilt.audio_format, "flac")

        # Upserting a saver variant must NOT overwrite an existing high-quality StoredTrack row
        storage._upsert_record(
            "703",
            {"SNG_TITLE": "Hi", "ART_NAME": "A", "DURATION": 180},
            str(high_and_saver_low),
            audio_format="mp3",
            quality="saver",
        )
        with self.SessionFactory() as db:
            row = db.get(StoredTrack, "703")
            self.assertEqual(row.file_path, str(high_and_saver_high))
            self.assertEqual(row.size_bytes, high_and_saver_high.stat().st_size)

        # Persisting analysis after audio file was evicted must NOT create an orphaned sidecar
        sidecar = tracks_dir / "999.json"
        audio_analysis._persist_analysis(
            "999",
            {"deezer_id": "999", "peaks": [0.5] * 96, "analyzed_at": "2026-11-25T00:00:00+00:00"},
            str(sidecar),
        )
        self.assertFalse(sidecar.exists())

    def test_batch_preload_and_scoped_cached_check(self) -> None:
        cached_mp3 = self.tmp_path / "tracks" / "101.mp3"
        cached_mp3.write_bytes(b"\xff\xfb" + b"\x00" * 4096)

        with patch.object(storage, "_preload_executor") as mock_exec:
            resp = self.client.post(
                "/api/tracks/preload",
                json={"track_ids": ["101", "202", "303"]},
                headers=self.headers,
            )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["already_cached"], ["101"])
        self.assertEqual(body["queued"], ["202", "303"])
        self.assertEqual(mock_exec.submit.call_count, 2)

        # Reject non-numeric track_ids
        bad = self.client.post(
            "/api/tracks/preload",
            json={"track_ids": ["not-numeric"]},
            headers=self.headers,
        )
        self.assertEqual(bad.status_code, 422)

        # Scoped cached-check reports true/false + exact size_bytes
        chk = self.client.post(
            "/api/tracks/cached-check",
            json={"ids": ["101", "202"]},
            headers=self.headers,
        )
        self.assertEqual(chk.status_code, 200)
        chk_body = chk.json()
        self.assertEqual(chk_body["cached"], {"101": True, "202": False})
        self.assertEqual(chk_body["sizes"], {"101": 4098})

    def test_real_ffmpeg_audio_analysis_endpoint_caching_db_backfill_and_503_when_missing(self) -> None:
        track_mp3 = self.tmp_path / "tracks" / "888.mp3"
        _generate_test_mp3(track_mp3)

        with self.SessionFactory() as db:
            db.add(
                StoredTrack(
                    deezer_id="888",
                    file_path=str(track_mp3),
                    title="Tone",
                    artist="Synth",
                    size_bytes=track_mp3.stat().st_size,
                )
            )
            db.add(
                Like(
                    user_id=self.user.id,
                    deezer_id="888",
                    title="Tone",
                    artist="Synth",
                )
            )
            pl = Playlist(user_id=self.user.id, name="Test")
            db.add(pl)
            db.flush()
            db.add(
                PlaylistTrack(
                    playlist_id=pl.id,
                    deezer_id="888",
                    title="Tone",
                    artist="Synth",
                )
            )
            db.commit()

        # First call computes real ffmpeg peaks + EBU R128 loudness + silence cues
        resp = self.client.get("/api/tracks/888/audio-meta", headers=self.headers)
        self.assertEqual(resp.status_code, 200)
        meta = resp.json()
        self.assertEqual(meta["deezer_id"], "888")
        self.assertEqual(len(meta["peaks"]), 96)
        self.assertTrue(all(0.0 <= p <= 1.0 for p in meta["peaks"]))
        self.assertGreater(max(meta["peaks"]), 0.9)
        self.assertIsNotNone(meta["loudness_lufs"])
        self.assertIsNotNone(meta["loudness_gain_db"])
        self.assertIsNotNone(meta["loudness_peak"])
        self.assertGreater(meta["intro_end_sec"], 0.15)
        self.assertLess(meta["outro_start_sec"], meta["duration_sec"] - 0.1)

        # DB rows were backfilled with measured EBU R128 loudness
        with self.SessionFactory() as db:
            st = db.get(StoredTrack, "888")
            self.assertEqual(st.loudness_lufs, meta["loudness_lufs"])
            self.assertEqual(st.loudness_gain_db, meta["loudness_gain_db"])
            lk = db.query(Like).filter_by(deezer_id="888").one()
            self.assertEqual(lk.loudness_gain_db, meta["loudness_gain_db"])
            pt = db.query(PlaylistTrack).filter_by(deezer_id="888").one()
            self.assertEqual(pt.loudness_gain_db, meta["loudness_gain_db"])

        # Second call serves directly from sidecar JSON without re-running ffmpeg
        with patch.object(audio_analysis, "analyze_file", side_effect=AssertionError("should use cache")):
            resp2 = self.client.get("/api/tracks/888/audio-meta", headers=self.headers)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.json()["peaks"], meta["peaks"])

        # Missing ffmpeg fails loudly with 503 (never returns fake peaks!)
        uncached_mp3 = self.tmp_path / "tracks" / "889.mp3"
        uncached_mp3.write_bytes(track_mp3.read_bytes())
        with patch.object(audio_analysis.shutil, "which", return_value=None):
            err_resp = self.client.get("/api/tracks/889/audio-meta", headers=self.headers)
        self.assertEqual(err_resp.status_code, 503)
        self.assertIn("ffmpeg", err_resp.json()["detail"].lower())


if __name__ == "__main__":
    unittest.main()
