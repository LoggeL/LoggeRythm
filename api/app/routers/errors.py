"""Map Deezer adapter errors to HTTP responses."""
import math

from fastapi import HTTPException

from ..services import deezer_client as dc
from ..services.deezer_rate_limit import DEFAULT_QUOTA_RETRY_AFTER_SEC
from ..services.discovery import DiscoveryError


def _retry_after_seconds(exc: dc.RateLimited) -> int:
    raw = getattr(exc, "retry_after_sec", None)
    if raw is None or not math.isfinite(raw) or raw <= 0:
        return DEFAULT_QUOTA_RETRY_AFTER_SEC
    return max(1, math.ceil(raw))


def _max_retry_after_from_failures(failures: tuple[Exception, ...]) -> int:
    values: list[int] = []
    for error in failures:
        if isinstance(error, dc.RateLimited):
            values.append(_retry_after_seconds(error))
        elif isinstance(error, DiscoveryError) and error.failures:
            nested = _max_retry_after_from_failures(error.failures)
            if nested > 0:
                values.append(nested)
    return max(values) if values else DEFAULT_QUOTA_RETRY_AFTER_SEC


def to_http(exc: Exception) -> HTTPException:
    if isinstance(exc, DiscoveryError) and exc.failures:
        statuses = {to_http(error).status_code for error in exc.failures}
        # A batch of rate-limited (or unavailable) tracks should retain the
        # provider's retry/resource semantics, even through nested home jobs.
        status = statuses.pop() if len(statuses) == 1 else 502
        headers = (
            {"Retry-After": str(_max_retry_after_from_failures(exc.failures))}
            if status == 429
            else None
        )
        return HTTPException(
            status_code=status,
            detail=f"Upstream error: {exc}",
            headers=headers,
        )
    if isinstance(exc, dc.AuthExpired):
        return HTTPException(status_code=502, detail="Deezer authentication expired")
    if isinstance(exc, dc.TrackUnavailable):
        return HTTPException(status_code=404, detail="Resource not found on Deezer")
    if isinstance(exc, dc.RateLimited):
        retry_after = _retry_after_seconds(exc)
        return HTTPException(
            status_code=429,
            detail=f"Deezer rate limit reached. Retry after {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )
    if isinstance(exc, dc.DecryptFailed):
        return HTTPException(status_code=502, detail="Track decryption failed")
    if isinstance(exc, dc.DeezerClientError):
        return HTTPException(status_code=502, detail=f"Deezer error: {exc}")
    return HTTPException(status_code=502, detail=f"Upstream error: {exc}")
