"""Transition planner: decide beatmatch vs. plain crossfade for an ordered pair (A -> B).

Every decision carries an explicit reason. A plain crossfade is a deliberate,
reported outcome of `plan()`, never the silent result of a swallowed error.

Model of playback this plans for (mirrors the proposed Android design):
  * A plays at 1.0x until its cue-out downbeat (where the single player clips A).
  * B starts there at 1.0x (it is the "real" current item from then on).
  * A's tail is decoded separately and time-stretched so its beats ride on B's grid;
    the tempo ramps from 1.0 to the target over the first bar of the overlap.
"""

from __future__ import annotations

import math

import numpy as np

from analysis import grid_from_analysis, local_grid_stats

MAX_SPEED_DEVIATION = 0.06    # A's tail may run at most +-6 % off its native tempo
MIN_LOCAL_GRID_CONF = 0.90    # share of beats within +-25 ms in the mix regions
MAX_REGION_RMS_RES_MS = 8.0  # beat-tracker jitter in the mix region; above this the phase estimate
                              # was measured to be off by 8-30 ms (Tiësto intro, Nico Moreno intro)
MIN_PHASE_MARGIN = 5.0       # downbeat logit margin between best and 2nd-best bar phase
MAX_BARS = 16
MIN_BARS = 4
RAMP_BEATS = 4                # tempo ramp length (one bar) at the start of the overlap
PLAIN_FADE_S = 8.0


def _label(a: dict) -> str:
    return f"{a['track']['artist']} - {a['track']['title']}"


def _plain(a: dict, b: dict, reason: str, detail: str) -> dict:
    out = {"kind": "crossfade", "reason": reason, "detail": detail,
           "a": {"id": a["track"]["id"], "label": _label(a)},
           "b": {"id": b["track"]["id"], "label": _label(b)},
           "fade_s": PLAIN_FADE_S}
    if a.get("status") == "ok":
        bars = a["bars"]["times"]
        end_bar = a["cues"]["audible_end_bar"]
        a_end = bars[end_bar] if end_bar < len(bars) else a["duration_s"]
        out["a_fade_start_s"] = round(max(0.0, a_end - PLAIN_FADE_S), 3)
    else:
        out["a_fade_start_s"] = round(max(0.0, a.get("duration_s", 0) - PLAIN_FADE_S), 3) if a.get("duration_s") else None
    if b.get("status") == "ok":
        out["b_start_s"] = b["bars"]["times"][b["cues"]["audible_start_bar"]]
    else:
        out["b_start_s"] = 0.0
    return out


def _bar_time(a: dict, bar: int) -> float:
    times = a["bars"]["times"]
    if bar < len(times):
        return times[bar]
    # beyond the last full bar: extrapolate with the bar length
    return times[-1] + (bar - len(times) + 1) * (times[-1] - times[-2])


def mix_grid(an: dict, t0: float, t1: float) -> dict:
    """Beat grid used for alignment in [t0, t1]: precise period + kick-anchored phase.

    period: the whole-track fit for constant-tempo tracks (hundreds of beats, far
            more precise than a 40-beat window), else the local fit.
    phase:  median beat-tracker phase in the window, shifted onto the kick onsets
            when the window has a clear kick; which one was used is recorded.
    """
    grid = grid_from_analysis(an)
    stats = local_grid_stats(grid, t0, t1)
    if stats["bpm"] is None:
        return stats
    t = an["tempo"]
    if t["grid_mode"] == "constant" and t["global_conf"] >= MIN_LOCAL_GRID_CONF:
        A = np.vstack([grid.k, np.ones(len(grid.k))]).T
        (period, _), *_ = np.linalg.lstsq(A, grid.beats, rcond=None)
        period_source = "global"
    else:
        period, period_source = stats["period_s"], "local"
    sel = (grid.beats >= t0) & (grid.beats <= t1)
    offset_bt = float(np.median(grid.beats[sel] - grid.k[sel] * period))
    kick = an["kick"]
    wins = [w for w in kick["windows"] if w["t1"] >= t0 and w["t0"] <= t1 and w["strength"] >= kick["min_strength"]]
    if wins:
        # weight = onset clarity x how much of the window lies inside the mix region
        wts = np.array([w["strength"] * max(0.0, min(w["t1"], t1) - max(w["t0"], t0)) / (w["t1"] - w["t0"])
                        for w in wins])
        if wts.sum() <= 0:
            raise ValueError("onset windows overlap the region with zero length")
        kick_ms = float(np.sum(wts * np.array([w["offset_ms"] for w in wins])) / wts.sum())
        phase_source = "kick"
    else:
        kick_ms = 0.0
        phase_source = "beat_tracker (no clear kick in window)"
    stats.update({"period_s": float(period), "bpm": round(60.0 / period, 4), "period_source": period_source,
                  "offset_s": offset_bt + kick_ms / 1000, "kick_offset_ms": round(kick_ms, 2),
                  "phase_source": phase_source})
    return stats


def _tempo_multiplier(bpm_a: float, bpm_b: float) -> float:
    """Mixxx's half/double rule: pick x2 / x0.5 when the squared ratio leaves [0.5, 2]."""
    r = (bpm_b / bpm_a) ** 2
    if r < 0.5:
        return 2.0
    if r > 2.0:
        return 0.5
    return 1.0


def plan(a: dict, b: dict) -> dict:
    for side, t in (("A", a), ("B", b)):
        if t.get("status") != "ok":
            return _plain(a, b, f"{side}_NOT_ANALYSABLE", t.get("reason", t.get("status", "missing")))
        if t["meter"]["meter"] != 4:
            return _plain(a, b, f"{side}_NOT_4_4", f"meter {t['meter']['meter']}")
        if t["meter"]["phase_margin"] < MIN_PHASE_MARGIN:
            return _plain(a, b, f"{side}_AMBIGUOUS_DOWNBEAT", f"phase margin {t['meter']['phase_margin']} < {MIN_PHASE_MARGIN}")

    ca, cb = a["cues"], b["cues"]
    # ---- overlap length: B's intro must fit, A must have room before its audible end
    a_room = ca["audible_end_bar"] - ca["outro_start_bar"] if ca["outro_bars"] >= 8 else 8
    bars = min(MAX_BARS, max(cb["intro_bars"], MIN_BARS), max(a_room, MIN_BARS))
    bars = max(MIN_BARS, bars - bars % 4)

    if ca["outro_bars"] >= 8:
        a_cue_bar = ca["outro_start_bar"]
        a_cue_kind = "outro_start"
    else:
        # no real outro (radio edit): mix over the last bars, on the section's 4-bar grid
        from analysis import _snap_down

        a_cue_bar = _snap_down(ca["audible_end_bar"] - bars, ca["section_boundaries"])
        a_cue_kind = "last_bars"
    b_cue_bar = cb["rise_bar"] - bars
    b_cue_kind = "intro_before_rise"
    if b_cue_bar < cb["audible_start_bar"]:
        b_cue_bar = cb["audible_start_bar"]
        b_cue_kind = "audible_start"

    a_cue_s = _bar_time(a, a_cue_bar)
    b_cue_s = _bar_time(b, b_cue_bar)

    # ---- local grids where the mix actually happens
    pa, pb = 60.0 / a["tempo"]["bpm"], 60.0 / b["tempo"]["bpm"]
    # A's region ends where A stops sounding: a radio edit that ends hard right after
    # the overlap must not be penalised for "missing" beats past its last bar
    a_end_s = _bar_time(a, ca["audible_end_bar"])
    a_reg = mix_grid(a, a_cue_s - 8 * pa, min(a_cue_s + (bars * 4 + 4) * pa, a_end_s))
    b_reg = mix_grid(b, b_cue_s, b_cue_s + (bars * 4 + 8) * pb)
    base = {
        "a": {"id": a["track"]["id"], "label": _label(a), "cue_bar": a_cue_bar, "cue_s": round(a_cue_s, 4),
              "cue_kind": a_cue_kind, "region": a_reg},
        "b": {"id": b["track"]["id"], "label": _label(b), "cue_bar": b_cue_bar, "cue_s": round(b_cue_s, 4),
              "cue_kind": b_cue_kind, "region": b_reg},
        "bars": bars,
    }
    for side, reg in (("A", a_reg), ("B", b_reg)):
        reason = None
        if reg["bpm"] is None or reg["conf"] < MIN_LOCAL_GRID_CONF:
            reason = (f"{side}_LOW_BEAT_CONF", f"local grid conf {reg['conf']} < {MIN_LOCAL_GRID_CONF} ({reg['n_beats']} beats)")
        elif reg["rms_res_ms"] > MAX_REGION_RMS_RES_MS:
            reason = (f"{side}_LOW_BEAT_PRECISION", f"beat jitter {reg['rms_res_ms']} ms rms > {MAX_REGION_RMS_RES_MS} ms")
        if reason:
            p = _plain(a, b, *reason)
            p.update({k: v for k, v in base.items() if k not in ("a", "b")})
            p["a"].update(base["a"])
            p["b"].update(base["b"])
            return p

    m = _tempo_multiplier(a_reg["bpm"], b_reg["bpm"])
    speed = m * b_reg["bpm"] / a_reg["bpm"]  # playback-rate factor for A's tail
    if abs(speed - 1) > MAX_SPEED_DEVIATION:
        p = _plain(a, b, "TEMPO_GAP", f"A would need {speed:.3f}x (limit +-{MAX_SPEED_DEVIATION:.0%}); "
                                      f"{a_reg['bpm']:.2f} vs {b_reg['bpm']:.2f} bpm (x{m:g})")
        p["a"].update(base["a"])
        p["b"].update(base["b"])
        return p
    if m != 1.0:
        # half/double mapping changes what a bar means; not supported by the renderer yet
        p = _plain(a, b, "HALF_DOUBLE_TEMPO", f"needs x{m:g} beat mapping ({a_reg['bpm']:.2f} vs {b_reg['bpm']:.2f} bpm)")
        p["a"].update(base["a"])
        p["b"].update(base["b"])
        return p

    return {
        "kind": "beatmatch",
        "reason": "OK",
        "detail": f"{a_reg['bpm']:.2f} -> {b_reg['bpm']:.2f} bpm, A tail at {speed:.4f}x, {bars} bars",
        **base,
        "tempo": {"a_bpm": a_reg["bpm"], "b_bpm": b_reg["bpm"], "multiplier": m, "a_speed": round(speed, 6),
                  "ramp_beats": RAMP_BEATS, "semitone_equiv_if_unstretched": round(12 * math.log2(speed), 3)},
    }
