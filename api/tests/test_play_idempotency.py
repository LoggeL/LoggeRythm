from __future__ import annotations

import asyncio
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi import FastAPI
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateColumn, CreateIndex

from app import main
from app.auth import get_current_user
from app.db.models import Play, User
from app.db.session import Base, get_db
from app.routers import stats
from app.schemas.track import Track


def _track_payload(track_id: str = "31337", *, title: str = "First") -> dict:
    return {
        "id": track_id,
        "title": title,
        "artist": "Idempotent Artist",
        "artist_id": "42",
        "album": "Exactly Once",
        "album_id": "7",
        "duration_sec": 180,
    }


async def _asgi_post_play(
    api: FastAPI,
    payload: dict,
    *,
    idempotency_key: str | None,
) -> tuple[int, bytes]:
    """Exercise FastAPI's real request validation without an HTTP client extra."""
    request_sent = False
    messages: list[dict] = []

    async def receive() -> dict:
        nonlocal request_sent
        if request_sent:
            return {"type": "http.disconnect"}
        request_sent = True
        return {
            "type": "http.request",
            "body": json.dumps(payload).encode("utf-8"),
            "more_body": False,
        }

    async def send(message: dict) -> None:
        messages.append(message)

    headers = [
        (b"host", b"api.example.test"),
        (b"content-type", b"application/json"),
    ]
    if idempotency_key is not None:
        headers.append((b"idempotency-key", idempotency_key.encode("ascii")))

    await api(
        {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/api/me/plays",
            "raw_path": b"/api/me/plays",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 12345),
            "server": ("api.example.test", 443),
            "root_path": "",
        },
        receive,
        send,
    )
    status_message = next(
        message
        for message in messages
        if message["type"] == "http.response.start"
    )
    body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return status_message["status"], body


class PlayIdempotencyApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.first_user = self._add_user("first@example.test")
        self.second_user = self._add_user("second@example.test")
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _add_user(self, email: str) -> User:
        user = User(
            email=email,
            password_hash="unused",
            display_name=email,
            is_approved=True,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def _rows(self) -> list[Play]:
        self.db.expire_all()
        return list(self.db.scalars(select(Play).order_by(Play.id)))

    def _record(
        self,
        *,
        key: str | None = None,
        title: str = "First",
        user: User | None = None,
    ):
        parsed_key = (
            None
            if key is None
            else TypeAdapter(stats.PlayIdempotencyKey).validate_python(key)
        )
        return stats.record_play(
            track=Track.model_validate(_track_payload(title=title)),
            idempotency_key=parsed_key,
            user=user or self.first_user,
            db=self.db,
        )

    def test_same_user_duplicate_key_returns_success_without_second_insert(self) -> None:
        event_id = str(uuid4())

        first = self._record(key=event_id, title="Original payload")
        duplicate = self._record(key=event_id, title="Retry payload")

        self.assertEqual(first.status_code, 204)
        self.assertEqual(duplicate.status_code, 204)
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].event_id, UUID(event_id))
        self.assertEqual(rows[0].title, "Original payload")

    def test_same_uuid_is_independent_for_different_users(self) -> None:
        event_id = str(uuid4())

        self.assertEqual(self._record(key=event_id).status_code, 204)
        self.assertEqual(
            self._record(key=event_id, user=self.second_user).status_code,
            204,
        )

        rows = self._rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual({row.user_id for row in rows}, {self.first_user.id, self.second_user.id})
        self.assertEqual({row.event_id for row in rows}, {UUID(event_id)})

    def test_different_uuids_create_distinct_events(self) -> None:
        first_id = str(uuid4())
        second_id = str(uuid4())

        self.assertEqual(self._record(key=first_id).status_code, 204)
        self.assertEqual(self._record(key=second_id).status_code, 204)

        self.assertEqual(
            {row.event_id for row in self._rows()},
            {UUID(first_id), UUID(second_id)},
        )

    def test_missing_key_preserves_legacy_additive_behavior(self) -> None:
        self.assertEqual(self._record().status_code, 204)
        self.assertEqual(self._record().status_code, 204)

        rows = self._rows()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row.event_id is None for row in rows))

    def test_omitted_header_injects_none_and_returns_an_exact_empty_204(self) -> None:
        api = FastAPI()
        api.include_router(stats.router)
        api.dependency_overrides[get_current_user] = lambda: self.first_user
        api.dependency_overrides[get_db] = lambda: self.db

        status_code, body = asyncio.run(
            _asgi_post_play(api, _track_payload(), idempotency_key=None)
        )

        self.assertEqual(status_code, 204)
        self.assertEqual(body, b"")
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].event_id)

    def test_malformed_or_noncanonical_key_is_rejected_before_insert(self) -> None:
        api = FastAPI()
        api.include_router(stats.router)
        api.dependency_overrides[get_current_user] = lambda: self.first_user
        api.dependency_overrides[get_db] = lambda: self.db
        malformed = (
            "not-a-uuid",
            "null",
            "123e4567e89b12d3a456426614174000",
            "{123e4567-e89b-12d3-a456-426614174000}",
            "123e4567-e89b-12d3-a456-42661417400z",
        )
        for value in malformed:
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    TypeAdapter(stats.PlayIdempotencyKey).validate_python(value)
                status_code, response_body = asyncio.run(
                    _asgi_post_play(
                        api,
                        _track_payload(),
                        idempotency_key=value,
                    )
                )
                self.assertEqual(status_code, 422)
                body = json.loads(response_body)
                self.assertEqual(body["detail"][0]["loc"], ["header", "Idempotency-Key"])

        self.assertEqual(self._rows(), [])


class PlayIdempotencyConcurrencyTests(unittest.TestCase):
    def test_concurrent_duplicate_requests_converge_to_one_row(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "plays.sqlite3"
            engine = create_engine(
                f"sqlite+pysqlite:///{database}",
                connect_args={"check_same_thread": False, "timeout": 10},
                future=True,
            )
            Base.metadata.create_all(engine)
            with Session(engine) as setup:
                user = User(
                    email="race@example.test",
                    password_hash="unused",
                    is_approved=True,
                )
                setup.add(user)
                setup.commit()
                user_id = user.id

            event_id = uuid4()
            barrier = threading.Barrier(2)

            def submit() -> int:
                with Session(engine) as db:
                    user = db.get(User, user_id)
                    assert user is not None
                    barrier.wait(timeout=5)
                    response = stats.record_play(
                        track=Track.model_validate(_track_payload()),
                        idempotency_key=event_id,
                        user=user,
                        db=db,
                    )
                    return response.status_code

            with ThreadPoolExecutor(max_workers=2) as executor:
                statuses = list(executor.map(lambda _index: submit(), range(2)))

            with Session(engine) as db:
                count = db.scalar(select(func.count()).select_from(Play))
            engine.dispose()

        self.assertEqual(statuses, [204, 204])
        self.assertEqual(count, 1)


class PlayIdempotencyMigrationTests(unittest.TestCase):
    def test_existing_sqlite_schema_is_migrated_once_and_enforces_scope(self) -> None:
        engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE plays ("
                "id INTEGER PRIMARY KEY, "
                "user_id INTEGER NOT NULL, "
                "deezer_id VARCHAR(32) NOT NULL"
                ")"
            )
            connection.exec_driver_sql(
                "INSERT INTO plays (id, user_id, deezer_id) VALUES (1, 10, 'legacy')"
            )

        with patch.object(main, "engine", engine):
            main._run_column_migrations()
            main._run_column_migrations()

        inspector = inspect(engine)
        self.assertIn("event_id", {column["name"] for column in inspector.get_columns("plays")})
        matching_indexes = [
            index
            for index in inspector.get_indexes("plays")
            if index["name"] == "uq_play_user_event_id"
        ]
        self.assertEqual(len(matching_indexes), 1)
        self.assertTrue(matching_indexes[0]["unique"])
        self.assertEqual(matching_indexes[0]["column_names"], ["user_id", "event_id"])

        event_id = uuid4().hex
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO plays (id, user_id, deezer_id, event_id) "
                "VALUES (2, 10, 'new', ?)",
                (event_id,),
            )
            connection.exec_driver_sql(
                "INSERT INTO plays (id, user_id, deezer_id, event_id) "
                "VALUES (3, 11, 'other-user', ?)",
                (event_id,),
            )
            connection.exec_driver_sql(
                "INSERT INTO plays (id, user_id, deezer_id, event_id) "
                "VALUES (4, 10, 'legacy-null', NULL)"
            )

        with self.assertRaises(IntegrityError):
            with engine.begin() as connection:
                connection.exec_driver_sql(
                    "INSERT INTO plays (id, user_id, deezer_id, event_id) "
                    "VALUES (5, 10, 'duplicate', ?)",
                    (event_id,),
                )
        engine.dispose()

    def test_model_ddl_compiles_for_sqlite_and_postgresql(self) -> None:
        event_column = Play.__table__.c.event_id
        event_index = next(
            index
            for index in Play.__table__.indexes
            if index.name == "uq_play_user_event_id"
        )

        sqlite_column = str(CreateColumn(event_column).compile(dialect=sqlite.dialect()))
        postgres_column = str(
            CreateColumn(event_column).compile(dialect=postgresql.dialect())
        )
        sqlite_index = str(CreateIndex(event_index).compile(dialect=sqlite.dialect()))
        postgres_index = str(
            CreateIndex(event_index).compile(dialect=postgresql.dialect())
        )

        self.assertIn("CHAR(32)", sqlite_column)
        self.assertIn("UUID", postgres_column)
        for statement in (sqlite_index, postgres_index):
            self.assertEqual(
                statement,
                "CREATE UNIQUE INDEX uq_play_user_event_id ON plays (user_id, event_id)",
            )


if __name__ == "__main__":
    unittest.main()
