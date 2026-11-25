"""Bounded, in-process notification bus for live opt-in friend listening activity."""
from __future__ import annotations

import asyncio
from threading import Lock


class Subscription:
    """Coalescing wakeup slot for one SSE client watching social activity."""

    def __init__(self) -> None:
        self.queue: asyncio.Queue[int] = asyncio.Queue(maxsize=1)
        self.loop = asyncio.get_running_loop()
        self._lock = Lock()
        self._latest_seq: int = 0
        self._pending: int | None = None
        self._scheduled = False
        self._closed = False

    def offer(self, seq: int) -> None:
        with self._lock:
            if self._closed or seq <= self._latest_seq:
                return
            self._latest_seq = seq
            self._pending = seq
            if not self._scheduled:
                self._scheduled = True
                self.loop.call_soon_threadsafe(self._deliver)

    def _deliver(self) -> None:
        with self._lock:
            seq = self._pending
            self._pending = None
            self._scheduled = False
            if self._closed or seq is None:
                return
            if self.queue.full():
                self.queue.get_nowait()
            self.queue.put_nowait(seq)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._pending = None
        if not self.queue.empty():
            self.queue.get_nowait()


_subscribers: set[Subscription] = set()
_lock = Lock()
_seq: int = 0


def subscribe() -> Subscription:
    sub = Subscription()
    with _lock:
        _subscribers.add(sub)
    return sub


def unsubscribe(sub: Subscription) -> None:
    sub.close()
    with _lock:
        _subscribers.discard(sub)


def notify() -> None:
    """Signal all live social-activity SSE streams that presence/playback changed."""
    global _seq
    with _lock:
        _seq += 1
        seq = _seq
        subs = tuple(_subscribers)
    for sub in subs:
        sub.offer(seq)


def subscriber_count() -> int:
    with _lock:
        return len(_subscribers)
