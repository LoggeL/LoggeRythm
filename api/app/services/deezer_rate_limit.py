"""Process-local outbound pacing, shared cooldown, and Retry-After parsing for Deezer.

Pure standard-library concurrency primitives (no external infrastructure).
Keeps public Deezer traffic inside Deezer's documented ~50 requests / 5 seconds
budget, honors upstream HTTP 429 / Deezer JSON quota ``code == 4`` cooldowns
across concurrent callers, and fails fast with exact ``retry_after_sec`` when
a caller's wait budget would be exceeded.
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from datetime import timezone
from email.utils import parsedate_to_datetime
from typing import Callable

DEFAULT_QUOTA_RETRY_AFTER_SEC = 5


class RateLimitBudgetExceeded(Exception):
    """Raised when pacing or an active upstream cooldown exceeds ``max_wait_sec``."""

    def __init__(self, reason: str, *, retry_after_sec: float):
        super().__init__(reason)
        self.retry_after_sec = max(0.0, float(retry_after_sec))


def parse_retry_after(
    value: object,
    *,
    now_epoch: Callable[[], float] = time.time,
) -> float | None:
    """Parse an HTTP ``Retry-After`` header (delta-seconds or RFC HTTP-date).

    Returns the exact non-negative delay in seconds without silently clamping
    explicit upstream values, or ``None`` when missing or unparseable.
    """
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    if not stripped:
        return None

    try:
        seconds = float(stripped)
    except ValueError:
        seconds = math.nan
    if math.isfinite(seconds) and seconds >= 0:
        return seconds

    try:
        target = parsedate_to_datetime(stripped)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if target is None:
        return None
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    delta = target.timestamp() - now_epoch()
    return max(0.0, delta)


class DeezerRateLimiter:
    """Thread-safe dual-window pacer + shared upstream cooldown gate.

    Default limits stay conservatively under Deezer's 50 req / 5 s public API
    quota:
    - ``burst_limit=15`` per ``1.0s`` smooths instantaneous request spikes
      while adding 0 ms delay to normal 1–4 request interactive searches.
    - ``sustained_limit=40`` per ``5.0s`` leaves headroom for concurrent
      browse/health/retry traffic.
    """

    def __init__(
        self,
        *,
        burst_limit: int = 15,
        burst_window_sec: float = 1.0,
        sustained_limit: int = 40,
        sustained_window_sec: float = 5.0,
        default_quota_cooldowns: tuple[float, ...] = (1.0, 2.0, 5.0),
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if burst_limit < 1 or sustained_limit < 1:
            raise ValueError("Rate limiter request limits must be positive")
        if burst_window_sec <= 0 or sustained_window_sec <= 0:
            raise ValueError("Rate limiter windows must be positive")
        if sustained_window_sec < burst_window_sec:
            raise ValueError("sustained_window_sec must be >= burst_window_sec")
        if not default_quota_cooldowns or any(c <= 0 for c in default_quota_cooldowns):
            raise ValueError("default_quota_cooldowns must contain positive durations")

        self.burst_limit = burst_limit
        self.burst_window_sec = burst_window_sec
        self.sustained_limit = sustained_limit
        self.sustained_window_sec = sustained_window_sec
        self.default_quota_cooldowns = default_quota_cooldowns
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._timestamps: deque[float] = deque()
        self._cooldown_until: float = 0.0
        self._consecutive_rate_limits: int = 0

    def _prune_locked(self, now: float) -> None:
        cutoff = now - self.sustained_window_sec
        while self._timestamps and self._timestamps[0] <= cutoff:
            self._timestamps.popleft()

    def _wait_needed_locked(self, now: float) -> tuple[float, str]:
        self._prune_locked(now)
        cooldown_wait = max(0.0, self._cooldown_until - now)

        sustained_wait = 0.0
        if len(self._timestamps) >= self.sustained_limit:
            sustained_wait = max(
                0.0, (self._timestamps[0] + self.sustained_window_sec) - now
            )

        burst_wait = 0.0
        burst_cutoff = now - self.burst_window_sec
        recent_count = 0
        oldest_in_burst: float | None = None
        for ts in reversed(self._timestamps):
            if ts <= burst_cutoff:
                break
            recent_count += 1
            oldest_in_burst = ts
            if recent_count == self.burst_limit:
                burst_wait = max(0.0, (oldest_in_burst + self.burst_window_sec) - now)
                break

        wait = max(cooldown_wait, sustained_wait, burst_wait)
        if wait <= 0.0:
            return 0.0, ""
        if cooldown_wait >= sustained_wait and cooldown_wait >= burst_wait:
            return wait, "Deezer rate-limit cooldown active"
        return wait, "Deezer public API pacing budget reached"

    def acquire(self, *, max_wait_sec: float) -> None:
        """Reserve an outbound slot, sleeping up to ``max_wait_sec`` if needed.

        Raises ``RateLimitBudgetExceeded`` immediately (without sleeping) when
        the required wait exceeds the remaining wait budget.
        """
        if max_wait_sec < 0:
            raise ValueError("max_wait_sec must be non-negative")
        deadline = self._clock() + max_wait_sec

        while True:
            with self._lock:
                now = self._clock()
                wait, reason = self._wait_needed_locked(now)
                if wait <= 0.0:
                    self._timestamps.append(now)
                    return
                if now + wait > deadline + 1e-9:
                    retry_after = max(wait, 0.001)
                    raise RateLimitBudgetExceeded(
                        f"{reason} (retry after {max(1, math.ceil(retry_after))}s)",
                        retry_after_sec=retry_after,
                    )
            self._sleep(wait)

    def record_success(self) -> None:
        """Reset consecutive rate-limit backoff escalation after a healthy response."""
        with self._lock:
            self._consecutive_rate_limits = 0

    def record_rate_limit(self, retry_after_sec: float | None = None) -> float:
        """Advance the shared cooldown deadline after an upstream 429 / quota error.

        Explicit upstream ``retry_after_sec`` values are recorded verbatim
        without silently shortening them. Returns the effective cooldown
        duration in seconds from now.
        """
        with self._lock:
            now = self._clock()
            self._consecutive_rate_limits += 1
            if retry_after_sec is not None and math.isfinite(retry_after_sec) and retry_after_sec > 0:
                delay = float(retry_after_sec)
            else:
                index = min(
                    self._consecutive_rate_limits - 1,
                    len(self.default_quota_cooldowns) - 1,
                )
                delay = self.default_quota_cooldowns[index]
            self._cooldown_until = max(self._cooldown_until, now + delay)
            return max(delay, self._cooldown_until - now)

    def cooldown_remaining(self) -> float:
        """Remaining shared cooldown in seconds (0.0 when inactive)."""
        with self._lock:
            return max(0.0, self._cooldown_until - self._clock())

    def reset(self) -> None:
        """Clear recorded request window and cooldown state (for tests/benchmarks)."""
        with self._lock:
            self._timestamps.clear()
            self._cooldown_until = 0.0
            self._consecutive_rate_limits = 0
