"""Synchronized (time-stamped) song lyrics via public providers (no auth).

Returns parsed LRC lines [{t, text}] so the client can show a karaoke-style
3-line view that follows playback. Source: lrclib.net (has synced lyrics).
"""
import json
import re

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db.models import StoredLyrics
from ..db.session import get_db
from ..services import groq, storage

router = APIRouter(prefix="/api", tags=["lyrics"])

_UA = {"User-Agent": "SpotiFrei/1.0 (https://github.com/LoggeL/spotifrei)"}
_LRC_TS = re.compile(r"\[(\d+):(\d{1,2}(?:\.\d+)?)\]")


def _clean_title(title: str) -> str:
    t = re.sub(r"\s*[\(\[].*?[\)\]]", "", title)
    t = re.split(r"\s+-\s+", t)[0]
    return t.strip() or title


def _parse_lrc(lrc: str) -> list[dict]:
    lines: list[dict] = []
    for raw in lrc.splitlines():
        stamps = _LRC_TS.findall(raw)
        if not stamps:
            continue
        text = _LRC_TS.sub("", raw).strip()
        for mm, ss in stamps:
            lines.append({"t": round(int(mm) * 60 + float(ss), 2), "text": text})
    lines.sort(key=lambda x: x["t"])
    return lines


def _lrclib_synced(artist: str, title: str) -> list[dict] | None:
    try:
        r = requests.get(
            "https://lrclib.net/api/get",
            params={"artist_name": artist, "track_name": title},
            headers=_UA,
            timeout=10,
        )
        if r.status_code == 200:
            synced = r.json().get("syncedLyrics")
            if synced:
                parsed = _parse_lrc(synced)
                if parsed:
                    return parsed
        r = requests.get(
            "https://lrclib.net/api/search",
            params={"artist_name": artist, "track_name": title},
            headers=_UA,
            timeout=10,
        )
        if r.status_code == 200:
            for item in r.json() or []:
                synced = item.get("syncedLyrics")
                if synced:
                    parsed = _parse_lrc(synced)
                    if parsed:
                        return parsed
    except (requests.exceptions.RequestException, ValueError):
        return None
    return None


def _fetch(artist: str, title: str) -> dict:
    primary = artist.split(",")[0].strip() or artist
    titles = [title]
    cleaned = _clean_title(title)
    if cleaned != title:
        titles.append(cleaned)
    for t in titles:
        lines = _lrclib_synced(primary, t)
        if lines:
            return {
                "lines": lines,
                "synced": True,
                "source": "lrclib",
                "ai_generated": False,
            }
    return {
        "lines": None,
        "synced": False,
        "source": None,
        "ai_generated": False,
    }


def _groq_transcription(deezer_id: str) -> list[dict]:
    try:
        path = storage.materialize(deezer_id)
    except Exception as exc:  # noqa: BLE001 - translate storage failure with context
        raise groq.GroqTranscriptionError(
            f"Could not materialize Deezer track {deezer_id}."
        ) from exc
    return groq.transcribe_file(path)


def _cached_lyrics_need_word_refresh(row: StoredLyrics) -> bool:
    return (
        groq.configured()
        and row.ai_generated
        and row.source == groq.LEGACY_LYRICS_SOURCE
    )


def _should_persist_lyrics(result: dict) -> bool:
    return bool(result.get("lines")) or result.get("source") == groq.LYRICS_SOURCE


@router.get("/lyrics")
async def lyrics(
    artist: str = Query(..., min_length=1),
    title: str = Query(..., min_length=1),
    deezer_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    # Served from permanent storage if we've fetched this track before.
    if deezer_id:
        row = db.get(StoredLyrics, deezer_id)
        if row is not None and not _cached_lyrics_need_word_refresh(row):
            return {
                "lines": json.loads(row.lines_json),
                "synced": row.synced,
                "source": row.source,
                "ai_generated": row.ai_generated,
                "cached": True,
            }

    result = await run_in_threadpool(_fetch, artist, title)

    if deezer_id and not result.get("lines") and groq.configured():
        try:
            lines = await run_in_threadpool(_groq_transcription, deezer_id)
        except Exception as exc:  # noqa: BLE001 - preserve materialize/Groq context
            print(
                f"Groq lyrics transcription failed for deezer_id={deezer_id}: "
                f"{type(exc).__name__}: {exc}"
            )
            raise HTTPException(
                status_code=502,
                detail="Groq lyrics transcription failed. Check the server logs.",
            ) from exc
        result = {
            "lines": lines,
            "synced": False,
            "source": groq.LYRICS_SOURCE,
            "ai_generated": True,
        }

    # Persist positive hits and valid no-vocals Groq results so repeated page
    # loads never trigger another paid transcription for the same audio.
    if deezer_id and _should_persist_lyrics(result):
        db.merge(
            StoredLyrics(
                deezer_id=deezer_id,
                lines_json=json.dumps(result["lines"], ensure_ascii=False),
                synced=bool(result.get("synced")),
                source=str(result.get("source") or "unknown"),
                ai_generated=bool(result.get("ai_generated")),
            )
        )
        db.commit()
    return result
