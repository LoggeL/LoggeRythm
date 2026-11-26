"""Beat This! inference (CPJKU, MIT code and weights). Imported only by the worker
subprocess: torch must never be loaded into the API process."""
from __future__ import annotations

import os

import numpy as np

CHECKPOINT = "final0"
ANALYZER = f"beat_this-1.1.0/{CHECKPOINT}"

_MODEL = None


class ModelError(RuntimeError):
    """The beat model could not be loaded or run."""


def _threads() -> int:
    raw = os.getenv("DJ_ANALYSIS_THREADS", "4")
    try:
        n = int(raw)
    except ValueError as exc:
        raise ModelError(f"DJ_ANALYSIS_THREADS must be an integer, got {raw!r}") from exc
    if n < 1:
        raise ModelError(f"DJ_ANALYSIS_THREADS must be >= 1, got {n}")
    return n


def activations(audio: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """Beat and downbeat logits at 50 fps for float32 stereo audio (n, 2)."""
    global _MODEL
    import torch
    from beat_this.inference import Audio2Frames

    torch.set_num_threads(_threads())
    if _MODEL is None:
        _MODEL = Audio2Frames(checkpoint_path=CHECKPOINT, device="cpu")
    with torch.inference_mode():
        beat, down = _MODEL(audio, sr)
    return beat.cpu().numpy().astype(np.float64), down.cpu().numpy().astype(np.float64)
