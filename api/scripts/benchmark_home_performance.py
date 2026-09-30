"""Synthetic chart latency comparison with fixed 100 ms upstream responses.

Run from the repository root:
    python api/scripts/benchmark_home_performance.py

Install the API dependencies first. This makes no network calls. It compares
the former serial loop with the actual charts_collections route and asserts
that their shelves match.
"""
from __future__ import annotations

import statistics
import sys
import time
from pathlib import Path
from typing import Callable
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers import home  # noqa: E402
from app.services import deezer_client as dc  # noqa: E402


UPSTREAM_DELAY_SEC = 0.1
ROUNDS = 5


def fake_public_get(path: str) -> dict:
    time.sleep(UPSTREAM_DELAY_SEC)
    chart_id = path.rsplit("/", 1)[-1]
    return {"tracks": {"data": [{"id": chart_id, "title": f"Track {chart_id}"}]}}


def serial_reference() -> list[home.Shelf]:
    shelves: list[home.Shelf] = []
    for chart in home._CHART_COLLECTIONS:
        tracks = home._chart_tracks(int(chart["id"]))
        if tracks:
            shelves.append(home.Shelf(
                key=str(chart["key"]),
                title=str(chart["title"]),
                subtitle=str(chart["subtitle"]),
                cover=home._cover_of(tracks),
                tracks=tracks[:50],
            ))
    return shelves


def timed(fn: Callable[[], list[home.Shelf]]) -> tuple[float, list[home.Shelf]]:
    started = time.perf_counter()
    shelves = fn()
    return time.perf_counter() - started, shelves


def main() -> None:
    serial_times: list[float] = []
    parallel_times: list[float] = []
    with (
        patch.object(dc, "_public_get", side_effect=fake_public_get),
        patch.object(dc, "normalize_public_tracks", side_effect=lambda tracks: tracks),
    ):
        for _ in range(ROUNDS):
            serial_elapsed, serial_shelves = timed(serial_reference)
            parallel_elapsed, parallel_shelves = timed(home.charts_collections)
            assert [s.model_dump() for s in parallel_shelves] == [
                s.model_dump() for s in serial_shelves
            ]
            serial_times.append(serial_elapsed)
            parallel_times.append(parallel_elapsed)

    serial_median = statistics.median(serial_times)
    parallel_median = statistics.median(parallel_times)
    print(f"Fixed upstream latency: {UPSTREAM_DELAY_SEC:.3f}s per chart")
    print(f"Serial loop median ({ROUNDS} runs): {serial_median:.3f}s")
    print(f"Parallel route median ({ROUNDS} runs): {parallel_median:.3f}s")
    print(f"Synthetic speedup: {serial_median / parallel_median:.2f}x")


if __name__ == "__main__":
    main()
