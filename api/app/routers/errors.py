"""Map Deezer adapter errors to HTTP responses."""
from fastapi import HTTPException

from ..services import deezer_client as dc
from ..services.discovery import DiscoveryError


def to_http(exc: Exception) -> HTTPException:
    if isinstance(exc, DiscoveryError) and exc.failures:
        statuses = {to_http(error).status_code for error in exc.failures}
        # A batch of rate-limited (or unavailable) tracks should retain the
        # provider's retry/resource semantics, even through nested home jobs.
        status = statuses.pop() if len(statuses) == 1 else 502
        return HTTPException(status_code=status, detail=f"Upstream error: {exc}")
    if isinstance(exc, dc.AuthExpired):
        return HTTPException(status_code=502, detail="Deezer authentication expired")
    if isinstance(exc, dc.TrackUnavailable):
        return HTTPException(status_code=404, detail="Resource not found on Deezer")
    if isinstance(exc, dc.RateLimited):
        return HTTPException(status_code=429, detail="Deezer rate limit reached")
    if isinstance(exc, dc.DecryptFailed):
        return HTTPException(status_code=502, detail="Track decryption failed")
    if isinstance(exc, dc.DeezerClientError):
        return HTTPException(status_code=502, detail=f"Deezer error: {exc}")
    return HTTPException(status_code=502, detail=f"Upstream error: {exc}")
