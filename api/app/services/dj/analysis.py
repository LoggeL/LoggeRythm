"""Per-track DJ analysis from Beat This! activations: tempo grid, meter, onset phase,
bars, sections and cue points.

Pure numpy/scipy - the model itself lives in ``model.py`` and only runs in the worker
subprocess. Anything that cannot be determined raises ``AnalysisError`` with the
reason; the caller records the track as ``unsuitable`` with that reason instead of
inventing values.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import maximum_filter1d
from scipy.signal import butter, sosfiltfilt, stft

from .audio import SR

ANALYSIS_VERSION = 2
FPS = 50  # Beat This! frame rate

GRID_TOL_S = 0.025  # a beat is "on grid" within +-25 ms of the fitted line
LOW_BAND_HZ = 150.0
CONSTANT_TEMPO_MIN_CONF = 0.8
MIN_BEATS = 32


class AnalysisError(RuntimeError):
    """The track cannot be analysed for beat-matched mixing (reason in the message)."""


# --------------------------------------------------------------------------- peaks


def pick_peaks(logits: np.ndarray) -> np.ndarray:
    """Beat This! 'minimal' peak picking (local max within +-3 frames, logit > 0,
    adjacent duplicates merged) with parabolic sub-frame refinement. Returns seconds."""
    mp = maximum_filter1d(logits, size=7, mode="nearest")
    cand = np.flatnonzero((logits == mp) & (logits > 0))
    keep: list[int] = []
    for c in cand:
        if keep and c - keep[-1] <= 1:
            if logits[c] > logits[keep[-1]]:
                keep[-1] = int(c)
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
    beats: np.ndarray  # kept beat times, s
    k: np.ndarray  # integer grid index of every kept beat
    period: float  # fitted beat period, s
    offset: float  # time of grid index 0, s
    mode: str = "constant"
    n_dropped: int = 0
    residual: np.ndarray = field(default_factory=lambda: np.zeros(0))

    def time_of(self, k) -> np.ndarray:
        """Beat time for grid index k: detected beat or interpolation between detected
        neighbours; outside the detected range, extrapolated with the period."""
        k = np.asarray(k, dtype=float)
        t = np.interp(k, self.k, self.beats)
        lo, hi = self.k[0], self.k[-1]
        t = np.where(k < lo, self.beats[0] + (k - lo) * self.period, t)
        t = np.where(k > hi, self.beats[-1] + (k - hi) * self.period, t)
        return t


def _dedupe_on_index(k: np.ndarray, res: np.ndarray, period: float) -> np.ndarray:
    """Keep one beat per grid index (smallest residual); drop off-grid extras such as
    half-beat detections when Beat This! follows a hi-hat at double tempo."""
    near = np.abs(res) <= 0.25 * period
    order = np.lexsort((np.abs(res), k))
    seen: set[int] = set()
    mask = np.zeros(len(k), bool)
    for i in order:
        if near[i] and int(k[i]) not in seen:
            seen.add(int(k[i]))
            mask[i] = True
    return mask


def _fit_constant(beats: np.ndarray) -> tuple[float, float, np.ndarray, np.ndarray]:
    """Global constant-tempo fit by phase coherence, robust to gaps and extra beats."""
    p0 = float(np.median(np.diff(beats)))
    cands = p0 * (1 + np.linspace(-0.03, 0.03, 1201))
    coh = np.abs(np.exp(2j * np.pi * beats[None, :] / cands[:, None]).mean(axis=1))
    period = float(cands[int(np.argmax(coh))])
    offset = float(np.angle(np.exp(2j * np.pi * beats / period).mean()) / (2 * np.pi) * period)
    for _ in range(4):  # least-squares refinement on inliers
        k = np.round((beats - offset) / period).astype(int)
        res = beats - (offset + k * period)
        inl = np.abs(res) < 0.04
        if inl.sum() < 16:
            break
        design = np.vstack([k[inl], np.ones(int(inl.sum()))]).T
        (period, offset), *_ = np.linalg.lstsq(design, beats[inl], rcond=None)
    k = np.round((beats - offset) / period).astype(int)
    return float(period), float(offset), k, beats - (offset + k * period)


def _drop_short_intervals(beats: np.ndarray) -> np.ndarray:
    """Greedy filter for drifting tempo: keep a beat only if it is at least 0.75 of the
    median interval after the last *kept* beat. Comparing against the last kept beat
    (not the raw predecessor) keeps the real beat that follows a spurious extra and
    keeps every real beat inside a double-tempo run."""
    med = float(np.median(np.diff(beats)))
    keep = np.zeros(len(beats), bool)
    keep[0] = True
    last = beats[0]
    for i in range(1, len(beats)):
        if beats[i] - last > 0.75 * med:
            keep[i] = True
            last = beats[i]
    # a double-tempo run halves the median; re-run with the median of the kept beats
    med2 = float(np.median(np.diff(beats[keep])))
    if med2 > 1.5 * med:
        keep[:] = False
        keep[0] = True
        last = beats[0]
        for i in range(1, len(beats)):
            if beats[i] - last > 0.75 * med2:
                keep[i] = True
                last = beats[i]
    return keep


def _piecewise_indices(beats: np.ndarray, period: float) -> np.ndarray:
    k = np.zeros(len(beats), int)
    for i in range(1, len(beats)):
        k[i] = k[i - 1] + max(1, int(round((beats[i] - beats[i - 1]) / period)))
    return k


def fit_grid(beats: np.ndarray) -> Grid:
    if len(beats) < MIN_BEATS:
        raise AnalysisError(f"only {len(beats)} beats detected; need at least {MIN_BEATS}")
    period, offset, k, res = _fit_constant(beats)
    mask = _dedupe_on_index(k, res, period)
    kept_k = k[mask]
    on_grid = float(np.mean(np.abs(res[mask]) < GRID_TOL_S))
    # coverage: kept beats vs grid slots between first and last kept beat. Off-grid
    # extras (double-tempo intros) are dropped by the dedupe and must not count against
    # the fit, so they are not part of this ratio.
    coverage = len(kept_k) / float(kept_k[-1] - kept_k[0] + 1)
    conf = on_grid * coverage
    if conf >= CONSTANT_TEMPO_MIN_CONF:
        return Grid(beats=beats[mask], k=kept_k, period=period, offset=offset,
                    mode="constant", n_dropped=int((~mask).sum()), residual=res[mask])
    # tempo drifts (live drummer, rubato): indices from local intervals instead
    keep = _drop_short_intervals(beats)
    kept = beats[keep]
    k_kept = _piecewise_indices(kept, float(np.median(np.diff(kept))))
    design = np.vstack([k_kept, np.ones(len(k_kept))]).T
    (p, o), *_ = np.linalg.lstsq(design, kept, rcond=None)
    return Grid(beats=kept, k=k_kept, period=float(p), offset=float(o), mode="piecewise",
                n_dropped=int((~keep).sum()), residual=kept - (o + k_kept * p))


def local_grid_stats(grid: Grid, t0: float, t1: float) -> dict:
    """Linear fit over the detected beats in [t0, t1]: local bpm, confidence, jitter."""
    sel = (grid.beats >= t0) & (grid.beats <= t1)
    n = int(sel.sum())
    expected = (t1 - t0) / grid.period
    if n < 8:
        return {"t0": t0, "t1": t1, "n_beats": n, "expected_beats": round(expected, 1),
                "bpm": None, "conf": 0.0}
    k, b = grid.k[sel], grid.beats[sel]
    design = np.vstack([k, np.ones(n)]).T
    (p, o), *_ = np.linalg.lstsq(design, b, rcond=None)
    res = b - (o + k * p)
    on = float(np.mean(np.abs(res) < GRID_TOL_S))
    coverage = min(1.0, n / max(expected, 1.0))
    return {
        "t0": round(t0, 3), "t1": round(t1, 3), "n_beats": n, "expected_beats": round(expected, 1),
        "bpm": round(60.0 / p, 3), "period_s": float(p), "offset_s": float(o),
        "conf": round(on * coverage, 3),
        "rms_res_ms": round(float(np.sqrt(np.mean(res ** 2))) * 1000, 2),
        "max_abs_res_ms": round(float(np.max(np.abs(res))) * 1000, 2),
    }


def tempo_stability(grid: Grid, window_beats: int = 32) -> dict:
    bpms = []
    for s in range(0, len(grid.beats) - window_beats, window_beats // 2):
        k = grid.k[s:s + window_beats]
        b = grid.beats[s:s + window_beats]
        (p, _), *_ = np.linalg.lstsq(np.vstack([k, np.ones(len(k))]).T, b, rcond=None)
        bpms.append(60.0 / p)
    if not bpms:
        raise AnalysisError("track too short for tempo-stability windows")
    arr = np.array(bpms)
    med = float(np.median(arr))
    spread = float((np.percentile(arr, 95) - np.percentile(arr, 5)) / med)
    return {"window_bpm_median": round(med, 3), "window_bpm_spread": round(spread, 4),
            "stable": spread < 0.02}


# --------------------------------------------------------------------------- meter


def fit_meter(grid: Grid, down_logits: np.ndarray) -> dict:
    """Meter (3 or 4) and downbeat phase from the mean downbeat logit per beat class.

    Class means instead of counting picked downbeats: for some hip-hop the model fires
    on every second beat, and the activation still separates the bar start."""
    at_beat = np.interp(grid.beats * FPS, np.arange(len(down_logits)), down_logits)
    best: dict | None = None
    for meter in (3, 4):
        means = np.array([at_beat[grid.k % meter == p].mean() for p in range(meter)])
        order = np.argsort(means)[::-1]
        margin = float(means[order[0]] - means[order[1]])
        if best is None or margin > best["phase_margin"]:
            best = {"meter": meter, "phase": int(order[0]), "phase_margin": round(margin, 3)}
    assert best is not None
    if best["phase_margin"] <= 0:
        raise AnalysisError("downbeat activation does not distinguish any bar phase")
    return best


# --------------------------------------------------------------------------- onset phase

ONSET_HOP = 64  # 1.45 ms envelope resolution
ONSET_SEARCH_MS = 60.0
ONSET_MIN_STRENGTH = 1.5  # profile peak / mean; below this a window has no clear onsets
ONSET_WINDOW_BEATS = 16


def _onset_envelope(audio: np.ndarray) -> np.ndarray:
    """Spectral flux (40 Hz-4 kHz, log magnitude), one value per 64-sample hop,
    re-centred so index i describes the audio around sample i*64."""
    mono = audio.mean(axis=1)
    mono = sosfiltfilt(butter(4, [40, 4000], btype="band", fs=SR, output="sos"), mono)
    _, _, z = stft(mono, fs=SR, nperseg=1024, noverlap=1024 - ONSET_HOP, boundary=None, padded=False)
    mag = np.log1p(100 * np.abs(z))
    flux = np.concatenate([[0], np.maximum(0, np.diff(mag, axis=1)).sum(axis=0)])
    out = np.zeros(len(mono) // ONSET_HOP)
    shift = 512 // ONSET_HOP  # STFT frame i is centred at i*hop + nperseg/2
    n = min(len(flux), len(out) - shift)
    out[shift:shift + n] = flux[:n]
    return out


def onset_alignment(audio: np.ndarray, grid: Grid) -> dict:
    """Where the percussive onsets sit relative to the tracker's beats, per 4-bar window.

    Beat This! beats are perceptual positions whose offset to the drum attack differs
    between tracks by tens of ms (R3HAB vs Calvin Harris: ~40 ms). Mixing on raw beat
    positions would flam; anchoring both grids on their onsets removes that."""
    env = _onset_envelope(audio)
    hop_s = ONSET_HOP / SR
    taus = np.arange(-ONSET_SEARCH_MS, ONSET_SEARCH_MS + 0.01, hop_s * 1000) / 1000

    def profile(beats: np.ndarray) -> np.ndarray:
        idx = np.round((beats[:, None] + taus[None, :]) / hop_s).astype(int)
        return env[np.clip(idx, 0, len(env) - 1)].mean(axis=0)

    def peak(prof: np.ndarray) -> tuple[float, float]:
        i = int(np.argmax(prof))
        d = 0.0
        if 0 < i < len(prof) - 1:
            y0, y1, y2 = prof[i - 1], prof[i], prof[i + 1]
            den = y0 - 2 * y1 + y2
            if den < 0:
                d = 0.5 * (y0 - y2) / den
        return float((taus[i] + d * hop_s) * 1000), float(prof[i] / (prof.mean() + 1e-12))

    windows = []
    w = ONSET_WINDOW_BEATS
    for s in range(0, len(grid.beats) - w // 2, w):
        b = grid.beats[s:s + w]
        off, strength = peak(profile(b))
        windows.append({"t0": round(float(b[0]), 3), "t1": round(float(b[-1]), 3),
                        "offset_ms": round(off, 2), "strength": round(strength, 2)})
    return {"windows": windows, "min_strength": ONSET_MIN_STRENGTH}


# --------------------------------------------------------------------------- bars / sections

SECTION_MIN_NOVELTY_DB = 4.0
LOUD_MARGIN_DB = 3.0


def bar_energy(audio: np.ndarray, bar_times: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mono = audio.mean(axis=1)
    low = sosfiltfilt(butter(4, LOW_BAND_HZ, btype="low", fs=SR, output="sos"), mono)
    e_full, e_low = [], []
    for t0, t1 in zip(bar_times[:-1], bar_times[1:]):
        a, b = max(int(t0 * SR), 0), min(int(t1 * SR), len(mono))
        if b - a < SR // 10:
            e_full.append(-120.0)
            e_low.append(-120.0)
            continue
        e_full.append(10 * np.log10(np.mean(mono[a:b] ** 2) + 1e-12))
        e_low.append(10 * np.log10(np.mean(low[a:b] ** 2) + 1e-12))
    return np.array(e_full), np.array(e_low)


def section_boundaries(e_full: np.ndarray, e_low: np.ndarray) -> list[int]:
    """Bars where the arrangement changes (2-bar energy steps), as novelty peaks.
    Pop songs have 2-bar fills and pickups, so cues anchor on real boundaries rather
    than on a global 8-bar grid."""
    nb = len(e_full)
    nov = np.zeros(nb)
    for b in range(2, nb - 2):
        nov[b] = (abs(e_full[b:b + 2].mean() - e_full[b - 2:b].mean())
                  + abs(e_low[b:b + 2].mean() - e_low[b - 2:b].mean()))
    return [b for b in range(1, nb - 1)
            if nov[b] >= SECTION_MIN_NOVELTY_DB and nov[b] == nov[max(0, b - 2):b + 3].max()]


def snap_down(target: int, anchors: list[int], step: int = 4) -> int:
    """Largest bar <= target on a `step`-bar grid anchored at the last anchor <= target."""
    prior = [a for a in anchors if a <= target]
    anchor = prior[-1] if prior else 0
    return anchor + step * ((target - anchor) // step)


def cue_points(e_full: np.ndarray, boundaries: list[int]) -> dict:
    audible = np.flatnonzero(e_full > e_full.max() - 30)
    if len(audible) == 0:
        raise AnalysisError("no audible bars")
    start_bar, end_bar = int(audible[0]), int(audible[-1]) + 1  # end exclusive
    loud = float(np.percentile(e_full[start_bar:end_bar], 80))
    main = e_full >= loud - LOUD_MARGIN_DB
    anchors = sorted(set([start_bar] + [b for b in boundaries if start_bar < b < end_bar]))

    # outgoing side: where the outro (sustained below-main energy) starts
    last_main = int(np.flatnonzero(main[:end_bar])[-1])
    if last_main + 1 < end_bar:
        outro_start = snap_down(last_main + 1, anchors)
        # the snap may land inside the main part; step to the first 4-bar slot after it
        while outro_start <= last_main:
            outro_start += 4
        outro_start = min(outro_start, end_bar)
    else:
        outro_start = end_bar
    outro_bars = end_bar - outro_start

    # incoming side: first section (including the very first one) where the main part runs
    rise_bar = None
    for b in anchors:
        if e_full[b:b + 4].mean() >= loud - LOUD_MARGIN_DB:
            rise_bar = b
            break
    if rise_bar is None:
        rise_bar = int(np.flatnonzero(main[start_bar:])[0]) + start_bar

    return {
        "audible_start_bar": start_bar,
        "audible_end_bar": end_bar,
        "loud_level_db": round(loud, 2),
        "section_boundaries": anchors,
        "outro_start_bar": int(outro_start),
        "outro_bars": int(outro_bars),
        "rise_bar": int(rise_bar),
        "intro_bars": int(rise_bar - start_bar),
    }


# --------------------------------------------------------------------------- entry


def analyze_activations(audio: np.ndarray, beat_logits: np.ndarray, down_logits: np.ndarray) -> dict:
    """Full analysis from decoded audio plus the model's 50 fps beat/downbeat logits."""
    grid = fit_grid(pick_peaks(beat_logits))
    meter = fit_meter(grid, down_logits)
    stability = tempo_stability(grid)
    onsets = onset_alignment(audio, grid)

    m, ph = meter["meter"], meter["phase"]
    k_first = int(np.ceil((grid.k[0] - ph) / m) * m + ph)
    bar_k = np.arange(k_first, int(grid.k[-1]) + m + 1, m)
    bar_times = grid.time_of(bar_k)
    duration = len(audio) / SR
    bar_times = bar_times[bar_times <= duration]
    bar_k = bar_k[: len(bar_times)]
    if len(bar_times) < 9:
        raise AnalysisError(f"only {len(bar_times)} bar lines inside the track")
    e_full, e_low = bar_energy(audio, bar_times)
    cues = cue_points(e_full, section_boundaries(e_full, e_low))

    return {
        "duration_s": round(duration, 4),
        "tempo": {
            "bpm": round(60.0 / grid.period, 4),
            "global_conf": round(float(np.mean(np.abs(grid.residual) < GRID_TOL_S)), 3),
            "grid_mode": grid.mode,
            "dropped_offgrid_beats": grid.n_dropped,
            **stability,
        },
        "meter": meter,
        "onsets": onsets,
        "beats": {"times": np.round(grid.beats, 5).tolist(), "k": grid.k.tolist()},
        "bars": {
            "k": bar_k.tolist(),
            "times": np.round(bar_times, 5).tolist(),
            "energy_db": np.round(e_full, 2).tolist(),
        },
        "cues": cues,
    }


def grid_from_analysis(a: dict) -> Grid:
    beats = np.array(a["beats"]["times"], dtype=float)
    k = np.array(a["beats"]["k"], dtype=int)
    (p, o), *_ = np.linalg.lstsq(np.vstack([k, np.ones(len(k))]).T, beats, rcond=None)
    return Grid(beats=beats, k=k, period=float(p), offset=float(o), mode=a["tempo"]["grid_mode"],
                residual=beats - (o + k * p))
