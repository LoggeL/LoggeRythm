"""Provider health reports actionable failures within the proxy deadline."""

import unittest
from unittest.mock import Mock, patch

import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import browse
from app.services import deezer, deezer_client as dc


class DeezerHealthTests(unittest.TestCase):
    def test_account_health_does_not_depend_on_a_sample_song(self):
        with (
            patch.object(deezer, "get_user_data", return_value=("test-license", {})) as account,
            patch.object(deezer, "test_deezer_login") as legacy_check,
            patch.object(deezer, "get_song_infos_from_deezer_website") as song,
        ):
            self.assertTrue(dc.health())
        account.assert_called_once_with(timeout=(3, 5))
        legacy_check.assert_not_called()
        song.assert_not_called()

    def test_auth_failure_is_explicit_and_keeps_its_cause(self):
        cause = deezer.Deezer403Exception("DEEZER_ARL is invalid or expired: anonymous user")
        with patch.object(deezer, "get_user_data", side_effect=cause):
            with self.assertRaisesRegex(dc.AuthExpired, "DEEZER_ARL.*anonymous") as error:
                dc.health()
        self.assertIs(error.exception.__cause__, cause)

    def test_provider_failure_is_not_returned_as_false(self):
        cause = deezer.DeezerApiException("deezer.getUserData returned invalid JSON")
        with patch.object(deezer, "get_user_data", side_effect=cause):
            with self.assertRaisesRegex(dc.DeezerClientError, "account health check.*invalid JSON"):
                dc.health()

    def test_programming_error_is_not_swallowed(self):
        with patch.object(deezer, "get_user_data", side_effect=RuntimeError("unexpected bug")):
            with self.assertRaisesRegex(RuntimeError, "unexpected bug"):
                dc.health()

    def test_health_deadline_reaches_account_http_request(self):
        session = Mock()
        session.get.side_effect = requests.ReadTimeout("private request URL and session details")
        with patch.object(deezer, "session", session):
            with self.assertRaisesRegex(dc.DeezerClientError, "ReadTimeout") as error:
                dc.health()
        self.assertEqual(session.get.call_args.kwargs["timeout"], (3, 5))
        self.assertNotIn("private", str(error.exception))


class DeezerHealthRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(browse.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_success_preserves_health_response_shape(self):
        with patch.object(dc, "health", return_value=True):
            response = self.client.get("/api/health/deezer")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_failed_health_returns_json_with_the_specific_cause(self):
        for cause in (
            dc.AuthExpired("DEEZER_ARL is invalid or expired: anonymous user"),
            dc.DeezerClientError("deezer.getUserData request failed (ReadTimeout)"),
        ):
            with self.subTest(cause=type(cause).__name__):
                with patch.object(dc, "health", side_effect=cause):
                    response = self.client.get("/api/health/deezer")
                self.assertEqual(response.status_code, 502)
                self.assertIn(str(cause), response.json()["detail"])
                self.assertEqual(response.headers["content-type"], "application/json")


if __name__ == "__main__":
    unittest.main()
