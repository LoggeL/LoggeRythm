"""OpenAPI details that FastAPI cannot infer from auth dependencies alone."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from copy import deepcopy
from typing import Any

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from .api_version import (
    COMPATIBLE_OPENAPI_CONTRACT_VERSIONS,
    OPENAPI_CONTRACT_VERSION,
)
from .auth import get_current_session_user, get_current_user


_AUTH_ERROR_SCHEMA = {
    "type": "object",
    "properties": {"detail": {"type": "string"}},
    "required": ["detail"],
}

_UNAUTHORIZED_RESPONSE = {
    "description": (
        "The session cookie is missing, invalid, expired, or no longer "
        "identifies a user."
    ),
    "content": {
        "application/json": {
            "schema": {"$ref": "#/components/schemas/AuthError"},
        }
    },
}

_FORBIDDEN_RESPONSE = {
    "description": (
        "The authenticated account is pending approval or lacks permission "
        "for this operation."
    ),
    "content": {
        "application/json": {
            "schema": {"$ref": "#/components/schemas/AuthError"},
        }
    },
}


def _dependency_calls(dependant: Dependant) -> Iterator[Callable[..., Any]]:
    """Yield every callable in an endpoint's nested dependency graph."""
    if dependant.call is not None:
        yield dependant.call
    for child in dependant.dependencies:
        yield from _dependency_calls(child)


def add_auth_error_responses(app: FastAPI, schema: dict[str, Any]) -> None:
    """Document auth failures for routes backed by required auth dependencies.

    FastAPI discovers the ``sf_session`` API-key cookie from ``Security`` but
    does not infer responses raised inside dependencies.  Inspecting the actual
    dependency graph keeps optional-cookie routes public while making the
    required routes' 401/403 behavior explicit.
    """
    components = schema.setdefault("components", {})
    component_schemas = components.setdefault("schemas", {})
    component_schemas.setdefault("AuthError", deepcopy(_AUTH_ERROR_SCHEMA))

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue

        dependencies = set(_dependency_calls(route.dependant))
        requires_approved_user = get_current_user in dependencies
        requires_session_user = get_current_session_user in dependencies
        if not (requires_approved_user or requires_session_user):
            continue

        path_item = schema.get("paths", {}).get(route.path_format, {})
        for method in route.methods or ():
            operation = path_item.get(method.lower())
            if operation is None:
                continue
            responses = operation.setdefault("responses", {})
            responses.setdefault("401", deepcopy(_UNAUTHORIZED_RESPONSE))
            if requires_approved_user:
                responses.setdefault("403", deepcopy(_FORBIDDEN_RESPONSE))


def add_contract_metadata(schema: dict[str, Any]) -> None:
    """Make the served/exported schema identify its wire compatibility line."""
    info = schema.setdefault("info", {})
    info["x-loggerythm-contract-version"] = OPENAPI_CONTRACT_VERSION
    info["x-loggerythm-compatible-contract-versions"] = list(
        COMPATIBLE_OPENAPI_CONTRACT_VERSIONS
    )


def install_auth_openapi(app: FastAPI) -> None:
    """Wrap ``app.openapi`` once so generated and served contracts stay equal."""
    default_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        schema = default_openapi()
        add_contract_metadata(schema)
        add_auth_error_responses(app, schema)
        return schema

    app.openapi = openapi  # type: ignore[method-assign]
