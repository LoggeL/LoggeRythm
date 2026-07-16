"""Generate Android TypeScript wire contracts from checked-in FastAPI OpenAPI.

Run from ``api/`` with either::

    python -m app.android_contract export
    python -m app.android_contract check

The generator deliberately uses only the Python standard library. The OpenAPI
JSON remains the versioned source artifact, while the generated TypeScript
provides transport-only component types, operation request/response types, and
a compile-time client stub. Runtime endpoint adapters keep their strict
decoders and are not rewritten by this module.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .api_version import (
    API_VERSION,
    COMPATIBLE_OPENAPI_CONTRACT_VERSIONS,
    OPENAPI_CONTRACT_VERSION,
)
from .openapi_contract import API_ROOT, DEFAULT_CONTRACT_PATH, canonical_json

REPOSITORY_ROOT = API_ROOT.parent
DEFAULT_ANDROID_CONTRACT_PATH = (
    REPOSITORY_ROOT / "mobile" / "src" / "api" / "generated" / "contract.ts"
)
COMPATIBILITY_PATH = "/api/version"
HTTP_METHODS = ("delete", "get", "head", "options", "patch", "post", "put", "trace")
PARAMETER_LOCATIONS = ("path", "query", "header", "cookie")
_TS_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
_NON_IDENTIFIER = re.compile(r"[^A-Za-z0-9_$]")


class AndroidContractDriftError(RuntimeError):
    """Raised when Android's generated OpenAPI contract is missing or stale."""


def _require_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RuntimeError(f"OpenAPI {label} must be an object")
    return value


def _require_sequence(value: Any, label: str) -> Sequence[Any]:
    if not isinstance(value, list):
        raise RuntimeError(f"OpenAPI {label} must be an array")
    return value


def load_openapi_contract(path: Path = DEFAULT_CONTRACT_PATH) -> Mapping[str, Any]:
    """Load the checked-in OpenAPI source and fail with actionable context."""
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RuntimeError(f"Missing OpenAPI source contract: {path}") from exc
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"OpenAPI source contract {path} is invalid JSON at "
            f"line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    return _require_mapping(parsed, f"source contract {path}")


def _wire_name(schema_name: str) -> str:
    identifier = _NON_IDENTIFIER.sub("_", schema_name)
    if not identifier or identifier[0].isdigit():
        identifier = f"_{identifier}"
    return f"{identifier}Wire"


def _property_name(name: str) -> str:
    return name if _TS_IDENTIFIER.fullmatch(name) else json.dumps(name)


def _literal_type(value: Any, label: str) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)) and not isinstance(value, complex):
        return json.dumps(value, ensure_ascii=False)
    raise RuntimeError(f"OpenAPI {label} has unsupported enum value {value!r}")


def _union(types: Sequence[str]) -> str:
    unique: list[str] = []
    for type_name in types:
        if type_name not in unique:
            unique.append(type_name)
    return " | ".join(unique) if unique else "never"


def _object_properties(
    schema: Mapping[str, Any],
    schema_names: set[str],
    label: str,
) -> list[tuple[str, bool, str]]:
    properties_value = schema.get("properties", {})
    properties = _require_mapping(properties_value, f"{label}.properties")
    required_value = schema.get("required", [])
    required = _require_sequence(required_value, f"{label}.required")
    if not all(isinstance(name, str) for name in required):
        raise RuntimeError(f"OpenAPI {label}.required must contain only strings")
    required_names = set(required)
    unknown_required = required_names.difference(properties)
    if unknown_required:
        names = ", ".join(sorted(unknown_required))
        raise RuntimeError(f"OpenAPI {label}.required names missing properties: {names}")

    rendered: list[tuple[str, bool, str]] = []
    for property_name in sorted(properties):
        property_schema = _require_mapping(
            properties[property_name],
            f"{label}.properties.{property_name}",
        )
        rendered.append(
            (
                property_name,
                property_name in required_names,
                _typescript_type(
                    property_schema,
                    schema_names,
                    f"{label}.properties.{property_name}",
                ),
            )
        )
    return rendered


def _typescript_object_type(
    schema: Mapping[str, Any],
    schema_names: set[str],
    label: str,
) -> str:
    properties = _object_properties(schema, schema_names, label)
    property_type = ""
    if properties:
        fields = [
            f"{_property_name(name)}{'' if required else '?'}: {type_name};"
            for name, required, type_name in properties
        ]
        property_type = "{ " + " ".join(fields) + " }"

    additional = schema.get("additionalProperties")
    additional_type = ""
    if additional is True:
        additional_type = "Record<string, unknown>"
    elif isinstance(additional, Mapping):
        additional_type = (
            "Record<string, "
            + _typescript_type(additional, schema_names, f"{label}.additionalProperties")
            + ">"
        )
    elif additional not in (None, False):
        raise RuntimeError(f"OpenAPI {label}.additionalProperties must be boolean or object")

    if property_type and additional_type:
        return f"{property_type} & {additional_type}"
    if property_type:
        return property_type
    if additional_type:
        return additional_type
    return "Record<string, unknown>"


def _typescript_type(
    schema: Mapping[str, Any],
    schema_names: set[str],
    label: str,
) -> str:
    reference = schema.get("$ref")
    if reference is not None:
        if not isinstance(reference, str) or not reference.startswith(
            "#/components/schemas/"
        ):
            raise RuntimeError(f"OpenAPI {label} has unsupported $ref {reference!r}")
        schema_name = reference.removeprefix("#/components/schemas/")
        schema_name = schema_name.replace("~1", "/").replace("~0", "~")
        if schema_name not in schema_names:
            raise RuntimeError(f"OpenAPI {label} references missing schema {schema_name!r}")
        return _wire_name(schema_name)

    any_of = schema.get("anyOf")
    if any_of is not None:
        alternatives = _require_sequence(any_of, f"{label}.anyOf")
        if not alternatives:
            raise RuntimeError(f"OpenAPI {label}.anyOf must not be empty")
        return _union(
            [
                _typescript_type(
                    _require_mapping(alternative, f"{label}.anyOf[{index}]"),
                    schema_names,
                    f"{label}.anyOf[{index}]",
                )
                for index, alternative in enumerate(alternatives)
            ]
        )

    enum = schema.get("enum")
    if enum is not None:
        values = _require_sequence(enum, f"{label}.enum")
        if not values:
            raise RuntimeError(f"OpenAPI {label}.enum must not be empty")
        return _union(
            [_literal_type(value, f"{label}.enum[{index}]") for index, value in enumerate(values)]
        )

    if not schema:
        return "unknown"

    schema_type = schema.get("type")
    if schema_type == "string":
        return "Blob" if schema.get("format") == "binary" else "string"
    if schema_type in ("integer", "number"):
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "null":
        return "null"
    if schema_type == "array":
        items = _require_mapping(schema.get("items"), f"{label}.items")
        item_type = _typescript_type(items, schema_names, f"{label}.items")
        if " | " in item_type or " & " in item_type or item_type.startswith("{ "):
            item_type = f"({item_type})"
        return f"{item_type}[]"
    if schema_type == "object" or "properties" in schema or "additionalProperties" in schema:
        return _typescript_object_type(schema, schema_names, label)
    raise RuntimeError(f"OpenAPI {label} has unsupported schema type {schema_type!r}")


def _render_schema(
    schema_name: str,
    schema: Mapping[str, Any],
    schema_names: set[str],
) -> str:
    wire_name = _wire_name(schema_name)
    is_plain_object = (
        (schema.get("type") == "object" or "properties" in schema)
        and schema.get("additionalProperties") in (None, False)
        and "anyOf" not in schema
        and "$ref" not in schema
    )
    if not is_plain_object:
        return (
            f"export type {wire_name} = "
            f"{_typescript_type(schema, schema_names, f'components.schemas.{schema_name}')};\n"
        )

    properties = _object_properties(
        schema,
        schema_names,
        f"components.schemas.{schema_name}",
    )
    lines = [f"export interface {wire_name} {{"]
    for property_name, required, type_name in properties:
        optional = "" if required else "?"
        lines.append(f"  {_property_name(property_name)}{optional}: {type_name};")
    lines.append("}")
    return "\n".join(lines) + "\n"


def _parameters_for_operation(
    path: str,
    method: str,
    path_item: Mapping[str, Any],
    operation: Mapping[str, Any],
    schema_names: set[str],
) -> dict[str, list[tuple[str, bool, str]]]:
    combined: list[Any] = []
    for owner, value in (
        (f"paths.{path}.parameters", path_item.get("parameters", [])),
        (f"paths.{path}.{method}.parameters", operation.get("parameters", [])),
    ):
        combined.extend(_require_sequence(value, owner))

    grouped = {location: [] for location in PARAMETER_LOCATIONS}
    seen: set[tuple[str, str]] = set()
    for index, value in enumerate(combined):
        label = f"{method.upper()} {path} parameter[{index}]"
        parameter = _require_mapping(value, label)
        if "$ref" in parameter:
            raise RuntimeError(f"OpenAPI {label} uses unsupported parameter $ref")
        name = parameter.get("name")
        location = parameter.get("in")
        if not isinstance(name, str) or not name:
            raise RuntimeError(f"OpenAPI {label}.name must be a non-empty string")
        if location not in PARAMETER_LOCATIONS:
            raise RuntimeError(f"OpenAPI {label}.in has unsupported location {location!r}")
        identity = (location, name)
        if identity in seen:
            raise RuntimeError(f"OpenAPI {method.upper()} {path} repeats {location} {name!r}")
        seen.add(identity)
        required = parameter.get("required") is True
        if location == "path" and not required:
            raise RuntimeError(f"OpenAPI {label} path parameter must be required")
        parameter_schema = _require_mapping(parameter.get("schema"), f"{label}.schema")
        grouped[location].append(
            (
                name,
                required,
                _typescript_type(parameter_schema, schema_names, f"{label}.schema"),
            )
        )
    for values in grouped.values():
        values.sort(key=lambda item: item[0])
    templated_names = set(re.findall(r"{([^{}]+)}", path))
    declared_path_names = {name for name, _, _ in grouped["path"]}
    if templated_names != declared_path_names:
        missing = sorted(templated_names.difference(declared_path_names))
        extra = sorted(declared_path_names.difference(templated_names))
        raise RuntimeError(
            f"OpenAPI {method.upper()} {path} path parameters do not match its template: "
            f"missing={missing}, extra={extra}"
        )
    return grouped


def _content_type(
    content_value: Any,
    schema_names: set[str],
    label: str,
    *,
    empty_type: str,
) -> tuple[str, list[str]]:
    if content_value is None:
        return empty_type, []
    content = _require_mapping(content_value, f"{label}.content")
    if not content:
        return empty_type, []
    media_types: list[str] = []
    body_types: list[str] = []
    for media_type in sorted(content):
        media = _require_mapping(content[media_type], f"{label}.content.{media_type}")
        media_schema = _require_mapping(
            media.get("schema", {}),
            f"{label}.content.{media_type}.schema",
        )
        media_types.append(media_type)
        body_types.append(
            _typescript_type(
                media_schema,
                schema_names,
                f"{label}.content.{media_type}.schema",
            )
        )
    return _union(body_types), media_types


def _operation_records(
    schema: Mapping[str, Any],
    schema_names: set[str],
) -> list[dict[str, Any]]:
    paths = _require_mapping(schema.get("paths"), "paths")
    records: list[dict[str, Any]] = []
    operation_ids: set[str] = set()
    for path in sorted(paths):
        path_item = _require_mapping(paths[path], f"paths.{path}")
        for method in HTTP_METHODS:
            if method not in path_item:
                continue
            operation = _require_mapping(path_item[method], f"paths.{path}.{method}")
            operation_id = operation.get("operationId")
            if not isinstance(operation_id, str) or not operation_id:
                raise RuntimeError(f"OpenAPI {method.upper()} {path} must have an operationId")
            if operation_id in operation_ids:
                raise RuntimeError(f"OpenAPI operationId {operation_id!r} is duplicated")
            operation_ids.add(operation_id)

            parameters = _parameters_for_operation(
                path,
                method,
                path_item,
                operation,
                schema_names,
            )
            request_body = operation.get("requestBody")
            body_type: str | None = None
            body_required = False
            request_media_types: list[str] = []
            if request_body is not None:
                request = _require_mapping(
                    request_body,
                    f"paths.{path}.{method}.requestBody",
                )
                if "$ref" in request:
                    raise RuntimeError(
                        f"OpenAPI {method.upper()} {path} uses unsupported requestBody $ref"
                    )
                body_type, request_media_types = _content_type(
                    request.get("content"),
                    schema_names,
                    f"paths.{path}.{method}.requestBody",
                    empty_type="unknown",
                )
                body_required = request.get("required") is True

            responses = _require_mapping(
                operation.get("responses"),
                f"paths.{path}.{method}.responses",
            )
            rendered_responses: list[tuple[str, str]] = []
            success_types: list[str] = []
            success_statuses: list[int] = []
            for status in sorted(responses, key=lambda value: (len(value), value)):
                response = _require_mapping(
                    responses[status],
                    f"paths.{path}.{method}.responses.{status}",
                )
                if "$ref" in response:
                    raise RuntimeError(
                        f"OpenAPI {method.upper()} {path} response {status} uses unsupported $ref"
                    )
                response_type, _ = _content_type(
                    response.get("content"),
                    schema_names,
                    f"paths.{path}.{method}.responses.{status}",
                    empty_type="undefined",
                )
                rendered_responses.append((status, response_type))
                if status.isdigit() and 200 <= int(status) <= 299:
                    success_statuses.append(int(status))
                    success_types.append(response_type)
            if not success_types:
                raise RuntimeError(f"OpenAPI {method.upper()} {path} has no 2xx response")

            security_value = operation.get("security", schema.get("security", []))
            security = _require_sequence(
                security_value,
                f"paths.{path}.{method}.security",
            )
            requires_session = any(
                "sf_session" in _require_mapping(requirement, "security requirement")
                for requirement in security
            )
            has_optional_session = any(
                name == "sf_session" for name, _, _ in parameters["cookie"]
            )
            if requires_session:
                auth = "required"
            elif has_optional_session:
                auth = "optional"
            else:
                auth = "none"

            records.append(
                {
                    "auth": auth,
                    "body_required": body_required,
                    "body_type": body_type,
                    "method": method.upper(),
                    "operation_id": operation_id,
                    "parameters": parameters,
                    "path": path,
                    "request_media_types": request_media_types,
                    "response_type": _union(success_types),
                    "responses": rendered_responses,
                    "success_statuses": success_statuses,
                }
            )
    return sorted(records, key=lambda record: record["operation_id"])


def _require_contract_metadata(schema: Mapping[str, Any]) -> None:
    info = _require_mapping(schema.get("info"), "info")
    if info.get("x-loggerythm-contract-version") != OPENAPI_CONTRACT_VERSION:
        raise RuntimeError("OpenAPI contract-version extension is inconsistent")
    if info.get("x-loggerythm-compatible-contract-versions") != list(
        COMPATIBLE_OPENAPI_CONTRACT_VERSIONS
    ):
        raise RuntimeError("OpenAPI compatible-contract extension is inconsistent")
    if info.get("version") != API_VERSION:
        raise RuntimeError("OpenAPI API version is inconsistent")


def _require_compatibility_schema(schema: Mapping[str, Any]) -> str:
    components = _require_mapping(schema.get("components"), "components")
    schemas = _require_mapping(components.get("schemas"), "components.schemas")
    compatibility = _require_mapping(
        schemas.get("ApiCompatibility"),
        "components.schemas.ApiCompatibility",
    )
    required = compatibility.get("required")
    expected_required = {
        "api_version",
        "current_contract_version",
        "compatible_contract_versions",
    }
    if not isinstance(required, list) or set(required) != expected_required:
        raise RuntimeError(
            "ApiCompatibility.required changed; update Android generation deliberately"
        )

    properties = _require_mapping(
        compatibility.get("properties"),
        "components.schemas.ApiCompatibility.properties",
    )
    for name in ("api_version", "current_contract_version"):
        prop = _require_mapping(properties.get(name), f"ApiCompatibility.{name}")
        if prop.get("type") != "string":
            raise RuntimeError(f"ApiCompatibility.{name} must remain a string")
    versions = _require_mapping(
        properties.get("compatible_contract_versions"),
        "ApiCompatibility.compatible_contract_versions",
    )
    items = _require_mapping(
        versions.get("items"),
        "ApiCompatibility.compatible_contract_versions.items",
    )
    if versions.get("type") != "array" or items.get("type") != "string":
        raise RuntimeError(
            "ApiCompatibility.compatible_contract_versions must remain string[]"
        )

    paths = _require_mapping(schema.get("paths"), "paths")
    path_item = _require_mapping(paths.get(COMPATIBILITY_PATH), COMPATIBILITY_PATH)
    operation = _require_mapping(path_item.get("get"), f"GET {COMPATIBILITY_PATH}")
    responses = _require_mapping(operation.get("responses"), "compatibility responses")
    response = _require_mapping(responses.get("200"), "compatibility 200 response")
    content = _require_mapping(response.get("content"), "compatibility 200 content")
    media = _require_mapping(content.get("application/json"), "compatibility JSON response")
    response_schema = _require_mapping(media.get("schema"), "compatibility response schema")
    if response_schema.get("$ref") != "#/components/schemas/ApiCompatibility":
        raise RuntimeError("GET /api/version no longer returns ApiCompatibility")

    operation_id = operation.get("operationId")
    if not isinstance(operation_id, str) or not operation_id:
        raise RuntimeError("GET /api/version must have an operationId")
    return operation_id


def _render_request(record: Mapping[str, Any]) -> list[str]:
    fields: list[str] = []
    parameters = record["parameters"]
    for location in PARAMETER_LOCATIONS:
        values = parameters[location]
        if not values:
            continue
        location_required = any(required for _, required, _ in values)
        fields.append(f"      {location}{'' if location_required else '?'}: {{")
        for name, required, type_name in values:
            fields.append(
                f"        {_property_name(name)}{'' if required else '?'}: {type_name};"
            )
        fields.append("      };")
    if record["body_type"] is not None:
        optional = "" if record["body_required"] else "?"
        fields.append(f"      body{optional}: {record['body_type']};")
    if not fields:
        return ["    request: Record<never, never>;"]
    return ["    request: {"] + fields + ["    };"]


def _render_operations(records: Sequence[Mapping[str, Any]]) -> str:
    lines = ["export interface GeneratedApiOperations {"]
    for record in records:
        lines.append(f"  {json.dumps(record['operation_id'])}: {{")
        lines.extend(_render_request(record))
        lines.append("    responses: {")
        for status, response_type in record["responses"]:
            lines.append(f"      {json.dumps(status)}: {response_type};")
        lines.append("    };")
        lines.append(f"    response: {record['response_type']};")
        lines.append("  };")
    lines.append("}")
    return "\n".join(lines) + "\n"


def _render_operation_descriptors(records: Sequence[Mapping[str, Any]]) -> str:
    lines = ["export const GENERATED_API_OPERATIONS = {"]
    for record in records:
        lines.extend(
            [
                f"  {json.dumps(record['operation_id'])}: {{",
                f"    method: {json.dumps(record['method'])},",
                f"    path: {json.dumps(record['path'])},",
                f"    auth: {json.dumps(record['auth'])},",
                "    requestMediaTypes: "
                + json.dumps(record["request_media_types"], ensure_ascii=False)
                + ",",
                "    successStatuses: " + json.dumps(record["success_statuses"]) + ",",
                "  },",
            ]
        )
    lines.append(
        "} as const satisfies "
        "Record<GeneratedApiOperationId, GeneratedOperationDescriptor>;"
    )
    return "\n".join(lines) + "\n"


def rendered_android_contract(
    contract_path: Path = DEFAULT_CONTRACT_PATH,
) -> str:
    schema = load_openapi_contract(contract_path)
    _require_contract_metadata(schema)
    compatibility_operation_id = _require_compatibility_schema(schema)

    components = _require_mapping(schema.get("components"), "components")
    schemas = _require_mapping(components.get("schemas"), "components.schemas")
    schema_names = set(schemas)
    wire_names: dict[str, str] = {}
    for schema_name in sorted(schema_names):
        wire_name = _wire_name(schema_name)
        previous = wire_names.get(wire_name)
        if previous is not None:
            raise RuntimeError(
                f"OpenAPI schemas {previous!r} and {schema_name!r} both map to {wire_name}"
            )
        wire_names[wire_name] = schema_name

    records = _operation_records(schema, schema_names)
    if compatibility_operation_id not in {
        record["operation_id"] for record in records
    }:
        raise RuntimeError("GET /api/version operation is absent from generated operations")

    fingerprint = hashlib.sha256(canonical_json(schema).encode("utf-8")).hexdigest()
    compatible_versions = json.dumps(list(COMPATIBLE_OPENAPI_CONTRACT_VERSIONS))
    header = f"""// Generated by `python -m app.android_contract export`; do not edit by hand.
// Source: api/openapi/{OPENAPI_CONTRACT_VERSION}.json
// Transport declarations only: runtime adapters retain explicit response decoders.

export const GENERATED_API_VERSION = {json.dumps(API_VERSION)} as const;
export const GENERATED_OPENAPI_CONTRACT_VERSION = {json.dumps(OPENAPI_CONTRACT_VERSION)} as const;
export const GENERATED_COMPATIBLE_CONTRACT_VERSIONS = {compatible_versions} as const;
export const GENERATED_OPENAPI_SHA256 = {json.dumps(fingerprint)} as const;

"""
    rendered_schemas = "\n".join(
        _render_schema(
            schema_name,
            _require_mapping(schemas[schema_name], f"components.schemas.{schema_name}"),
            schema_names,
        ).rstrip()
        for schema_name in sorted(schema_names)
    )
    schema_map = ["export interface GeneratedApiSchemas {"]
    for schema_name in sorted(schema_names):
        schema_map.append(
            f"  {json.dumps(schema_name)}: {_wire_name(schema_name)};"
        )
    schema_map.append("}")

    helpers = """
export type GeneratedApiOperationId = keyof GeneratedApiOperations;
export type GeneratedApiRequest<OperationId extends GeneratedApiOperationId> =
  GeneratedApiOperations[OperationId]['request'];
export type GeneratedApiResponses<OperationId extends GeneratedApiOperationId> =
  GeneratedApiOperations[OperationId]['responses'];
export type GeneratedApiResponse<OperationId extends GeneratedApiOperationId> =
  GeneratedApiOperations[OperationId]['response'];
export type GeneratedApiRequestArgs<OperationId extends GeneratedApiOperationId> =
  Record<never, never> extends GeneratedApiRequest<OperationId>
    ? [request?: GeneratedApiRequest<OperationId>]
    : [request: GeneratedApiRequest<OperationId>];

/** Compile-time request stub; concrete clients must still validate responses at runtime. */
export interface GeneratedApiClient {
  request<OperationId extends GeneratedApiOperationId>(
    operationId: OperationId,
    ...args: GeneratedApiRequestArgs<OperationId>
  ): Promise<GeneratedApiResponse<OperationId>>;
}

export interface GeneratedOperationDescriptor {
  readonly method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT' | 'TRACE';
  readonly path: string;
  readonly auth: 'none' | 'optional' | 'required';
  readonly requestMediaTypes: readonly string[];
  readonly successStatuses: readonly number[];
}
"""
    descriptor = _render_operation_descriptors(records)
    compatibility_alias = (
        "export const API_COMPATIBILITY_OPERATION = "
        f"GENERATED_API_OPERATIONS[{json.dumps(compatibility_operation_id)}];\n"
    )
    return (
        header
        + rendered_schemas
        + "\n\n"
        + "\n".join(schema_map)
        + "\n\n"
        + _render_operations(records)
        + helpers
        + "\n"
        + descriptor
        + "\n"
        + compatibility_alias
    )


def export_android_contract(
    path: Path = DEFAULT_ANDROID_CONTRACT_PATH,
    contract_path: Path = DEFAULT_CONTRACT_PATH,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered_android_contract(contract_path), encoding="utf-8")
    return path


def android_contract_diff(
    path: Path = DEFAULT_ANDROID_CONTRACT_PATH,
    contract_path: Path = DEFAULT_CONTRACT_PATH,
) -> str | None:
    generated = rendered_android_contract(contract_path)
    try:
        committed = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return f"Missing generated Android contract: {path}\n"
    if committed == generated:
        return None
    return "".join(
        difflib.unified_diff(
            committed.splitlines(keepends=True),
            generated.splitlines(keepends=True),
            fromfile=f"{path} (committed)",
            tofile=f"{path} (generated)",
        )
    )


def check_android_contract(
    path: Path = DEFAULT_ANDROID_CONTRACT_PATH,
    contract_path: Path = DEFAULT_CONTRACT_PATH,
) -> None:
    diff = android_contract_diff(path, contract_path)
    if diff is not None:
        raise AndroidContractDriftError(diff)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("export", "check"))
    parser.add_argument(
        "--contract",
        type=Path,
        default=DEFAULT_CONTRACT_PATH,
        help=f"OpenAPI source path (default: {DEFAULT_CONTRACT_PATH})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_ANDROID_CONTRACT_PATH,
        help=f"generated TypeScript path (default: {DEFAULT_ANDROID_CONTRACT_PATH})",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "export":
        exported = export_android_contract(args.output, args.contract)
        print(f"Exported Android OpenAPI wire contract to {exported}")
        return 0
    try:
        check_android_contract(args.output, args.contract)
    except AndroidContractDriftError as exc:
        print(str(exc), file=sys.stderr, end="")
        print(
            "Generated Android contract drift detected. Regenerate with: "
            "python -m app.android_contract export",
            file=sys.stderr,
        )
        return 1
    print(f"Generated Android contract is current: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
