"""Audio I/O for the DJ-transition prototype.

Every decode goes through one pinned ffmpeg invocation so analysis and rendering
see exactly the same sample timeline (ffmpeg trims the LAME/iTunSMPB encoder delay
when the tag is present). Beat This!'s own `load_audio` is deliberately NOT used:
it silently falls back across torchaudio/soundfile/madmom, and each of those treats
MP3 encoder delay differently, which would shift beat times without notice.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

SR = 44100
CHANNELS = 2


class AudioError(RuntimeError):
    pass


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise AudioError("ffmpeg not found on PATH; it is required to decode MP3s")
    return exe


def decode(path: Path) -> np.ndarray:
    """Decode to float32 stereo at 44.1 kHz, shape (n_samples, 2)."""
    if not path.is_file():
        raise AudioError(f"audio file does not exist: {path}")
    cmd = [
        _ffmpeg(), "-v", "error", "-nostdin", "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le", "-ac", str(CHANNELS), "-ar", str(SR), "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise AudioError(f"ffmpeg failed to decode {path}: {proc.stderr.decode(errors='replace').strip()}")
    if proc.stderr.strip():
        # ffmpeg at -v error only prints real problems (corrupt frames etc.)
        raise AudioError(f"ffmpeg reported errors while decoding {path}: {proc.stderr.decode(errors='replace').strip()}")
    pcm = np.frombuffer(proc.stdout, dtype=np.float32)
    if pcm.size == 0 or pcm.size % CHANNELS:
        raise AudioError(f"ffmpeg returned {pcm.size} floats for {path}; expected a non-empty multiple of {CHANNELS}")
    return pcm.reshape(-1, CHANNELS).copy()


def encoder_delay_info(path: Path) -> dict:
    """Report whether the MP3 carries gapless info ffmpeg can use (LAME/Xing or iTunSMPB).

    Needed later on Android: an untagged file decodes ~529 samples earlier in
    MediaCodec than in ffmpeg, so the analysis must record which case it was.
    """
    exe = shutil.which("ffprobe")
    if exe is None:
        raise AudioError("ffprobe not found on PATH")
    proc = subprocess.run(
        [exe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise AudioError(f"ffprobe failed on {path}: {proc.stderr.decode(errors='replace').strip()}")
    info = json.loads(proc.stdout)
    streams = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if len(streams) != 1:
        raise AudioError(f"{path}: expected exactly one audio stream, found {len(streams)}")
    s = streams[0]
    return {
        "codec": s.get("codec_name"),
        "sample_rate": int(s["sample_rate"]),
        "bit_rate": int(s["bit_rate"]) if s.get("bit_rate") else None,
        # ffmpeg exposes the trimmed delay as start_time > 0 for tagged MP3s
        "start_time_s": float(s.get("start_time", 0.0)),
        "tags": sorted((info.get("format", {}).get("tags") or {}).keys()),
    }


def write_mp3(path: Path, audio: np.ndarray, bitrate: str = "192k") -> None:
    if audio.ndim != 2 or audio.shape[1] != CHANNELS:
        raise AudioError(f"write_mp3 expects (n, {CHANNELS}) audio, got {audio.shape}")
    peak = float(np.max(np.abs(audio)))
    if peak > 1.0:
        raise AudioError(f"refusing to write clipped audio to {path} (peak {peak:.3f}); limit before writing")
    path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        _ffmpeg(), "-v", "error", "-nostdin", "-y",
        "-f", "f32le", "-ar", str(SR), "-ac", str(CHANNELS), "-i", "-",
        "-codec:a", "libmp3lame", "-b:a", bitrate, str(path),
    ]
    proc = subprocess.run(cmd, input=np.ascontiguousarray(audio, dtype=np.float32).tobytes(), capture_output=True)
    if proc.returncode != 0:
        raise AudioError(f"ffmpeg failed to encode {path}: {proc.stderr.decode(errors='replace').strip()}")
