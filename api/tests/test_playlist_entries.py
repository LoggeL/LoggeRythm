import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.models import Playlist, PlaylistTrack, User
from app.db.session import Base
from app.routers import playlists
from app.schemas.playlist import PlaylistEntryReorder, PlaylistReorder


class PlaylistStableEntryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        with self.engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.owner = User(
            email="owner@example.test",
            password_hash="unused",
            display_name="Owner",
            is_approved=True,
        )
        self.db.add(self.owner)
        self.db.flush()
        self.playlist = Playlist(user_id=self.owner.id, name="Duplicates")
        self.other_playlist = Playlist(user_id=self.owner.id, name="Other")
        self.db.add_all([self.playlist, self.other_playlist])
        self.db.flush()
        self.first = self.add_track(self.playlist.id, "42", "First", 0)
        self.second = self.add_track(self.playlist.id, "42", "Second", 1)
        self.third = self.add_track(self.playlist.id, "77", "Third", 2)
        self.foreign = self.add_track(self.other_playlist.id, "42", "Foreign", 0)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def add_track(
        self,
        playlist_id: int,
        deezer_id: str,
        title: str,
        position: int,
    ) -> PlaylistTrack:
        track = PlaylistTrack(
            playlist_id=playlist_id,
            deezer_id=deezer_id,
            title=title,
            artist="Artist",
            position=position,
        )
        self.db.add(track)
        self.db.flush()
        return track

    def ordered_rows(self) -> list[PlaylistTrack]:
        return list(
            self.db.scalars(
                select(PlaylistTrack)
                .where(PlaylistTrack.playlist_id == self.playlist.id)
                .order_by(PlaylistTrack.position, PlaylistTrack.id)
            )
        )

    def test_detail_exposes_stable_ids_for_duplicate_occurrences(self) -> None:
        detail = playlists.get_playlist(
            playlist_id=self.playlist.id,
            user=self.owner,
            db=self.db,
        )

        self.assertEqual([track.id for track in detail.tracks], ["42", "42", "77"])
        self.assertEqual(
            [track.playlist_entry_id for track in detail.tracks],
            [self.first.id, self.second.id, self.third.id],
        )

    def test_reorder_uses_complete_entry_snapshot_without_collapsing_duplicates(self) -> None:
        response = playlists.reorder_playlist_entries(
            playlist_id=self.playlist.id,
            body=PlaylistEntryReorder(
                entry_ids=[self.second.id, self.third.id, self.first.id],
            ),
            user=self.owner,
            db=self.db,
        )

        self.assertEqual(response.status_code, 204)
        self.db.expire_all()
        self.assertEqual(
            [(row.id, row.deezer_id, row.position) for row in self.ordered_rows()],
            [
                (self.second.id, "42", 0),
                (self.third.id, "77", 1),
                (self.first.id, "42", 2),
            ],
        )

    def test_stale_or_cross_playlist_reorder_fails_atomically(self) -> None:
        before = [(row.id, row.position) for row in self.ordered_rows()]
        with self.assertRaises(HTTPException) as raised:
            playlists.reorder_playlist_entries(
                playlist_id=self.playlist.id,
                body=PlaylistEntryReorder(
                    entry_ids=[self.first.id, self.second.id, self.foreign.id],
                ),
                user=self.owner,
                db=self.db,
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual([(row.id, row.position) for row in self.ordered_rows()], before)

    def test_remove_deletes_one_duplicate_and_normalizes_positions(self) -> None:
        response = playlists.remove_playlist_entry(
            playlist_id=self.playlist.id,
            entry_id=self.second.id,
            user=self.owner,
            db=self.db,
        )

        self.assertEqual(response.status_code, 204)
        self.db.expire_all()
        self.assertEqual(
            [(row.id, row.deezer_id, row.position) for row in self.ordered_rows()],
            [(self.first.id, "42", 0), (self.third.id, "77", 1)],
        )
        self.assertIsNotNone(self.db.get(PlaylistTrack, self.foreign.id))

    def test_remove_rejects_an_entry_from_another_playlist(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            playlists.remove_playlist_entry(
                playlist_id=self.playlist.id,
                entry_id=self.foreign.id,
                user=self.owner,
                db=self.db,
            )
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(len(self.ordered_rows()), 3)

    def test_legacy_deezer_contract_remains_available(self) -> None:
        response = playlists.reorder_tracks(
            playlist_id=self.playlist.id,
            body=PlaylistReorder(deezer_ids=["77", "42"]),
            user=self.owner,
            db=self.db,
        )
        self.assertEqual(response.status_code, 204)

        response = playlists.remove_track(
            playlist_id=self.playlist.id,
            deezer_id="42",
            user=self.owner,
            db=self.db,
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual([row.deezer_id for row in self.ordered_rows()], ["77"])


if __name__ == "__main__":
    unittest.main()
