"""Public discovery and binary response contract checks without app startup."""

import unittest

from fastapi.testclient import TestClient

from app.api_version import API_VERSION, OPENAPI_CONTRACT_VERSION
from app.main import app


class AgentDiscoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # Avoid startup: these public metadata routes do not need the DB or Deezer.
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()

    def test_api_openapi_alias_is_the_live_schema(self) -> None:
        response = self.client.get("/api/openapi.json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), app.openapi())
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("/api/openapi.json", response.json()["paths"])
        self.assertNotIn("/api/docs", response.json()["paths"])

    def test_api_docs_uses_proxied_openapi_alias(self) -> None:
        response = self.client.get("/api/docs")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/openapi.json", response.text)
        self.assertIn("swagger-ui", response.text)

    def test_agent_manifest_resolves_each_operation_from_live_schema(self) -> None:
        response = self.client.get("/api/agent")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        manifest = response.json()
        schema = app.openapi()

        self.assertEqual(manifest["api_version"], API_VERSION)
        self.assertEqual(manifest["contract_version"], OPENAPI_CONTRACT_VERSION)
        self.assertEqual(manifest["openapi_url"], "/api/openapi.json")
        self.assertEqual(manifest["docs_url"], "/api/docs")
        self.assertEqual(manifest["auth"]["cookie_name"], "sf_session")
        self.assertEqual(manifest["auth"]["missing_or_expired_session_status"], 401)
        self.assertEqual(manifest["auth"]["pending_approval_status"], 403)

        operations = {item["operation_id"]: item for item in manifest["operations"]}
        expected_count = sum(
            1
            for path_item in schema["paths"].values()
            for method in path_item
            if method in {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
        )
        self.assertEqual(len(operations), expected_count)
        for operation in operations.values():
            with self.subTest(operation=operation["operation_id"]):
                spec = schema["paths"][operation["path"]][operation["method"].lower()]
                self.assertEqual(spec["operationId"], operation["operation_id"])
                pointer_tokens = [
                    token.replace("~1", "/").replace("~0", "~")
                    for token in operation["openapi_pointer"].removeprefix("#/").split("/")
                ]
                pointed_to = schema
                for token in pointer_tokens:
                    pointed_to = pointed_to[token]
                self.assertEqual(pointed_to, spec)
                self.assertEqual(spec.get("security", []), operation["security"])
                self.assertEqual(list(spec["responses"]), operation["response_statuses"])
                self.assertEqual(
                    list(spec.get("requestBody", {}).get("content", {})),
                    operation["request_content_types"],
                )

        for capability in manifest["capabilities"]:
            for operation_id in capability["operation_ids"]:
                self.assertIn(operation_id, operations)

        stream = operations["stream_api_tracks__deezer_id__stream_get"]
        self.assertEqual(stream["path"], "/api/tracks/{deezer_id}/stream")
        self.assertEqual(stream["security"], [{"sf_session": []}])
        self.assertIn("206", stream["response_statuses"])

    def test_binary_and_event_responses_have_correct_media_types(self) -> None:
        paths = app.openapi()["paths"]
        expected = {
            "/api/tracks/{deezer_id}/stream": {"200": "audio/mpeg", "206": "audio/mpeg"},
            "/api/playlists/{playlist_id}/export": {"200": "application/zip"},
            "/api/party/{code}/events": {"200": "text/event-stream"},
        }
        for path, statuses in expected.items():
            for status, media_type in statuses.items():
                with self.subTest(path=path, status=status):
                    content = paths[path]["get"]["responses"][status]["content"]
                    self.assertEqual(list(content), [media_type])
        self.assertIn(
            "materializes",
            paths["/api/tracks/{deezer_id}/stream"]["get"]["description"],
        )
        self.assertIn(
            "register or refresh",
            paths["/api/party/{code}"]["get"]["description"],
        )


if __name__ == "__main__":
    unittest.main()
