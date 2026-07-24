import unittest
from unittest.mock import patch

from fastapi import HTTPException, Response
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db.models import InviteCode, User
from app.db.session import Base
from app.routers import auth as auth_router
from app.schemas.auth import LoginRequest, RegisterRequest


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

    def test_email_identity_is_case_insensitive_for_registration_and_login(self) -> None:
        registered = self.register("Mixed.Case@Example.COM")

        self.assertEqual(registered.email, "mixed.case@example.com")
        with self.assertRaises(HTTPException) as duplicate:
            self.register("MIXED.CASE@example.com")
        self.assertEqual(duplicate.exception.status_code, 409)

        response = Response()
        with (
            patch.object(auth_router, "verify_password", return_value=True) as verify,
            patch.object(auth_router, "create_token", return_value="login-token"),
        ):
            logged_in = auth_router.login(
                body=LoginRequest(
                    email="MIXED.CASE@EXAMPLE.COM",
                    password="valid-password",
                ),
                response=response,
                db=self.db,
            )

        self.assertEqual(logged_in.id, registered.id)
        verify.assert_called_once_with("valid-password", "deterministic-hash")
        self.assertIn("sf_session=login-token", response.headers["set-cookie"])


if __name__ == "__main__":
    unittest.main()
