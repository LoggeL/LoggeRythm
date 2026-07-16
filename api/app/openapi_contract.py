"""Export and validate the versioned FastAPI OpenAPI contract.

Run from ``api/`` with either::

    python -m app.openapi_contract export
    python -m app.openapi_contract check

The checked-in JSON is deliberately canonicalized so the drift check is stable
across machines and Python dictionary insertion order.
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .api_version import API_VERSION, OPENAPI_CONTRACT_VERSION

API_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTRACT_PATH = API_ROOT / "openapi" / f"{OPENAPI_CONTRACT_VERSION}.json"


class ContractDriftError(RuntimeError):
    """Raised when the checked-in OpenAPI contract differs from FastAPI."""


def build_schema() -> Mapping[str, Any]:
    """Build the live FastAPI schema and enforce its declared API version."""
    # Imported lazily so helpers such as ``canonical_json`` remain lightweight.
    from .main import app

    schema = app.openapi()
    schema_version = schema.get("info", {}).get("version")
    if schema_version != API_VERSION:
        raise RuntimeError(
            "FastAPI OpenAPI version mismatch: "
            f"expected {API_VERSION!r}, got {schema_version!r}"
        )
    return schema


def canonical_json(schema: Mapping[str, Any]) -> str:
    """Render a schema with deterministic ordering and Unix newlines."""
    return json.dumps(
        schema,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def rendered_contract() -> str:
    """Return the canonical OpenAPI document generated from the live app."""
    return canonical_json(build_schema())


def export_contract(path: Path = DEFAULT_CONTRACT_PATH) -> Path:
    """Write the canonical OpenAPI document to ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered_contract(), encoding="utf-8")
    return path


def contract_diff(path: Path = DEFAULT_CONTRACT_PATH) -> str | None:
    """Return a unified diff when ``path`` is missing or stale."""
    generated = rendered_contract()
    try:
        committed = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return f"Missing OpenAPI contract: {path}\n"

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


def check_contract(path: Path = DEFAULT_CONTRACT_PATH) -> None:
    """Raise ``ContractDriftError`` when the contract is missing or stale."""
    diff = contract_diff(path)
    if diff is not None:
        raise ContractDriftError(diff)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("export", "check"),
        help="export the canonical contract or check the committed artifact",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_CONTRACT_PATH,
        help=f"contract path (default: {DEFAULT_CONTRACT_PATH})",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "export":
        exported = export_contract(args.output)
        print(f"Exported OpenAPI {API_VERSION} contract to {exported}")
        return 0

    try:
        check_contract(args.output)
    except ContractDriftError as exc:
        print(str(exc), file=sys.stderr, end="")
        print(
            "OpenAPI contract drift detected. Regenerate with: "
            "python -m app.openapi_contract export",
            file=sys.stderr,
        )
        return 1

    print(f"OpenAPI contract is current: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
