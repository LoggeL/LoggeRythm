"""Bounded, in-process SSE delivery for live collaborative playlist updates.

Keyed by ``playlist_id`` and ordered by monotonic ``Playlist.revision`` so
collaborators viewing the same playlist receive live revision notifications
without polling or holding DB sessions open.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True)
class PlaylistEvent:
    playlist_id: int
    revision: int
    event: str = "updated"


class Subscription:
    """One latest-revision slot on either side of a subscriber's event loop."""

    def __init__(self) -> None:
        self.queue: asyncio.Queue[PlaylistEvent] = asyncio.Queue(maxsize=1)
        self.loop = asyncio.get_running_loop()
        self._lock = Lock()
        self._latest_revision: int = -1
        self._pending: PlaylistEvent | None = None
        self._scheduled = False
        self._closed = False

    def offer(self, item: PlaylistEvent) -> None:
        with self._lock:
            if self._closed:
                return
            is_terminal = item.event == "deleted"
            if not is_terminal and item.revision <= self._latest_revision:
                return
            if is_terminal and item.revision <= self._latest_revision:
                item = PlaylistEvent(
                    playlist_id=item.playlist_id,
                    revision=self._latest_revision + 1,
                    event="deleted",
                )
            self._latest_revision = item.revision
            self._pending = item
            if not self._scheduled:
                self._scheduled = True
                self.loop.call_soon_threadsafe(self._deliver)

    def _deliver(self) -> None:
        with self._lock:
            item = self._pending
            self._pending = None
            self._scheduled = False
            if self._closed or item is None:
                return
            if self.queue.full():
                self.queue.get_nowait()
            self.queue.put_nowait(item)

    def take_latest(self, initial: PlaylistEvent) -> PlaylistEvent:
        with self._lock:
            candidates = [initial]
            if self._pending is not None:
                candidates.append(self._pending)
            if not self.queue.empty():
                candidates.append(self.queue.get_nowait())
            newest = max(
                candidates,
                key=lambda ev: (1 if ev.event == "deleted" else 0, ev.revision),
            )
            self._pending = None
            self._latest_revision = newest.revision
            return newest

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._pending = None
        if not self.queue.empty():
            self.queue.get_nowait()


_subscribers: dict[int, set[Subscription]] = {}
_lock = Lock()


def subscribe(playlist_id: int) -> Subscription:
    sub = Subscription()
    with _lock:
        _subscribers.setdefault(playlist_id, set()).add(sub)
    return sub


def unsubscribe(playlist_id: int, sub: Subscription) -> None:
    sub.close()
    with _lock:
        subs = _subscribers.get(playlist_id)
        if subs is None:
            return
        subs.discard(sub)
        if not subs:
            del _subscribers[playlist_id]


def publish(playlist_id: int, revision: int, event: str = "updated") -> None:
    """Notify subscribers of a committed playlist revision bump."""
    payload = PlaylistEvent(playlist_id=playlist_id, revision=revision, event=event)
    with _lock:
        subs = tuple(_subscribers.get(playlist_id, ()))
    for sub in subs:
        sub.offer(payload)


def publish_deleted(playlist_id: int, revision: int = 0) -> None:
    """Notify open SSE subscribers that the playlist has been deleted."""
    publish(playlist_id, revision, event="deleted")


def subscriber_count(playlist_id: int) -> int:
    with _lock:
        return len(_subscribers.get(playlist_id, ()))
