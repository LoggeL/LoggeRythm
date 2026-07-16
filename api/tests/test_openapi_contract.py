import json
import tempfile
import unittest
from pathlib import Path

from app.android_contract import (
    DEFAULT_ANDROID_CONTRACT_PATH,
    AndroidContractDriftError,
    android_contract_diff,
    check_android_contract,
    load_openapi_contract,
    rendered_android_contract,
)
from app.api_version import (
    API_VERSION,
    COMPATIBLE_OPENAPI_CONTRACT_VERSIONS,
    OPENAPI_CONTRACT_VERSION,
)
from app.openapi_contract import (
    DEFAULT_CONTRACT_PATH,
    ContractDriftError,
    build_schema,
    check_contract,
    contract_diff,
    rendered_contract,
)
from app.routers.compatibility import get_api_compatibility
from fastapi import Response


class OpenApiContractTests(unittest.TestCase):
    def test_checked_in_contract_matches_fastapi(self) -> None:
        self.assertIsNone(contract_diff(DEFAULT_CONTRACT_PATH))

    def test_contract_generation_is_deterministic_and_versioned(self) -> None:
        self.assertEqual(rendered_contract(), rendered_contract())
        schema = build_schema()
        self.assertEqual(schema["info"]["title"], "LoggeRythm API")
        self.assertEqual(schema["info"]["version"], API_VERSION)
        self.assertEqual(
            schema["info"]["x-loggerythm-contract-version"],
            OPENAPI_CONTRACT_VERSION,
        )
        self.assertEqual(
            schema["info"]["x-loggerythm-compatible-contract-versions"],
            list(COMPATIBLE_OPENAPI_CONTRACT_VERSIONS),
        )
        self.assertIn("/api/auth/login", schema["paths"])
        self.assertIn("/api/version", schema["paths"])
        self.assertIn("/api/tracks/{deezer_id}/stream", schema["paths"])
        self.assertIn(
            "/api/playlists/{playlist_id}/tracks/entries/{entry_id}",
            schema["paths"],
        )
        self.assertIn(
            "/api/playlists/{playlist_id}/tracks/entries/order",
            schema["paths"],
        )
        self.assertEqual(
            DEFAULT_CONTRACT_PATH.name,
            f"{OPENAPI_CONTRACT_VERSION}.json",
        )

    def test_required_cookie_auth_is_explicit(self) -> None:
        schema = build_schema()
        scheme = schema["components"]["securitySchemes"]["sf_session"]
        self.assertEqual(scheme["type"], "apiKey")
        self.assertEqual(scheme["in"], "cookie")
        self.assertEqual(scheme["name"], "sf_session")

        protected = schema["paths"]["/api/me/likes"]["get"]
        self.assertEqual(protected["security"], [{"sf_session": []}])
        self.assertIn("401", protected["responses"])
        self.assertIn("403", protected["responses"])
        self.assertEqual(
            protected["responses"]["401"]["content"]["application/json"][
                "schema"
            ]["$ref"],
            "#/components/schemas/AuthError",
        )

        protected_count = 0
        for path, path_item in schema["paths"].items():
            for method, operation in path_item.items():
                if not isinstance(operation, dict):
                    continue
                if {"sf_session": []} not in operation.get("security", []):
                    continue
                protected_count += 1
                with self.subTest(path=path, method=method):
                    self.assertIn("401", operation["responses"])
        self.assertGreater(protected_count, 0)

    def test_pending_account_endpoint_documents_only_its_real_auth_errors(self) -> None:
        operation = build_schema()["paths"]["/api/auth/me"]["get"]
        self.assertEqual(operation["security"], [{"sf_session": []}])
        self.assertIn("401", operation["responses"])
        self.assertNotIn("403", operation["responses"])

    def test_optional_cookie_routes_remain_public(self) -> None:
        paths = build_schema()["paths"]
        for path, method in (
            ("/api/home/mixes", "get"),
            ("/api/playlists/public", "get"),
            ("/api/playlists/{playlist_id}", "get"),
        ):
            with self.subTest(path=path):
                operation = paths[path][method]
                self.assertNotIn("security", operation)
                self.assertNotIn("401", operation["responses"])
                self.assertNotIn("403", operation["responses"])

    def test_v2_server_retains_every_v1_operation_and_track_field(self) -> None:
        legacy_path = DEFAULT_CONTRACT_PATH.with_name("v1.json")
        legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
        current = build_schema()

        for path, path_item in legacy["paths"].items():
            self.assertIn(path, current["paths"])
            for method, operation in path_item.items():
                if method not in {
                    "delete",
                    "get",
                    "head",
                    "options",
                    "patch",
                    "post",
                    "put",
                    "trace",
                }:
                    continue
                with self.subTest(path=path, method=method):
                    self.assertIn(method, current["paths"][path])
                    self.assertEqual(
                        current["paths"][path][method]["operationId"],
                        operation["operationId"],
                    )

        legacy_schemas = legacy["components"]["schemas"]
        current_schemas = current["components"]["schemas"]
        self.assertEqual(current_schemas["Track"], legacy_schemas["Track"])
        self.assertEqual(
            current_schemas["PlaylistReorder"],
            legacy_schemas["PlaylistReorder"],
        )
        self.assertEqual(
            set(legacy_schemas["Track"]["properties"]),
            set(current_schemas["PlaylistTrackEntry"]["properties"])
            - {"playlist_entry_id"},
        )
        self.assertEqual(
            current_schemas["PlaylistDetail"]["required"],
            legacy_schemas["PlaylistDetail"]["required"],
        )

    def test_check_rejects_stale_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stale_contract = Path(directory) / "openapi.json"
            stale_contract.write_text("{}\n", encoding="utf-8")

            with self.assertRaises(ContractDriftError):
                check_contract(stale_contract)

    def test_public_compatibility_response_uses_the_contract_constants(self) -> None:
        response = Response()
        compatibility = get_api_compatibility(response)
        self.assertEqual(compatibility.api_version, API_VERSION)
        self.assertEqual(
            compatibility.current_contract_version,
            OPENAPI_CONTRACT_VERSION,
        )
        self.assertEqual(
            compatibility.compatible_contract_versions,
            list(COMPATIBLE_OPENAPI_CONTRACT_VERSIONS),
        )
        self.assertEqual(response.headers["cache-control"], "no-store")

        operation = build_schema()["paths"]["/api/version"]["get"]
        self.assertNotIn("security", operation)
        self.assertEqual(
            operation["responses"]["200"]["content"]["application/json"][
                "schema"
            ]["$ref"],
            "#/components/schemas/ApiCompatibility",
        )

    def test_generated_android_contract_is_current_and_deterministic(self) -> None:
        self.assertEqual(rendered_android_contract(), rendered_android_contract())
        self.assertIsNone(android_contract_diff(DEFAULT_ANDROID_CONTRACT_PATH))
        generated = rendered_android_contract()
        self.assertIn("export interface ApiCompatibilityWire", generated)
        self.assertIn("export interface TrackWire", generated)
        self.assertIn("export interface GeneratedApiOperations", generated)
        self.assertIn("export interface GeneratedApiClient", generated)
        self.assertIn("body: LoginRequestWire;", generated)
        self.assertIn("file: Blob;", generated)
        self.assertIn('"204": undefined;', generated)
        self.assertIn("GENERATED_OPENAPI_SHA256", generated)
        self.assertIn('path: "/api/version"', generated)

        schema = load_openapi_contract()
        schemas = schema["components"]["schemas"]
        operation_ids = {
            operation["operationId"]
            for path_item in schema["paths"].values()
            for method, operation in path_item.items()
            if method in {"delete", "get", "head", "options", "patch", "post", "put", "trace"}
        }
        self.assertEqual(len(schemas), 54)
        self.assertEqual(len(schema["paths"]), 73)
        self.assertEqual(len(operation_ids), 82)
        for schema_name in schemas:
            with self.subTest(schema=schema_name):
                self.assertIn(f'  {json.dumps(schema_name)}:', generated)
        for operation_id in operation_ids:
            with self.subTest(operation=operation_id):
                self.assertIn(f'  {json.dumps(operation_id)}: {{', generated)

    def test_android_contract_generation_reads_the_versioned_json_source(self) -> None:
        source = load_openapi_contract()
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "v1.json"
            changed = json.loads(json.dumps(source))
            changed["paths"]["/api/version"]["get"]["operationId"] = (
                "changed_compatibility_operation"
            )
            source_path.write_text(json.dumps(changed), encoding="utf-8")

            generated = rendered_android_contract(source_path)

        self.assertIn('"changed_compatibility_operation": {', generated)
        self.assertIn(
            'GENERATED_API_OPERATIONS["changed_compatibility_operation"]',
            generated,
        )

    def test_android_contract_generation_rejects_a_missing_schema_reference(self) -> None:
        source = load_openapi_contract()
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "v1.json"
            changed = json.loads(json.dumps(source))
            changed["paths"]["/api/charts"]["get"]["responses"]["200"]["content"][
                "application/json"
            ]["schema"] = {"$ref": "#/components/schemas/MissingTrack"}
            source_path.write_text(json.dumps(changed), encoding="utf-8")

            with self.assertRaisesRegex(
                RuntimeError,
                "references missing schema 'MissingTrack'",
            ):
                rendered_android_contract(source_path)

    def test_android_contract_generation_rejects_duplicate_operation_ids(self) -> None:
        source = load_openapi_contract()
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "v1.json"
            changed = json.loads(json.dumps(source))
            changed["paths"]["/api/charts"]["get"]["operationId"] = (
                changed["paths"]["/api/genres"]["get"]["operationId"]
            )
            source_path.write_text(json.dumps(changed), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "operationId .* is duplicated"):
                rendered_android_contract(source_path)

    def test_android_contract_check_rejects_stale_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stale_contract = Path(directory) / "contract.ts"
            stale_contract.write_text("// stale\n", encoding="utf-8")
            with self.assertRaises(AndroidContractDriftError):
                check_android_contract(stale_contract)


if __name__ == "__main__":
    unittest.main()
