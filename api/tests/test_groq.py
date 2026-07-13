import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.routers.lyrics import (
    _cached_lyrics_need_word_refresh,
    _should_persist_lyrics,
)
from app.services import groq
from app.services.groq import GroqTranscriptionError, _word_lines


def word(text: str, start: float, end: float) -> dict:
    return {"word": text, "start": start, "end": end}


class WordLineTests(unittest.TestCase):
    def test_uses_punctuation_and_real_first_word_timestamps(self) -> None:
        lines = _word_lines(
            {
                "words": [
                    word("Wir", 0.17, 0.4),
                    word("tanzen,", 0.45, 0.9),
                    word("bis", 0.95, 1.1),
                    word("morgen.", 1.2, 1.7),
                    word("Nochmal!", 2.0, 2.5),
                ]
            }
        )

        self.assertEqual(
            lines,
            [
                {"t": 0.17, "text": "Wir tanzen, bis morgen."},
                {"t": 2.0, "text": "Nochmal!"},
            ],
        )

    def test_splits_on_silence_and_joins_punctuation_tokens(self) -> None:
        lines = _word_lines(
            {
                "words": [
                    word("Hello", 0.0, 0.3),
                    word(",", 0.3, 0.32),
                    word("world", 0.4, 0.7),
                    word("again", 1.6, 1.9),
                    word("!", 1.9, 1.91),
                ]
            }
        )

        self.assertEqual(
            lines,
            [
                {"t": 0.0, "text": "Hello, world"},
                {"t": 1.6, "text": "again!"},
            ],
        )

    def test_keeps_closing_quote_with_quoted_phrase(self) -> None:
        lines = _word_lines(
            {
                "words": [
                    word('"', 0.0, 0.01),
                    word("Hello", 0.02, 0.4),
                    word(".", 0.4, 0.42),
                    word('"', 0.42, 0.43),
                    word("Again.", 0.8, 1.2),
                ]
            }
        )

        self.assertEqual(
            lines,
            [
                {"t": 0.0, "text": '"Hello."'},
                {"t": 0.8, "text": "Again."},
            ],
        )

    def test_limits_line_word_count_without_interpolating_time(self) -> None:
        words = [word(f"w{i}", i * 0.3, i * 0.3 + 0.2) for i in range(12)]

        lines = _word_lines({"words": words})

        self.assertEqual(lines[0]["t"], 0.0)
        self.assertEqual(lines[1]["t"], 3.0)
        self.assertEqual(len(lines[0]["text"].split()), 10)
        self.assertEqual(len(lines[1]["text"].split()), 2)

    def test_limits_line_length_and_duration_at_real_word_boundaries(self) -> None:
        long_words = [
            word("abcdefghij", index * 0.3, index * 0.3 + 0.2)
            for index in range(6)
        ]
        duration_words = [
            word(f"w{index}", index * 0.9, index * 0.9 + 0.8)
            for index in range(7)
        ]

        length_lines = _word_lines({"words": long_words})
        duration_lines = _word_lines({"words": duration_words})

        self.assertEqual([line["t"] for line in length_lines], [0.0, 1.5])
        self.assertLessEqual(len(length_lines[0]["text"]), 56)
        self.assertEqual([line["t"] for line in duration_lines], [0.0, 5.4])

    def test_accepts_valid_empty_word_list(self) -> None:
        self.assertEqual(_word_lines({"words": []}), [])

    def test_rejects_missing_or_invalid_word_timestamps(self) -> None:
        cases = [
            ({}, "missing word timestamps"),
            ({"words": [word("bad", float("nan"), 1.0)]}, "invalid start"),
            ({"words": [word("backwards", 2.0, 1.0)]}, "ends before"),
            (
                {
                    "words": [
                        word("later", 2.0, 2.2),
                        word("earlier", 1.0, 1.2),
                    ]
                },
                "starts before",
            ),
        ]
        for payload, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(GroqTranscriptionError, message):
                    _word_lines(payload)


class TranscriptionRequestTests(unittest.TestCase):
    @patch("app.services.groq.requests.post")
    def test_requests_verbose_word_timestamps(self, post: Mock) -> None:
        response = Mock()
        response.json.return_value = {
            "words": [word("Lyrics.", 0.12, 0.8)],
        }
        post.return_value = response

        fd, audio_path = tempfile.mkstemp(suffix=".mp3")
        with os.fdopen(fd, "wb") as audio:
            audio.write(b"audio")
        self.addCleanup(os.remove, audio_path)

        with patch.object(groq, "GROQ_API_KEY", "unit-test-key"):
            lines = groq.transcribe_file(audio_path)

        self.assertEqual(lines, [{"t": 0.12, "text": "Lyrics."}])
        request = post.call_args.kwargs
        self.assertEqual(request["data"]["response_format"], "verbose_json")
        self.assertEqual(request["data"]["timestamp_granularities[]"], "word")
        self.assertEqual(request["data"]["temperature"], "0")


class CacheVersionTests(unittest.TestCase):
    def test_refreshes_only_legacy_groq_cache_when_configured(self) -> None:
        legacy = SimpleNamespace(ai_generated=True, source="groq")
        current = SimpleNamespace(ai_generated=True, source=groq.LYRICS_SOURCE)
        lrclib = SimpleNamespace(ai_generated=False, source="lrclib")

        with patch("app.routers.lyrics.groq.configured", return_value=True):
            self.assertTrue(_cached_lyrics_need_word_refresh(legacy))
            self.assertFalse(_cached_lyrics_need_word_refresh(current))
            self.assertFalse(_cached_lyrics_need_word_refresh(lrclib))
        with patch("app.routers.lyrics.groq.configured", return_value=False):
            self.assertFalse(_cached_lyrics_need_word_refresh(legacy))

    def test_persists_valid_empty_groq_result_but_not_provider_miss(self) -> None:
        self.assertTrue(
            _should_persist_lyrics(
                {"lines": [], "source": groq.LYRICS_SOURCE},
            )
        )
        self.assertFalse(_should_persist_lyrics({"lines": None, "source": None}))
