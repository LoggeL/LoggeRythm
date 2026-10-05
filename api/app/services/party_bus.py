"""Bounded, in-process delivery of canonical party state to SSE subscribers.

A state frame replaces the previous one, so a slow listener needs only the
newest frame. Both the asyncio queue and the thread-to-loop handoff are bounded.
Database revisions order frames even when threadpool publishers finish out of
order. Revisions are internal and never change the party event wire format.

This bus is local to one worker. Multiple workers require a shared broker.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Any


def utc_revision(value: datetime) -> datetime:
    """Normalize SQLite's naive timestamps to the UTC used by the API."""
    if not isinstance(value, datetime):
        raise TypeError("Party state revision must be a datetime")
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


@dataclass(frozen=True)
class StateFrame:
    updated_at: datetime
    payload: dict[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(self, "updated_at", utc_revision(self.updated_at))


class Subscription:
    """One latest-state slot on either side of a subscriber's event loop."""

    def __init__(self) -> None:
        self.queue: asyncio.Queue[StateFrame] = asyncio.Queue(maxsize=1)
        self.loop = asyncio.get_running_loop()
        self._lock = Lock()
        self._latest_revision: datetime | None = None
        self._pending: StateFrame | None = None
        self._scheduled = False
        self._closed = False

    def offer(self, frame: StateFrame) -> None:
        """Coalesce from any thread before scheduling a single loop callback."""
        with self._lock:
            if self._closed:
                return
            if (
                self._latest_revision is not None
                and frame.updated_at <= self._latest_revision
            ):
                return
            self._latest_revision = frame.updated_at
            self._pending = frame
            if not self._scheduled:
                # Mark and schedule while locked: close() cannot race a write
                # onto a loop which has already dropped this subscription.
                self._scheduled = True
                self.loop.call_soon_threadsafe(self._deliver)

    def _deliver(self) -> None:
        with self._lock:
            frame = self._pending
            self._pending = None
            self._scheduled = False
            if self._closed or frame is None:
                return
            # Only this loop accesses the queue. Replacing a full state frame
            # preserves every field in the latest state without backlog.
            if self.queue.full():
                self.queue.get_nowait()
            self.queue.put_nowait(frame)

    def take_latest(self, initial: StateFrame) -> StateFrame:
        """Start at the newest snapshot, ignoring any older in-flight publish."""
        with self._lock:
            candidates = [initial]
            if self._pending is not None:
                candidates.append(self._pending)
            if not self.queue.empty():
                candidates.append(self.queue.get_nowait())
            newest = max(candidates, key=lambda frame: frame.updated_at)
            self._pending = None
            self._latest_revision = newest.updated_at
            return newest

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._pending = None
        # Called on the owning loop; release the last potentially large frame.
        if not self.queue.empty():
            self.queue.get_nowait()


_subscribers: dict[str, set[Subscription]] = {}
_subscribers_lock = Lock()


def subscribe(code: str) -> Subscription:
    subscription = Subscription()
    with _subscribers_lock:
        _subscribers.setdefault(code, set()).add(subscription)
    return subscription


def unsubscribe(code: str, subscription: Subscription) -> None:
    subscription.close()
    with _subscribers_lock:
        subscribers = _subscribers.get(code)
        if subscribers is None:
            return
        subscribers.discard(subscription)
        if not subscribers:
            del _subscribers[code]


def publish(code: str, frame: StateFrame) -> None:
    """Deliver the latest canonical state; safe in sync FastAPI handlers."""
    with _subscribers_lock:
        subscribers = tuple(_subscribers.get(code, ()))
    for subscription in subscribers:
        subscription.offer(frame)


def subscriber_count(code: str) -> int:
    with _subscribers_lock:
        return len(_subscribers.get(code, ()))
