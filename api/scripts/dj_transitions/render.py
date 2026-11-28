"""Offline renderer: turns a plan into listenable MP3s (+ stems for evaluation).

Per pair it writes, under <out>/mixes/:
  <slug>.dj.mp3     the planned transition (beatmatch, or the planned plain crossfade)
  <slug>.naive.mp3  what the web player does today: linear 8 s fade at the file end, B from 0
  <slug>.plan.json  the plan plus render metrics
  <slug>.stems.npz  A and B contributions around the overlap, pre-limiter (for evaluate.py)
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from scipy.ndimage import maximum_filter1d
from scipy.signal import butter, sosfiltfilt

from audio import SR, decode, write_mp3
from stretch import stretch_varying

PRE_S = 20.0          # A before the transition
POST_S = 20.0         # B after the transition
XF_S = 0.05           # join between A's original audio and its stretched tail
CROSSOVER_HZ = 150.0
LIMIT = 0.97          # limiter ceiling (linear)


class RenderError(RuntimeError):
    pass


def _slug(plan: dict) -> str:
    def s(x):
        return re.sub(r"[^a-z0-9]+", "-", x.lower()).strip("-")[:40]
    return f"{s(plan['a']['label'])}__{s(plan['b']['label'])}"


def _main_level_db(an: dict) -> float:
    e = np.array(an["bars"]["energy_db"])
    loud = an["cues"]["loud_level_db"]
    main = e[e >= loud - 3.0]
    if len(main) == 0:
        raise RenderError(f"{an['track']['id']}: no main-part bars for loudness matching")
    return float(10 * np.log10(np.mean(10 ** (main / 10))))


def _match_gains(a: dict, b: dict) -> tuple[float, float]:
    """Attenuation-only loudness matching (like the app's normalisation)."""
    la, lb = _main_level_db(a), _main_level_db(b)
    target = min(la, lb)
    return 10 ** ((target - la) / 20), 10 ** ((target - lb) / 20)


def _split(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    sos = butter(4, CROSSOVER_HZ, btype="low", fs=SR, output="sos")
    low = sosfiltfilt(sos, x, axis=0)  # zero-phase -> high = x - low is exactly complementary
    return low, x - low


def _limit(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Look-ahead peak limiter (5 ms look-ahead, 150 ms release). Returns (y, max reduction dB)."""
    peak = np.max(np.abs(x), axis=1)
    la = int(0.005 * SR)
    env = maximum_filter1d(peak, size=2 * la + 1)
    target = np.minimum(1.0, LIMIT / np.maximum(env, 1e-9))
    # release smoothing: gain may fall instantly (look-ahead covers attack) and recover slowly
    alpha = np.exp(-1.0 / (0.150 * SR))
    g = np.empty_like(target)
    cur = 1.0
    for i, t in enumerate(target):  # ~2M samples; fine for a prototype
        cur = t if t < cur else alpha * cur + (1 - alpha) * t
        g[i] = cur
    y = x * g[:, None]
    if np.max(np.abs(y)) > 1.0:
        raise RenderError("limiter failed to keep peaks below 0 dBFS")
    return y, float(-20 * np.log10(g.min()))


def _ramp(n: int, kind: str) -> np.ndarray:
    u = np.linspace(0.0, 1.0, n, endpoint=False) if n > 0 else np.zeros(0)
    if kind == "in":
        return np.sin(0.5 * np.pi * u)
    if kind == "out":
        return np.cos(0.5 * np.pi * u)
    raise ValueError(kind)


def _seg(x: np.ndarray, start: int, n: int) -> np.ndarray:
    """x[start:start+n] with zero padding outside the track (silence before/after is real silence)."""
    out = np.zeros((n, x.shape[1]), np.float32)
    lo, hi = max(start, 0), min(start + n, len(x))
    if hi > lo:
        out[lo - start:hi - start] = x[lo:hi]
    return out


def _grid_time(region: dict, k: float) -> float:
    return region["offset_s"] + k * region["period_s"]


def render_beatmatch(A: np.ndarray, B: np.ndarray, a: dict, b: dict, plan: dict, ga: float, gb: float):
    ra, rb = plan["a"]["region"], plan["b"]["region"]
    pa, pb = ra["period_s"], rb["period_s"]
    bars = plan["bars"]
    R = plan["tempo"]["ramp_beats"]
    speed = pa / pb  # A tail rate so that its beat period becomes B's

    ka = a["bars"]["k"][plan["a"]["cue_bar"]]
    kb = b["bars"]["k"][plan["b"]["cue_bar"]]
    ta_cue = _grid_time(ra, ka)      # A's cue downbeat (s, A media time), from the local fit
    tb_cue = _grid_time(rb, kb)

    # ---- A's tail, stretched with a smoothstep ramp 1 -> speed over the first R beats
    ramp_s = R * pa

    def rate_at(x: float) -> float:
        x -= XF_S  # stretch starts XF_S before the cue (rate 1 there)
        if x <= 0:
            return 1.0
        u = min(1.0, x / ramp_s)
        return 1.0 + (speed - 1.0) * u * u * (3 - 2 * u)

    tail_beats = bars * 4 + 4
    st_start = int(round((ta_cue - XF_S) * SR))
    A_pad = np.concatenate([A, np.zeros((int(20 * SR), A.shape[1]), np.float32)])
    st_stop = int(round((ta_cue + tail_beats * pa + 1.0) * SR))
    if st_stop > len(A_pad):
        raise RenderError("A's tail range exceeds the padded track")
    tail, in_pos, out_pos = stretch_varying(A_pad, st_start, st_stop, rate_at, SR)

    def a_media_to_tail(t_media: float) -> float:  # A media time -> sample index within `tail`
        return float(np.interp((t_media * SR) - st_start, in_pos, out_pos))

    T0 = int(round(PRE_S * SR))                    # output index of A's cue downbeat
    tail_origin = T0 - a_media_to_tail(ta_cue)     # output index of tail[0]
    # anchor: A's beat (cue + R) - first beat at full target tempo - meets B's beat (cue + R)
    t_anchor_out = tail_origin + a_media_to_tail(_grid_time(ra, ka + R))
    tb_anchor = _grid_time(rb, kb + R)
    b_origin = t_anchor_out - tb_anchor * SR       # output index of B media sample 0

    def b_out(t_media: float) -> float:
        return b_origin + t_media * SR

    T_start = int(round(b_out(tb_cue)))            # B audible from its cue bar
    T_mid = int(round(b_out(_grid_time(rb, kb + bars * 2))))
    T_end = int(round(b_out(_grid_time(rb, kb + bars * 4))))
    swap = int(round(pb * SR))
    n_out = T_end + int(POST_S * SR)

    # ---- assemble contributions
    out_a = np.zeros((n_out, 2), np.float32)
    out_b = np.zeros((n_out, 2), np.float32)
    a_start = int(round(ta_cue * SR)) - T0
    pre = _seg(A, a_start, T0 + int(XF_S * SR))
    t0i = int(round(tail_origin))
    tail_len = min(len(tail), n_out - t0i)
    # original A up to the join, stretched tail after it, with a short equal-power join
    join = int(XF_S * SR)
    j0 = T0 - join // 2
    out_a[:j0] = pre[:j0]
    tail_full = np.zeros((n_out, 2), np.float32)
    tail_full[t0i:t0i + tail_len] = tail[:tail_len]
    xf_out, xf_in = _ramp(join, "out")[:, None], _ramp(join, "in")[:, None]
    out_a[j0:j0 + join] = pre[j0:j0 + join] * xf_out + tail_full[j0:j0 + join] * xf_in
    out_a[j0 + join:] = tail_full[j0 + join:]

    b0 = int(np.floor(-b_origin))  # B media sample at output index 0
    frac = (-b_origin) - b0
    seg_b = _seg(B, b0, n_out + 1)
    out_b[:] = (1 - frac) * seg_b[:-1] + frac * seg_b[1:]  # sub-sample placement

    a_low, a_high = _split(out_a)
    b_low, b_high = _split(out_b)

    # ---- gain automation (output time)
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

    ca = ga * (a_low * g_a_low[:, None] + a_high * g_a_high[:, None])
    cb = gb * (b_low * g_b_low[:, None] + b_high * g_b_high[:, None])
    # un-gained, time-aligned signals for the alignment measurement in evaluate.py
    raw = {"a_raw": out_a.copy(), "b_raw": out_b.copy()}
    timeline = {
        "T0_cue_s": T0 / SR, "B_start_s": T_start / SR, "bass_swap_s": T_mid / SR, "end_s": T_end / SR,
        "anchor_s": t_anchor_out / SR, "a_speed": speed, "ramp_s": ramp_s, "overlap_s": (T_end - T_start) / SR,
        "b_media_at_T0_s": (T0 - b_origin) / SR,
    }
    # expected beat positions (output time) of both tracks inside the overlap, for evaluation
    beats_a = [tail_origin + a_media_to_tail(_grid_time(ra, ka + i)) for i in range(0, bars * 4 + 1)]
    beats_b = [b_out(_grid_time(rb, kb + i)) for i in range(0, bars * 4 + 1)]
    timeline["expected_beat_offsets_ms"] = [round((x - y) / SR * 1000, 3) for x, y in zip(beats_a, beats_b)]
    timeline["beats_b_out_s"] = [round(x / SR, 5) for x in beats_b]
    timeline["raw"] = raw
    return ca.astype(np.float32), cb.astype(np.float32), timeline


def render_plain(A: np.ndarray, B: np.ndarray, plan: dict, ga: float, gb: float, equal_power: bool):
    fade = int(plan["fade_s"] * SR)
    a_fade_start = int(round(plan["a_fade_start_s"] * SR))
    b_start = int(round(plan["b_start_s"] * SR))
    T0 = int(PRE_S * SR)
    n_out = T0 + fade + int(POST_S * SR)
    out_a = _seg(A, a_fade_start - T0, n_out)
    out_b = np.zeros((n_out, 2), np.float32)
    out_b[T0:] = _seg(B, b_start, n_out - T0)
    if equal_power:
        g_out, g_in = _ramp(fade, "out"), _ramp(fade, "in")
    else:
        g_out, g_in = np.linspace(1, 0, fade), np.linspace(0, 1, fade)
    ga_t = np.ones(n_out)
    ga_t[T0:T0 + fade] = g_out
    ga_t[T0 + fade:] = 0
    gb_t = np.zeros(n_out)
    gb_t[T0:T0 + fade] = g_in
    gb_t[T0 + fade:] = 1
    return (ga * out_a * ga_t[:, None]).astype(np.float32), (gb * out_b * gb_t[:, None]).astype(np.float32), {
        "T0_s": T0 / SR, "fade_s": fade / SR}


def render_pair(audio_dir: Path, a: dict, b: dict, plan: dict, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    A = decode(audio_dir / f"{a['track']['id']}.mp3")
    B = decode(audio_dir / f"{b['track']['id']}.mp3")
    ga, gb = _match_gains(a, b) if (a.get("status") == "ok" and b.get("status") == "ok") else (1.0, 1.0)
    slug = _slug(plan)

    if plan["kind"] == "beatmatch":
        ca, cb, timeline = render_beatmatch(A, B, a, b, plan, ga, gb)
    elif plan["kind"] == "crossfade":
        ca, cb, timeline = render_plain(A, B, plan, ga, gb, equal_power=True)
    else:
        raise RenderError(f"unknown plan kind {plan['kind']!r}")
    mix, reduction = _limit(ca + cb)
    files = {"mix": out_dir / f"{slug}.dj.mp3"}
    write_mp3(files["mix"], mix)

    # naive reference: today's web player (linear fade over the last 8 s of the file, B from 0)
    naive_plan = {"fade_s": 8.0, "a_fade_start_s": max(0.0, len(A) / SR - 8.0), "b_start_s": 0.0}
    na, nb_, _ = render_plain(A, B, naive_plan, 1.0, 1.0, equal_power=False)
    naive, _ = _limit(na + nb_)
    files["naive"] = out_dir / f"{slug}.naive.mp3"
    write_mp3(files["naive"], naive)

    raw = timeline.pop("raw", None)
    if raw is not None:
        lo = max(0, int((timeline["B_start_s"] - 1.0) * SR))
        hi = int((timeline["end_s"] + 1.0) * SR)
        np.savez_compressed(out_dir / f"{slug}.stems.npz", a_raw=raw["a_raw"][lo:hi], b_raw=raw["b_raw"][lo:hi],
                            origin_s=lo / SR)
    meta = {**plan, "render": {"gain_a_db": round(20 * np.log10(ga), 2), "gain_b_db": round(20 * np.log10(gb), 2),
                               "limiter_max_reduction_db": round(reduction, 2), "timeline": timeline,
                               "files": {k: v.name for k, v in files.items()}}}
    (out_dir / f"{slug}.plan.json").write_text(json.dumps(meta, indent=1))
    return {"files": files, "meta": meta}
