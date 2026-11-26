"""Transition planner: ``beatmatch`` or ``crossfade`` for an ordered pair A -> B.

Every decision carries an explicit reason code. ``crossfade`` is a deliberate,
reported outcome (the player then uses its regular crossfade settings), never the
silent result of a swallowed error.
"""
from __future__ import annotations

import math

import numpy as np

from .analysis import grid_from_analysis, local_grid_stats, snap_down

MAX_SPEED_DEVIATION = 0.06  # A's tail may run at most +-6 % off its native tempo
MIN_LOCAL_GRID_CONF = 0.90  # share of beats within +-25 ms in the mix regions
MAX_REGION_RMS_RES_MS = 8.0  # above this the phase estimate was measured 8-30 ms off
MIN_PHASE_MARGIN = 5.0  # downbeat logit margin between best and 2nd-best bar phase
MAX_BARS = 16
MIN_BARS = 4
RAMP_BEATS = 4  # tempo ramp length (one bar) at the start of the overlap


def _crossfade(reason: str, detail: str) -> dict:
    return {"kind": "crossfade", "reason": reason, "detail": detail}


def _bar_time(an: dict, bar: int) -> float:
    times = an["bars"]["times"]
    if bar < len(times):
        return float(times[bar])
    return float(times[-1] + (bar - len(times) + 1) * (times[-1] - times[-2]))


def mix_grid(an: dict, t0: float, t1: float) -> dict:
    """Beat grid used for alignment in [t0, t1]: precise period + onset-anchored phase.

    period: the whole-track fit for constant-tempo tracks (hundreds of beats), else the
            local fit.
    phase:  median tracker phase in the window, shifted onto the percussive onsets when
            windows inside [t0, t1] have clear onsets; ``phase_source`` records which.
    """
    grid = grid_from_analysis(an)
    stats = local_grid_stats(grid, t0, t1)
    if stats["bpm"] is None:
        return stats
    tempo = an["tempo"]
    if tempo["grid_mode"] == "constant" and tempo["global_conf"] >= MIN_LOCAL_GRID_CONF:
        period, period_source = grid.period, "global"
    else:
        period, period_source = stats["period_s"], "local"
    sel = (grid.beats >= t0) & (grid.beats <= t1)
    offset_bt = float(np.median(grid.beats[sel] - grid.k[sel] * period))
    onsets = an["onsets"]
    wins = [w for w in onsets["windows"]
            if w["t1"] >= t0 and w["t0"] <= t1 and w["strength"] >= onsets["min_strength"]]
    weights = np.array([
        w["strength"] * max(0.0, min(w["t1"], t1) - max(w["t0"], t0)) / max(w["t1"] - w["t0"], 1e-9)
        for w in wins
    ])
    if wins and weights.sum() > 0:
        onset_ms = float(np.sum(weights * np.array([w["offset_ms"] for w in wins])) / weights.sum())
        phase_source = "onsets"
    else:
        onset_ms = 0.0
        phase_source = "beat_tracker"
    stats.update({
        "period_s": float(period), "bpm": round(60.0 / period, 4), "period_source": period_source,
        "offset_s": offset_bt + onset_ms / 1000, "onset_offset_ms": round(onset_ms, 2),
        "phase_source": phase_source,
    })
    return stats


def _tempo_multiplier(bpm_a: float, bpm_b: float) -> float:
    """Mixxx's half/double rule: x2 / x0.5 when the squared ratio leaves [0.5, 2]."""
    r = (bpm_b / bpm_a) ** 2
    if r < 0.5:
        return 2.0
    if r > 2.0:
        return 0.5
    return 1.0


def plan(a: dict, b: dict) -> dict:
    """``a``/``b`` are analysis records ({"status": "ok", ...} or {"status": "unsuitable"})."""
    for side, t in (("A", a), ("B", b)):
        if t["status"] != "ok":
            return _crossfade(f"{side}_NOT_ANALYSABLE", t["reason"])
        if t["meter"]["meter"] != 4:
            return _crossfade(f"{side}_NOT_4_4", f"meter {t['meter']['meter']}")
        if t["meter"]["phase_margin"] < MIN_PHASE_MARGIN:
            return _crossfade(f"{side}_AMBIGUOUS_DOWNBEAT",
                              f"phase margin {t['meter']['phase_margin']} < {MIN_PHASE_MARGIN}")

    ca, cb = a["cues"], b["cues"]
    # overlap length: B's intro must fit, A must have room before its audible end
    a_room = ca["outro_bars"] if ca["outro_bars"] >= 8 else 8
    bars = min(MAX_BARS, max(cb["intro_bars"], MIN_BARS), max(a_room, MIN_BARS))
    bars = max(MIN_BARS, bars - bars % 4)

    if ca["outro_bars"] >= 8:
        a_cue_bar, a_cue_kind = ca["outro_start_bar"], "outro_start"
    else:
        # no real outro (radio edit): mix over the last bars, on the section's 4-bar grid
        a_cue_bar = snap_down(ca["audible_end_bar"] - bars, ca["section_boundaries"])
        a_cue_kind = "last_bars"
    if a_cue_bar < ca["audible_start_bar"] + 8:
        return _crossfade("A_TOO_SHORT", f"cue bar {a_cue_bar} leaves no main part before it")
    b_cue_bar, b_cue_kind = cb["rise_bar"] - bars, "intro_before_rise"
    if b_cue_bar < cb["audible_start_bar"]:
        b_cue_bar, b_cue_kind = cb["audible_start_bar"], "audible_start"

    a_cue_s = _bar_time(a, a_cue_bar)
    b_cue_s = _bar_time(b, b_cue_bar)
    pa, pb = 60.0 / a["tempo"]["bpm"], 60.0 / b["tempo"]["bpm"]
    # A's region ends where A stops sounding: a hard radio-edit ending must not be
    # penalised for "missing" beats past its last bar
    a_end_s = _bar_time(a, ca["audible_end_bar"])
    a_reg = mix_grid(a, a_cue_s - 8 * pa, min(a_cue_s + (bars * 4 + 4) * pa, a_end_s))
    # B's phase only from the part of B that is actually heard against A
    b_reg = mix_grid(b, b_cue_s, b_cue_s + bars * 4 * pb)

    for side, reg in (("A", a_reg), ("B", b_reg)):
        if reg["bpm"] is None or reg["conf"] < MIN_LOCAL_GRID_CONF:
            return _crossfade(f"{side}_LOW_BEAT_CONF",
                              f"local grid conf {reg['conf']} < {MIN_LOCAL_GRID_CONF} ({reg['n_beats']} beats)")
        if reg["rms_res_ms"] > MAX_REGION_RMS_RES_MS:
            return _crossfade(f"{side}_LOW_BEAT_PRECISION",
                              f"beat jitter {reg['rms_res_ms']} ms rms > {MAX_REGION_RMS_RES_MS} ms")
    if a_reg["phase_source"] != b_reg["phase_source"]:
        # one side is anchored on its drum onsets, the other on raw tracker beats; those
        # references differ by tens of ms per track, so the result would flam
        return _crossfade("PHASE_REFERENCE_MISMATCH",
                          f"A phase from {a_reg['phase_source']}, B phase from {b_reg['phase_source']}")

    m = _tempo_multiplier(a_reg["bpm"], b_reg["bpm"])
    speed = m * b_reg["bpm"] / a_reg["bpm"]  # playback-rate factor for A's tail
    if abs(speed - 1) > MAX_SPEED_DEVIATION:
        return _crossfade("TEMPO_GAP", f"A would need {speed:.3f}x (limit +-{MAX_SPEED_DEVIATION:.0%}); "
                                       f"{a_reg['bpm']:.2f} vs {b_reg['bpm']:.2f} bpm")
    if m != 1.0:
        return _crossfade("HALF_DOUBLE_TEMPO",
                          f"needs x{m:g} beat mapping ({a_reg['bpm']:.2f} vs {b_reg['bpm']:.2f} bpm)")

    return {
        "kind": "beatmatch",
        "reason": "OK",
        "detail": f"{a_reg['bpm']:.2f} -> {b_reg['bpm']:.2f} bpm, A tail at {speed:.4f}x, {bars} bars",
        "bars": bars,
        "a": {"cue_bar": a_cue_bar, "cue_k": int(a["bars"]["k"][a_cue_bar]), "cue_kind": a_cue_kind,
              "region": a_reg},
        "b": {"cue_bar": b_cue_bar, "cue_k": int(b["bars"]["k"][b_cue_bar]), "cue_kind": b_cue_kind,
              "region": b_reg},
        "tempo": {"a_bpm": a_reg["bpm"], "b_bpm": b_reg["bpm"], "a_speed": round(speed, 6),
                  "ramp_beats": RAMP_BEATS, "semitones_if_unstretched": round(12 * math.log2(speed), 3)},
    }
