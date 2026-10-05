"""One validated Last.fm transport for discovery and metadata providers."""

from __future__ import annotations

import threading

import requests

_LASTFM = "https://ws.audioscrobbler.com/2.0/"
_REQUEST_SLOTS = threading.BoundedSemaphore(8)


class LastfmError(RuntimeError):
    """A configured Last.fm provider failed or returned invalid data."""


def get_json(
    params: dict,
    *,
    api_key: str,
    context: str,
    timeout: int = 12,
    allow_not_found: bool = False,
) -> dict | None:
    """Read a provider response; only an explicit unknown entity may be absent.

    Optional-provider selection belongs to callers. Once a caller chooses
    Last.fm, missing credentials, transport failures and error payloads are
    errors rather than successful empty discovery results.
    """
    if not api_key:
        raise LastfmError(f"{context}: LASTFM_API_KEY is not configured")
    try:
        with _REQUEST_SLOTS:
            response = requests.get(
                _LASTFM,
                params={**params, "api_key": api_key, "format": "json"},
                timeout=timeout,
            )
            response.raise_for_status()
            payload = response.json()
    except requests.exceptions.RequestException as error:
        # requests.HTTPError includes the full request URL, including api_key.
        # Keep the source and status without putting credentials in API errors.
        status = getattr(getattr(error, "response", None), "status_code", None)
        cause = f"HTTP {status}" if status is not None else type(error).__name__
        raise LastfmError(f"{context}: Last.fm request failed ({cause})") from None
    except ValueError as error:
        raise LastfmError(f"{context}: Last.fm returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise LastfmError(f"{context}: Last.fm returned a non-object response")
    if "error" in payload:
        message = payload.get("message")
        if (
            allow_not_found and str(payload["error"]) == "6"
            and isinstance(message, str)
            and message.strip().casefold() in {"track not found", "artist not found"}
        ):
            return None
        if not isinstance(message, str) or not message:
            message = f"API error {payload['error']}"
        raise LastfmError(f"{context}: Last.fm {message}")
    return payload


def object_field(data: dict, key: str, *, context: str) -> dict:
    value = data.get(key)
    if not isinstance(value, dict):
        raise LastfmError(f"{context}: Last.fm has no valid {key} object")
    return value


def list_objects(data: dict, key: str, child: str, *, context: str) -> list[dict]:
    section = object_field(data, key, context=context)
    value = section.get(child)
    if not isinstance(value, list):
        raise LastfmError(f"{context}: Last.fm has no valid {key}.{child} list")
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise LastfmError(
                f"{context}: Last.fm {key}.{child}[{index}] is not an object"
            )
    return value


def text_field(data: dict, key: str, *, context: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise LastfmError(f"{context}: Last.fm has no valid {key} text")
    return value.strip()


def count_field(data: dict, key: str, *, context: str) -> int:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise LastfmError(f"{context}: Last.fm has no valid {key} count")
    try:
        count = int(value)
    except ValueError as error:
        raise LastfmError(f"{context}: Last.fm has no valid {key} count") from error
    if count < 0:
        raise LastfmError(f"{context}: Last.fm {key} count is negative")
    return count
