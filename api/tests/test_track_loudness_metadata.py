import unittest

from app.schemas.track import Track
from app.services.deezer_client import normalize_public_track, normalize_search_item


class TrackLoudnessMetadataTests(unittest.TestCase):
    def test_track_schema_exposes_optional_loudness_metadata(self):
        track = Track(
            id="1",
            loudness_gain_db=-5.5,
            loudness_lufs=-8.5,
            loudness_peak=0.97,
        )

        self.assertEqual(track.loudness_gain_db, -5.5)
        self.assertEqual(track.loudness_lufs, -8.5)
        self.assertEqual(track.loudness_peak, 0.97)

    def test_deezer_normalizers_preserve_upstream_replaygain_without_inventing_values(self):
        normalized = normalize_public_track(
            {
                "id": "1",
                "title": "Loud Song",
                "artist": {"id": "2", "name": "Artist"},
                "album": {"id": "3", "title": "Album"},
                "duration": 180,
                "GAIN": "-7.25",
                "REPLAYGAIN_TRACK_PEAK": "0.91",
            }
        )

        self.assertEqual(normalized["loudness_gain_db"], -7.25)
        self.assertIsNone(normalized["loudness_lufs"])
        self.assertEqual(normalized["loudness_peak"], 0.91)

        legacy = normalize_search_item({"id": "2", "title": "No Metadata"})
        self.assertIsNone(legacy["loudness_gain_db"])
        self.assertIsNone(legacy["loudness_lufs"])
        self.assertIsNone(legacy["loudness_peak"])


if __name__ == "__main__":
    unittest.main()
