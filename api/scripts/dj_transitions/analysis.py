"""Per-track analysis: beats, downbeats, tempo grid, bars, phrases, energy, cue candidates.

Output is a JSON-serialisable dict. Anything that cannot be determined is reported
with an explicit status/reason - never filled with a guessed default.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.ndimage import maximum_filter1d
from scipy.signal import butter, sosfiltfilt

from audio import SR, decode, encoder_delay_info

ANALYSIS_VERSION = 1
FPS = 50  # Beat This! frame rate
CHECKPOINT = "final0"

GRID_TOL_S = 0.025      # a beat counts as "on grid" within +-25 ms of the fitted line
LOW_BAND_HZ = 150.0
PHRASE_BARS = 8


class AnalysisError(RuntimeError):
    pass


# --------------------------------------------------------------------------- model

_MODEL = None


def _model(device: str):
    global _MODEL
    if _MODEL is None:
        from beat_this.inference import Audio2Frames  # heavy import, only when analysing

        _MODEL = Audio2Frames(checkpoint_path=CHECKPOINT, device=device)
    return _MODEL


def _pick_peaks(logits: np.ndarray) -> np.ndarray:
    """Beat This! 'minimal' peak picking plus parabolic sub-frame refinement.

    Same rule as beat_this.model.postprocessor (local max within +-3 frames,
    logit > 0, adjacent duplicates removed), but returns fractional frame
    positions instead of whole 20 ms frames.
    """
    mp = maximum_filter1d(logits, size=7, mode="nearest")
    cand = np.flatnonzero((logits == mp) & (logits > 0))
    keep: list[int] = []
    for c in cand:
        if keep and c - keep[-1] <= 1:
            if logits[c] > logits[keep[-1]]:
                keep[-1] = c
            continue
        keep.append(int(c))
    out = np.empty(len(keep))
    for i, c in enumerate(keep):
        d = 0.0
        if 0 < c < len(logits) - 1:
            y0, y1, y2 = logits[c - 1], logits[c], logits[c + 1]
            denom = y0 - 2 * y1 + y2
            if denom < 0:
                d = float(np.clip(0.5 * (y0 - y2) / denom, -0.5, 0.5))
        out[i] = (c + d) / FPS
    return out


# --------------------------------------------------------------------------- grid


@dataclass
class Grid:
    beats: np.ndarray        # detected (refined) beat times, s
    k: np.ndarray            # integer grid index for every detected beat
    period: float            # global fitted beat period, s
    offset: float            # time of grid index 0, s
    residual: np.ndarray     # beats - (offset + k*period)

    def time_of(self, k: np.ndarray | float) -> np.ndarray:
        """Beat time for grid index k from the *local* detected beats.

        Uses the detected beat when present, otherwise linear interpolation in
        index space between neighbouring detected beats; outside the detected
        range it extrapolates with the global period.
        """
        k = np.asarray(k, dtype=float)
        t = np.interp(k, self.k, self.beats)
        lo, hi = self.k[0], self.k[-1]
        t = np.where(k < lo, self.beats[0] + (k - lo) * self.period, t)
        t = np.where(k > hi, self.beats[-1] + (k - hi) * self.period, t)
        return t


CONSTANT_TEMPO_MIN_CONF = 0.8


def _dedupe_on_index(beats: np.ndarray, k: np.ndarray, res: np.ndarray, period: float):
    """Keep one beat per grid index (smallest residual); drop off-grid extras.

    Beat This! sometimes tracks a section at double tempo (hi-hat 8ths in an
    intro). Those extra detections sit half a beat off the grid; they are dropped
    and counted, never allowed to shift the index of everything after them.
    """
    keep = np.abs(res) <= 0.25 * period
    order = np.lexsort((np.abs(res), k))
    seen = set()
    mask = np.zeros(len(beats), bool)
    for i in order:
        if keep[i] and k[i] not in seen:
            seen.add(int(k[i]))
            mask[i] = True
    return mask


def _fit_constant(beats: np.ndarray) -> tuple[float, float, np.ndarray, np.ndarray]:
    """Global constant-tempo fit by phase coherence, robust to gaps and extra beats."""
    p0 = float(np.median(np.diff(beats)))
    cands = p0 * (1 + np.linspace(-0.03, 0.03, 1201))
    phasors = np.exp(2j * np.pi * beats[None, :] / cands[:, None])
    coh = np.abs(phasors.mean(axis=1))
    period = float(cands[int(np.argmax(coh))])
    offset = float(np.angle(np.exp(2j * np.pi * beats / period).mean()) / (2 * np.pi) * period)
    for _ in range(4):  # least-squares refinement on inliers
        k = np.round((beats - offset) / period).astype(int)
        res = beats - (offset + k * period)
        inl = np.abs(res) < 0.04
        if inl.sum() < 16:
            break
        A = np.vstack([k[inl], np.ones(inl.sum())]).T
        (period, offset), *_ = np.linalg.lstsq(A, beats[inl], rcond=None)
    k = np.round((beats - offset) / period).astype(int)
    res = beats - (offset + k * period)
    return float(period), float(offset), k, res


def _fit_piecewise(beats: np.ndarray, period: float) -> np.ndarray:
    """Index assignment for drifting tempo: step through intervals, skipping half-beat extras."""
    k = np.zeros(len(beats), int)
    for i in range(1, len(beats)):
        ratio = (beats[i] - beats[i - 1]) / period
        k[i] = k[i - 1] + max(1, int(round(ratio)))
    return k


def fit_grid(beats: np.ndarray) -> Grid:
    if len(beats) < 32:
        raise AnalysisError(f"only {len(beats)} beats detected; need at least 32 for a tempo grid")
    period, offset, k, res = _fit_constant(beats)
    mask = _dedupe_on_index(beats, k, res, period)
    conf = float(np.mean(np.abs(res[mask]) < GRID_TOL_S)) * mask.sum() / len(beats)
    mode = "constant"
    if conf < CONSTANT_TEMPO_MIN_CONF:
        # tempo drifts (live drummer, rubato): indices from local intervals instead
        mode = "piecewise"
        ibi = np.diff(beats)
        regular = ibi > 0.75 * np.median(ibi)
        keep = np.concatenate([[True], regular])   # drop the second beat of a half-interval pair
        beats_kept = beats[keep]
        k_kept = _fit_piecewise(beats_kept, float(np.median(np.diff(beats_kept))))
        A = np.vstack([k_kept, np.ones(len(k_kept))]).T
        (period, offset), *_ = np.linalg.lstsq(A, beats_kept, rcond=None)
        g = Grid(beats=beats_kept, k=k_kept, period=float(period), offset=float(offset),
                 residual=beats_kept - (offset + k_kept * period))
        g.mode, g.n_dropped = mode, int((~keep).sum())
        return g
    g = Grid(beats=beats[mask], k=k[mask], period=period, offset=offset, residual=res[mask])
    g.mode, g.n_dropped = mode, int((~mask).sum())
    return g


def local_grid_stats(grid: Grid, t0: float, t1: float) -> dict:
    """Linear fit over the detected beats in [t0, t1]: local bpm and confidence."""
    sel = (grid.beats >= t0) & (grid.beats <= t1)
    n = int(sel.sum())
    expected = (t1 - t0) / grid.period
    if n < 8:
        return {"t0": t0, "t1": t1, "n_beats": n, "expected_beats": round(expected, 1),
                "bpm": None, "conf": 0.0, "max_abs_res_ms": None}
    k, b = grid.k[sel], grid.beats[sel]
    A = np.vstack([k, np.ones(n)]).T
    (p, o), *_ = np.linalg.lstsq(A, b, rcond=None)
    res = b - (o + k * p)
    on = float(np.mean(np.abs(res) < GRID_TOL_S))
    coverage = min(1.0, n / max(expected, 1.0))  # missing beats lower confidence too
    return {
        "t0": round(t0, 3), "t1": round(t1, 3), "n_beats": n, "expected_beats": round(expected, 1),
        "bpm": round(60.0 / p, 3), "period_s": float(p), "offset_s": float(o),
        "conf": round(on * coverage, 3),
        "rms_res_ms": round(float(np.sqrt(np.mean(res ** 2))) * 1000, 2),
        "max_abs_res_ms": round(float(np.max(np.abs(res))) * 1000, 2),
    }


def tempo_stability(grid: Grid, window_beats: int = 32) -> dict:
    bpms = []
    for start in range(0, len(grid.beats) - window_beats, window_beats // 2):
        k = grid.k[start:start + window_beats]
        b = grid.beats[start:start + window_beats]
        A = np.vstack([k, np.ones(len(k))]).T
        (p, _), *_ = np.linalg.lstsq(A, b, rcond=None)
        bpms.append(60.0 / p)
    if not bpms:
        raise AnalysisError("track too short for tempo-stability windows")
    bpms = np.array(bpms)
    med = float(np.median(bpms))
    spread = float((np.percentile(bpms, 95) - np.percentile(bpms, 5)) / med)
    return {"window_bpm_median": round(med, 3), "window_bpm_spread": round(spread, 4), "stable": spread < 0.02}


# --------------------------------------------------------------------------- meter


def fit_meter(grid: Grid, down_logits: np.ndarray) -> dict:
    """Meter (3 or 4) and downbeat phase from the downbeat activation at each beat.

    Uses the mean downbeat logit per (k mod meter) class rather than counting
    peak-picked downbeats: for some hip-hop the model fires on every 2nd beat, and
    the activation still tells the true bar start apart from the mid-bar beat.
    """
    at_beat = np.interp(grid.beats * FPS, np.arange(len(down_logits)), down_logits)
    best = None
    for meter in (3, 4):
        means = np.array([at_beat[grid.k % meter == p].mean() for p in range(meter)])
        order = np.argsort(means)[::-1]
        margin = float(means[order[0]] - means[order[1]])
        if best is None or margin > best["phase_margin"]:
            best = {"meter": meter, "phase": int(order[0]), "phase_margin": round(margin, 3),
                    "class_mean_logits": np.round(means, 2).tolist()}
    if best["phase_margin"] <= 0:
        raise AnalysisError("downbeat activation does not distinguish any bar phase")
    peaks = _pick_peaks(down_logits)
    on = 0
    for d in peaks:
        j = int(np.argmin(np.abs(grid.beats - d)))
        if abs(grid.beats[j] - d) <= 0.07 and grid.k[j] % best["meter"] == best["phase"]:
            on += 1
    best["downbeat_agreement"] = round(on / len(peaks), 3) if len(peaks) else 0.0
    best["conf"] = best["downbeat_agreement"]
    return best


# --------------------------------------------------------------------------- kick phase

KICK_HOP = 64              # 1.45 ms envelope resolution
KICK_SEARCH_MS = 60.0
KICK_MIN_STRENGTH = 1.5    # profile peak / profile mean; below this a window has no clear onsets


def _onset_envelope(audio: np.ndarray) -> np.ndarray:
    """Spectral flux (40 Hz-4 kHz, log magnitude), one value per 64-sample hop,
    re-centred so index i describes the audio around sample i*64.

    A first attempt used the RMS rise of the 40-150 Hz band at 1.45 ms hops; that
    follows the bass waveform's half-cycles rather than the attack and was off by up
    to 37 ms on hardstyle kicks, so the transition evaluation rejected it.
    """
    mono = audio.mean(axis=1)
    sos = butter(4, [40, 4000], btype="band", fs=SR, output="sos")
    mono = sosfiltfilt(sos, mono)
    from scipy.signal import stft

    _, _, Z = stft(mono, fs=SR, nperseg=1024, noverlap=1024 - KICK_HOP, boundary=None, padded=False)
    mag = np.log1p(100 * np.abs(Z))
    flux = np.concatenate([[0], np.maximum(0, np.diff(mag, axis=1)).sum(axis=0)])
    out = np.zeros(len(mono) // KICK_HOP)
    shift = 512 // KICK_HOP  # STFT frame i is centred at i*hop + nperseg/2
    n = min(len(flux), len(out) - shift)
    out[shift:shift + n] = flux[:n]
    return out


def kick_alignment(audio: np.ndarray, grid: Grid, window_beats: int = 16) -> dict:
    """Where the percussive onsets sit relative to Beat This!'s beats, per 8-bar window.

    Beat This! beats are 'perceptual' positions whose offset to the drum attack
    differs between tracks by tens of ms (measured: ~40 ms between R3HAB and Calvin
    Harris). Two tracks mixed on raw beat positions then flam; anchoring both grids
    on their onsets removes that. Method: average the onset envelope around every
    beat (beat-synchronous profile) and take the peak.
    """
    env = _onset_envelope(audio)
    hop_s = KICK_HOP / SR
    taus = np.arange(-KICK_SEARCH_MS, KICK_SEARCH_MS + 0.01, hop_s * 1000) / 1000

    def profile(beats: np.ndarray) -> np.ndarray:
        idx = (beats[:, None] + taus[None, :]) / hop_s
        idx = np.clip(np.round(idx).astype(int), 0, len(env) - 1)
        return env[idx].mean(axis=0)

    def peak(prof: np.ndarray) -> tuple[float, float]:
        i = int(np.argmax(prof))
        d = 0.0
        if 0 < i < len(prof) - 1:
            y0, y1, y2 = prof[i - 1], prof[i], prof[i + 1]
            den = y0 - 2 * y1 + y2
            if den < 0:
                d = 0.5 * (y0 - y2) / den
        strength = float(prof[i] / (prof.mean() + 1e-12))
        return float((taus[i] + d * hop_s) * 1000), strength

    g_off, g_str = peak(profile(grid.beats))
    windows = []
    for s in range(0, len(grid.beats) - window_beats // 2, window_beats):
        b = grid.beats[s:s + window_beats]
        off, st = peak(profile(b))
        windows.append({"t0": round(float(b[0]), 3), "t1": round(float(b[-1]), 3),
                        "offset_ms": round(off, 2), "strength": round(st, 2)})
    return {"global_offset_ms": round(g_off, 2), "global_strength": round(g_str, 2), "windows": windows,
            "min_strength": KICK_MIN_STRENGTH}


# --------------------------------------------------------------------------- bars / energy


def bar_features(audio: np.ndarray, bar_times: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mono = audio.mean(axis=1)
    sos = butter(4, LOW_BAND_HZ, btype="low", fs=SR, output="sos")
    low = sosfiltfilt(sos, mono)
    e_full, e_low = [], []
    for t0, t1 in zip(bar_times[:-1], bar_times[1:]):
        a, b = int(t0 * SR), int(t1 * SR)
        a, b = max(a, 0), min(b, len(mono))
        if b - a < SR // 10:
            e_full.append(-120.0)
            e_low.append(-120.0)
            continue
        e_full.append(10 * np.log10(np.mean(mono[a:b] ** 2) + 1e-12))
        e_low.append(10 * np.log10(np.mean(low[a:b] ** 2) + 1e-12))
    return np.array(e_full), np.array(e_low)


SECTION_MIN_NOVELTY_DB = 4.0   # full-band + low-band energy step that counts as a section change
LOUD_MARGIN_DB = 3.0           # "main part" = within this of the track's loud level


def section_boundaries(e_full: np.ndarray, e_low: np.ndarray) -> tuple[list[int], np.ndarray]:
    """Bars where the arrangement changes (energy steps), found as novelty peaks.

    Pop songs do not keep a strict global 8-bar phase (2-bar fills, pickups), so
    cue points are anchored on these real boundaries instead of a global grid.
    """
    nb = len(e_full)
    nov = np.zeros(nb)
    w = 2
    for b in range(w, nb - w):
        nov[b] = abs(e_full[b:b + w].mean() - e_full[b - w:b].mean()) + abs(e_low[b:b + w].mean() - e_low[b - w:b].mean())
    peaks = [b for b in range(1, nb - 1)
             if nov[b] >= SECTION_MIN_NOVELTY_DB and nov[b] == nov[max(0, b - 2):b + 3].max()]
    return peaks, nov


def phrase_phase(boundaries: list[int], nov: np.ndarray) -> dict:
    """Dominant phrase phase (bar index mod 8) voted by boundary strength - informational."""
    if not boundaries:
        return {"phase": None, "conf": 0.0}
    votes = np.zeros(PHRASE_BARS)
    for b in boundaries:
        votes[b % PHRASE_BARS] += nov[b]
    p = int(np.argmax(votes))
    # share of boundary strength that sits on the 4-bar grid of that phase
    on4 = sum(nov[b] for b in boundaries if (b - p) % 4 == 0) / sum(nov[b] for b in boundaries)
    return {"phase": p, "conf": round(float(on4), 3)}


# --------------------------------------------------------------------------- cues


def _snap_down(target: int, anchors: list[int], step: int = 4) -> int:
    """Largest bar <= target lying on a `step`-bar grid anchored at the last anchor <= target."""
    prior = [a for a in anchors if a <= target]
    anchor = prior[-1] if prior else 0
    return anchor + step * ((target - anchor) // step)


def cue_points(e_full: np.ndarray, boundaries: list[int]) -> dict:
    nb = len(e_full)
    loud_peak = e_full.max()
    audible = np.flatnonzero(e_full > loud_peak - 30)
    if len(audible) == 0:
        raise AnalysisError("no audible bars")
    start_bar, end_bar = int(audible[0]), int(audible[-1]) + 1  # end exclusive
    loud = float(np.percentile(e_full[start_bar:end_bar], 80))
    main = e_full >= loud - LOUD_MARGIN_DB
    anchors = sorted(set([start_bar] + [b for b in boundaries if start_bar < b < end_bar]))

    # ---- outgoing side: where does the outro (sustained below-main energy) start?
    last_main = int(np.flatnonzero(main[:end_bar])[-1])
    outro_start = _snap_down(last_main + 1, anchors) if last_main + 1 < end_bar else end_bar
    # the snap may move us back into the main part; step forward to the first 4-bar slot after last_main
    while outro_start <= last_main:
        outro_start += 4
    outro_bars = max(0, end_bar - outro_start)

    # ---- incoming side: first section boundary where the main part begins
    rise_bar = None
    for b in anchors[1:]:
        if e_full[b:b + 4].mean() >= loud - LOUD_MARGIN_DB:
            rise_bar = b
            break
    if rise_bar is None:
        first_main = int(np.flatnonzero(main[start_bar:])[0]) + start_bar
        rise_bar = first_main
    intro_bars = rise_bar - start_bar

    return {
        "audible_start_bar": start_bar,
        "audible_end_bar": end_bar,
        "loud_level_db": round(loud, 2),
        "section_boundaries": anchors,
        "outro_start_bar": int(outro_start),
        "outro_bars": int(outro_bars),
        "rise_bar": int(rise_bar),
        "intro_bars": int(intro_bars),
    }


# --------------------------------------------------------------------------- entry


def analyze(path: Path, device: str) -> dict:
    t_start = time.perf_counter()
    audio = decode(path)
    t_decoded = time.perf_counter()
    import torch

    beat_logits, down_logits = _model(device)(audio, SR)
    if device == "mps":
        torch.mps.synchronize()
    beat_logits = beat_logits.cpu().numpy().astype(np.float64)
    down_logits = down_logits.cpu().numpy().astype(np.float64)
    t_model = time.perf_counter()

    beats = _pick_peaks(beat_logits)
    grid = fit_grid(beats)
    meter = fit_meter(grid, down_logits)
    stability = tempo_stability(grid)
    kick = kick_alignment(audio, grid)

    m, ph = meter["meter"], meter["phase"]
    k_first = int(np.ceil((grid.k[0] - ph) / m) * m + ph)
    k_last_detected = int(grid.k[-1])
    bar_k = np.arange(k_first, k_last_detected + m + 1, m)
    bar_times = grid.time_of(bar_k)
    duration = len(audio) / SR
    bar_times = bar_times[bar_times <= duration]
    bar_k = bar_k[: len(bar_times)]
    e_full, e_low = bar_features(audio, bar_times)
    boundaries, nov = section_boundaries(e_full, e_low)
    phrase = phrase_phase(boundaries, nov)
    cues = cue_points(e_full, boundaries)
    t_end = time.perf_counter()

    return {
        "analysis_version": ANALYSIS_VERSION,
        "analyzer": f"beat_this-1.1.0/{CHECKPOINT}+subframe-peaks; ffmpeg decode",
        "status": "ok",
        "file": path.name,
        "duration_s": round(duration, 3),
        "decode": encoder_delay_info(path),
        "timing_s": {"decode": round(t_decoded - t_start, 2), "model": round(t_model - t_decoded, 2),
                     "post": round(t_end - t_model, 2), "device": device},
        "tempo": {
            "bpm": round(60.0 / grid.period, 3),
            "global_conf": round(float(np.mean(np.abs(grid.residual) < GRID_TOL_S)), 3),
            "grid_mode": grid.mode,
            "dropped_offgrid_beats": grid.n_dropped,
            **stability,
        },
        "meter": meter,
        "kick": kick,
        "phrase": {"phase_bar": phrase["phase"], "conf": phrase["conf"], "bars": PHRASE_BARS},
        "beats": {"times": np.round(grid.beats, 4).tolist(), "k": grid.k.tolist()},
        "bars": {
            "k": bar_k.tolist(),
            "times": np.round(bar_times, 4).tolist(),
            "energy_db": np.round(e_full, 2).tolist(),
            "low_db": np.round(e_low, 2).tolist(),
        },
        "cues": cues,
    }


def grid_from_analysis(a: dict) -> Grid:
    beats = np.array(a["beats"]["times"])
    k = np.array(a["beats"]["k"])
    period = 60.0 / a["tempo"]["bpm"]
    A = np.vstack([k, np.ones(len(k))]).T
    (p, o), *_ = np.linalg.lstsq(A, beats, rcond=None)
    return Grid(beats=beats, k=k, period=period, offset=float(o), residual=beats - (o + k * p))
