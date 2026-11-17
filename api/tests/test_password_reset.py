import unittest
from datetime import timedelta
from unittest.mock import Mock, patch

import requests
from fastapi import BackgroundTasks, HTTPException, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import config as cfg
from app.db.models import PasswordResetToken, User
from app.db.session import Base
from app.routers import auth as auth_router
from app.schemas.auth import PasswordForgotRequest, PasswordResetRequest, RegisterRequest
from app.services import auth_mail, mail


class PasswordResetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="user@example.com", password_hash="old-hash", is_approved=True)
        self.db.add(self.user)
        self.db.commit()
        self.enterContext(patch.object(mail, "configured", return_value=True))
        self.sent = self.enterContext(patch.object(auth_mail, "send_password_reset"))

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def forgot(self, email: str = "user@example.com") -> Response:
        return auth_router.forgot_password(PasswordForgotRequest(email=email), db=self.db)

    def reset(self, token: str, password: str = "new-password") -> Response:
        response = Response()
        with (
            patch.object(auth_router, "hash_password", side_effect=lambda p: f"hash:{p}"),
            patch.object(auth_router, "create_token", return_value="session-token"),
        ):
            auth_router.reset_password(
                PasswordResetRequest(token=token, password=password), response=response, db=self.db
            )
        return response

    def last_token(self) -> str:
        return self.sent.call_args.args[1]

    def tokens(self) -> list[PasswordResetToken]:
        return list(self.db.scalars(select(PasswordResetToken).order_by(PasswordResetToken.id)))

    def test_forgot_without_mail_config_fails_with_503(self) -> None:
        with patch.object(mail, "configured", return_value=False), self.assertRaises(HTTPException) as ctx:
            self.forgot()
        self.assertEqual(ctx.exception.status_code, 503)
        self.sent.assert_not_called()

    def test_unknown_email_answers_204_without_mail(self) -> None:
        self.assertEqual(self.forgot("nobody@example.com").status_code, 204)
        self.sent.assert_not_called()
        self.assertEqual(self.tokens(), [])

    def test_reset_link_sets_password_signs_in_and_is_single_use(self) -> None:
        self.assertEqual(self.forgot("USER@example.com").status_code, 204)
        self.sent.assert_called_once()
        token = self.last_token()
        [stored] = self.tokens()
        self.assertNotEqual(stored.token_hash, token, "only the hash may be stored")

        response = self.reset(token)
        self.assertIn("sf_session=session-token", response.headers["set-cookie"])
        self.db.refresh(self.user)
        self.assertEqual(self.user.password_hash, "hash:new-password")

        with self.assertRaises(HTTPException) as ctx:
            self.reset(token, "another-password")
        self.assertEqual(ctx.exception.status_code, 400)
        self.db.refresh(self.user)
        self.assertEqual(self.user.password_hash, "hash:new-password")

    def test_expired_and_unknown_tokens_are_rejected(self) -> None:
        self.forgot()
        token = self.last_token()
        [stored] = self.tokens()
        stored.expires_at = auth_router._utcnow_naive() - timedelta(seconds=1)
        self.db.commit()
        for candidate in (token, "x" * 43):
            with self.assertRaises(HTTPException) as ctx:
                self.reset(candidate)
            self.assertEqual(ctx.exception.status_code, 400)
        self.db.refresh(self.user)
        self.assertEqual(self.user.password_hash, "old-hash")

    def test_repeat_request_inside_cooldown_sends_no_second_mail(self) -> None:
        self.forgot()
        self.forgot()
        self.sent.assert_called_once()
        self.assertEqual(len(self.tokens()), 1)

    def test_new_request_after_cooldown_invalidates_the_previous_link(self) -> None:
        self.forgot()
        first = self.last_token()
        [stored] = self.tokens()
        stored.created_at -= timedelta(minutes=5)
        self.db.commit()
        self.forgot()
        second = self.last_token()
        self.assertNotEqual(first, second)
        with self.assertRaises(HTTPException):
            self.reset(first)
        self.reset(second)

    def test_delivery_failure_is_reported_and_stores_no_token(self) -> None:
        self.sent.side_effect = mail.MailDeliveryError("Resend rejected the mail with HTTP 403")
        with self.assertRaises(HTTPException) as ctx:
            self.forgot()
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertIn("HTTP 403", ctx.exception.detail)
        self.assertEqual(self.tokens(), [])


class PendingRegistrationNoticeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def register(self, email: str, *, configured: bool) -> BackgroundTasks:
        tasks = BackgroundTasks()
        with (
            patch.object(mail, "configured", return_value=configured),
            patch.object(auth_router, "hash_password", return_value="hash"),
            patch.object(auth_router, "create_token", return_value="token"),
        ):
            auth_router.register(
                body=RegisterRequest(email=email, password="valid-password"),
                response=Response(),
                background_tasks=tasks,
                db=self.db,
            )
        return tasks

    def test_pending_registration_notifies_admins_after_the_response(self) -> None:
        self.assertEqual(self.register("admin@example.com", configured=True).tasks, [])
        [task] = self.register("pending@example.com", configured=True).tasks
        self.assertIs(task.func, auth_mail.send_pending_registration_notice)
        self.assertEqual(task.args, (["admin@example.com"], "pending@example.com"))

    def test_without_mail_config_no_notice_is_scheduled(self) -> None:
        self.register("admin@example.com", configured=False)
        self.assertEqual(self.register("pending@example.com", configured=False).tasks, [])


class ResendClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.enterContext(patch.object(cfg, "RESEND_API_KEY", "re_test"))
        self.enterContext(patch.object(cfg, "MAIL_FROM", "LoggeRythm <noreply@example.com>"))
        self.enterContext(patch.object(cfg, "PUBLIC_APP_URL", "https://music.example.com"))

    def send(self) -> str:
        return mail.send(to=["a@example.com"], subject="S", text="T", html="<p>H</p>")

    def test_send_posts_to_resend_and_returns_the_message_id(self) -> None:
        response = Mock(status_code=200, json=Mock(return_value={"id": "msg_1"}))
        with patch.object(mail.requests, "post", return_value=response) as post:
            self.assertEqual(self.send(), "msg_1")
        self.assertEqual(post.call_args.kwargs["headers"], {"Authorization": "Bearer re_test"})
        self.assertEqual(post.call_args.kwargs["json"]["from"], "LoggeRythm <noreply@example.com>")
        self.assertEqual(post.call_args.kwargs["json"]["to"], ["a@example.com"])

    def test_rejected_and_failed_requests_raise_with_the_cause(self) -> None:
        rejected = Mock(status_code=403, text='{"message":"domain not verified"}')
        with patch.object(mail.requests, "post", return_value=rejected):
            with self.assertRaisesRegex(mail.MailDeliveryError, "HTTP 403.*domain not verified"):
                self.send()
        with patch.object(mail.requests, "post", side_effect=requests.ConnectionError("down")):
            with self.assertRaisesRegex(mail.MailDeliveryError, "request failed: down"):
                self.send()

    def test_send_without_key_raises_not_configured(self) -> None:
        with patch.object(cfg, "RESEND_API_KEY", ""), self.assertRaises(mail.MailNotConfiguredError):
            self.send()

    def test_reset_mail_links_to_the_public_web_app(self) -> None:
        user = User(email="user@example.com", display_name="Logge", password_hash="x")
        with patch.object(mail, "send") as send:
            auth_mail.send_password_reset(user, "tok123")
        self.assertIn("https://music.example.com/reset-password?token=tok123", send.call_args.kwargs["text"])
        self.assertEqual(send.call_args.kwargs["to"], ["user@example.com"])

    def test_partial_mail_config_fails_startup_validation(self) -> None:
        with patch.object(cfg, "MAIL_FROM", ""), self.assertRaisesRegex(RuntimeError, "MAIL_FROM"):
            cfg.validate_runtime_config()
        with patch.object(cfg, "PUBLIC_APP_URL", "music.example.com"):
            with self.assertRaisesRegex(RuntimeError, "absolute http"):
                cfg.validate_runtime_config()
        cfg.validate_runtime_config()


if __name__ == "__main__":
    unittest.main()
