"""Renders the transition clip for a ``beatmatch`` plan.

Clip layout (clip seconds; A and B media times are exact affine maps of clip time):

    0 ........ cue_s ............ mix_start_s ...... mix_end_s ..... join_out_s .. end
    | A @1.0x  | A tail stretched (ramp 1.0 -> a_speed over one bar), fading out  |
                                  | B @1.0x fading in, bass swap mid-overlap | B only |

* ``a_media = a_start_s + clip_t`` for clip_t <= cue_s (A plays unstretched up to its cue)
* ``b_media = clip_t + b_offset_s`` everywhere (B is never stretched)

The player joins its own A onto the clip at ``join_in_s`` and its own B back at
``join_out_s``. Both joins sit between two beats and the clip carries the same audio
as the player there, so a few ms of join timing error is inaudible.

Loudness: A and B are scaled by the per-track gains the player would apply itself
(``a_gain``/``b_gain``), so the deck plays the clip at volume 1.0 and both joins are
level-matched.
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import maximum_filter1d
from scipy.signal import butter, sosfiltfilt

from .audio import SR
from .stretch import stretch_varying

RENDER_VERSION = 2
PRE_S = 8.0  # A before its cue: room for the deck to start muted and lock on
POST_S = 3.0  # B after the join-out point
DECK_START_S = 1.0
JOIN_IN_BEFORE_CUE_S = 2.0
JOIN_OUT_AFTER_MIX_S = 1.0
MIN_PRIMARY_ALIGN_S = 3.0  # the player needs this long to lock its B onto the clip
XF_S = 0.05  # join between A's original audio and its stretched tail
CROSSOVER_HZ = 150.0
LIMIT = 0.97


class RenderError(RuntimeError):
    """The plan cannot be rendered (reason in the message)."""


class RenderUnsuitable(RenderError):
    """The planned pair violates a clip constraint the planner cannot see (pre-roll,
    track length, B's entry point). Deterministic for these inputs: the service records
    it as a ``crossfade`` decision with reason ``RENDER_UNSUITABLE`` instead of retrying."""


def _split(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    low = sosfiltfilt(butter(4, CROSSOVER_HZ, btype="low", fs=SR, output="sos"), x, axis=0)
    return low, x - low  # zero-phase -> exactly complementary


def limit(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Look-ahead peak limiter (5 ms look-ahead, 150 ms release).

    Gain is computed per 32-sample block (instant attack, one-pole release),
    interpolated per sample and clamped to the per-sample ceiling, so no sample can
    exceed LIMIT. Returns (y, max gain reduction in dB)."""
    peak = np.max(np.abs(x), axis=1)
    la = int(0.005 * SR)
    target = np.minimum(1.0, LIMIT / np.maximum(maximum_filter1d(peak, size=2 * la + 1), 1e-9))
    block = 32
    nb = -(-len(target) // block)
    padded = np.ones(nb * block)
    padded[: len(target)] = target
    tb = padded.reshape(nb, block).min(axis=1)
    alpha = np.exp(-block / (0.150 * SR))
    gb = np.empty(nb)
    cur = 1.0
    for i in range(nb):
        cur = tb[i] if tb[i] < cur else alpha * cur + (1 - alpha) * tb[i]
        gb[i] = cur
    centres = np.arange(nb) * block + block / 2
    g = np.minimum(np.interp(np.arange(len(target)), centres, gb), target)
    y = (x * g[:, None]).astype(np.float32)
    if np.max(np.abs(y)) > 1.0:
        raise RenderError("limiter failed to keep peaks below 0 dBFS")
    return y, max(0.0, float(-20 * np.log10(max(g.min(), 1e-9))))


def _ramp(n: int, kind: str) -> np.ndarray:
    u = np.linspace(0.0, 1.0, n, endpoint=False) if n > 0 else np.zeros(0)
    if kind == "in":
        return np.sin(0.5 * np.pi * u)
    if kind == "out":
        return np.cos(0.5 * np.pi * u)
    raise ValueError(kind)


def _seg(x: np.ndarray, start: int, n: int) -> np.ndarray:
    """x[start:start+n], zero-padded outside the track (silence there is real)."""
    out = np.zeros((n, x.shape[1]), np.float32)
    lo, hi = max(start, 0), min(start + n, len(x))
    if hi > lo:
        out[lo - start:hi - start] = x[lo:hi]
    return out


def _grid_time(region: dict, k: float) -> float:
    return region["offset_s"] + k * region["period_s"]


def _mid_beat_at_or_after(region: dict, t: float) -> float:
    k = np.ceil((t - region["offset_s"]) / region["period_s"] - 0.5)
    return _grid_time(region, k + 0.5)


def render_clip(A: np.ndarray, B: np.ndarray, plan: dict, a_gain: float, b_gain: float) -> tuple[np.ndarray, dict]:
    if plan["kind"] != "beatmatch":
        raise RenderError(f"only beatmatch plans have a clip, got {plan['kind']!r}")
    for name, g in (("a_gain", a_gain), ("b_gain", b_gain)):
        if not 0.0 < g <= 1.0:
            raise RenderError(f"{name} must be in (0, 1], got {g}")
    ra, rb = plan["a"]["region"], plan["b"]["region"]
    pa, pb = ra["period_s"], rb["period_s"]
    bars = plan["bars"]
    R = plan["tempo"]["ramp_beats"]
    speed = pa / pb  # A tail rate so that its beat period becomes B's
    ka, kb = plan["a"]["cue_k"], plan["b"]["cue_k"]
    ta_cue = _grid_time(ra, ka)
    tb_cue = _grid_time(rb, kb)

    # ---- A's tail, smoothstep ramp 1 -> speed over the first R beats after the cue
    ramp_s = R * pa

    def rate_at(x: float) -> float:
        x -= XF_S  # the stretch starts XF_S before the cue, at rate 1
        if x <= 0:
            return 1.0
        u = min(1.0, x / ramp_s)
        return 1.0 + (speed - 1.0) * u * u * (3 - 2 * u)

    st_start = int(round((ta_cue - XF_S) * SR))
    st_stop = int(round((ta_cue + (bars * 4 + 4) * pa + 1.0) * SR))
    A_pad = np.concatenate([A, np.zeros((int(20 * SR), A.shape[1]), np.float32)])
    if st_start - int(PRE_S * SR) < 0:
        raise RenderUnsuitable(f"A cue at {ta_cue:.2f}s leaves less than {PRE_S}s of pre-roll")
    if st_stop > len(A_pad):
        raise RenderUnsuitable("A's tail range exceeds the padded track")
    tail, in_pos, out_pos = stretch_varying(A_pad, st_start, st_stop, rate_at, SR)

    def a_media_to_tail(t_media: float) -> float:
        return float(np.interp(t_media * SR - st_start, in_pos, out_pos))

    T0 = int(round(PRE_S * SR))  # clip index of A's cue
    a_start = int(round(ta_cue * SR)) - T0  # A sample at clip index 0
    tail_origin = T0 - a_media_to_tail(a_start / SR + PRE_S)  # clip index of tail[0]
    # anchor: A's beat cue+R (first beat at full target tempo) meets B's beat cue+R
    t_anchor = tail_origin + a_media_to_tail(_grid_time(ra, ka + R))
    b_origin = t_anchor - _grid_time(rb, kb + R) * SR  # clip index of B media sample 0

    def b_clip(t_media: float) -> float:
        return b_origin + t_media * SR

    T_start = int(round(b_clip(tb_cue)))
    T_mid = int(round(b_clip(_grid_time(rb, kb + bars * 2))))
    T_end = int(round(b_clip(_grid_time(rb, kb + bars * 4))))
    if not T0 - SR < T_start < T_mid < T_end:
        raise RenderError(f"inconsistent clip timeline: cue {T0}, B in {T_start}, mid {T_mid}, end {T_end}")
    b_offset_s = -b_origin / SR

    a_start_s = a_start / SR
    join_in_s = _mid_beat_at_or_after(ra, a_start_s + PRE_S - JOIN_IN_BEFORE_CUE_S) - a_start_s
    join_out_s = _mid_beat_at_or_after(rb, T_end / SR + JOIN_OUT_AFTER_MIX_S + b_offset_s) - b_offset_s
    primary_seek_s = max(join_in_s + 0.3, 0.5 - b_offset_s)
    if primary_seek_s > T_end / SR - MIN_PRIMARY_ALIGN_S:
        raise RenderUnsuitable(
            f"B enters too late in its own file for the player to lock on (seek at {primary_seek_s:.2f}s, "
            f"mix ends {T_end / SR:.2f}s)"
        )
    n_out = int(round((join_out_s + POST_S) * SR))

    # ---- A: original up to the cue, stretched tail after; the two are the same audio
    # at the join (rate 1), so the join uses equal-gain ramps (equal-power would add
    # +3 dB on coherent signals)
    out_a = np.zeros((n_out, 2), np.float32)
    join = int(XF_S * SR)
    j0 = T0 - join // 2
    pre = _seg(A, a_start, j0 + join)
    t0i = int(round(tail_origin))
    tail_full = np.zeros((n_out, 2), np.float32)
    n_tail = min(len(tail), n_out - t0i)
    tail_full[t0i:t0i + n_tail] = tail[:n_tail]
    fade = np.linspace(0.0, 1.0, join, endpoint=False)[:, None]
    out_a[:j0] = pre[:j0]
    out_a[j0:j0 + join] = pre[j0:j0 + join] * (1 - fade) + tail_full[j0:j0 + join] * fade
    out_a[j0 + join:] = tail_full[j0 + join:]

    b0 = int(np.floor(-b_origin))
    frac = (-b_origin) - b0
    seg_b = _seg(B, b0, n_out + 1)
    out_b = ((1 - frac) * seg_b[:-1] + frac * seg_b[1:]).astype(np.float32)  # sub-sample placement

    a_low, a_high = _split(out_a)
    b_low, b_high = _split(out_b)
    swap = int(round(pb * SR))
    g_a_high = np.ones(n_out)
    g_a_high[T_mid:T_end] = _ramp(T_end - T_mid, "out")
    g_a_high[T_end:] = 0
    g_a_low = np.ones(n_out)
    g_a_low[T_mid:T_mid + swap] = np.linspace(1, 0, swap)
    g_a_low[T_mid + swap:] = 0
    g_b_high = np.zeros(n_out)
    g_b_high[T_start:T_mid] = _ramp(T_mid - T_start, "in")
    g_b_high[T_mid:] = 1
    g_b_low = np.zeros(n_out)
    g_b_low[T_mid:T_mid + swap] = np.linspace(0, 1, swap)
    g_b_low[T_mid + swap:] = 1

    mix = (a_gain * (a_low * g_a_low[:, None] + a_high * g_a_high[:, None])
           + b_gain * (b_low * g_b_low[:, None] + b_high * g_b_high[:, None]))
    clip, reduction_db = limit(mix)
    timeline = {
        "render_version": RENDER_VERSION,
        "duration_s": round(n_out / SR, 6),
        "a_start_s": round(a_start_s, 6),
        "b_offset_s": round(b_offset_s, 6),
        "cue_s": round(T0 / SR, 6),
        "deck_start_s": DECK_START_S,
        "join_in_s": round(float(join_in_s), 6),
        "primary_seek_s": round(float(primary_seek_s), 6),
        "mix_start_s": round(T_start / SR, 6),
        "bass_swap_s": round(T_mid / SR, 6),
        "mix_end_s": round(T_end / SR, 6),
        "join_out_s": round(float(join_out_s), 6),
        "a_speed": round(speed, 6),
        "limiter_reduction_db": round(reduction_db, 2),
    }
    return clip, timeline
