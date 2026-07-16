import unittest
from unittest.mock import patch

from fastapi import Response
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db.models import InviteCode, User
from app.db.session import Base
from app.routers import auth as auth_router
from app.schemas.auth import RegisterRequest


class AuthRegistrationPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        with self.engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def register(self, email: str, *, invite: str | None = None):
        response = Response()
        with (
            patch.object(auth_router, "hash_password", return_value="deterministic-hash"),
            patch.object(auth_router, "create_token", return_value="deterministic-token"),
        ):
            result = auth_router.register(
                body=RegisterRequest(
                    email=email,
                    password="valid-password",
                    display_name=email.split("@", 1)[0],
                    invite=invite,
                ),
                response=response,
                db=self.db,
            )
        self.assertIn("sf_session=deterministic-token", response.headers["set-cookie"])
        return result

    def test_first_registered_user_is_approved_admin(self) -> None:
        registered = self.register("first@example.com")

        self.assertTrue(registered.is_admin)
        self.assertTrue(registered.is_approved)
        stored = self.db.get(User, registered.id)
        self.assertIsNotNone(stored)
        self.assertTrue(stored.is_admin)
        self.assertTrue(stored.is_approved)
        self.assertEqual(
            self.db.scalar(select(func.count()).select_from(User)),
            1,
        )

    def test_ordinary_non_first_user_remains_pending(self) -> None:
        self.register("admin@example.com")
        registered = self.register("pending@example.com")

        self.assertFalse(registered.is_admin)
        self.assertFalse(registered.is_approved)
        stored = self.db.get(User, registered.id)
        self.assertIsNotNone(stored)
        self.assertFalse(stored.is_admin)
        self.assertFalse(stored.is_approved)

    def test_unused_invite_auto_approves_non_first_user_and_is_consumed(self) -> None:
        admin = self.register("admin@example.com")
        invite = InviteCode(code="INVITE01", created_by=admin.id)
        self.db.add(invite)
        self.db.commit()

        registered = self.register("invited@example.com", invite=invite.code)

        self.assertFalse(registered.is_admin)
        self.assertTrue(registered.is_approved)
        self.db.expire_all()
        consumed = self.db.get(InviteCode, invite.code)
        self.assertIsNotNone(consumed)
        self.assertEqual(consumed.used_by, registered.id)
        self.assertIsNotNone(consumed.used_at)


if __name__ == "__main__":
    unittest.main()
