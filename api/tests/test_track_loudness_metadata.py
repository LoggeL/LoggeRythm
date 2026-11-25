import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Like, Playlist, PlaylistTrack, StoredTrack, User
from app.db.session import Base
from app.routers import likes as likes_router
from app.routers import playlists as playlists_router
from app.schemas.track import Track
from app.services import deezer_client as dc
from app.services.deezer_client import (
    normalize_public_track,
    normalize_public_tracks,
    normalize_search_item,
)


class TrackLoudnessMetadataTests(unittest.TestCase):
    def test_track_schema_exposes_optional_loudness_and_extra_metadata(self):
        track = Track(
            id="1",
            loudness_gain_db=-5.5,
            loudness_lufs=-8.5,
            loudness_peak=0.97,
            bpm=128.0,
            explicit=True,
        )

        self.assertEqual(track.loudness_gain_db, -5.5)
        self.assertEqual(track.loudness_lufs, -8.5)
        self.assertEqual(track.loudness_peak, 0.97)
        self.assertEqual(track.bpm, 128.0)
        self.assertIs(track.explicit, True)

        # Sentinel JSON "null" strings normalize to None
        cleaned = Track(id="2", loudness_gain_db="null", bpm="null")
        self.assertIsNone(cleaned.loudness_gain_db)
        self.assertIsNone(cleaned.bpm)

    def test_deezer_normalizers_preserve_lowercase_and_uppercase_gain_bpm_explicit(self):
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

        # Public Deezer /track/{id} JSON uses lowercase "gain", "bpm", "explicit_lyrics", "release_date"
        public_detail = normalize_public_track(
            {
                "id": "10",
                "title": "Detail Song",
                "artist": {"id": "2", "name": "Artist"},
                "album": {"id": "3", "title": "Album"},
                "duration": 210,
                "gain": -9.4,
                "bpm": 124.5,
                "explicit_lyrics": True,
                "release_date": "2025-05-01",
            }
        )
        self.assertEqual(public_detail["loudness_gain_db"], -9.4)
        self.assertEqual(public_detail["bpm"], 124.5)
        self.assertIs(public_detail["explicit"], True)
        self.assertEqual(public_detail["release_date"], "2025-05-01")

        legacy = normalize_search_item({"id": "2", "title": "No Metadata"})
        self.assertIsNone(legacy["loudness_gain_db"])
        self.assertIsNone(legacy["loudness_lufs"])
        self.assertIsNone(legacy["loudness_peak"])
        self.assertIsNone(legacy["bpm"])
        self.assertIsNone(legacy["explicit"])

    def test_normalize_public_tracks_merges_cached_track_detail_gain_bpm_explicit(self):
        # Search results omit `gain` and `bpm`, but _full_public_artist_refs fetches
        # /track/{id} for contributor credits — confirm gain/bpm/explicit ride along!
        def fake_public_get(path: str):
            if path == "/track/777":
                return {
                    "id": 777,
                    "title": "Search Hit",
                    "artist": {"id": 5, "name": "Main"},
                    "contributors": [
                        {"id": 5, "name": "Main", "role": "Main"},
                        {"id": 6, "name": "Feat", "role": "Featured"},
                    ],
                    "gain": -8.1,
                    "bpm": 118.0,
                    "explicit_lyrics": True,
                }
            raise AssertionError(f"Unexpected path {path}")

        with (
            patch.object(
                dc,
                "_track_artists_flights",
                dc.SingleFlightTtlCache(ttl_seconds=60, max_entries=16, max_inflight=4),
            ),
            patch.object(
                dc,
                "_track_detail_meta_flights",
                dc.SingleFlightTtlCache(ttl_seconds=60, max_entries=16, max_inflight=4),
            ),
            patch.object(dc, "_public_get", side_effect=fake_public_get),
        ):
            tracks = normalize_public_tracks(
                [
                    {
                        "id": 777,
                        "title": "Search Hit",
                        "artist": {"id": 5, "name": "Main"},
                        "album": {"id": 9, "title": "LP"},
                        "duration": 200,
                    }
                ]
            )
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["loudness_gain_db"], -8.1)
        self.assertEqual(tracks[0]["bpm"], 118.0)
        self.assertIs(tracks[0]["explicit"], True)
        self.assertEqual([a["name"] for a in tracks[0]["artists"]], ["Main", "Feat"])

    def test_likes_and_playlists_persist_and_enrich_loudness_from_stored_tracks(self):
        with tempfile.TemporaryDirectory() as tmp:
            engine = create_engine(f"sqlite:///{Path(tmp) / 'loudness.db'}")
            Base.metadata.create_all(engine)
            SessionFactory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
            with SessionFactory() as db:
                user = User(email="u@test.local", password_hash="x", is_approved=True)
                db.add(user)
                db.flush()
                # StoredTrack has measured LUFS/peak/BPM + gain
                db.add(
                    StoredTrack(
                        deezer_id="901",
                        file_path="/tmp/901.mp3",
                        title="Measured",
                        artist="A",
                        loudness_gain_db=-6.2,
                        loudness_lufs=-7.8,
                        loudness_peak=0.98,
                        bpm=130.0,
                    )
                )
                db.commit()

                # Like with inline gain
                likes_router.add_like(
                    "901",
                    Track(id="901", title="Measured", artist="A", loudness_gain_db=-6.0),
                    user=user,
                    db=db,
                )
                liked = likes_router.list_likes(user=user, db=db)
                self.assertEqual(len(liked), 1)
                self.assertEqual(liked[0].loudness_gain_db, -6.0)
                self.assertEqual(liked[0].loudness_lufs, -7.8)
                self.assertEqual(liked[0].loudness_peak, 0.98)
                self.assertEqual(liked[0].bpm, 130.0)

                # Playlist track without inline gain inherits from StoredTrack
                pl = Playlist(user_id=user.id, name="Test")
                db.add(pl)
                db.commit()
                playlists_router.add_track(
                    pl.id,
                    Track(id="901", title="Measured", artist="A"),
                    user=user,
                    db=db,
                )
                detail = playlists_router.get_playlist(pl.id, user=user, db=db)
                self.assertEqual(detail.tracks[0].loudness_gain_db, -6.2)
                self.assertEqual(detail.tracks[0].loudness_lufs, -7.8)
                self.assertEqual(detail.tracks[0].loudness_peak, 0.98)
                self.assertEqual(detail.tracks[0].bpm, 130.0)
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
