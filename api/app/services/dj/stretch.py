"""ctypes wrapper over native/libstretch (Signalsmith Stretch, MIT) with a time-varying rate.

``stretch_varying()`` streams the input block by block through one stretcher instance
(no per-call reset) and returns the output plus an exact input -> output position map.
"""
from __future__ import annotations

import ctypes
import sys
from pathlib import Path
from typing import Callable

import numpy as np

_LIB_PATH = Path(__file__).parent / "native" / (
    "libstretch.dylib" if sys.platform == "darwin" else "libstretch.so"
)


class StretchError(RuntimeError):
    """The native stretcher is missing or was driven out of range."""


_LIB = None


def _lib():
    global _LIB
    if _LIB is not None:
        return _LIB
    if not _LIB_PATH.is_file():
        raise StretchError(
            f"{_LIB_PATH} is missing; build it with api/app/services/dj/native/build.sh"
        )
    lib = ctypes.CDLL(str(_LIB_PATH))
    fp = ctypes.POINTER(ctypes.c_float)
    lib.ss_create.restype = ctypes.c_void_p
    lib.ss_create.argtypes = [ctypes.c_int, ctypes.c_float, ctypes.c_int]
    lib.ss_destroy.argtypes = [ctypes.c_void_p]
    for name in ("ss_input_latency", "ss_output_latency", "ss_seek_length"):
        getattr(lib, name).restype = ctypes.c_int
        getattr(lib, name).argtypes = [ctypes.c_void_p]
    lib.ss_seek.argtypes = [ctypes.c_void_p, fp, ctypes.c_int, ctypes.c_int, ctypes.c_double]
    lib.ss_process.argtypes = [
        ctypes.c_void_p, fp, ctypes.c_int, ctypes.c_int, fp, ctypes.c_int, ctypes.c_int,
    ]
    _LIB = lib
    return lib


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
    """Time-stretch ``audio[start:stop]`` (shape (n, ch)) with a per-block rate.

    ``rate_at(x)`` is the playback rate at input position x (seconds after ``start``);
    rate > 1 is faster. The stretcher is primed with ``seek()`` on the audio before
    ``start``, so output begins exactly at input ``start`` without a fade-in.

    Returns ``(out, in_pos, out_pos)``: ``out`` has shape (m, ch); ``in_pos``/``out_pos``
    are matching sample positions (relative to ``start`` and ``out[0]``) for np.interp.
    """
    lib = _lib()
    n_in, ch = stop - start, audio.shape[1]
    if start < 0 or stop > len(audio) or n_in <= 0:
        raise StretchError(f"invalid stretch range [{start}, {stop}) for {len(audio)} samples")
    handle = lib.ss_create(ch, float(sr), 0)
    if not handle:
        raise StretchError("ss_create returned NULL")
    try:
        lat_in, lat_out = lib.ss_input_latency(handle), lib.ss_output_latency(handle)
        seek_len = lib.ss_seek_length(handle)
        # internal position = supplied input - lat_in; pre-feed so it sits at `start`
        pre_from = start - seek_len + lat_in
        if pre_from < 0:
            raise StretchError(f"need {seek_len - lat_in} samples of pre-roll before {start}")
        seek_buf = np.ascontiguousarray(audio[pre_from:start + lat_in].T, dtype=np.float32)
        lib.ss_seek(handle, _ptr(seek_buf), seek_buf.shape[1], seek_buf.shape[1], float(rate_at(0.0)))
        outs: list[np.ndarray] = []
        in_pos, out_pos = [0.0], [0.0]
        pos = lat_in
        produced = 0
        ideal = 0.0
        internal = 0
        while internal < n_in:
            rate = float(rate_at(internal / sr))
            if not 0.25 <= rate <= 4.0:
                raise StretchError(f"rate {rate} out of range at {internal / sr:.3f}s")
            # accumulate the ideal output length; per-block rounding alone drifts ~1 ms/beat
            ideal += block / rate
            m = max(1, int(round(ideal)) - produced)
            if len(audio) - (start + pos) < block:
                raise StretchError("ran out of input audio while stretching")
            buf = np.ascontiguousarray(audio[start + pos:start + pos + block].T, dtype=np.float32)
            out = np.zeros((ch, m), np.float32)
            lib.ss_process(handle, _ptr(buf), block, block, _ptr(out), m, m)
            outs.append(out)
            pos += block
            produced += m
            internal += block
            in_pos.append(float(internal))
            out_pos.append(float(produced))
        result = np.concatenate(outs, axis=1).T
        # after dropping the first lat_out output samples, output sample `produced`
        # lines up with input position `internal` (pinned by test_dj_stretch)
        return result[lat_out:], np.array(in_pos), np.array(out_pos)
    finally:
        lib.ss_destroy(handle)
