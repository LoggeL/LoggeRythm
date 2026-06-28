"""Groq-backed audio transcription helpers."""
from __future__ import annotations

import os
import re
from typing import Any

import requests

from ..config import GROQ_API_KEY, GROQ_TRANSCRIPTION_MODEL

_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
_MAX_AUDIO_BYTES = 24 * 1024 * 1024


def configured() -> bool:
    return bool(GROQ_API_KEY)


def _segment_lines(payload: dict[str, Any]) -> list[dict]:
    segments = payload.get("segments")
    if isinstance(segments, list):
        lines = []
        for segment in segments:
            if not isinstance(segment, dict):
                continue
            text = str(segment.get("text") or "").strip()
            if not text:
                continue
            start = segment.get("start", 0)
            try:
                t = round(float(start), 2)
            except (TypeError, ValueError):
                t = 0
            lines.append({"t": t, "text": text})
        if lines:
            return lines

    text = str(payload.get("text") or "").strip()
    if not text:
        return []
    parts = [
        part.strip()
        for part in re.split(r"(?<=[.!?])\s+|\n+", text)
        if part.strip()
    ]
    return [{"t": i * 5, "text": part} for i, part in enumerate(parts or [text])]


def transcribe_file(path: str) -> list[dict] | None:
    """Return best-effort timestamped lyric lines, or None if unavailable."""
    if not GROQ_API_KEY:
        return None
    if not os.path.exists(path) or os.path.getsize(path) > _MAX_AUDIO_BYTES:
        return None

    with open(path, "rb") as audio:
        response = requests.post(
            _TRANSCRIPTIONS_URL,
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            data={
                "model": GROQ_TRANSCRIPTION_MODEL,
                "response_format": "verbose_json",
                "timestamp_granularities[]": "segment",
            },
            files={"file": (os.path.basename(path), audio, "audio/mpeg")},
            timeout=90,
        )
    response.raise_for_status()
    lines = _segment_lines(response.json())
    return lines or None
