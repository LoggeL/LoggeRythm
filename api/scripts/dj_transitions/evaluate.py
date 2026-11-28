"""Objective check of rendered beatmatch transitions - no listening required.

For every <slug>.plan.json of kind beatmatch it loads the un-gained, time-aligned
A and B signals of the overlap and measures how far their percussive onsets are
apart, bar by bar, via cross-correlation of onset envelopes (1.45 ms resolution).
A flam becomes audible from roughly 10-20 ms; below ~5 ms two kicks fuse.

A self-test shifts B by a known amount first, so a "0 ms" result cannot come
from a metric that is blind to misalignment.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfiltfilt, stft

from audio import SR

HOP = 64
MAX_LAG_MS = 60.0
MIN_CORR = 0.15   # bars whose onset envelopes barely correlate (no shared percussion) are not measurable


class EvalError(RuntimeError):
    pass


def high_flux_env(x: np.ndarray) -> np.ndarray:
    """Independent check: spectral flux of 2-8 kHz only (hi-hats, snare crack).

    (A low-band Hilbert-envelope check was tried and dropped: sustained sub-bass and
    sidechain pumping made it disagree by 30-70 ms even on pairs where cross-
    correlation and the hi-hat band agreed within 1 ms.)
    """
    return onset_env(x, band=(2000, 8000))


def onset_env(x: np.ndarray, band=(40, 4000)) -> np.ndarray:
    """Spectral flux of the low/mid band (kicks, snares), half-wave rectified, normalised."""
    mono = x.mean(axis=1)
    sos = butter(4, list(band), btype="band", fs=SR, output="sos")
    mono = sosfiltfilt(sos, mono)
    _, _, Z = stft(mono, fs=SR, nperseg=1024, noverlap=1024 - HOP, boundary=None, padded=False)
    mag = np.log1p(100 * np.abs(Z))
    flux = np.maximum(0, np.diff(mag, axis=1)).sum(axis=0)
    flux = np.concatenate([[0], flux])
    # frame i is centred at sample i*HOP + 512 (nperseg/2)
    return flux


def best_lag_ms(ea: np.ndarray, eb: np.ndarray) -> tuple[float, float]:
    """Lag (ms) maximising the normalised cross-correlation; positive = B late vs A."""
    ea = (ea - ea.mean()) / (ea.std() + 1e-9)
    eb = (eb - eb.mean()) / (eb.std() + 1e-9)
    max_lag = int(MAX_LAG_MS / 1000 * SR / HOP)
    lags = np.arange(-max_lag, max_lag + 1)
    n = len(ea)
    corr = np.array([np.dot(ea[max(0, -l):n - max(0, l)], eb[max(0, l):n - max(0, -l)]) / (n - abs(l)) for l in lags])
    i = int(np.argmax(corr))
    # parabolic refinement
    d = 0.0
    if 0 < i < len(corr) - 1:
        y0, y1, y2 = corr[i - 1], corr[i], corr[i + 1]
        den = y0 - 2 * y1 + y2
        if den < 0:
            d = 0.5 * (y0 - y2) / den
    return float((lags[i] + d) * HOP / SR * 1000), float(corr[i])


def per_bar_lags(a: np.ndarray, b: np.ndarray, origin_s: float, beats_b_s: list[float]) -> list[dict]:
    ea, eb = onset_env(a), onset_env(b)
    frame_t = (np.arange(len(ea)) * HOP + 512) / SR + origin_s
    res = []
    for i in range(0, len(beats_b_s) - 4, 4):
        t0, t1 = beats_b_s[i], beats_b_s[i + 4]
        sel = (frame_t >= t0) & (frame_t < t1)
        if sel.sum() < 50:
            raise EvalError(f"bar window {t0:.2f}-{t1:.2f}s has too few frames")
        lag, c = best_lag_ms(ea[sel], eb[sel])
        res.append({"bar": i // 4, "t0_s": round(t0, 3), "lag_ms": round(lag, 2), "corr": round(c, 3)})
    return res


SYNC_MIN_STRENGTH = 1.4


def sync_offset(a: np.ndarray, b: np.ndarray, origin_s: float, beats_s: list[float], env_fn) -> dict:
    """Beat-synchronous onset profile of each stem around the planned beats.

    Returns where A's and B's onsets peak relative to the shared beat positions and
    their difference (B - A, ms). Positive = B's hits come later than A's.
    """
    taus = np.arange(-MAX_LAG_MS, MAX_LAG_MS + 0.01, HOP / SR * 1000) / 1000
    beats = np.array(beats_s)
    out = {}
    for name, x in (("a", a), ("b", b)):
        e = env_fn(x)
        ft = (np.arange(len(e)) * HOP + 512) / SR + origin_s
        prof = np.interp(beats[:, None] + taus[None, :], ft, e).mean(axis=0)
        i = int(np.argmax(prof))
        out[name] = (float(taus[i] * 1000), float(prof[i] / (prof.mean() + 1e-12)))
    ok = min(out["a"][1], out["b"][1]) >= SYNC_MIN_STRENGTH
    return {"a_ms": round(out["a"][0], 1), "b_ms": round(out["b"][0], 1),
            "strength": (round(out["a"][1], 2), round(out["b"][1], 2)),
            "diff_ms": round(out["b"][0] - out["a"][0], 1) if ok else None}


def self_test(a: np.ndarray, b: np.ndarray, origin_s: float, beats: list[float], shift_ms: float) -> float:
    s = int(round(shift_ms / 1000 * SR))
    b_shift = np.concatenate([np.zeros((s, 2), b.dtype), b[:-s]])
    lags = [r["lag_ms"] for r in per_bar_lags(a, b_shift, origin_s, beats)]
    return float(np.median(lags))


def main(out_dir: Path) -> int:
    mixes = out_dir / "mixes"
    plans = sorted(mixes.glob("*.plan.json"))
    if not plans:
        raise SystemExit(f"no rendered plans in {mixes}")
    report = []
    for p in plans:
        meta = json.loads(p.read_text())
        if meta["kind"] != "beatmatch":
            report.append({"pair": f"{meta['a']['label']} -> {meta['b']['label']}", "kind": meta["kind"],
                           "reason": meta["reason"]})
            continue
        stems = np.load(p.with_name(p.name.replace(".plan.json", ".stems.npz")))
        a, b, origin = stems["a_raw"], stems["b_raw"], float(stems["origin_s"])
        tl = meta["render"]["timeline"]
        beats = tl["beats_b_out_s"]
        R = meta["tempo"]["ramp_beats"]
        bars = per_bar_lags(a, b, origin, beats)
        post_ramp = [r for r in bars if r["bar"] >= R // 4]
        measurable = [r for r in post_ramp if r["corr"] >= MIN_CORR]
        st = self_test(a, b, origin, beats, 25.0)
        if not measurable:
            report.append({"pair": f"{meta['a']['label']} -> {meta['b']['label']}", "kind": "beatmatch",
                           "unmeasurable": f"no bar with onset correlation >= {MIN_CORR}",
                           "corr_per_bar": [r["corr"] for r in bars]})
            continue
        lags = np.array([r["lag_ms"] for r in measurable])
        post_beats = beats[R:]
        sync = {
            "broad_flux (same feature as the alignment)": sync_offset(a, b, origin, post_beats, onset_env),
            "high_flux (independent)": sync_offset(a, b, origin, post_beats, high_flux_env),
        }
        report.append({
            "sync": sync,
            "measurable_bars": f"{len(measurable)}/{len(post_ramp)}",
            "self_test_ok": abs(st - (float(np.median(lags)) + 25.0)) < 5.0,
            "pair": f"{meta['a']['label']} -> {meta['b']['label']}",
            "kind": "beatmatch",
            "a_speed": round(tl["a_speed"], 4),
            "bars": meta["bars"],
            "grid_expected_max_ms": round(max(abs(x) for x in tl["expected_beat_offsets_ms"][R:]), 3),
            "onset_lag_median_ms": round(float(np.median(lags)), 2),
            "onset_lag_max_abs_ms": round(float(np.max(np.abs(lags))), 2),
            "onset_lag_per_bar_ms": [r["lag_ms"] for r in bars],
            "corr_per_bar": [r["corr"] for r in bars],
            "self_test_25ms_measured": round(st, 2),
            "limiter_db": meta["render"]["limiter_max_reduction_db"],
        })
    (out_dir / "evaluation.json").write_text(json.dumps(report, indent=1))
    for r in report:
        if r["kind"] != "beatmatch":
            print(f"{r['pair'][:66]:66s} {r['kind']} ({r['reason']})")
            continue
        if "unmeasurable" in r:
            print(f"{r['pair'][:66]:66s} UNMEASURABLE: {r['unmeasurable']} corr={r['corr_per_bar']}")
            continue
        print(f"{r['pair'][:66]:66s} speed={r['a_speed']:.4f} lag median={r['onset_lag_median_ms']:+6.2f} "
              f"max={r['onset_lag_max_abs_ms']:5.2f} ms bars={r['measurable_bars']} per-bar={r['onset_lag_per_bar_ms']} "
              f"selftest={'ok' if r['self_test_ok'] else 'FAIL'}({r['self_test_25ms_measured']:+.1f}) grid_exp={r['grid_expected_max_ms']}")
        print("      sync B-A ms: " + "  ".join(f"{k.split(' ')[0]}={v['diff_ms']}" for k, v in r["sync"].items()))
    return 0
