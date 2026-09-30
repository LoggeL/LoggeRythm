"""Bounded, synchronous TTL cache that shares concurrent loads per key."""

from __future__ import annotations

import threading
import time
from concurrent.futures import Future
from typing import Callable, Generic, TypeVar


K = TypeVar("K")
V = TypeVar("V")


class SingleFlightTtlCache(Generic[K, V]):
    """Cache successful loads and let callers of an active key share its result.

    The loader runs outside the lock, so unrelated keys can load concurrently.
    Active loads are capped; a caller for a new key waits for capacity while
    callers for an already active key can still join its future.
    """

    def __init__(
        self,
        *,
        ttl_seconds: float,
        max_entries: int,
        max_inflight: int,
        clock: Callable[[], float] = time.monotonic,
    ):
        if ttl_seconds <= 0 or max_entries < 1 or max_inflight < 1:
            raise ValueError("TTL and cache/in-flight limits must be positive")
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self.max_inflight = max_inflight
        self._clock = clock
        self.lock = threading.Lock()
        self._capacity = threading.Condition(self.lock)
        self.cache: dict[K, tuple[float, V]] = {}
        self.inflight: dict[K, Future[V]] = {}

    def get(self, key: K, loader: Callable[[], V]) -> V:
        with self._capacity:
            while True:
                hit = self.cache.get(key)
                if hit is not None:
                    if self._clock() - hit[0] < self.ttl_seconds:
                        return hit[1]
                    del self.cache[key]

                future = self.inflight.get(key)
                if future is not None:
                    leader = False
                    break

                if len(self.inflight) < self.max_inflight:
                    future = Future()
                    self.inflight[key] = future
                    leader = True
                    break

                self._capacity.wait()

        if not leader:
            return future.result()

        try:
            value = loader()
        except BaseException as exc:
            with self._capacity:
                future.set_exception(exc)
                del self.inflight[key]
                self._capacity.notify_all()
            raise

        with self._capacity:
            completed_at = self._clock()
            expired = [
                cached_key
                for cached_key, (cached_at, _) in self.cache.items()
                if completed_at - cached_at >= self.ttl_seconds
            ]
            for cached_key in expired:
                del self.cache[cached_key]
            while len(self.cache) >= self.max_entries:
                oldest_key = min(self.cache, key=lambda k: self.cache[k][0])
                del self.cache[oldest_key]
            self.cache[key] = (completed_at, value)
            future.set_result(value)
            del self.inflight[key]
            self._capacity.notify_all()
        return value
