"""Anonymous party guests and background loading of party tracks."""
import tempfile
import unittest
from concurrent.futures import Future
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app import party_auth
from app.auth import create_token
from app.db.models import PartyGuest, PartySession, PartyTrack, User
from app.db.session import Base
from app.party_auth import PartyActor, get_party_actor
from app.routers import party
from app.schemas.party import PartyGuestJoin
from app.schemas.track import Track
from app.services import party_preload

CODE = "GUESTS"


def cookie_token(response: Response) -> tuple[str, str]:
    header = response.headers["set-cookie"]
    token = header.split(";", 1)[0].split("=", 1)[1]
    return token, header


class PartyGuestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.directory.name) / 'party.db'}")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.host = User(email="host@example.test", password_hash="x", is_approved=True)
        self.member = User(email="member@example.test", password_hash="x", is_approved=True)
        self.pending = User(email="pending@example.test", password_hash="x", is_approved=False)
        self.db.add_all([self.host, self.member, self.pending])
        self.db.flush()
        self.db.add_all([
            PartySession(code=CODE, host_id=self.host.id),
            PartySession(code="OTHER1", host_id=self.host.id),
        ])
        self.db.commit()
        self.publisher = patch.object(party.party_bus, "publish")
        self.publish = self.publisher.start()
        self.preloader = patch.object(party.party_preload, "schedule")
        self.schedule = self.preloader.start()

    def tearDown(self) -> None:
        self.preloader.stop()
        self.publisher.stop()
        self.db.close()
        self.engine.dispose()
        self.directory.cleanup()

    def join(self, nickname: str, code: str = CODE):
        response = Response()
        state = party.join_as_guest(code, PartyGuestJoin(nickname=nickname), response, self.db)
        token, header = cookie_token(response)
        return state, token, header

    def guest_actor(self, token: str, code: str = CODE) -> PartyActor:
        return get_party_actor(code, None, token, self.db)

    def add(self, actor: PartyActor, deezer_id: str) -> PartyTrack:
        party.add_track(CODE, Track(id=deezer_id, title=f"T{deezer_id}"), actor, self.db)
        return self.db.scalars(
            select(PartyTrack).where(PartyTrack.session_code == CODE).order_by(PartyTrack.id.desc())
        ).first()

    def test_guest_joins_with_nickname_and_party_scoped_cookie(self):
        state, token, header = self.join("  Disco   Dani ")
        self.assertTrue(state.viewer_is_guest)
        self.assertEqual(state.viewer_name, "Disco Dani")
        self.assertFalse(state.is_host)
        self.assertEqual([(m.name, m.is_guest) for m in state.members], [("Disco Dani", True)])
        self.assertIn(f"Path=/api/party/{CODE}", header)
        self.assertIn("HttpOnly", header)
        stored = self.db.scalar(select(PartyGuest))
        self.assertNotEqual(stored.token_hash, token)
        self.assertEqual(stored.token_hash, party_auth.hash_guest_token(token))
        self.assertEqual(self.guest_actor(token).guest.id, stored.id)
        self.publish.assert_called()

    def test_nickname_must_be_unique_and_not_blank(self):
        self.join("Mia")
        for nickname, status in (("mia", 409), ("   ", 422)):
            with self.assertRaises(HTTPException) as raised:
                self.join(nickname)
            self.assertEqual(raised.exception.status_code, status)
        self.assertEqual(len(self.db.scalars(select(PartyGuest)).all()), 1)

    def test_guest_token_only_opens_its_own_party(self):
        _, token, _ = self.join("Mia")
        with self.assertRaises(HTTPException) as raised:
            self.guest_actor(token, code="OTHER1")
        self.assertEqual(raised.exception.status_code, 401)
        with self.assertRaises(HTTPException) as raised:
            self.guest_actor("forged-token")
        self.assertEqual(raised.exception.status_code, 401)

    def test_accounts_win_and_pending_accounts_are_rejected_without_guest_token(self):
        _, token, _ = self.join("Mia")
        actor = get_party_actor(CODE, create_token(self.member.id), token, self.db)
        self.assertEqual(actor.user.id, self.member.id)
        guest = get_party_actor(CODE, create_token(self.pending.id), token, self.db)
        self.assertTrue(guest.is_guest)
        with self.assertRaises(HTTPException) as raised:
            get_party_actor(CODE, create_token(self.pending.id), None, self.db)
        self.assertEqual(raised.exception.status_code, 403)
        with self.assertRaises(HTTPException) as raised:
            get_party_actor(CODE, None, None, self.db)
        self.assertEqual(raised.exception.status_code, 401)

    def test_guest_adds_and_removes_only_own_upcoming_tracks(self):
        _, token, _ = self.join("Mia")
        mia = self.guest_actor(token)
        host = PartyActor(user=self.host)
        hosts_track = self.add(host, "10")
        own_track = self.add(mia, "20")
        playing_own = self.add(mia, "30")
        self.assertEqual(own_track.added_by, "Mia")
        self.assertEqual(own_track.added_by_member, f"g:{mia.guest.id}")
        party.set_current(CODE, party.CurrentUpdate(index=2), self.host, self.db)

        for item, detail in ((hosts_track, "selbst hinzugefügt"), (playing_own, "läuft gerade")):
            with self.assertRaises(HTTPException) as raised:
                party.remove_track(CODE, item.id, mia, self.db)
            self.assertEqual(raised.exception.status_code, 403)
            self.assertIn(detail, raised.exception.detail)

        party.remove_track(CODE, own_track.id, mia, self.db)
        remaining = party.get_party(CODE, mia, self.db)
        self.assertEqual([t.deezer_id for t in remaining.tracks], ["10", "30"])
        self.assertEqual(remaining.current_index, 1)
        self.assertEqual(remaining.viewer_key, f"g:{mia.guest.id}")
        party.remove_track(CODE, playing_own.id, host, self.db)

    def test_non_numeric_track_ids_are_rejected_before_anything_is_stored(self):
        _, token, _ = self.join("Mia")
        with self.assertRaises(HTTPException) as raised:
            party.add_track(CODE, Track(id="local-1"), self.guest_actor(token), self.db)
        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(self.db.scalars(select(PartyTrack)).all(), [])

    def test_guest_leaving_ends_identity_and_clears_cookie(self):
        _, token, _ = self.join("Mia")
        mia = self.guest_actor(token)
        self.add(mia, "20")
        response = party.leave_party(CODE, mia, self.db)
        self.assertIn('sf_party_guest=""', response.headers["set-cookie"])
        self.assertIn(f"Path=/api/party/{CODE}", response.headers["set-cookie"])
        self.assertEqual(self.db.scalars(select(PartyGuest)).all(), [])
        state = party.get_party(CODE, PartyActor(user=self.host), self.db)
        self.assertEqual([t.added_by for t in state.tracks], ["Mia"])
        with self.assertRaises(HTTPException):
            self.guest_actor(token)

    def test_every_commit_keeps_the_playing_and_next_tracks_loading(self):
        host = PartyActor(user=self.host)
        for deezer_id in ("10", "20", "10", "30"):
            self.add(host, deezer_id)
        party.set_current(CODE, party.CurrentUpdate(index=1), self.host, self.db)
        self.schedule.assert_called_with(["20", "10", "30"])

    def test_load_change_publishes_a_newer_revision_with_track_state(self):
        host = PartyActor(user=self.host)
        self.add(host, "10")
        before = self.db.get(PartySession, CODE).updated_at
        factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        with (
            patch.object(party, "SessionLocal", factory),
            patch.object(party_preload, "load_state", return_value=("failed", "Deezer: 403")),
        ):
            party._publish_load_change("10")
        frame = self.publish.call_args.args[1]
        self.assertGreater(frame.updated_at, party.party_bus.utc_revision(before))
        self.assertEqual(frame.payload["tracks"][0]["load_state"], "failed")
        self.assertEqual(frame.payload["tracks"][0]["load_error"], "Deezer: 403")


class _SyncExecutor:
    def submit(self, fn, *args):
        future = Future()
        future.set_result(fn(*args))
        return future


class PartyPreloadTests(unittest.TestCase):
    def setUp(self) -> None:
        party_preload.reset_for_tests()
        self.ready: set[str] = set()
        self.settled: list[tuple[str, tuple]] = []
        patches = (
            patch.object(party_preload, "_executor", _SyncExecutor()),
            patch.object(party_preload.storage, "is_ready", side_effect=lambda i: i in self.ready),
            patch.object(party_preload, "_on_track_settled", self.record),
        )
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(party_preload.reset_for_tests)

    def record(self, deezer_id: str) -> None:
        self.settled.append((deezer_id, party_preload.load_state(deezer_id)))

    def test_upcoming_starts_at_the_playhead_without_duplicates(self):
        ids = [str(i) for i in range(40)]
        self.assertEqual(party_preload.upcoming(["1", "2", "1", "3"], 1), ["2", "1", "3"])
        self.assertEqual(party_preload.upcoming(["1", "2"], -1), ["1", "2"])
        self.assertEqual(len(party_preload.upcoming(ids, 0)), party_preload.PARTY_PRELOAD_AHEAD)

    def test_loading_reports_progress_and_ends_ready(self):
        def materialize(deezer_id):
            self.ready.add(deezer_id)
            return f"/x/{deezer_id}.mp3"

        with patch.object(party_preload.storage, "materialize", side_effect=materialize):
            self.assertEqual(party_preload.schedule(["5"]), ["5"])
        self.assertEqual(self.settled, [("5", ("loading", None)), ("5", ("ready", None))])
        self.assertEqual(party_preload.schedule(["5"]), [])

    def test_failure_is_shown_with_its_cause_and_not_retried_at_once(self):
        with patch.object(
            party_preload.storage, "materialize", side_effect=RuntimeError("track unavailable")
        ):
            with self.assertLogs(party_preload.logger, "ERROR"):
                party_preload.schedule(["7"])
        self.assertEqual(
            party_preload.load_state("7"), ("failed", "RuntimeError: track unavailable")
        )
        self.assertEqual(party_preload.schedule(["7"]), [])

    def test_untouched_tracks_are_idle_and_bad_ids_fail_loudly(self):
        self.assertEqual(party_preload.load_state("9"), ("idle", None))
        with self.assertRaises(ValueError):
            party_preload.schedule(["abc"])


if __name__ == "__main__":
    unittest.main()
