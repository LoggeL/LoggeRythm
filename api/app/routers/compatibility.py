"""Unauthenticated API contract negotiation."""

from fastapi import APIRouter, Response

from ..api_version import (
    API_VERSION,
    COMPATIBLE_OPENAPI_CONTRACT_VERSIONS,
    OPENAPI_CONTRACT_VERSION,
)
from ..schemas.compatibility import ApiCompatibility

router = APIRouter(tags=["compatibility"])


@router.get(
    "/api/version",
    response_model=ApiCompatibility,
    summary="Get API compatibility metadata",
)
def get_api_compatibility(response: Response) -> ApiCompatibility:
    """Describe the wire contracts this deployment can serve."""
    # A process-local Android decision should be based on this deployment, not
    # a stale intermediary cache left behind after a server upgrade.
    response.headers["Cache-Control"] = "no-store"
    return ApiCompatibility(
        api_version=API_VERSION,
        current_contract_version=OPENAPI_CONTRACT_VERSION,
        compatible_contract_versions=list(COMPATIBLE_OPENAPI_CONTRACT_VERSIONS),
    )
