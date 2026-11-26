"""Audio I/O for DJ transitions.

Every decode goes through one pinned ffmpeg invocation so analysis and rendering see
exactly the same sample timeline. ffmpeg trims the LAME/Xing encoder delay like
Media3's Mp3Extractor does, so these times match the player's media positions.
Beat This!'s own ``load_audio`` is deliberately not used: it silently falls back
across torchaudio/soundfile/madmom, and each treats MP3 encoder delay differently.
"""
from __future__ import annotations

import shutil
import subprocess

import numpy as np

SR = 44100
CHANNELS = 2
_FFMPEG_TIMEOUT_SEC = 120


class AudioError(RuntimeError):
    """Decoding or encoding failed."""


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise AudioError("DJ transitions require ffmpeg on PATH, but it was not found")
    return exe


def decode(path: str) -> np.ndarray:
    """Decode to float32 stereo at 44.1 kHz, shape (n_samples, 2)."""
    cmd = [
        _ffmpeg(), "-v", "error", "-nostdin", "-i", path,
        "-f", "f32le", "-acodec", "pcm_f32le", "-ac", str(CHANNELS), "-ar", str(SR), "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=_FFMPEG_TIMEOUT_SEC)
    except subprocess.TimeoutExpired as exc:
        raise AudioError(f"ffmpeg timed out decoding {path}") from exc
    err = proc.stderr.decode(errors="replace").strip()
    if proc.returncode != 0:
        raise AudioError(f"ffmpeg failed to decode {path}: {err}")
    if err:
        # at -v error ffmpeg only prints real problems (corrupt frames etc.)
        raise AudioError(f"ffmpeg reported errors while decoding {path}: {err}")
    pcm = np.frombuffer(proc.stdout, dtype=np.float32)
    if pcm.size == 0 or pcm.size % CHANNELS:
        raise AudioError(
            f"ffmpeg returned {pcm.size} floats for {path}; expected a non-empty multiple of {CHANNELS}"
        )
    return pcm.reshape(-1, CHANNELS).copy()


def write_mp3(path: str, audio: np.ndarray, bitrate: str = "256k") -> None:
    """Encode with LAME. ffmpeg writes the Xing/LAME header carrying the encoder
    delay and padding, which Media3 uses for sample-exact gapless trimming."""
    if audio.ndim != 2 or audio.shape[1] != CHANNELS:
        raise AudioError(f"write_mp3 expects (n, {CHANNELS}) audio, got {audio.shape}")
    peak = float(np.max(np.abs(audio)))
    if peak > 1.0:
        raise AudioError(f"refusing to write clipped audio to {path} (peak {peak:.3f})")
    cmd = [
        _ffmpeg(), "-v", "error", "-nostdin", "-y",
        "-f", "f32le", "-ar", str(SR), "-ac", str(CHANNELS), "-i", "-",
        "-codec:a", "libmp3lame", "-b:a", bitrate, "-f", "mp3", path,
    ]
    try:
        proc = subprocess.run(
            cmd,
            input=np.ascontiguousarray(audio, dtype=np.float32).tobytes(),
            capture_output=True,
            timeout=_FFMPEG_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioError(f"ffmpeg timed out encoding {path}") from exc
    if proc.returncode != 0:
        raise AudioError(
            f"ffmpeg failed to encode {path}: {proc.stderr.decode(errors='replace').strip()}"
        )
