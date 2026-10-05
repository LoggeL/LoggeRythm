from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.models import PartySession, PartyTrack, User
from app.db.session import Base
from app.routers import party


class PartyQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.host = User(email="host@example.test", password_hash="unused")
        self.guest = User(email="guest@example.test", password_hash="unused")
        self.db.add_all([self.host, self.guest])
        self.db.flush()
        self.stamp = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
        self.session = PartySession(
            code="QATEST",
            host_id=self.host.id,
            current_index=1,
            is_playing=True,
            position_sec=42.0,
            playback_updated_at=self.stamp,
        )
        self.other_session = PartySession(code="OTHER", host_id=self.host.id)
        self.db.add_all([self.session, self.other_session])
        self.db.flush()
        self.first = self.add_track(self.session.code, "42", 0)
        self.current = self.add_track(self.session.code, "42", 1)
        self.last = self.add_track(self.session.code, "77", 2)
        self.foreign = self.add_track(self.other_session.code, "90", 0)
        self.db.commit()
        self.publisher = patch.object(party.party_bus, "publish")
        self.publish = self.publisher.start()

    def tearDown(self) -> None:
        self.publisher.stop()
        self.db.close()
        self.engine.dispose()

    def add_track(self, code: str, deezer_id: str, position: int) -> PartyTrack:
        track = PartyTrack(
            session_code=code,
            deezer_id=deezer_id,
            title=f"Track {deezer_id}",
            position=position,
        )
        self.db.add(track)
        self.db.flush()
        return track

    def rows(self) -> list[PartyTrack]:
        return list(self.db.scalars(
            select(PartyTrack)
            .where(PartyTrack.session_code == self.session.code)
            .order_by(PartyTrack.position, PartyTrack.id)
        ))

    def remove(self, item_id: int):
        return party.remove_track(self.session.code, item_id, self.host, self.db)

    def reorder(self, ids: list[int]):
        return party.reorder_tracks(
            self.session.code, party.OrderUpdate(ids=ids), self.host, self.db
        )

    def test_removing_earlier_track_preserves_active_occurrence_and_playback_clock(self):
        self.assertEqual(self.remove(self.first.id).status_code, 204)

        rows = self.rows()
        self.assertEqual([(row.id, row.position) for row in rows], [
            (self.current.id, 0), (self.last.id, 1),
        ])
        self.assertEqual(rows[self.session.current_index].id, self.current.id)
        self.assertEqual(self.session.position_sec, 42.0)
        self.assertEqual(self.session.playback_updated_at.replace(tzinfo=timezone.utc), self.stamp)
        self.assertTrue(self.session.is_playing)

    def test_removing_current_track_selects_next_and_resets_clock(self):
        self.assertEqual(self.remove(self.current.id).status_code, 204)

        self.assertEqual(self.rows()[self.session.current_index].id, self.last.id)
        self.assertEqual(self.session.position_sec, 0.0)
        self.assertGreater(self.session.playback_updated_at.replace(tzinfo=timezone.utc), self.stamp)
        self.assertTrue(self.session.is_playing)

    def test_removing_current_last_track_selects_previous_then_stops_empty_queue(self):
        self.session.current_index = 2
        self.db.commit()
        self.remove(self.last.id)
        self.assertEqual(self.rows()[self.session.current_index].id, self.current.id)
        self.assertEqual(self.session.position_sec, 0.0)

        self.db.expire(self.session, ["tracks"])
        self.remove(self.current.id)
        self.db.expire(self.session, ["tracks"])
        self.remove(self.first.id)

        self.assertEqual(self.rows(), [])
        self.assertEqual(self.session.current_index, -1)
        self.assertFalse(self.session.is_playing)
        self.assertEqual(self.session.position_sec, 0.0)

    def test_removing_foreign_or_unknown_track_fails_without_mutation(self):
        for item_id in (self.foreign.id, 99999):
            with self.subTest(item_id=item_id):
                with self.assertRaises(HTTPException) as raised:
                    self.remove(item_id)
                self.assertEqual(raised.exception.status_code, 404)
                self.assertEqual(len(self.rows()), 3)
                self.assertEqual(self.session.current_index, 1)
        self.publish.assert_not_called()

    def test_reorder_preserves_active_duplicate_occurrence_and_playback_clock(self):
        self.reorder([self.current.id, self.last.id, self.first.id])

        self.assertEqual(self.session.current_index, 0)
        self.assertEqual([row.id for row in self.rows()], [
            self.current.id, self.last.id, self.first.id,
        ])
        self.assertEqual(self.session.position_sec, 42.0)
        self.assertEqual(self.session.playback_updated_at.replace(tzinfo=timezone.utc), self.stamp)
        self.assertTrue(self.session.is_playing)

    def test_stale_duplicate_and_foreign_reorders_fail_atomically(self):
        invalid = (
            [self.first.id, self.current.id],
            [self.first.id, self.first.id, self.last.id],
            [self.first.id, self.current.id, self.foreign.id],
            [self.first.id, self.current.id, self.last.id, self.foreign.id],
        )
        before = [(row.id, row.position) for row in self.rows()]
        for ids in invalid:
            with self.subTest(ids=ids):
                with self.assertRaises(HTTPException) as raised:
                    self.reorder(ids)
                self.assertEqual(raised.exception.status_code, 409)
                self.assertEqual([(row.id, row.position) for row in self.rows()], before)
                self.assertEqual(self.session.current_index, 1)
        self.publish.assert_not_called()

    def test_reorder_keeps_unselected_queue_stopped(self):
        self.session.current_index = -1
        self.session.is_playing = False
        self.db.commit()
        self.reorder([self.last.id, self.first.id, self.current.id])
        self.assertEqual(self.session.current_index, -1)
        self.assertFalse(self.session.is_playing)

    def test_out_of_bounds_current_indices_fail_without_mutation(self):
        for index in (-2, 3, 100):
            with self.subTest(index=index):
                with self.assertRaises(HTTPException) as raised:
                    party.set_current(
                        self.session.code, party.CurrentUpdate(index=index), self.host, self.db
                    )
                self.assertEqual(raised.exception.status_code, 422)
                self.assertEqual(self.session.current_index, 1)
                self.assertEqual(self.session.position_sec, 42.0)
        self.publish.assert_not_called()

    def test_deselecting_current_track_stops_playback(self):
        party.set_current(
            self.session.code, party.CurrentUpdate(index=-1), self.host, self.db
        )
        self.assertEqual(self.session.current_index, -1)
        self.assertFalse(self.session.is_playing)
        self.assertEqual(self.session.position_sec, 0.0)

    def test_playback_rejects_invalid_positions_without_mutation(self):
        for position in (-1.0, float("nan"), float("inf"), float("-inf")):
            with self.subTest(position=position):
                with self.assertRaises(HTTPException) as raised:
                    party.set_playback(
                        self.session.code,
                        party.PlaybackUpdate(is_playing=False, position_sec=position),
                        self.host,
                        self.db,
                    )
                self.assertEqual(raised.exception.status_code, 422)
                self.assertTrue(self.session.is_playing)
                self.assertEqual(self.session.position_sec, 42.0)
        self.publish.assert_not_called()

    def test_playback_cannot_start_without_selected_track(self):
        self.session.current_index = -1
        self.session.is_playing = False
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            party.set_playback(
                self.session.code,
                party.PlaybackUpdate(is_playing=True, position_sec=0.0),
                self.host,
                self.db,
            )
        self.assertEqual(raised.exception.status_code, 409)
        self.assertFalse(self.session.is_playing)
        self.publish.assert_not_called()

    def test_guest_cannot_mutate_queue_or_playback(self):
        mutations = (
            lambda: party.remove_track(self.session.code, self.first.id, self.guest, self.db),
            lambda: party.reorder_tracks(
                self.session.code,
                party.OrderUpdate(ids=[self.last.id, self.current.id, self.first.id]),
                self.guest,
                self.db,
            ),
            lambda: party.set_current(
                self.session.code, party.CurrentUpdate(index=0), self.guest, self.db
            ),
            lambda: party.set_playback(
                self.session.code,
                party.PlaybackUpdate(is_playing=False, position_sec=0.0),
                self.guest,
                self.db,
            ),
        )
        for mutate in mutations:
            with self.assertRaises(HTTPException) as raised:
                mutate()
            self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(len(self.rows()), 3)
        self.assertEqual(self.session.current_index, 1)
        self.publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
