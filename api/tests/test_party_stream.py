"""Party stream races, bounded delivery, cancellation and canonical revisions."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
from threading import Event, Thread, get_ident
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import PartyMember, PartySession, User
from app.db.session import Base
from app.routers import party
from app.services import party_bus


CODE = "STREAM"
STAMP = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)


def frame(version: int, name: str | None = None) -> party_bus.StateFrame:
    return party_bus.StateFrame(
        STAMP + timedelta(microseconds=version),
        {
            "code": CODE,
            "name": name if name is not None else str(version),
            "host_name": "Host",
            "is_host": False,
            "current_index": -1,
            "is_playing": False,
            "position_sec": 0.0,
            "playback_updated_at": None,
            "members": [],
            "tracks": [],
        },
    )


def data(event: str) -> dict:
    return json.loads(event.removeprefix("data: ").strip())


class PartyBusTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.subscriptions: list[party_bus.Subscription] = []

    async def asyncTearDown(self) -> None:
        for subscription in self.subscriptions:
            party_bus.unsubscribe(CODE, subscription)
        self.assertEqual(party_bus.subscriber_count(CODE), 0)

    def subscribe(self) -> party_bus.Subscription:
        subscription = party_bus.subscribe(CODE)
        self.subscriptions.append(subscription)
        return subscription

    async def test_slow_subscriber_has_one_frame_and_one_pending_loop_callback(self):
        subscription = self.subscribe()
        with patch.object(
            subscription.loop,
            "call_soon_threadsafe",
            wraps=subscription.loop.call_soon_threadsafe,
        ) as schedule:
            # Block loop delivery until all threadpool-style writes complete.
            publisher = Thread(
                target=lambda: [party_bus.publish(CODE, frame(i)) for i in range(1000)]
            )
            publisher.start()
            publisher.join(timeout=2)
            self.assertFalse(publisher.is_alive())
            self.assertEqual(schedule.call_count, 1)
            self.assertEqual(subscription.queue.maxsize, 1)
        await asyncio.sleep(0)
        self.assertEqual(subscription.queue.qsize(), 1)
        self.assertEqual(subscription.queue.get_nowait().payload["name"], "999")

    async def test_new_state_replaces_already_queued_full_frame(self):
        subscription = self.subscribe()
        party_bus.publish(CODE, frame(1))
        await asyncio.sleep(0)
        party_bus.publish(CODE, frame(2))
        await asyncio.sleep(0)
        self.assertEqual(subscription.queue.qsize(), 1)
        self.assertEqual(subscription.queue.get_nowait().payload["name"], "2")

    async def test_out_of_order_publish_cannot_overwrite_newer_frame(self):
        subscription = self.subscribe()
        party_bus.publish(CODE, frame(4))
        party_bus.publish(CODE, frame(2))
        party_bus.publish(CODE, frame(4, "duplicate revision"))
        await asyncio.sleep(0)
        self.assertEqual(subscription.queue.get_nowait().payload["name"], "4")

    async def test_pending_thread_handoff_is_compared_with_initial_snapshot(self):
        subscription = self.subscribe()
        party_bus.publish(CODE, frame(2))
        self.assertEqual(subscription.take_latest(frame(1)).payload["name"], "2")
        party_bus.publish(CODE, frame(1))
        await asyncio.sleep(0)
        self.assertTrue(subscription.queue.empty())

    async def test_new_snapshot_discards_old_queue_and_late_old_publish(self):
        subscription = self.subscribe()
        party_bus.publish(CODE, frame(1))
        await asyncio.sleep(0)
        self.assertEqual(subscription.take_latest(frame(3)).payload["name"], "3")
        party_bus.publish(CODE, frame(2))
        await asyncio.sleep(0)
        self.assertTrue(subscription.queue.empty())

    async def test_each_listener_retains_its_independent_latest_revision(self):
        first = self.subscribe()
        second = self.subscribe()
        first.take_latest(frame(2))
        second.take_latest(frame(1))
        await asyncio.to_thread(party_bus.publish, CODE, frame(2))
        await asyncio.sleep(0)
        self.assertTrue(first.queue.empty())
        self.assertEqual(second.queue.get_nowait().payload["name"], "2")

    async def test_connections_on_different_loops_receive_on_their_own_loop(self):
        first = self.subscribe()
        ready = Event()
        result = []
        failures = []

        async def listen_on_another_loop():
            second = party_bus.subscribe(CODE)
            try:
                self.assertIsNot(first.loop, second.loop)
                ready.set()
                result.append(await asyncio.wait_for(second.queue.get(), timeout=2))
            finally:
                party_bus.unsubscribe(CODE, second)

        def run_listener():
            try:
                asyncio.run(listen_on_another_loop())
            except BaseException as error:
                failures.append(error)
                ready.set()

        listener = Thread(target=run_listener)
        listener.start()
        self.assertTrue(await asyncio.to_thread(ready.wait, 1))
        party_bus.publish(CODE, frame(2))
        self.assertEqual((await first.queue.get()).payload["name"], "2")
        await asyncio.to_thread(listener.join, 2)
        self.assertFalse(listener.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual([item.payload["name"] for item in result], ["2"])

    async def test_unsubscribe_cancels_scheduled_delivery_and_releases_state(self):
        subscription = self.subscribe()
        party_bus.publish(CODE, frame(1))
        party_bus.unsubscribe(CODE, subscription)
        party_bus.publish(CODE, frame(2))
        await asyncio.sleep(0)
        self.assertEqual(party_bus.subscriber_count(CODE), 0)
        self.assertTrue(subscription.queue.empty())
        self.assertIsNone(subscription._pending)


class PartyStreamTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self) -> None:
        self.assertEqual(party_bus.subscriber_count(CODE), 0)

    async def connect(self, initial=None, user_id=10):
        with patch.object(party, "_stream_snapshot", return_value=(10, initial or frame(1))):
            return await party.party_events(CODE, SimpleNamespace(id=user_id))

    async def test_wire_fields_headers_and_host_stamp_are_preserved(self):
        for user_id, is_host in ((10, True), (20, False)):
            response = await self.connect(user_id=user_id)
            try:
                event = data(await anext(response.body_iterator))
                self.assertEqual(event, {**frame(1).payload, "is_host": is_host})
                self.assertEqual(response.headers["cache-control"], "no-cache, no-transform")
                self.assertEqual(response.headers["x-accel-buffering"], "no")
                self.assertTrue(response.headers["content-type"].startswith("text/event-stream"))
                self.assertNotIn("updated_at", event)
                self.assertFalse(frame(1).payload["is_host"])
            finally:
                await response.body_iterator.aclose()

    async def test_snapshot_io_runs_off_loop_and_mutation_during_setup_is_not_lost(self):
        loop = asyncio.get_running_loop()
        started = loop.create_future()
        release = Event()
        loop_thread = get_ident()
        snapshot_threads = []

        def load_snapshot(code):
            snapshot_threads.append(get_ident())
            self.assertEqual(party_bus.subscriber_count(code), 1)
            loop.call_soon_threadsafe(started.set_result, None)
            if not release.wait(timeout=2):
                raise AssertionError("Snapshot test was not released")
            return 10, frame(1)

        with patch.object(party, "_stream_snapshot", side_effect=load_snapshot):
            connecting = asyncio.create_task(party.party_events(CODE, SimpleNamespace(id=10)))
            try:
                await asyncio.wait_for(started, timeout=1)
                # This callback executes while the database worker is blocked.
                responsive = loop.create_future()
                loop.call_soon(responsive.set_result, True)
                self.assertTrue(await asyncio.wait_for(responsive, timeout=0.1))
                party_bus.publish(CODE, frame(2))
            finally:
                release.set()
            response = await connecting
        try:
            self.assertNotEqual(snapshot_threads, [loop_thread])
            self.assertEqual(data(await anext(response.body_iterator))["name"], "2")
        finally:
            await response.body_iterator.aclose()

    async def test_initial_snapshot_cannot_regress_to_a_delayed_older_publish(self):
        response = await self.connect(initial=frame(3))
        try:
            self.assertEqual(data(await anext(response.body_iterator))["name"], "3")
            party_bus.publish(CODE, frame(2))
            party_bus.publish(CODE, frame(4))
            self.assertEqual(
                data(await asyncio.wait_for(anext(response.body_iterator), timeout=1))["name"],
                "4",
            )
        finally:
            await response.body_iterator.aclose()

    async def test_idle_heartbeat_keeps_subscription_until_close(self):
        response = await self.connect()
        try:
            await anext(response.body_iterator)
            with patch.object(party, "_HEARTBEAT_SEC", 0.001):
                self.assertEqual(await anext(response.body_iterator), ": ping\n\n")
            self.assertEqual(party_bus.subscriber_count(CODE), 1)
        finally:
            await response.body_iterator.aclose()

    async def test_snapshot_failure_is_explicit_and_removes_subscription(self):
        failure = HTTPException(status_code=404, detail="Party not found")
        with patch.object(party, "_stream_snapshot", side_effect=failure):
            with self.assertRaises(HTTPException) as raised:
                await party.party_events(CODE, SimpleNamespace(id=10))
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(party_bus.subscriber_count(CODE), 0)

    async def test_cancel_during_snapshot_removes_subscription(self):
        loop = asyncio.get_running_loop()
        started = loop.create_future()
        release = Event()

        def load_snapshot(code):
            loop.call_soon_threadsafe(started.set_result, None)
            if not release.wait(timeout=2):
                raise AssertionError("Snapshot cancellation test was not released")
            return 10, frame(1)

        with patch.object(party, "_stream_snapshot", side_effect=load_snapshot):
            connecting = asyncio.create_task(party.party_events(CODE, SimpleNamespace(id=10)))
            try:
                await asyncio.wait_for(started, timeout=1)
                connecting.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await connecting
                self.assertEqual(party_bus.subscriber_count(CODE), 0)
            finally:
                release.set()

    async def test_cancel_while_waiting_for_frame_unsubscribes(self):
        response = await self.connect()
        await anext(response.body_iterator)
        waiting = asyncio.create_task(anext(response.body_iterator))
        await asyncio.sleep(0)
        waiting.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiting
        self.assertEqual(party_bus.subscriber_count(CODE), 0)

    async def test_send_failure_before_generator_starts_unsubscribes(self):
        response = await self.connect()

        async def receive():
            return {"type": "http.disconnect"}

        async def send(message):
            raise RuntimeError("Client transport failed")

        with self.assertRaises(ExceptionGroup) as failure:
            await response(
                {"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send
            )
        self.assertEqual(len(failure.exception.exceptions), 1)
        self.assertIsInstance(failure.exception.exceptions[0], RuntimeError)
        self.assertEqual(str(failure.exception.exceptions[0]), "Client transport failed")
        self.assertEqual(party_bus.subscriber_count(CODE), 0)

    async def test_asgi_disconnect_after_initial_frame_unsubscribes(self):
        response = await self.connect()
        disconnected = asyncio.Event()
        messages = []

        async def receive():
            await disconnected.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)
            if message["type"] == "http.response.body":
                disconnected.set()

        await asyncio.wait_for(
            response({"type": "http"}, receive, send), timeout=1
        )
        self.assertEqual(messages[0]["status"], 200)
        self.assertEqual(data(messages[1]["body"].decode())["name"], "1")
        self.assertEqual(party_bus.subscriber_count(CODE), 0)


class PartyCanonicalRevisionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.directory.name) / 'party.db'}")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.host = User(email="host@example.test", password_hash="unused")
        self.guest = User(email="guest@example.test", password_hash="unused")
        self.db.add_all([self.host, self.guest])
        self.db.flush()
        self.session = PartySession(code=CODE, host_id=self.host.id, updated_at=STAMP)
        self.db.add(self.session)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.directory.cleanup()

    def revision(self) -> datetime:
        return party_bus.utc_revision(self.db.scalar(
            select(PartySession.updated_at).where(PartySession.code == CODE)
        ))

    def test_join_read_registration_and_leave_each_publish_a_newer_canonical_revision(self):
        with patch.object(party.party_bus, "publish") as publish:
            previous = self.revision()
            mutations = (
                lambda: party.join_party(CODE, self.guest, self.db),
                lambda: party.get_party(CODE, self.host, self.db),
                lambda: party.leave_party(CODE, self.guest, self.db),
            )
            for mutate in mutations:
                mutate()
                current = self.revision()
                self.assertGreater(current, previous)
                published = publish.call_args.args[1]
                self.assertEqual(published.updated_at, current)
                self.assertNotIn("updated_at", published.payload)
                previous = current
            self.assertEqual(publish.call_count, 3)
            self.assertEqual(
                list(self.db.scalars(select(PartyMember.user_id))), [self.host.id]
            )

    def test_revision_stays_monotonic_if_wall_clock_moves_backwards(self):
        with patch.object(party, "_utcnow", return_value=STAMP - timedelta(days=1)):
            party._touch_session(self.db, self.session)
            self.db.commit()
        self.assertEqual(self.revision(), STAMP + timedelta(microseconds=1))

    def test_existing_member_presence_read_does_not_conflict_with_new_playback(self):
        with patch.object(party.party_bus, "publish"):
            party.join_party(CODE, self.guest, self.db)
            with Session(self.engine, expire_on_commit=False) as reading_db:
                stale = reading_db.get(PartySession, CODE)
                reading_db.commit()
                old_revision = party_bus.utc_revision(stale.updated_at)
                party.set_playback(
                    CODE,
                    party.PlaybackUpdate(is_playing=False, position_sec=7),
                    self.host,
                    self.db,
                )
                playback_revision = self.revision()
                self.assertGreater(playback_revision, old_revision)
                # Ordinary presence refresh uses the newer canonical snapshot
                # without trying to overwrite its stale session revision.
                response = party.get_party(CODE, self.guest, reading_db)
                self.assertEqual(response.position_sec, 7)
                self.assertEqual(self.revision(), playback_revision)

    def test_changed_member_name_advances_visible_state_revision(self):
        with patch.object(party.party_bus, "publish"):
            party.join_party(CODE, self.guest, self.db)
            previous = self.revision()
            self.guest.display_name = "Updated guest"
            response = party.get_party(CODE, self.guest, self.db)
        self.assertGreater(self.revision(), previous)
        self.assertEqual(response.members[0].name, "Updated guest")

    def test_stale_concurrent_mutation_fails_without_overwriting_committed_state(self):
        with Session(self.engine, expire_on_commit=False) as other_db:
            stale = other_db.get(PartySession, CODE)
            # Close the read transaction but retain its stale ORM revision.
            other_db.commit()
            party._touch_session(self.db, self.session)
            self.session.name = "Committed party"
            self.db.commit()
            stale.name = "Stale party"
            with self.assertRaises(HTTPException) as raised:
                party._touch_session(other_db, stale)
            self.assertEqual(raised.exception.status_code, 409)
        self.db.refresh(self.session)
        self.assertEqual(self.session.name, "Committed party")

    def test_canonical_validation_failure_happens_before_commit_or_publish(self):
        party._touch_session(self.db, self.session)
        self.session.name = "Pending party"
        with (
            patch.object(party, "_canonical_frame", side_effect=HTTPException(
                status_code=409, detail="Party changed while reading its state"
            )),
            patch.object(party.party_bus, "publish") as publish,
        ):
            with self.assertRaises(HTTPException):
                party._commit_state(self.db, self.session)
        publish.assert_not_called()
        with Session(self.engine) as reader:
            self.assertEqual(reader.get(PartySession, CODE).name, "")
        self.db.rollback()

    def test_frame_contains_flushed_changes_and_is_published_only_after_commit(self):
        party._touch_session(self.db, self.session)
        self.session.name = "Committed party"
        published = []

        def observe(code, captured):
            with Session(self.engine) as reader:
                self.assertEqual(reader.get(PartySession, code).name, "Committed party")
            published.append(captured)

        with patch.object(party.party_bus, "publish", side_effect=observe):
            captured = party._commit_state(self.db, self.session)
        self.assertEqual(captured.payload["name"], "Committed party")
        self.assertEqual(published, [captured])

    def test_snapshot_closes_worker_session_and_retains_real_wire_contract(self):
        factory = sessionmaker(bind=self.engine)
        with patch.object(party, "SessionLocal", factory):
            host_id, snapshot = party._stream_snapshot(CODE)
        self.assertEqual(host_id, self.host.id)
        self.assertEqual(snapshot.updated_at, self.revision())
        self.assertEqual(set(snapshot.payload), set(frame(0).payload))
        self.assertEqual(snapshot.payload["code"], CODE)

    def test_canonical_snapshot_retries_changes_during_relationship_reads(self):
        original = party._state_dict
        seen = []

        def snapshot(db, session):
            payload = original(db, session)
            seen.append(payload["name"])
            if len(seen) == 1:
                with Session(self.engine) as writer:
                    current = writer.get(PartySession, CODE)
                    party._touch_session(writer, current)
                    current.name = "New canonical party"
                    writer.commit()
            return payload

        with patch.object(party, "_state_dict", side_effect=snapshot):
            result = party._canonical_frame(self.db, self.session)
        self.assertEqual(seen, ["", "New canonical party"])
        self.assertEqual(result.payload["name"], "New canonical party")
        self.assertEqual(result.updated_at, self.revision())


if __name__ == "__main__":
    unittest.main()
