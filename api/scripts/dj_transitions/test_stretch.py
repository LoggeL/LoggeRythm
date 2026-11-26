"""Regression tests for the streaming stretcher (run: .venv/bin/python -m pytest test_stretch.py).

Synthetic signals only - nothing is played back.
"""

import numpy as np
import pytest

import stretch

SR = 44100


def _clicks(seconds=16, every=0.5):
    n = SR * seconds
    x = np.zeros((n, 2), np.float32)
    pos = np.arange(SR, n - SR, int(every * SR))
    x[pos] = 1.0
    return x, pos


def _detect(y):
    e = np.abs(y[:, 0])
    idx, i = [], 0
    while i < len(e):
        if e[i] > 0.2:
            idx.append(i + int(np.argmax(e[i:i + 600])))
            i += 8000
        else:
            i += 1
    return np.array(idx)


def smooth(t, t0, dur, target):
    u = min(1.0, max(0.0, (t - t0) / dur))
    return 1 + (target - 1) * u * u * (3 - 2 * u)


@pytest.mark.parametrize("rate", [
    lambda t: 1.0,
    lambda t: 1.06,
    lambda t: 0.94,
    lambda t: smooth(t, 0.0, 1.875, 1.04),
    lambda t: smooth(t, 1.0, 2.0, 0.95),
])
def test_position_map_is_sample_accurate(rate):
    x, clicks = _clicks()
    start, stop = 2 * SR, len(x) - 3 * SR
    y, ip, op = stretch.stretch_varying(x, start, stop, rate, SR)
    det = _detect(y)
    rel = clicks[clicks >= start] - start
    pred = np.interp(rel, ip, op)
    m = min(len(det), len(pred) - 2)
    err_ms = np.abs(det[:m] - pred[:m]) / SR * 1000
    assert m >= 15
    assert err_ms.max() < 0.6, err_ms


def test_no_drift_at_awkward_constant_rate():
    # 256/0.9789 is not an integer; block rounding used to drift ~1 ms/beat
    x, clicks = _clicks(seconds=40)
    start, stop = 2 * SR, len(x) - 3 * SR
    y, ip, op = stretch.stretch_varying(x, start, stop, lambda t: 0.9789, SR)
    det = _detect(y)
    rel = clicks[clicks >= start] - start
    expected = rel[: len(det)] / 0.9789
    assert np.abs(det - expected).max() / SR * 1000 < 0.6


def test_sine_stays_clean_through_ramp():
    t = np.arange(SR * 10) / SR
    s = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    x = np.stack([s, s], axis=1)
    y, _, _ = stretch.stretch_varying(x, 2 * SR, len(x) - 2 * SR, lambda tt: smooth(tt, 1.0, 2.0, 1.05), SR)
    assert len(y) > 4.6 * SR
    for a in (0.2, 1.8, 3.5):
        seg = y[int(a * SR):int(a * SR) + SR, 0] * np.hanning(SR)
        spec = np.abs(np.fft.rfft(seg))
        f = int(np.argmax(spec))
        assert abs(f - 440) <= 1  # pitch preserved
        assert (spec[f - 20:f + 21] ** 2).sum() / (spec ** 2).sum() > 0.999
    assert np.abs(np.diff(y[1000:-1000, 0])).max() < 0.04  # no clicks/discontinuities
