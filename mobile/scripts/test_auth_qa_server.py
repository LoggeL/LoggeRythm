"""Focused contract tests for the disposable Android auth QA backend."""

from __future__ import annotations

import http.client
import json
import unittest
from urllib.parse import urlsplit

from auth_qa_server import DisposableAuthServer, LedgerEntry


class DisposableAuthServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = DisposableAuthServer()
        self.server.start()
        parsed = urlsplit(self.server.origin)
        assert parsed.hostname is not None and parsed.port is not None
        self.host = parsed.hostname
        self.port = parsed.port

    def tearDown(self) -> None:
        self.server.close()

    def request(
        self,
        method: str,
        path: str,
        body: object | None = None,
        cookie: str | None = None,
    ) -> tuple[int, object, str | None]:
        headers: dict[str, str] = {}
        encoded: bytes | None = None
        if body is not None:
            encoded = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if cookie is not None:
            headers["Cookie"] = cookie
        connection = http.client.HTTPConnection(self.host, self.port, timeout=5)
        try:
            connection.request(method, path, body=encoded, headers=headers)
            response = connection.getresponse()
            payload = json.loads(response.read().decode("utf-8"))
            return response.status, payload, response.getheader("Set-Cookie")
        finally:
            connection.close()

    @staticmethod
    def cookie_header(set_cookie: str | None) -> str:
        if set_cookie is None:
            raise AssertionError("response did not set a cookie")
        return set_cookie.split(";", 1)[0]

    def test_compatibility_and_redacted_ledger(self) -> None:
        secret_query = "should-not-appear-in-ledger"
        status, body, _cookie = self.request(
            "GET",
            f"/api/version?credential={secret_query}",
        )

        self.assertEqual(status, 200)
        self.assertEqual(
            body,
            {
                "api_version": "1.1.0",
                "current_contract_version": "v2",
                "compatible_contract_versions": ["v2"],
            },
        )
        self.assertEqual(
            self.server.ledger,
            (LedgerEntry(1, "GET", "/api/version", 200),),
        )
        self.assertNotIn(secret_query, repr(self.server.ledger))

        self.server.set_compatibility("2.0.0", "v3", ("v2", "v3"))
        status, body, _cookie = self.request("GET", "/api/version")
        self.assertEqual(status, 200)
        self.assertEqual(body["current_contract_version"], "v3")
        self.assertEqual(body["compatible_contract_versions"], ["v2", "v3"])

    def test_seed_login_authorized_collections_and_logout(self) -> None:
        email = "qa-secret@example.test"
        password = "password-secret-marker"
        self.server.seed_account(
            email,
            password,
            display_name="Android QA",
            is_admin=True,
        )

        status, body, set_cookie = self.request(
            "POST",
            "/api/auth/login",
            {"email": email, "password": "incorrect"},
        )
        self.assertEqual(status, 401)
        self.assertEqual(body, {"detail": "Invalid credentials"})
        self.assertIsNone(set_cookie)

        status, body, set_cookie = self.request(
            "POST",
            "/api/auth/login",
            {"email": email, "password": password},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["email"], email)
        self.assertTrue(body["is_admin"])
        assert set_cookie is not None
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("Secure", set_cookie)
        self.assertIn("SameSite=Lax", set_cookie)
        self.assertIn("Path=/", set_cookie)
        cookie = self.cookie_header(set_cookie)

        for path, expected in (
            ("/api/auth/me", body),
            ("/api/me/likes", []),
            ("/api/playlists", []),
        ):
            status, current, _ = self.request("GET", path, cookie=cookie)
            self.assertEqual(status, 200)
            self.assertEqual(current, expected)

        status, body, cleared_cookie = self.request(
            "POST",
            "/api/auth/logout",
            cookie=cookie,
        )
        self.assertEqual((status, body), (200, {"ok": True}))
        assert cleared_cookie is not None
        self.assertIn("Max-Age=0", cleared_cookie)

        status, body, _ = self.request("GET", "/api/auth/me", cookie=cookie)
        self.assertEqual(status, 401)
        self.assertEqual(body, {"detail": "Not authenticated"})

        redacted = repr(self.server.ledger)
        self.assertNotIn(email, redacted)
        self.assertNotIn(password, redacted)
        self.assertEqual(
            [(entry.method, entry.path, entry.status) for entry in self.server.ledger],
            [
                ("POST", "/api/auth/login", 401),
                ("POST", "/api/auth/login", 200),
                ("GET", "/api/auth/me", 200),
                ("GET", "/api/me/likes", 200),
                ("GET", "/api/playlists", 200),
                ("POST", "/api/auth/logout", 200),
                ("GET", "/api/auth/me", 401),
            ],
        )

    def test_pending_registration_can_be_approved_directly(self) -> None:
        self.server.seed_account(
            "anchor@example.test",
            "anchor-password",
            is_admin=True,
        )
        email = "pending@example.test"
        status, body, set_cookie = self.request(
            "POST",
            "/api/auth/register",
            {
                "email": email,
                "password": "pending-password",
                "display_name": "Pending QA",
                "invite": None,
            },
        )
        self.assertEqual(status, 200)
        self.assertFalse(body["is_approved"])
        cookie = self.cookie_header(set_cookie)

        status, me, _ = self.request("GET", "/api/auth/me", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertFalse(me["is_approved"])
        status, detail, _ = self.request("GET", "/api/me/likes", cookie=cookie)
        self.assertEqual(status, 403)
        self.assertIn("Freigabe", detail["detail"])

        self.server.approve(email)
        status, me, _ = self.request("GET", "/api/auth/me", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertTrue(me["is_approved"])
        status, likes, _ = self.request("GET", "/api/me/likes", cookie=cookie)
        self.assertEqual((status, likes), (200, []))

    def test_invite_is_single_use_and_auto_approves(self) -> None:
        self.server.seed_account(
            "anchor@example.test",
            "anchor-password",
            is_admin=True,
        )
        invite = self.server.issue_invite("one-use-code")

        status, first, _ = self.request(
            "POST",
            "/api/auth/register",
            {
                "email": "invited@example.test",
                "password": "invited-password",
                "display_name": "Invited QA",
                "invite": invite,
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(first["is_approved"])

        status, second, _ = self.request(
            "POST",
            "/api/auth/register",
            {
                "email": "reuse@example.test",
                "password": "reused-password",
                "display_name": "Reuse QA",
                "invite": invite,
            },
        )
        self.assertEqual(status, 200)
        self.assertFalse(second["is_approved"])

    def test_fault_is_path_scoped_one_shot_and_has_no_control_route(self) -> None:
        self.server.fault_next("/api/version", 503)

        status, body, _ = self.request("GET", "/api/version")
        self.assertEqual(status, 503)
        self.assertEqual(body, {"detail": "Injected disposable QA fault"})
        status, body, _ = self.request("GET", "/api/version")
        self.assertEqual(status, 200)
        self.assertEqual(body["current_contract_version"], "v2")

        self.server.fault_next("/api/version", 499)
        status, body, _ = self.request("GET", "/api/version")
        self.assertEqual(status, 499)
        self.assertEqual(body, {"detail": "Injected disposable QA fault"})

        for method, path in (
            ("GET", "/__qa/control"),
            ("POST", "/api/qa/approve"),
            ("POST", "/api/auth/fault"),
        ):
            status, body, _ = self.request(method, path, {})
            self.assertEqual(status, 404)
            self.assertEqual(body, {"detail": "Not Found"})

    def test_first_registration_matches_backend_bootstrap_policy(self) -> None:
        status, body, _ = self.request(
            "POST",
            "/api/auth/register",
            {
                "email": "first@example.test",
                "password": "first-password",
                "display_name": None,
                "invite": None,
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["is_admin"])
        self.assertTrue(body["is_approved"])

    def test_invalid_host_controls_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.server.fault_next("api/auth/me", 500)
        with self.assertRaises(ValueError):
            self.server.fault_next("/api/auth/me", 200)
        with self.assertRaises(ValueError):
            self.server.seed_account("invalid-email", "password")
        with self.assertRaises(KeyError):
            self.server.approve("missing@example.test")


if __name__ == "__main__":
    unittest.main()
