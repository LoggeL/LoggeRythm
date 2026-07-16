"""In-process async pub/sub for real-time party events (Server-Sent Events).

Each party ``code`` has a set of subscriber ``asyncio.Queue`` objects (one per
open SSE connection). :func:`publish` fans a state payload out to every
subscriber of a code.

IMPORTANT: subscribers live in *this* uvicorn worker's memory. With a single
worker (our dev/prod setup) that is exactly right. If we ever scale to multiple
workers/processes, this bus will NOT span them and must be swapped for a shared
broker (e.g. Redis pub/sub).

Thread-safety: mutation endpoints are synchronous FastAPI handlers that run in a
threadpool, so :func:`publish` may be called off the event loop. We therefore
capture the running loop when the first SSE connection registers and schedule
queue writes back onto it via ``loop.call_soon_threadsafe`` — the only safe way
to hand data to an ``asyncio.Queue`` from another thread.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

# code -> set of per-connection queues
_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)

# The event loop serving the SSE endpoints. Captured on first subscribe so that
# synchronous (threadpool) publishers can safely schedule queue writes.
_loop: asyncio.AbstractEventLoop | None = None


def subscribe(code: str) -> asyncio.Queue:
    """Register a new subscriber for ``code`` and return its unbounded queue."""
    global _loop
    _loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers[code].add(queue)
    return queue


def unsubscribe(code: str, queue: asyncio.Queue) -> None:
    """Remove a subscriber; drop the code entry once it has no listeners."""
    subs = _subscribers.get(code)
    if subs is None:
        return
    subs.discard(queue)
    if not subs:
        _subscribers.pop(code, None)


def publish(code: str, payload: dict[str, Any]) -> None:
    """Fan ``payload`` out to every subscriber of ``code``.

    Safe to call from a threadpool (sync handler) or the event loop. Does
    nothing when there are no subscribers — that is a legitimate "nobody is
    listening" state, not a swallowed error. Queues are unbounded, so writes
    never fail or drop.
    """
    subs = _subscribers.get(code)
    if not subs:
        return
    loop = _loop
    if loop is None:
        # No SSE connection has ever been established in this worker, yet a
        # subscriber set exists — this should be impossible. Fail loud.
        raise RuntimeError(
            f"party_bus has subscribers for {code!r} but no captured event loop"
        )
    for queue in list(subs):
        loop.call_soon_threadsafe(queue.put_nowait, payload)


def subscriber_count(code: str) -> int:
    """Number of open SSE connections for ``code`` (diagnostics/tests)."""
    return len(_subscribers.get(code, ()))
