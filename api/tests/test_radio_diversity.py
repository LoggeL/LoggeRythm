import unittest
from unittest import mock

from app.routers import radio


def _track(tid: str, artist_id: str, artist: str) -> dict:
    return {"id": tid, "artist_id": artist_id, "artist": artist, "title": f"T{tid}"}


class RadioDiversityTests(unittest.TestCase):
    def test_seed_artist_cannot_own_the_station(self):
        pool = [_track(str(i), "1", "Seed") for i in range(10)]
        pool += [_track(f"o{i}", str(100 + i), f"Other {i}") for i in range(30)]

        mix = radio._diversify(pool)

        seed_tracks = [t for t in mix if t["artist_id"] == "1"]
        self.assertEqual(len(mix), 32)  # 30 other artists + the seed artist's cap
        self.assertLessEqual(len(seed_tracks), radio._MAX_PER_ARTIST)

    def test_single_artist_pool_still_yields_a_usable_station(self):
        """When nothing else exists the cap relaxes — but only to _MIN_MIX_SIZE."""
        pool = [_track(str(i), "1", "Seed") for i in range(radio._MIX_SIZE)]

        mix = radio._diversify(pool)

        self.assertEqual(len(mix), radio._MIN_MIX_SIZE)

    def test_genre_charts_run_when_deezer_mix_is_all_seed_artist(self):
        """The long-tail case: Last.fm knows nothing, artist radio returns only
        the seed artist's own songs, related artists are empty."""
        seed = {
            "id": "9",
            "title": "Ich kann nix",
            "artist": {"id": 155029642, "name": "BABA SHRIMP GANG"},
            "album": {"id": 458783325},
        }
        own = [_track(f"s{i}", "155029642", "BABA SHRIMP GANG") for i in range(3)]
        genre = [_track(f"g{i}", str(200 + i), f"Indie {i}") for i in range(20)]

        with (
            mock.patch.object(radio, "_seed_meta", return_value=seed),
            mock.patch.object(radio, "_lastfm_similar", return_value=[]) as lastfm,
            mock.patch.object(radio, "_deezer_mix", return_value=own),
            mock.patch.object(radio, "_genre_charts", return_value=genre) as charts,
            mock.patch.object(radio.dc, "charts") as global_charts,
        ):
            mix = radio._radio("9")

        lastfm.assert_called_once_with("BABA SHRIMP GANG", "Ich kann nix")
        charts.assert_called_once_with(458783325)
        global_charts.assert_not_called()
        self.assertGreaterEqual(
            radio._other_artist_slots(mix, 155029642), radio._MIN_OTHER_ARTIST_SLOTS
        )

    def test_concentrated_other_artist_pool_still_runs_genre_charts(self):
        seed = {
            "id": "9",
            "title": "X",
            "artist": {"id": 1, "name": "Seed"},
            "album": {"id": 10},
        }
        concentrated = [_track(f"o{i}", "2", "Only Other") for i in range(20)]
        genre = [_track(f"g{i}", str(100 + i), f"Genre {i}") for i in range(20)]

        with (
            mock.patch.object(radio, "_seed_meta", return_value=seed),
            mock.patch.object(radio, "_lastfm_similar", return_value=[]),
            mock.patch.object(radio, "_deezer_mix", return_value=concentrated),
            mock.patch.object(radio, "_genre_charts", return_value=genre) as charts,
            mock.patch.object(radio.dc, "charts") as global_charts,
        ):
            mix = radio._radio("9")

        charts.assert_called_once_with(10)
        global_charts.assert_not_called()
        self.assertGreaterEqual(
            radio._other_artist_slots(mix, 1), radio._MIN_OTHER_ARTIST_SLOTS
        )
        self.assertLessEqual(
            len([track for track in mix if track["artist_id"] == "2"]),
            radio._MAX_PER_ARTIST,
        )

    def test_deezer_mix_failure_is_not_hidden_by_later_fallbacks(self):
        seed = {
            "id": "9",
            "title": "X",
            "artist": {"id": 1, "name": "Seed"},
            "album": {"id": 10},
        }

        with (
            mock.patch.object(radio, "_seed_meta", return_value=seed),
            mock.patch.object(radio, "_lastfm_similar", return_value=[]),
            mock.patch.object(
                radio,
                "_deezer_mix",
                side_effect=radio.dc.DeezerClientError("artist radio unavailable"),
            ),
            mock.patch.object(radio, "_genre_charts") as genre_charts,
            mock.patch.object(radio.dc, "charts") as global_charts,
        ):
            with self.assertRaisesRegex(
                radio.dc.DeezerClientError, "artist radio unavailable"
            ):
                radio._radio("9")

        genre_charts.assert_not_called()
        global_charts.assert_not_called()

    def test_empty_recommendation_sources_fail_clearly(self):
        seed = {
            "id": "9",
            "title": "X",
            "artist": {"id": 1, "name": "Seed"},
            "album": {"id": 10},
        }

        with (
            mock.patch.object(radio, "_seed_meta", return_value=seed),
            mock.patch.object(radio, "_lastfm_similar", return_value=[]),
            mock.patch.object(radio, "_deezer_mix", return_value=[]),
            mock.patch.object(radio, "_genre_charts", return_value=[]),
            mock.patch.object(radio.dc, "charts", return_value=[]),
        ):
            with self.assertRaisesRegex(
                radio.dc.DeezerClientError,
                "All radio recommendation sources returned no tracks for seed 9",
            ):
                radio._radio("9")

    def test_lastfm_timeout_fails_with_source_context(self):
        with (
            mock.patch.object(radio, "LASTFM_API_KEY", "configured"),
            mock.patch.object(
                radio.requests,
                "get",
                side_effect=radio.requests.exceptions.Timeout("timed out"),
            ),
        ):
            with self.assertRaisesRegex(
                radio._RadioSourceError,
                r"Last\.fm recommendations failed for 'Artist' - 'Title': timed out",
            ):
                radio._lastfm_similar("Artist", "Title")

    def test_genre_chart_failure_is_not_skipped(self):
        album = {"genres": {"data": [{"id": 85}]}}
        with mock.patch.object(
            radio.dc,
            "_public_get",
            side_effect=[
                album,
                radio.dc.DeezerClientError("genre chart unavailable"),
            ],
        ):
            with self.assertRaisesRegex(
                radio.dc.DeezerClientError, "genre chart unavailable"
            ):
                radio._genre_charts(10)

    def test_global_charts_are_the_last_resort(self):
        seed = {"id": "9", "title": "X", "artist": {"id": 1, "name": "A"}, "album": {}}
        fallback = [_track(f"c{i}", str(300 + i), f"Chart {i}") for i in range(20)]

        with (
            mock.patch.object(radio, "_seed_meta", return_value=seed),
            mock.patch.object(radio, "_lastfm_similar", return_value=[]),
            mock.patch.object(radio, "_deezer_mix", return_value=[]),
            mock.patch.object(radio, "_genre_charts", return_value=[]),
            mock.patch.object(radio.dc, "charts", return_value=fallback),
        ):
            mix = radio._radio("9")

        self.assertEqual(len(mix), 20)

    def test_seed_track_never_appears_in_its_own_radio(self):
        seed = {"id": "9", "title": "X", "artist": {"id": 1, "name": "A"}, "album": {}}
        similar = [_track("9", "1", "A"), *[
            _track(f"x{i}", str(400 + i), f"B{i}") for i in range(20)
        ]]

        with (
            mock.patch.object(radio, "_seed_meta", return_value=seed),
            mock.patch.object(radio, "_lastfm_similar", return_value=similar),
            mock.patch.object(radio.dc, "charts") as global_charts,
        ):
            mix = radio._radio("9")

        global_charts.assert_not_called()
        self.assertNotIn("9", [t["id"] for t in mix])


if __name__ == "__main__":
    unittest.main()
