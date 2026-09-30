import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import PartySession, User
from app.db.session import Base
from app.routers.party import _state_dict


class PartyTimestampTests(unittest.TestCase):
    def test_sqlite_playback_clock_is_returned_with_explicit_utc_offset(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        try:
            with Session(engine) as db:
                host = User(email="host@example.org", password_hash="unused", display_name="Host")
                db.add(host)
                db.flush()
                stamp = datetime(2026, 9, 30, 12, 0, 0, tzinfo=timezone.utc)
                party = PartySession(code="QATEST", name="Test", host_id=host.id,
                                     is_playing=True, position_sec=15, playback_updated_at=stamp)
                db.add(party)
                db.commit()
                db.refresh(party)
                self.assertIsNone(party.playback_updated_at.tzinfo)
                state = _state_dict(db, party)
                self.assertEqual(state["playback_updated_at"], "2026-09-30T12:00:00+00:00")
                self.assertEqual(datetime.fromisoformat(state["playback_updated_at"]), stamp)
        finally:
            engine.dispose()
