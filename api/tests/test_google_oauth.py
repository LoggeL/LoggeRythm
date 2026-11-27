from datetime import datetime, timedelta, timezone
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwk, jwt
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import config as cfg
from app.auth import verify_password
from app.db.models import InviteCode, OAuthExchangeCode, OAuthState, User
from app.db.session import Base, get_db
from app.main import _run_column_migrations
from app.routers import admin as admin_router
from app.routers import auth as auth_router
from app.routers import profile as profile_router
from app.schemas.auth import LoginRequest, PasswordResetRequest
from app.services import auth_mail, google_oauth, mail


def _make_rsa_jwk(kid: str):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    pub_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    jwk_dict = jwk.construct(pub_pem, algorithm="RS256").to_dict()
    jwk_dict["kid"] = kid
    jwk_dict["use"] = "sig"
    jwk_dict["alg"] = "RS256"
    return priv_pem, jwk_dict


class GoogleOAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.priv_k1, cls.jwk_k1 = _make_rsa_jwk("k1")
        cls.priv_k2, cls.jwk_k2 = _make_rsa_jwk("k2")

    def setUp(self) -> None:
        google_oauth.clear_jwks_cache()
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        with self.engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(self.engine)
        self.SessionFactory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )

        test_app = FastAPI()
        test_app.include_router(auth_router.router)
        test_app.include_router(profile_router.router)
        test_app.include_router(admin_router.router)

        def override_get_db():
            db = self.SessionFactory()
            try:
                yield db
            finally:
                db.close()

        test_app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(test_app)

        self.enterContext(patch.object(cfg, "GOOGLE_CLIENT_ID", "google-client-id"))
        self.enterContext(patch.object(cfg, "GOOGLE_CLIENT_SECRET", "google-client-secret"))
        self.enterContext(patch.object(cfg, "PUBLIC_APP_URL", "https://music.example.com"))
        self.enterContext(patch.object(cfg, "COOKIE_SECURE", False))
        self.enterContext(patch.object(mail, "configured", return_value=False))

    def tearDown(self) -> None:
        google_oauth.clear_jwks_cache()
        self.engine.dispose()

    def db_session(self) -> Session:
        return self.SessionFactory()

    def sign_id_token(
        self,
        *,
        sub: str = "google-sub-1",
        email: str = "Listener@Example.COM",
        email_verified: object = True,
        name: str | None = "Test Listener",
        nonce: str = "nonce-1",
        aud: str = "google-client-id",
        iss: str = "https://accounts.google.com",
        exp_offset: timedelta = timedelta(minutes=15),
        kid: str = "k1",
        priv_pem: bytes | None = None,
    ) -> str:
        now = datetime.now(timezone.utc)
        claims: dict[str, object] = {
            "sub": sub,
            "email": email,
            "nonce": nonce,
            "aud": aud,
            "iss": iss,
            "iat": int(now.timestamp()),
            "exp": int((now + exp_offset).timestamp()),
            "at_hash": "dummy-at-hash",
        }
        if email_verified is not None:
            claims["email_verified"] = email_verified
        if name is not None:
            claims["name"] = name
        return jwt.encode(
            claims,
            priv_pem or self.priv_k1,
            algorithm="RS256",
            headers={"kid": kid},
        )

    def mock_jwks_and_token(
        self,
        *,
        keys: list[dict] | None = None,
        token_builder=None,
    ):
        active_keys = keys if keys is not None else [self.jwk_k1]
        jwks_response = Mock(
            status_code=200,
            headers={"Cache-Control": "public, max-age=300"},
            json=Mock(return_value={"keys": active_keys}),
        )

        def post_side_effect(url, **kwargs):
            code = kwargs["data"]["code"]
            if callable(token_builder):
                id_tok = token_builder(code)
            else:
                id_tok = code
            return Mock(status_code=200, json=Mock(return_value={"id_token": id_tok}))

        return (
            patch.object(google_oauth.requests, "get", return_value=jwks_response),
            patch.object(google_oauth.requests, "post", side_effect=post_side_effect),
        )

    def _start_web(self, **params) -> tuple[str, str]:
        res = self.client.get("/api/auth/google/start", params=params, follow_redirects=False)
        self.assertEqual(res.status_code, 302)
        location = res.headers["location"]
        query = parse_qs(urlparse(location).query)
        state = query["state"][0]
        nonce = query["nonce"][0]
        self.assertIn("code_challenge", query)
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["redirect_uri"], ["https://music.example.com/api/auth/google/callback"])
        return state, nonce

    def test_runtime_config_validation_for_google_oauth(self) -> None:
        cfg.validate_runtime_config()

        with patch.object(cfg, "GOOGLE_CLIENT_ID", ""), patch.object(cfg, "GOOGLE_CLIENT_SECRET", ""):
            cfg.validate_runtime_config()

        with patch.object(cfg, "GOOGLE_CLIENT_SECRET", ""):
            with self.assertRaisesRegex(RuntimeError, "GOOGLE_CLIENT_SECRET"):
                cfg.validate_runtime_config()

        with patch.object(cfg, "PUBLIC_APP_URL", ""):
            with self.assertRaisesRegex(RuntimeError, "PUBLIC_APP_URL"):
                cfg.validate_runtime_config()

        with patch.object(cfg, "PUBLIC_APP_URL", "music.example.com"):
            with self.assertRaisesRegex(RuntimeError, "absolute http"):
                cfg.validate_runtime_config()

    def test_auth_providers_and_admin_status_reflect_google_config(self) -> None:
        self.assertEqual(self.client.get("/api/auth/providers").json(), {"google": True})
        with patch.object(cfg, "GOOGLE_CLIENT_SECRET", ""):
            self.assertEqual(self.client.get("/api/auth/providers").json(), {"google": False})

        with self.db_session() as db:
            admin = User(email="admin@example.com", password_hash="", is_admin=True, is_approved=True)
            db.add(admin)
            db.commit()
            with patch.object(admin_router.deezer_client, "health", return_value=False):
                status_out = admin_router.system_status(_admin=admin, db=db)
        self.assertTrue(status_out.integrations.google_oauth_configured)

    def test_web_first_user_becomes_approved_admin_without_password(self) -> None:
        state, nonce = self._start_web(next="/library?tab=playlists")
        id_token = self.sign_id_token(sub="sub-first", email="First.User@Example.COM", nonce=nonce)

        get_patch, post_patch = self.mock_jwks_and_token()
        with get_patch, post_patch:
            cb = self.client.get(
                "/api/auth/google/callback",
                params={"code": id_token, "state": state},
                follow_redirects=False,
            )

        self.assertEqual(cb.status_code, 303)
        self.assertEqual(cb.headers["location"], "/library?tab=playlists")
        self.assertIn("sf_session=", cb.headers.get("set-cookie", ""))

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(
            me.json(),
            {
                "id": 1,
                "email": "first.user@example.com",
                "display_name": "Test Listener",
                "is_admin": True,
                "is_approved": True,
                "avatar_url": None,
                "has_password": False,
                "google_linked": True,
            },
        )
        with self.db_session() as db:
            stored = db.get(User, 1)
            self.assertIsNotNone(stored)
            self.assertEqual(stored.password_hash, "")
            self.assertEqual(stored.google_sub, "sub-first")

    def test_web_subsequent_user_pending_notifies_admin_and_invite_auto_approves(self) -> None:
        with self.db_session() as db:
            admin = User(
                email="admin@example.com",
                password_hash="",
                google_sub="sub-admin",
                is_admin=True,
                is_approved=True,
            )
            db.add(admin)
            db.flush()
            invite = InviteCode(code="INV12345", created_by=admin.id)
            db.add(invite)
            db.commit()

        # Without invite -> pending approval + admin mail scheduled.
        state1, nonce1 = self._start_web(origin="/login")
        tok1 = self.sign_id_token(sub="sub-pending", email="pending@example.com", nonce=nonce1)
        get_p, post_p = self.mock_jwks_and_token()
        with (
            patch.object(mail, "configured", return_value=True),
            patch.object(auth_mail, "send_pending_registration_notice") as send_notice,
            get_p,
            post_p,
        ):
            cb1 = self.client.get(
                "/api/auth/google/callback",
                params={"code": tok1, "state": state1},
                follow_redirects=False,
            )
        self.assertEqual(cb1.status_code, 303)
        send_notice.assert_called_once_with(["admin@example.com"], "pending@example.com")
        self.assertFalse(self.client.get("/api/auth/me").json()["is_approved"])

        # With valid invite -> approved and invite atomically consumed.
        self.client.cookies.clear()
        state2, nonce2 = self._start_web(origin="/register", invite="INV12345")
        tok2 = self.sign_id_token(sub="sub-invited", email="invited@example.com", nonce=nonce2)
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            cb2 = self.client.get(
                "/api/auth/google/callback",
                params={"code": tok2, "state": state2},
                follow_redirects=False,
            )
        self.assertEqual(cb2.status_code, 303)
        me2 = self.client.get("/api/auth/me").json()
        self.assertTrue(me2["is_approved"])
        with self.db_session() as db:
            consumed = db.get(InviteCode, "INV12345")
            self.assertEqual(consumed.used_by, me2["id"])
            self.assertIsNotNone(consumed.used_at)

        # Reused invite fails cleanly without creating user.
        self.client.cookies.clear()
        state3, nonce3 = self._start_web(origin="/register", invite="INV12345")
        tok3 = self.sign_id_token(sub="sub-bad-inv", email="badinv@example.com", nonce=nonce3)
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            cb3 = self.client.get(
                "/api/auth/google/callback",
                params={"code": tok3, "state": state3},
                follow_redirects=False,
            )
        self.assertEqual(cb3.status_code, 303)
        self.assertIn("oauth_error=invalid_invite", cb3.headers["location"])
        with self.db_session() as db:
            self.assertIsNone(
                db.scalar(select(User).where(User.email == "badinv@example.com"))
            )

    def test_auto_links_existing_email_preserves_password_and_rejects_conflict(self) -> None:
        with self.db_session() as db:
            existing = User(
                email="existing@example.com",
                password_hash=auth_router.hash_password("secret-pw-123"),
                display_name="Existing User",
                is_admin=True,
                is_approved=True,
            )
            db.add(existing)
            db.commit()
            existing_id = existing.id

        state, nonce = self._start_web()
        tok = self.sign_id_token(
            sub="sub-linked",
            email="EXISTING@Example.com",
            name="Google Name",
            nonce=nonce,
        )
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            cb = self.client.get(
                "/api/auth/google/callback",
                params={"code": tok, "state": state},
                follow_redirects=False,
            )
        self.assertEqual(cb.status_code, 303)
        me = self.client.get("/api/auth/me").json()
        self.assertEqual(me["id"], existing_id)
        self.assertEqual(me["display_name"], "Existing User")
        self.assertTrue(me["has_password"])
        self.assertTrue(me["google_linked"])

        # Existing password login still works.
        pw_login = self.client.post(
            "/api/auth/login",
            json={"email": "existing@example.com", "password": "secret-pw-123"},
        )
        self.assertEqual(pw_login.status_code, 200)

        # Logging in with same google_sub under changed email still finds the account without consuming invites.
        state2, nonce2 = self._start_web(origin="/register", invite="IGNORED_FOR_EXISTING")
        tok2 = self.sign_id_token(sub="sub-linked", email="other@example.com", nonce=nonce2)
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            cb2 = self.client.get(
                "/api/auth/google/callback",
                params={"code": tok2, "state": state2},
                follow_redirects=False,
            )
        self.assertEqual(cb2.status_code, 303)
        self.assertEqual(cb2.headers["location"], "/")

        # Different google_sub for the same email is rejected as conflict.
        state3, nonce3 = self._start_web()
        tok3 = self.sign_id_token(sub="sub-intruder", email="existing@example.com", nonce=nonce3)
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            cb3 = self.client.get(
                "/api/auth/google/callback",
                params={"code": tok3, "state": state3},
                follow_redirects=False,
            )
        self.assertEqual(cb3.status_code, 303)
        self.assertIn("oauth_error=google_account_conflict", cb3.headers["location"])

    def test_id_token_validation_and_jwks_key_rotation(self) -> None:
        # Unverified email rejected.
        for bad_verified in (False, "true", None):
            tok = self.sign_id_token(email_verified=bad_verified, nonce="n1")
            get_p, _ = self.mock_jwks_and_token()
            with get_p, self.assertRaises(google_oauth.GoogleOAuthError) as ctx:
                google_oauth.verify_id_token(tok, expected_nonce="n1")
            self.assertEqual(ctx.exception.code, "google_email_unverified")

        # Bad aud / iss / nonce / expired exp / unknown kid rejected.
        for label, kwargs in (
            ("aud", {"aud": "other-client"}),
            ("iss", {"iss": "https://evil.example"}),
            ("nonce", {"nonce": "wrong-nonce"}),
            ("exp", {"exp_offset": timedelta(minutes=-5)}),
            ("kid", {"kid": "unknown-kid"}),
        ):
            tok = self.sign_id_token(**kwargs) if label != "nonce" else self.sign_id_token(nonce="wrong")
            get_p, _ = self.mock_jwks_and_token()
            with self.subTest(case=label), get_p, self.assertRaises(google_oauth.GoogleOAuthError) as ctx:
                google_oauth.verify_id_token(tok, expected_nonce="nonce-1")
            self.assertEqual(ctx.exception.code, "google_invalid_token")

        # Key rotation: first fetch caches k1, then k2 arrives and triggers a refresh.
        google_oauth.clear_jwks_cache()
        tok_k1 = self.sign_id_token(kid="k1", priv_pem=self.priv_k1, nonce="n-rot")
        tok_k2 = self.sign_id_token(kid="k2", priv_pem=self.priv_k2, nonce="n-rot")
        resp1 = Mock(status_code=200, headers={}, json=Mock(return_value={"keys": [self.jwk_k1]}))
        resp2 = Mock(status_code=200, headers={}, json=Mock(return_value={"keys": [self.jwk_k1, self.jwk_k2]}))
        with patch.object(google_oauth.requests, "get", side_effect=[resp1, resp2]) as get_mock:
            id1 = google_oauth.verify_id_token(tok_k1, expected_nonce="n-rot")
            id2 = google_oauth.verify_id_token(tok_k2, expected_nonce="n-rot")
        self.assertEqual(id1.sub, id2.sub)
        self.assertEqual(get_mock.call_count, 2)

    def test_state_binding_replay_expiry_and_cancel_redirect(self) -> None:
        # Missing state -> invalid_state
        missing = self.client.get("/api/auth/google/callback", follow_redirects=False)
        self.assertEqual(missing.status_code, 303)
        self.assertEqual(missing.headers["location"], "/login?oauth_error=invalid_state")

        # Missing/tampered cookie -> invalid_state
        state, _ = self._start_web()
        self.client.cookies.set(google_oauth.STATE_COOKIE, "wrong-cookie")
        bad_cookie = self.client.get(
            "/api/auth/google/callback",
            params={"state": state, "code": "abc"},
            follow_redirects=False,
        )
        self.assertEqual(bad_cookie.headers["location"], "/login?oauth_error=invalid_state")

        # Replay of same state fails cleanly.
        replay = self.client.get(
            "/api/auth/google/callback",
            params={"state": state, "code": "abc"},
            follow_redirects=False,
        )
        self.assertEqual(replay.headers["location"], "/login?oauth_error=invalid_state")

        # Cancel preserves origin_path, next, and invite.
        self.client.cookies.clear()
        cancel_state, _ = self._start_web(
            origin="/register", next="/library", invite="INV99"
        )
        cancel_res = self.client.get(
            "/api/auth/google/callback",
            params={"state": cancel_state, "error": "access_denied"},
            follow_redirects=False,
        )
        self.assertEqual(cancel_res.status_code, 303)
        parsed = urlparse(cancel_res.headers["location"])
        self.assertEqual(parsed.path, "/register")
        self.assertEqual(
            parse_qs(parsed.query),
            {"oauth_error": ["access_denied"], "next": ["/library"], "invite": ["INV99"]},
        )

        # Expired state fails cleanly.
        exp_state, _ = self._start_web()
        with self.db_session() as db:
            row = db.scalar(
                select(OAuthState).where(
                    OAuthState.state_hash == google_oauth.hash_secret(exp_state)
                )
            )
            row.expires_at = auth_router._utcnow_naive() - timedelta(seconds=1)
            db.commit()
        exp_res = self.client.get(
            "/api/auth/google/callback",
            params={"state": exp_state, "code": "abc"},
            follow_redirects=False,
        )
        self.assertEqual(exp_res.headers["location"], "/login?oauth_error=invalid_state")

    def test_google_only_user_cannot_login_with_password_until_password_set(self) -> None:
        self.assertFalse(verify_password("anything", ""))

        state, nonce = self._start_web()
        tok = self.sign_id_token(sub="sub-nopw", email="nopw@example.com", nonce=nonce)
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            self.client.get(
                "/api/auth/google/callback",
                params={"code": tok, "state": state},
                follow_redirects=False,
            )

        self.client.cookies.clear()
        failed_login = self.client.post(
            "/api/auth/login",
            json={"email": "nopw@example.com", "password": "some-password"},
        )
        self.assertEqual(failed_login.status_code, 401)

        # Set a password via PATCH /api/me (or reset_password) and verify password login then succeeds.
        state2, nonce2 = self._start_web()
        tok2 = self.sign_id_token(sub="sub-nopw", email="nopw@example.com", nonce=nonce2)
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            self.client.get(
                "/api/auth/google/callback",
                params={"code": tok2, "state": state2},
                follow_redirects=False,
            )
        patched = self.client.patch("/api/me", json={"password": "new-secure-password"})
        self.assertEqual(patched.status_code, 200)
        self.assertTrue(patched.json()["has_password"])
        self.assertTrue(patched.json()["google_linked"])

        self.client.cookies.clear()
        ok_login = self.client.post(
            "/api/auth/login",
            json={"email": "nopw@example.com", "password": "new-secure-password"},
        )
        self.assertEqual(ok_login.status_code, 200)

    def test_mobile_google_oauth_flow_start_callback_exchange_and_errors(self) -> None:
        with patch.object(cfg, "GOOGLE_CLIENT_SECRET", ""):
            disabled = self.client.post("/api/auth/google/mobile/start", json={"invite": None})
            self.assertEqual(disabled.status_code, 503)

        started = self.client.post("/api/auth/google/mobile/start", json={"invite": None})
        self.assertEqual(started.status_code, 200)
        body = started.json()
        handoff_secret = body["handoff_secret"]
        self.assertEqual(body["expires_in_sec"], 600)
        query = parse_qs(urlparse(body["auth_url"]).query)
        state = query["state"][0]
        nonce = query["nonce"][0]

        tok = self.sign_id_token(sub="sub-mobile", email="mobile@example.com", nonce=nonce)
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            cb = self.client.get(
                "/api/auth/google/callback",
                params={"code": tok, "state": state},
                follow_redirects=False,
            )
        self.assertEqual(cb.status_code, 303)
        self.assertNotIn("set-cookie", {k.lower(): v for k, v in cb.headers.items()})
        cb_url = urlparse(cb.headers["location"])
        self.assertEqual(cb_url.scheme, "loggerythm")
        self.assertEqual(cb_url.netloc, "auth")
        self.assertEqual(cb_url.path, "/google/callback")
        exchange_code = parse_qs(cb_url.query)["code"][0]

        # Wrong handoff secret fails without consuming or leaking session.
        bad_secret = self.client.post(
            "/api/auth/google/mobile/exchange",
            json={"code": exchange_code, "handoff_secret": "x" * 32},
        )
        self.assertEqual(bad_secret.status_code, 400)

        # Valid exchange sets sf_session and returns UserOut.
        exchanged = self.client.post(
            "/api/auth/google/mobile/exchange",
            json={"code": exchange_code, "handoff_secret": handoff_secret},
        )
        self.assertEqual(exchanged.status_code, 200)
        self.assertIn("sf_session=", exchanged.headers.get("set-cookie", ""))
        self.assertEqual(exchanged.json()["has_password"], False)
        self.assertEqual(exchanged.json()["google_linked"], True)

        # Replay of same exchange code returns 400.
        replay = self.client.post(
            "/api/auth/google/mobile/exchange",
            json={"code": exchange_code, "handoff_secret": handoff_secret},
        )
        self.assertEqual(replay.status_code, 400)

        # Mobile cancel redirects to app scheme with error.
        started2 = self.client.post("/api/auth/google/mobile/start", json={"invite": None}).json()
        state2 = parse_qs(urlparse(started2["auth_url"]).query)["state"][0]
        cancel_cb = self.client.get(
            "/api/auth/google/callback",
            params={"state": state2, "error": "access_denied"},
            follow_redirects=False,
        )
        self.assertEqual(cancel_cb.status_code, 303)
        self.assertEqual(
            cancel_cb.headers["location"],
            "loggerythm://auth/google/callback?error=access_denied",
        )

        # Expired exchange code returns 400.
        started3 = self.client.post("/api/auth/google/mobile/start", json={"invite": None}).json()
        q3 = parse_qs(urlparse(started3["auth_url"]).query)
        tok3 = self.sign_id_token(sub="sub-mobile", email="mobile@example.com", nonce=q3["nonce"][0])
        get_p, post_p = self.mock_jwks_and_token()
        with get_p, post_p:
            cb3 = self.client.get(
                "/api/auth/google/callback",
                params={"code": tok3, "state": q3["state"][0]},
                follow_redirects=False,
            )
        exp_code = parse_qs(urlparse(cb3.headers["location"]).query)["code"][0]
        with self.db_session() as db:
            row = db.scalar(
                select(OAuthExchangeCode).where(
                    OAuthExchangeCode.code_hash == google_oauth.hash_secret(exp_code)
                )
            )
            row.expires_at = auth_router._utcnow_naive() - timedelta(seconds=1)
            db.commit()
        exp_exchange = self.client.post(
            "/api/auth/google/mobile/exchange",
            json={"code": exp_code, "handoff_secret": started3["handoff_secret"]},
        )
        self.assertEqual(exp_exchange.status_code, 400)

    def test_legacy_sqlite_migration_adds_google_sub_and_partial_unique_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = f"{tmpdir}/legacy.db"
            conn = sqlite3.connect(db_path)
            conn.executescript(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    email VARCHAR(320) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    display_name VARCHAR(120),
                    created_at DATETIME
                );
                INSERT INTO users (id, email, password_hash, display_name)
                VALUES (1, 'a@example.com', 'h1', 'A'), (2, 'b@example.com', 'h2', 'B');
                """
            )
            conn.close()

            legacy_engine = create_engine(f"sqlite+pysqlite:///{db_path}", future=True)
            try:
                _run_column_migrations(legacy_engine)
                with Session(legacy_engine) as session:
                    users = list(session.scalars(select(User).order_by(User.id)))
                    self.assertEqual([u.google_sub for u in users], [None, None])
                    users[0].google_sub = "shared-sub"
                    session.commit()
                    users[1].google_sub = "shared-sub"
                    with self.assertRaises(IntegrityError):
                        session.commit()
                    session.rollback()
            finally:
                legacy_engine.dispose()


if __name__ == "__main__":
    unittest.main()
