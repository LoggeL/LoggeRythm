"""ctypes wrapper over native/libstretch (Signalsmith Stretch, MIT) with time-varying rate.

`stretch_varying()` streams the input block by block through one stretcher
instance (no per-call reset, unlike python-stretch's whole-buffer `process`,
which re-seeks every call and shifts pitch when fed in blocks) and returns the
output plus an exact input-position -> output-position map.
"""

from __future__ import annotations

import ctypes
import sys
from pathlib import Path
from typing import Callable

import numpy as np

_LIB_PATH = Path(__file__).parent / "native" / ("libstretch.dylib" if sys.platform == "darwin" else "libstretch.so")


class StretchError(RuntimeError):
    pass


def _lib():
    if not _LIB_PATH.is_file():
        raise StretchError(f"{_LIB_PATH} missing - run native/build.sh first")
    lib = ctypes.CDLL(str(_LIB_PATH))
    fp = ctypes.POINTER(ctypes.c_float)
    lib.ss_create.restype = ctypes.c_void_p
    lib.ss_create.argtypes = [ctypes.c_int, ctypes.c_float, ctypes.c_int]
    lib.ss_destroy.argtypes = [ctypes.c_void_p]
    for n in ("ss_input_latency", "ss_output_latency", "ss_seek_length"):
        getattr(lib, n).restype = ctypes.c_int
        getattr(lib, n).argtypes = [ctypes.c_void_p]
    lib.ss_seek.argtypes = [ctypes.c_void_p, fp, ctypes.c_int, ctypes.c_int, ctypes.c_double]
    lib.ss_process.argtypes = [ctypes.c_void_p, fp, ctypes.c_int, ctypes.c_int, fp, ctypes.c_int, ctypes.c_int]
    lib.ss_flush.argtypes = [ctypes.c_void_p, fp, ctypes.c_int, ctypes.c_int, ctypes.c_float]
    return lib


_LIB = None


def _ptr(a: np.ndarray):
    return a.ctypes.data_as(ctypes.POINTER(ctypes.c_float))


def stretch_varying(
    audio: np.ndarray,
    start: int,
    stop: int,
    rate_at: Callable[[float], float],
    sr: int,
    block: int = 256,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Time-stretch audio[start:stop] (shape (n, ch)) with a rate that varies per block.

    rate_at(x) gives the playback rate at input position x (seconds relative to
    `start`); rate > 1 is faster. The stretcher is primed with `seek()` on the audio
    *before* `start`, so output begins exactly at input `start` without fade-in.

    Returns (out, in_pos, out_pos): out has shape (m, ch); (in_pos, out_pos) are
    matching sample positions (relative to `start` and to out[0]) suitable for
    np.interp in both directions.
    """
    global _LIB
    if _LIB is None:
        _LIB = _lib()
    lib = _LIB
    n_in, ch = stop - start, audio.shape[1]
    if start < 0 or stop > len(audio) or n_in <= 0:
        raise StretchError(f"invalid stretch range [{start}, {stop}) for audio of {len(audio)} samples")
    h = lib.ss_create(ch, float(sr), 0)
    try:
        lat_in, lat_out = lib.ss_input_latency(h), lib.ss_output_latency(h)
        seek_len = lib.ss_seek_length(h)
        # internal position = supplied input - lat_in. Pre-feed so that the internal
        # position sits exactly at `start` when we begin collecting output.
        pre_from = start - seek_len + lat_in
        if pre_from < 0:
            raise StretchError(f"need {seek_len - lat_in} samples of pre-roll before {start}")
        r0 = float(rate_at(0.0))
        seek_buf = np.ascontiguousarray(audio[pre_from:start + lat_in].T, dtype=np.float32)
        lib.ss_seek(h, _ptr(seek_buf), seek_buf.shape[1], seek_buf.shape[1], r0)
        # After seek the stretcher has consumed input up to start+lat_in, i.e. its
        # internal position is `start`. Output still has lat_out samples of latency:
        # the first lat_out output samples belong to positions before `start`.
        outs, in_pos, out_pos = [], [0.0], [0.0]
        pos = lat_in            # next input sample to feed (relative to start)
        produced = 0
        ideal = 0.0
        internal = 0.0          # internal input position (relative to start), tracks the output centre
        while internal < n_in:
            r = float(rate_at(internal / sr))
            if not (0.25 <= r <= 4):
                raise StretchError(f"rate {r} out of range at {internal / sr:.3f}s")
            n = block
            # accumulate the ideal output length exactly; per-block rounding alone
            # (e.g. 256/0.9789 = 261.5 -> 262) drifts by ~1 ms per beat
            ideal += n / r
            m = max(1, int(round(ideal)) - produced)
            avail = len(audio) - (start + pos)
            if avail < n:
                raise StretchError("ran out of input audio while stretching; extend the source range")
            buf = np.ascontiguousarray(audio[start + pos:start + pos + n].T, dtype=np.float32)
            o = np.zeros((ch, m), np.float32)
            lib.ss_process(h, _ptr(buf), n, n, _ptr(o), m, m)
            outs.append(o)
            pos += n
            produced += m
            internal += n
            in_pos.append(internal)
            out_pos.append(float(produced))
        out = np.concatenate(outs, axis=1).T
        # Empirically (click-train test, see test_stretch.py): after dropping the
        # first lat_out output samples, output sample `produced` lines up with input
        # position `internal` - the input- and output-latency shifts cancel.
        out = out[lat_out:]
        in_pos = np.array(in_pos)
        out_pos = np.array(out_pos)
        return out, in_pos, out_pos
    finally:
        lib.ss_destroy(h)
