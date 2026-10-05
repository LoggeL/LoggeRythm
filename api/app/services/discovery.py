"""Bounded discovery fan-out with ordered results and complete failure reports."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, TypeVar

T = TypeVar("T")


class DiscoveryError(RuntimeError):
    """A discovery batch could not return a complete result."""

    def __init__(self, message: str, *, failures: tuple[Exception, ...] = ()):
        super().__init__(message)
        self.failures = failures


def run_jobs(jobs: dict[str, Callable[[], T]], *, max_workers: int = 6) -> dict[str, T]:
    """Run independent provider jobs, collect every failure, preserve job order.

    Jobs contain plain seed values. Database sessions must stay in the calling
    request thread and must not be captured by provider workers.
    """
    if not jobs:
        return {}
    results: dict[str, T] = {}
    failures: dict[str, Exception] = {}
    with ThreadPoolExecutor(max_workers=min(max_workers, len(jobs))) as pool:
        futures = {pool.submit(job): name for name, job in jobs.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                results[name] = future.result()
            except Exception as error:
                failures[name] = error
    if failures:
        names = [name for name in jobs if name in failures]
        details = "; ".join(f"{name}: {failures[name]}" for name in names)
        raise DiscoveryError(
            f"Discovery failed for {len(failures)} of {len(jobs)} sources: {details}",
            failures=tuple(failures[name] for name in names),
        ) from failures[names[0]]
    return {name: results[name] for name in jobs}
