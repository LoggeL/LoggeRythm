"""Audio I/O for DJ transitions.

Every decode goes through one pinned ffmpeg invocation so analysis and rendering see
exactly the same sample timeline. For an MP3 with a LAME/Lavf Info tag, ffmpeg skips
the encoder delay plus the 529-sample decoder delay; without a tag it skips nothing.
The player's positions match this timeline only up to a per-track offset that depends
on its own trimming state, so every clip carries ``start_skip_s`` (see
``probe()``) and the Android player applies the offset
(``LoggeRythmDjDecoderOffset``).
Beat This!'s own ``load_audio`` is deliberately not used: it silently falls back
across torchaudio/soundfile/madmom, and each treats MP3 encoder delay differently.
"""
from __future__ import annotations

import json
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


def write_flac(path: str, audio: np.ndarray) -> None:
    """Encode as 16-bit FLAC with 1024-sample frames. FLAC has no encoder delay, so
    Media3's reported position is the clip sample index in every state; MP3 is not
    (Media3 trims the encoder delay only after a reconfiguration, so a seek shifts it
    by ~13 ms). Media3 starts a seek at the first frame at or after the target, so the
    small frames keep that jump under 24 ms."""
    if audio.ndim != 2 or audio.shape[1] != CHANNELS:
        raise AudioError(f"write_flac expects (n, {CHANNELS}) audio, got {audio.shape}")
    peak = float(np.max(np.abs(audio)))
    if peak > 1.0:
        raise AudioError(f"refusing to write clipped audio to {path} (peak {peak:.3f})")
    cmd = [
        _ffmpeg(), "-v", "error", "-nostdin", "-y",
        "-f", "f32le", "-ar", str(SR), "-ac", str(CHANNELS), "-i", "-",
        "-codec:a", "flac", "-sample_fmt", "s16", "-compression_level", "5", "-frame_size", "1024",
        "-f", "flac", path,
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


_CODEC_MIME = {"mp3": "audio/mpeg", "flac": "audio/flac"}


def probe(path: str) -> tuple[float, str]:
    """``(start_skip_s, mime)`` of ``path``.

    ``start_skip_s`` is how much decoded audio ffmpeg drops at the start (its
    ``start_time``): (encoder delay + 529) / rate for LAME/Lavf-tagged MP3, 0 for
    untagged MP3 and FLAC. ``mime`` lets the player check it plays the same codec.
    """
    exe = shutil.which("ffprobe")
    if exe is None:
        raise AudioError("DJ transitions require ffprobe on PATH, but it was not found")
    cmd = [exe, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,start_time",
           "-of", "json", path]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=_FFMPEG_TIMEOUT_SEC)
    except subprocess.TimeoutExpired as exc:
        raise AudioError(f"ffprobe timed out on {path}") from exc
    out = proc.stdout.decode(errors="replace").strip()
    err = proc.stderr.decode(errors="replace").strip()
    if proc.returncode != 0 or err:
        raise AudioError(f"ffprobe failed on {path}: {err or proc.returncode}")
    try:
        stream = json.loads(out)["streams"][0]
        value = float(stream["start_time"])
        codec = stream["codec_name"]
    except (ValueError, KeyError, IndexError) as exc:
        raise AudioError(f"ffprobe returned no codec/start_time for {path}: {out!r}") from exc
    if not 0.0 <= value < 0.2:
        raise AudioError(f"implausible start_time {value} s for {path}")
    if codec not in _CODEC_MIME:
        raise AudioError(f"unsupported codec {codec!r} in {path}")
    return value, _CODEC_MIME[codec]
