"""Public API compatibility metadata consumed before authenticated requests."""

from pydantic import BaseModel


class ApiCompatibility(BaseModel):
    api_version: str
    current_contract_version: str
    compatible_contract_versions: list[str]
