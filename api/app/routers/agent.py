"""Public, machine-readable entry point for clients and coding agents."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.openapi.docs import get_swagger_ui_html
from pydantic import BaseModel

from ..api_version import (
    API_VERSION,
    COMPATIBLE_OPENAPI_CONTRACT_VERSIONS,
    OPENAPI_CONTRACT_VERSION,
)
from ..config import COOKIE_MAX_AGE, SESSION_COOKIE

router = APIRouter(prefix="/api", tags=["agent"])

OPENAPI_URL = "/api/openapi.json"
DOCS_URL = "/api/docs"


class AgentOperation(BaseModel):
    operation_id: str
    method: str
    path: str
    summary: str
    tags: list[str]
    security: list[dict[str, list[str]]]
    response_statuses: list[str]
    request_content_types: list[str]
    openapi_pointer: str


class AgentAuth(BaseModel):
    cookie_name: str
    cookie_max_age_seconds: int
    login_operation_id: str
    account_operation_id: str
    missing_or_expired_session_status: int
    pending_approval_status: int
    instructions: str


class AgentCapability(BaseModel):
    name: str
    description: str
    operation_ids: list[str]


class AgentManifest(BaseModel):
    api_version: str
    contract_version: str
    compatible_contract_versions: list[str]
    openapi_url: str
    docs_url: str
    auth: AgentAuth
    capabilities: list[AgentCapability]
    operations: list[AgentOperation]


def _operation_index(schema: dict[str, Any]) -> dict[str, AgentOperation]:
    operations: dict[str, AgentOperation] = {}
    for path, path_item in schema["paths"].items():
        for method, specification in path_item.items():
            if method not in {
                "get", "post", "put", "patch", "delete", "head", "options", "trace"
            }:
                continue
            operation_id = specification["operationId"]
            if operation_id in operations:
                raise RuntimeError(f"Duplicate OpenAPI operationId: {operation_id}")
            escaped_path = path.replace("~", "~0").replace("/", "~1")
            operations[operation_id] = AgentOperation(
                operation_id=operation_id,
                method=method.upper(),
                path=path,
                summary=specification["summary"],
                tags=specification.get("tags", []),
                security=specification.get("security", []),
                response_statuses=list(specification["responses"]),
                request_content_types=list(
                    specification.get("requestBody", {}).get("content", {})
                ),
                openapi_pointer=f"#/paths/{escaped_path}/{method}",
            )
    return operations


def _require_operation(
    operations: dict[str, AgentOperation], operation_id: str
) -> str:
    if operation_id not in operations:
        raise RuntimeError(f"Agent manifest refers to missing OpenAPI operationId: {operation_id}")
    return operation_id


@router.get("/agent", response_model=AgentManifest, summary="Discover API operations for agents")
def get_agent_manifest(request: Request, response: Response) -> AgentManifest:
    """Describe this deployment using its live OpenAPI contract."""
    schema = request.app.openapi()
    scheme = schema["components"]["securitySchemes"][SESSION_COOKIE]
    if (
        scheme.get("type") != "apiKey"
        or scheme.get("in") != "cookie"
        or scheme.get("name") != SESSION_COOKIE
    ):
        raise RuntimeError("OpenAPI session cookie scheme does not match server authentication")

    operations = _operation_index(schema)

    def capability(name: str, description: str, *operation_ids: str) -> AgentCapability:
        return AgentCapability(
            name=name,
            description=description,
            operation_ids=[_require_operation(operations, operation_id) for operation_id in operation_ids],
        )

    response.headers["Cache-Control"] = "no-store"
    return AgentManifest(
        api_version=API_VERSION,
        contract_version=OPENAPI_CONTRACT_VERSION,
        compatible_contract_versions=list(COMPATIBLE_OPENAPI_CONTRACT_VERSIONS),
        openapi_url=OPENAPI_URL,
        docs_url=DOCS_URL,
        auth=AgentAuth(
            cookie_name=SESSION_COOKIE,
            cookie_max_age_seconds=COOKIE_MAX_AGE,
            login_operation_id=_require_operation(operations, "login_api_auth_login_post"),
            account_operation_id=_require_operation(operations, "me_api_auth_me_get"),
            missing_or_expired_session_status=401,
            pending_approval_status=403,
            instructions=(
                "POST login to receive the HttpOnly session cookie; send that cookie on "
                "protected requests. A missing, invalid, or expired session returns 401. "
                "A signed-in account pending admin approval can read /api/auth/me, but "
                "approved-user operations return 403."
            ),
        ),
        capabilities=[
            capability(
                "download_track",
                "GET returns audio/mpeg bytes, including HTTP Range responses. The client saves the response body as an MP3.",
                "stream_api_tracks__deezer_id__stream_get",
            ),
            capability(
                "preload_track",
                "Materialize a track on the server without returning its audio bytes.",
                "preload_track_api_tracks__deezer_id__preload_post",
            ),
            capability(
                "list_cached_tracks",
                "List Deezer track IDs currently stored on the server.",
                "cached_tracks_api_cached_tracks_get",
            ),
            capability(
                "export_playlist_zip",
                "GET returns an application/zip archive of the playlist's ordered MP3 tracks.",
                "export_playlist_api_playlists__playlist_id__export_get",
            ),
            capability(
                "party_playback_state",
                "The host changes shared playback state; party events report that state. A client must play audio locally using the stream endpoint.",
                "set_playback_api_party__code__playback_patch",
                "party_events_api_party__code__events_get",
            ),
        ],
        operations=list(operations.values()),
    )


@router.get("/openapi.json", include_in_schema=False)
def get_api_openapi(request: Request, response: Response) -> dict[str, Any]:
    """Expose the exact live schema under the /api prefix used by web rewrites."""
    response.headers["Cache-Control"] = "no-store"
    return request.app.openapi()


@router.get("/docs", include_in_schema=False)
def get_api_docs() -> Response:
    """Swagger UI for deployments that only proxy /api routes."""
    return get_swagger_ui_html(openapi_url=OPENAPI_URL, title="LoggeRythm API docs")
