"""DJ transitions: stretcher accuracy, analysis/planner regressions, clip timeline
contract, and the opt-in API. Synthetic signals only - nothing is played back."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import create_token
from app.db.models import User
from app.db.session import Base, get_db
from app.main import app
from app.services import storage
from app.services.dj import analysis, planner, render, service, stretch

SR = 44100


def _clicks(seconds: float, every: float, first: float = 1.0, amp: float = 1.0):
    n = int(SR * seconds)
    x = np.zeros((n, 2), np.float32)
    pos = np.round(np.arange(first, seconds - 1.0, every) * SR).astype(int)
    x[pos] = amp
    return x, pos


def _detect(y: np.ndarray, threshold: float = 0.2, gap: int = 8000) -> np.ndarray:
    e = np.abs(y[:, 0])
    idx, i = [], 0
    while i < len(e):
        if e[i] > threshold:
            idx.append(i + int(np.argmax(e[i:i + 600])))
            i += gap
        else:
            i += 1
    return np.array(idx)


def _smooth(t: float, t0: float, dur: float, target: float) -> float:
    u = min(1.0, max(0.0, (t - t0) / dur))
    return 1 + (target - 1) * u * u * (3 - 2 * u)


class StretchTests(unittest.TestCase):
    def test_position_map_is_sample_accurate(self) -> None:
        rates = {
            "unity": lambda t: 1.0,
            "faster": lambda t: 1.06,
            "slower": lambda t: 0.94,
            "ramp_up": lambda t: _smooth(t, 0.0, 1.875, 1.04),
            "ramp_down": lambda t: _smooth(t, 1.0, 2.0, 0.95),
        }
        for name, rate in rates.items():
            with self.subTest(rate=name):
                x, clicks = _clicks(16, 0.5)
                start, stop = 2 * SR, len(x) - 3 * SR
                y, ip, op = stretch.stretch_varying(x, start, stop, rate, SR)
                det = _detect(y)
                pred = np.interp(clicks[clicks >= start] - start, ip, op)
                m = min(len(det), len(pred) - 2)
                self.assertGreaterEqual(m, 15)
                self.assertLess(float(np.abs(det[:m] - pred[:m]).max()) / SR * 1000, 0.6)

    def test_no_drift_at_awkward_constant_rate(self) -> None:
        x, clicks = _clicks(40, 0.5)
        start, stop = 2 * SR, len(x) - 3 * SR
        y, _, _ = stretch.stretch_varying(x, start, stop, lambda t: 0.9789, SR)
        det = _detect(y)
        expected = (clicks[clicks >= start] - start)[: len(det)] / 0.9789
        self.assertLess(float(np.abs(det - expected).max()) / SR * 1000, 0.6)

    def test_sine_keeps_pitch_and_has_no_discontinuities(self) -> None:
        t = np.arange(SR * 10) / SR
        s = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
        x = np.stack([s, s], axis=1)
        y, _, _ = stretch.stretch_varying(x, 2 * SR, len(x) - 2 * SR, lambda tt: _smooth(tt, 1.0, 2.0, 1.05), SR)
        for a in (0.2, 1.8, 3.5):
            seg = y[int(a * SR):int(a * SR) + SR, 0] * np.hanning(SR)
            spec = np.abs(np.fft.rfft(seg))
            f = int(np.argmax(spec))
            self.assertLessEqual(abs(f - 440), 1)
            self.assertGreater((spec[f - 20:f + 21] ** 2).sum() / (spec ** 2).sum(), 0.999)
        self.assertLess(float(np.abs(np.diff(y[1000:-1000, 0])).max()), 0.04)

    def test_out_of_range_input_raises(self) -> None:
        x, _ = _clicks(4, 0.5)
        with self.assertRaises(stretch.StretchError):
            stretch.stretch_varying(x, 10, len(x), lambda t: 1.0, SR)


class GridAndCueTests(unittest.TestCase):
    def test_double_tempo_intro_keeps_constant_grid_and_every_real_beat(self) -> None:
        period = 0.5
        real = 1.0 + period * np.arange(300)
        extras = real[:80] + period / 2  # hi-hat 8ths tracked at double tempo in the intro
        beats = np.sort(np.concatenate([real, extras]))
        grid = analysis.fit_grid(beats)
        self.assertEqual(grid.mode, "constant")
        self.assertEqual(len(grid.beats), 300)
        self.assertAlmostEqual(grid.period, period, places=6)

    def test_piecewise_filter_keeps_the_beat_after_a_spurious_extra(self) -> None:
        intervals = np.linspace(0.5, 0.56, 199)  # drifting tempo -> piecewise mode
        real = np.concatenate([[1.0], 1.0 + np.cumsum(intervals)])
        beats = np.sort(np.concatenate([real, [real[100] + 0.23]]))
        grid = analysis.fit_grid(beats)
        self.assertEqual(grid.mode, "piecewise")
        self.assertIn(real[101], grid.beats)
        self.assertNotIn(real[100] + 0.23, grid.beats)

    def test_track_at_full_energy_from_bar_zero_rises_at_bar_zero(self) -> None:
        e = np.full(64, -6.0)
        e[32:40] = -15.0  # breakdown
        cues = analysis.cue_points(e, analysis.section_boundaries(e, e))
        self.assertEqual(cues["rise_bar"], 0)
        self.assertEqual(cues["intro_bars"], 0)

    def test_outro_start_never_passes_the_audible_end(self) -> None:
        e = np.full(77, -6.0)
        e[75] = -12.0  # a single quieter last bar
        cues = analysis.cue_points(e, [])
        self.assertLessEqual(cues["outro_start_bar"], cues["audible_end_bar"])
        self.assertGreaterEqual(cues["outro_bars"], 0)

    def test_too_few_beats_is_an_explicit_analysis_error(self) -> None:
        with self.assertRaises(analysis.AnalysisError):
            analysis.fit_grid(np.arange(10) * 0.5)


def _synthetic_analysis(bpm: float, n_beats: int, first: float, onset_ms: float, strength: float) -> dict:
    period = 60.0 / bpm
    times = first + period * np.arange(n_beats)
    n_bars = n_beats // 4
    energy = [-8.0] * n_bars
    for i in range(8):
        energy[i] = -18.0  # 8-bar quiet intro
    return {
        "status": "ok",
        "duration_s": float(times[-1] + 2),
        "tempo": {"bpm": bpm, "global_conf": 1.0, "grid_mode": "constant"},
        "meter": {"meter": 4, "phase": 0, "phase_margin": 9.0},
        "onsets": {"min_strength": 1.5, "windows": [
            {"t0": float(times[s]), "t1": float(times[min(s + 15, n_beats - 1)]), "offset_ms": onset_ms,
             "strength": strength} for s in range(0, n_beats, 16)]},
        "beats": {"times": times.tolist(), "k": list(range(n_beats))},
        "bars": {"k": list(range(0, n_beats, 4)), "times": times[::4].tolist(), "energy_db": energy},
        "cues": analysis.cue_points(np.array(energy), analysis.section_boundaries(np.array(energy), np.array(energy))),
    }


class PlannerTests(unittest.TestCase):
    def test_compatible_pair_beatmatches(self) -> None:
        a = _synthetic_analysis(125.0, 400, 0.3, 4.0, 3.0)
        b = _synthetic_analysis(128.0, 400, 0.2, -6.0, 3.0)
        p = planner.plan(a, b)
        self.assertEqual((p["kind"], p["reason"]), ("beatmatch", "OK"))
        self.assertAlmostEqual(p["tempo"]["a_speed"], 128.0 / 125.0, places=4)

    def test_unsuitable_track_is_a_reported_crossfade(self) -> None:
        a = {"status": "unsuitable", "reason": "only 10 beats detected; need at least 32"}
        b = _synthetic_analysis(128.0, 400, 0.2, 0.0, 3.0)
        p = planner.plan(a, b)
        self.assertEqual((p["kind"], p["reason"]), ("crossfade", "A_NOT_ANALYSABLE"))
        self.assertIn("10 beats", p["detail"])

    def test_mixed_phase_references_do_not_beatmatch(self) -> None:
        a = _synthetic_analysis(125.0, 400, 0.3, 4.0, 3.0)
        b = _synthetic_analysis(128.0, 400, 0.2, -6.0, 1.0)  # no clear onsets in B
        self.assertEqual(planner.plan(a, b)["reason"], "PHASE_REFERENCE_MISMATCH")

    def test_tempo_gap_is_reported(self) -> None:
        a = _synthetic_analysis(110.0, 400, 0.3, 0.0, 3.0)
        b = _synthetic_analysis(128.0, 400, 0.2, 0.0, 3.0)
        self.assertEqual(planner.plan(a, b)["reason"], "TEMPO_GAP")


class RenderTests(unittest.TestCase):
    """The clip timeline is the contract with the Android player."""

    def setUp(self) -> None:
        self.pa, self.pb = 60 / 125.0, 60 / 128.0
        self.A, _ = _clicks(60, self.pa, first=0.1, amp=0.4)
        self.B, _ = _clicks(60, self.pb, first=0.2, amp=0.4)
        self.plan = {
            "kind": "beatmatch", "bars": 8,
            "a": {"cue_k": 64, "region": {"offset_s": 0.1, "period_s": self.pa}},
            "b": {"cue_k": 8, "region": {"offset_s": 0.2, "period_s": self.pb}},
            "tempo": {"ramp_beats": 4},
        }

    def test_joins_carry_the_players_own_audio(self) -> None:
        clip, t = render.render_clip(self.A, self.B, self.plan, 0.5, 0.8)
        for name in ("deck_start_s", "join_in_s", "cue_s", "mix_start_s", "bass_swap_s", "mix_end_s", "join_out_s"):
            self.assertIn(name, t)
        self.assertLess(t["deck_start_s"], t["join_in_s"])
        self.assertLess(t["join_in_s"], t["cue_s"])
        self.assertLess(t["primary_seek_s"], t["mix_end_s"] - render.MIN_PRIMARY_ALIGN_S + 1e-9)
        self.assertLess(t["mix_end_s"], t["join_out_s"])
        self.assertLess(t["join_out_s"], t["duration_s"])
        # around join_in the clip is A at the player's gain, sample for sample
        i = int(round(t["join_in_s"] * SR))
        a0 = int(round((t["a_start_s"] + t["join_in_s"]) * SR))
        w = int(0.6 * SR)
        np.testing.assert_allclose(clip[i - w:i + w], 0.5 * self.A[a0 - w:a0 + w], atol=1e-6)
        # around join_out the clip is B at the player's gain (sub-sample placed)
        j = int(round(t["join_out_s"] * SR))
        b_media = t["join_out_s"] + t["b_offset_s"]
        expected = 0.8 * np.interp(np.arange(j - w, j + w) / SR + t["b_offset_s"], np.arange(len(self.B)) / SR, self.B[:, 0])
        self.assertLess(float(np.abs(clip[j - w:j + w, 0] - expected).max()), 0.02)
        self.assertGreater(b_media, 0)
        self.assertLessEqual(float(np.abs(clip).max()), 1.0)

    def test_a_beats_land_on_b_beats_after_the_ramp(self) -> None:
        clip_a, t = render.render_clip(self.A, np.zeros_like(self.B), self.plan, 1.0, 1.0)
        R = self.plan["tempo"]["ramp_beats"]
        kb = self.plan["b"]["cue_k"]
        errors = []
        for i in range(R, self.plan["bars"] * 2):  # up to the bass swap, while A is at full level
            tb = 0.2 + (kb + i) * self.pb - t["b_offset_s"]
            c = int(round(tb * SR))
            seg = np.abs(clip_a[c - 2000:c + 2000, 0])
            errors.append((int(np.argmax(seg)) - 2000) / SR * 1000)
        self.assertLess(max(abs(e) for e in errors), 1.0, errors)

    def test_non_beatmatch_plan_has_no_clip(self) -> None:
        with self.assertRaises(render.RenderError):
            render.render_clip(self.A, self.B, {"kind": "crossfade"}, 1.0, 1.0)

    def test_limiter_keeps_every_sample_below_the_ceiling(self) -> None:
        rng = np.random.default_rng(1)
        x = (rng.standard_normal((SR * 3, 2)) * 0.8).astype(np.float32)
        y, reduction = render.limit(x)
        self.assertLessEqual(float(np.abs(y).max()), render.LIMIT + 1e-6)
        self.assertGreater(reduction, 0)


class DjApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.engine = create_engine(f"sqlite:///{self.tmp_path / 'dj.db'}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.SessionFactory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False)
        with self.SessionFactory() as db:
            user = User(email="dj@example.test", password_hash="x", display_name="DJ", is_approved=True)
            db.add(user)
            db.commit()
            db.refresh(user)
            self.user_id = user.id

        def override_db():
            s = self.SessionFactory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = override_db
        self.storage_dir = self.tmp_path / "tracks"
        os.makedirs(self.storage_dir)
        for p in (
            patch.object(storage, "_storage_dir", return_value=str(self.storage_dir)),
            patch.object(storage, "SessionLocal", self.SessionFactory),
        ):
            p.start()
            self.addCleanup(p.stop)
        service._failures.clear()
        self.client = TestClient(app)
        self.headers = {"Cookie": f"sf_session={create_token(self.user_id)}"}

    def tearDown(self) -> None:
        self.client.close()
        app.dependency_overrides.pop(get_db, None)
        self.engine.dispose()
        self.tmp.cleanup()

    def _enable(self) -> None:
        r = self.client.patch("/api/me/settings", json={"dj_transitions_enabled": True}, headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["dj_transitions_enabled"])

    def _query(self, **over) -> dict:
        q = {"from_id": "111", "to_id": "222", "quality": "high", "a_gain": 0.7, "b_gain": 0.9}
        q.update(over)
        return q

    def test_setting_defaults_off_and_gates_the_endpoints(self) -> None:
        r = self.client.get("/api/me/settings", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertIs(r.json()["dj_transitions_enabled"], False)
        r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        self.assertEqual(r.status_code, 409)
        r = self.client.get("/api/dj/clips/" + "0" * 32, headers=self.headers)
        self.assertEqual(r.status_code, 409)

    def test_missing_analysis_is_pending_and_queues_one_job_per_track(self) -> None:
        self._enable()
        with patch.object(service, "_submit") as submit:
            r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"status": "pending", "reason": "ANALYSING", "retry_after_s": 5})
        self.assertEqual([c.args[0] for c in submit.call_args_list], ["analysis:111:high", "analysis:222:high"])

    def _write_track(self, deezer_id: str, record: dict) -> None:
        audio = storage.path_for_quality(deezer_id, "high")
        Path(audio).write_bytes(b"ID3" + b"\0" * 2048)
        record = dict(record, analysis_version=analysis.ANALYSIS_VERSION, file=service._binding(audio))
        Path(service.analysis_path(deezer_id, "high")).write_text(json.dumps(record))

    def test_failed_job_is_an_error_not_a_crossfade(self) -> None:
        self._enable()
        service._failures["analysis:111:high"] = (10**12, "DjWorkerError: worker exited 1")
        with patch.object(service.time, "monotonic", return_value=10**12 + 1):
            r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        self.assertEqual(r.status_code, 502)
        self.assertIn("worker exited 1", r.json()["detail"])

    def test_unsuitable_pair_is_a_ready_crossfade_with_reason(self) -> None:
        self._enable()
        self._write_track("111", {"status": "unsuitable", "reason": "downbeat activation does not distinguish any bar phase"})
        self._write_track("222", _synthetic_analysis(128.0, 400, 0.2, 0.0, 3.0))
        r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["kind"], "crossfade")
        self.assertEqual(r.json()["reason"], "A_NOT_ANALYSABLE")

    def test_beatmatch_renders_then_serves_the_clip(self) -> None:
        self._enable()
        self._write_track("111", _synthetic_analysis(125.0, 400, 0.3, 0.0, 3.0))
        self._write_track("222", _synthetic_analysis(128.0, 400, 0.2, 0.0, 3.0))
        jobs = []
        with patch.object(service, "_submit", side_effect=lambda key, job: jobs.append((key, job))):
            r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        self.assertEqual(r.json()["reason"], "RENDERING")
        self.assertEqual(len(jobs), 1)
        clip_id = jobs[0][0].split(":", 1)[1]
        flac, meta = service.clip_paths(clip_id)
        Path(flac).write_bytes(b"fLaC" + b"\0" * 4096)
        timeline = {"render_version": 1, "duration_s": 27.0, "a_start_s": 150.0, "b_offset_s": -4.0,
                    "cue_s": 8.0, "deck_start_s": 1.0, "join_in_s": 6.1, "primary_seek_s": 6.4,
                    "mix_start_s": 8.0, "bass_swap_s": 15.5, "mix_end_s": 23.0, "join_out_s": 24.2,
                    "a_speed": 1.024, "limiter_reduction_db": 1.2,
                    "a_start_skip_s": 0.025057, "b_start_skip_s": 0.0}
        Path(meta).write_text(json.dumps(timeline))
        r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual((body["status"], body["kind"]), ("ready", "beatmatch"))
        self.assertEqual(body["clip"]["id"], clip_id)
        self.assertEqual(body["clip"]["join_out_s"], 24.2)
        r = self.client.get(f"/api/dj/clips/{clip_id}", headers={**self.headers, "Range": "bytes=0-9"})
        self.assertEqual(r.status_code, 206)
        self.assertEqual(r.headers["content-type"], "audio/flac")
        self.assertEqual(self.client.get("/api/dj/clips/" + "f" * 32, headers=self.headers).status_code, 404)
        self.assertEqual(self.client.get("/api/dj/clips/nothex", headers=self.headers).status_code, 422)

    def _render_job_for_pair(self) -> str:
        self._write_track("111", _synthetic_analysis(125.0, 400, 0.3, 0.0, 3.0))
        self._write_track("222", _synthetic_analysis(128.0, 400, 0.2, 0.0, 3.0))
        jobs = []
        with patch.object(service, "_submit", side_effect=lambda key, job: jobs.append((key, job))):
            r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        self.assertEqual(r.json()["reason"], "RENDERING")
        return jobs[0][0].split(":", 1)[1]

    def test_render_constraint_becomes_a_stored_crossfade_decision(self) -> None:
        self._enable()
        clip_id = self._render_job_for_pair()
        _flac, meta = service.clip_paths(clip_id)
        Path(meta).write_text(json.dumps({"status": "unsuitable", "detail": "B enters too late"}))
        with patch.object(service, "_submit") as submit:
            r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        submit.assert_not_called()
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["kind"], r.json()["reason"]), ("crossfade", "RENDER_UNSUITABLE"))
        self.assertEqual(r.json()["detail"], "B enters too late")

    def test_clip_metadata_without_audio_is_an_error(self) -> None:
        self._enable()
        clip_id = self._render_job_for_pair()
        _flac, meta = service.clip_paths(clip_id)
        Path(meta).write_text(json.dumps({"render_version": 2}))
        r = self.client.get("/api/dj/transition", params=self._query(), headers=self.headers)
        self.assertEqual(r.status_code, 502)
        self.assertIn("no audio file", r.json()["detail"])

    def test_omitted_quality_resolves_like_the_stream_endpoint(self) -> None:
        self._enable()
        with self.SessionFactory() as db:
            db.get(User, self.user_id).preferred_quality = "lossless"
            db.commit()
        query = self._query()
        del query["quality"]
        with patch.object(service, "_submit") as submit:
            r = self.client.get("/api/dj/transition", params=query, headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual([c.args[0] for c in submit.call_args_list],
                         ["analysis:111:lossless", "analysis:222:lossless"])

    def test_gains_and_ids_are_validated(self) -> None:
        self._enable()
        for over in ({"a_gain": 0}, {"b_gain": 1.5}, {"from_id": "abc"}, {"to_id": "111"}):
            with self.subTest(**over):
                r = self.client.get("/api/dj/transition", params=self._query(**over), headers=self.headers)
                self.assertEqual(r.status_code, 422, r.text)


class DjJobQueueTest(unittest.TestCase):
    """The single worker serves the most recently requested job first and drops stale ones."""

    def setUp(self) -> None:
        self.assertIsNone(service._running)
        service._queued.clear()
        service._failures.clear()
        self.addCleanup(service._queued.clear)

    def test_newest_request_first_and_stale_jobs_dropped(self) -> None:
        ran: list[str] = []
        clock = [1000.0]
        with patch.object(service.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(service, "_worker_thread", threading.current_thread()):
            for key in ("old", "a", "b"):
                service._submit(key, lambda key=key: ran.append(key))
                clock[0] += 1
            clock[0] += service.STALE_JOB_SEC - 1.5  # "old" is now stale, "a"/"b" are not
            service._submit("a", lambda: ran.append("a"))  # polled again: newest
            for _ in range(2):
                service._run_job(*service._next_job())
        self.assertEqual(ran, ["a", "b"])
        self.assertEqual(service._queued, {})

    def test_failure_is_recorded_and_running_key_is_released(self) -> None:
        def boom() -> None:
            raise RuntimeError("worker exited 1")

        with patch.object(service, "_worker_thread", threading.current_thread()):
            service._submit("x", boom)
            service._run_job(*service._next_job())
        self.assertIsNone(service._running)
        self.assertIn("worker exited 1", service._failures["x"][1])


class DjAudioIoTest(unittest.TestCase):
    """ffmpeg round trips (silent; nothing is played). The api-contract workflow installs
    ffmpeg; the self-hosted Android runner has none and reports these as skipped."""

    def setUp(self) -> None:
        import shutil

        if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
            raise unittest.SkipTest("ffmpeg/ffprobe not installed on this test host")

    def test_flac_clip_round_trips_without_offset(self) -> None:
        from app.services.dj import audio

        x = (np.random.default_rng(3).standard_normal((SR * 2, 2)) * 0.05).astype(np.float32)
        x[SR // 2] = 0.9
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "clip.flac")
            audio.write_flac(path, x)
            y = audio.decode(path)
            self.assertEqual(audio.start_skip_s(path), 0.0)
        self.assertEqual(y.shape, x.shape)
        self.assertLess(float(np.max(np.abs(x - y))), 2.0 / 32768)

    def test_start_skip_of_a_tagged_mp3_is_encoder_plus_decoder_delay(self) -> None:
        import subprocess

        from app.services.dj import audio

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t.mp3")
            subprocess.run(
                ["ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                 "-t", "1", "-codec:a", "libmp3lame", "-b:a", "320k", path],
                check=True, capture_output=True,
            )
            self.assertAlmostEqual(audio.start_skip_s(path) * SR, 576 + 529, delta=0.5)


class DjClipPruneTest(unittest.TestCase):
    def test_prunes_audio_and_metadata_together_by_newest_use(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(storage, "_storage_dir", return_value=tmp):
            old_flac, old_meta = service.clip_paths("a" * 32)
            used_flac, used_meta = service.clip_paths("b" * 32)
            for f in (old_flac, old_meta, used_flac, used_meta):
                Path(f).write_bytes(b"x")
            stale = time.time() - service.CLIP_MAX_AGE_SEC - 60
            for f in (old_flac, old_meta, used_flac):
                os.utime(f, (stale, stale))
            service._prune_clips()  # used_meta was touched recently -> its clip stays
            self.assertEqual(sorted(os.path.basename(p) for p in Path(tmp, "dj", "clips").iterdir()),
                             sorted(os.path.basename(p) for p in (used_flac, used_meta)))


if __name__ == "__main__":
    unittest.main()
