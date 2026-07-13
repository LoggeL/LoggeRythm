"""Groq-backed, word-timed lyrics transcription helpers."""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from typing import Any

import requests

from ..config import GROQ_API_KEY, GROQ_TRANSCRIPTION_MODEL

_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
_MAX_AUDIO_BYTES = 24 * 1024 * 1024

# Bump this value whenever the persisted line-building format changes. The
# lyrics router uses it to replace legacy, segment-timed Groq cache entries.
LYRICS_SOURCE = "groq-word-v1"
LEGACY_LYRICS_SOURCE = "groq"

_BREAK_PAUSE_SECONDS = 0.75
_MAX_LINE_CHARS = 56
_MAX_LINE_WORDS = 10
_MAX_LINE_SECONDS = 6.0
_SOFT_BREAK_MIN_WORDS = 5
_STRONG_END = re.compile(r"[.!?…][\"'’”)]*$")
_SOFT_END = re.compile(r"[,;:][\"'’”)]*$")
_NO_SPACE_BEFORE = (
    ",",
    ".",
    ";",
    ":",
    "!",
    "?",
    "%",
    "…",
    ")",
    "]",
    "}",
    "”",
)
_NO_SPACE_AFTER = ("(", "[", "{", "“", "„", "‘", "‚", "-", "–")
_PAIRED_QUOTES = {"\"", "'"}
_CLOSING_QUOTES = {"”", "’"}


class GroqTranscriptionError(RuntimeError):
    """Groq could not produce a valid word-timed transcription."""


@dataclass(frozen=True)
class _TimedWord:
    text: str
    start: float
    end: float


def configured() -> bool:
    return bool(GROQ_API_KEY)


def _timestamp(value: Any, field: str, index: int) -> float:
    if isinstance(value, bool):
        raise GroqTranscriptionError(
            f"Groq word {index} has a non-numeric {field} timestamp."
        )
    try:
        timestamp = float(value)
    except (TypeError, ValueError) as exc:
        raise GroqTranscriptionError(
            f"Groq word {index} has an invalid {field} timestamp: {value!r}."
        ) from exc
    if not math.isfinite(timestamp) or timestamp < 0:
        raise GroqTranscriptionError(
            f"Groq word {index} has an invalid {field} timestamp: {value!r}."
        )
    return timestamp


def _timed_words(payload: dict[str, Any]) -> list[_TimedWord]:
    if "words" not in payload:
        raise GroqTranscriptionError(
            "Groq verbose_json response is missing word timestamps."
        )
    raw_words = payload["words"]
    if not isinstance(raw_words, list):
        raise GroqTranscriptionError("Groq response field 'words' must be a list.")

    words: list[_TimedWord] = []
    previous_start = -1.0
    for index, raw_word in enumerate(raw_words):
        if not isinstance(raw_word, dict):
            raise GroqTranscriptionError(f"Groq word {index} must be an object.")
        raw_text = raw_word.get("word")
        if not isinstance(raw_text, str) or not raw_text.strip():
            raise GroqTranscriptionError(f"Groq word {index} has empty text.")
        start = _timestamp(raw_word.get("start"), "start", index)
        end = _timestamp(raw_word.get("end"), "end", index)
        if end < start:
            raise GroqTranscriptionError(
                f"Groq word {index} ends before it starts ({start} > {end})."
            )
        if start < previous_start:
            raise GroqTranscriptionError(
                f"Groq word {index} starts before the preceding word."
            )
        words.append(_TimedWord(text=raw_text.strip(), start=start, end=end))
        previous_start = start
    return words


def _join_words(words: list[_TimedWord]) -> str:
    text = ""
    open_quotes = {quote: False for quote in _PAIRED_QUOTES}
    for word in words:
        token = word.text
        if not text:
            text = token
            if token in _PAIRED_QUOTES:
                open_quotes[token] = True
        elif token in _PAIRED_QUOTES:
            if open_quotes[token]:
                text += token
                open_quotes[token] = False
            else:
                text += token if text.endswith(_NO_SPACE_AFTER) else f" {token}"
                open_quotes[token] = True
        elif any(
            is_open and text.endswith(quote)
            for quote, is_open in open_quotes.items()
        ):
            text += token
        elif token.startswith(_NO_SPACE_BEFORE) or text.endswith(_NO_SPACE_AFTER):
            text += token
        else:
            text += f" {token}"
    return text


def _next_word_closes_quote(
    current: list[_TimedWord],
    next_word: _TimedWord | None,
) -> bool:
    if next_word is None:
        return False
    if next_word.text in _CLOSING_QUOTES:
        return True
    if next_word.text in _PAIRED_QUOTES:
        quote_count = sum(word.text.count(next_word.text) for word in current)
        return quote_count % 2 == 1
    return False


def _word_lines(payload: dict[str, Any]) -> list[dict]:
    """Build readable lyric lines using only real Groq word timestamps."""
    words = _timed_words(payload)
    lines: list[dict] = []
    current: list[_TimedWord] = []

    def flush() -> None:
        if not current:
            return
        lines.append(
            {
                "t": round(current[0].start, 2),
                "text": _join_words(current),
            }
        )
        current.clear()

    for index, word in enumerate(words):
        if current and word.start - current[-1].end >= _BREAK_PAUSE_SECONDS:
            flush()

        candidate = [*current, word]
        candidate_text = _join_words(candidate)
        candidate_duration = word.end - candidate[0].start
        if current and (
            len(candidate_text) > _MAX_LINE_CHARS
            or len(candidate) > _MAX_LINE_WORDS
            or candidate_duration > _MAX_LINE_SECONDS
        ):
            flush()

        current.append(word)
        current_text = _join_words(current)
        next_word = words[index + 1] if index + 1 < len(words) else None
        ends_phrase = _STRONG_END.search(current_text) or (
            len(current) >= _SOFT_BREAK_MIN_WORDS and _SOFT_END.search(current_text)
        )
        if ends_phrase and not _next_word_closes_quote(current, next_word):
            flush()

    flush()
    return lines


def transcribe_file(path: str) -> list[dict]:
    """Return lyric lines timed to the first real word in each line."""
    if not GROQ_API_KEY:
        raise GroqTranscriptionError("GROQ_API_KEY is not configured.")
    if not os.path.isfile(path):
        raise GroqTranscriptionError(
            f"Audio file does not exist: {os.path.basename(path)}"
        )
    audio_size = os.path.getsize(path)
    if audio_size <= 0:
        raise GroqTranscriptionError(f"Audio file is empty: {os.path.basename(path)}")
    if audio_size > _MAX_AUDIO_BYTES:
        raise GroqTranscriptionError(
            f"Audio file is {audio_size} bytes; configured Groq upload limit is "
            f"{_MAX_AUDIO_BYTES} bytes."
        )

    try:
        with open(path, "rb") as audio:
            response = requests.post(
                _TRANSCRIPTIONS_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                data={
                    "model": GROQ_TRANSCRIPTION_MODEL,
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "word",
                    "temperature": "0",
                },
                files={"file": (os.path.basename(path), audio, "audio/mpeg")},
                timeout=90,
            )
    except requests.exceptions.RequestException as exc:
        raise GroqTranscriptionError(
            f"Groq transcription request failed: {exc}"
        ) from exc

    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError as exc:
        detail = response.text.strip()[:400]
        suffix = f": {detail}" if detail else ""
        raise GroqTranscriptionError(
            f"Groq transcription returned HTTP {response.status_code}{suffix}"
        ) from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise GroqTranscriptionError(
            "Groq transcription returned invalid JSON."
        ) from exc
    if not isinstance(payload, dict):
        raise GroqTranscriptionError("Groq transcription JSON must be an object.")
    return _word_lines(payload)
