"""Resolve external (Spotify) links into Deezer-playable tracks.

``GET /api/resolve`` answers within the request (capped at
``SPOTIFY_RESOLVE_LIMIT`` tracks). ``/api/resolve/jobs`` runs the same import
as a background job the client can leave and fetch later, for big playlists.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_user
from ..config import SPOTIFY_RESOLVE_LIMIT
from ..db.models import ImportJob, User
from ..db.session import get_db
from ..schemas.resolve import (
    ImportJobCreate,
    ImportJobDetail,
    ImportJobStatus,
    ResolveResult,
    UnmatchedTrack,
)
from ..schemas.track import Track
from ..services import import_jobs, spotify
from ..services.spotify_import import resolve_link

router = APIRouter(prefix="/api", tags=["resolve"])


def _spotify_http_error(e: spotify.SpotifyError) -> HTTPException:
    if isinstance(e, spotify.SpotifyNotConfigured):
        return HTTPException(status_code=503, detail=str(e))
    if isinstance(e, spotify.SpotifyBadLink):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, spotify.SpotifyNotFound):
        return HTTPException(status_code=404, detail=str(e))
    return HTTPException(status_code=502, detail=str(e))


def _result_model(data: dict) -> ResolveResult:
    return ResolveResult(
        type=data["type"],
        name=data["name"],
        image=data["image"],
        total=data["total"],
        source_total=data["source_total"],
        matched=data["matched"],
        tracks=[Track(**t) for t in data["tracks"]],
        unmatched=[UnmatchedTrack(**u) for u in data["unmatched"]],
    )


@router.get("/resolve", response_model=ResolveResult)
async def resolve(url: str = Query(..., description="Spotify playlist/album/track link")) -> ResolveResult:
    try:
        resolved = await run_in_threadpool(resolve_link, url, limit=SPOTIFY_RESOLVE_LIMIT)
    except spotify.SpotifyError as e:
        raise _spotify_http_error(e)
    return _result_model(resolved.as_result())


# --- background import jobs --------------------------------------------------
def _status_fields(job: ImportJob) -> dict:
    return {
        "id": job.id,
        "url": job.url,
        "status": job.status,
        "type": job.type,
        "name": job.name,
        "image": job.image,
        "total": job.total,
        "source_total": job.source_total,
        "processed": job.processed,
        "matched": job.matched,
        "failed_lookups": job.failed_lookups,
        "lookup_error": job.lookup_error,
        "error": job.error,
        "target_playlist_id": job.target_playlist_id,
        "create_playlist_name": job.create_playlist_name,
        "created_playlist_id": job.created_playlist_id,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "finished_at": job.finished_at,
    }


def _owned_job(db: Session, user: User, job_id: str) -> ImportJob:
    job = import_jobs.get_for(db, user, job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Import nicht gefunden. Er wurde gelöscht oder gehört zu einem anderen Konto.",
        )
    return job


@router.post(
    "/resolve/jobs",
    response_model=ImportJobStatus,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_import_job(
    body: ImportJobCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImportJobStatus:
    try:
        if body.target_playlist_id is not None or body.create_playlist_name is not None:
            job = import_jobs.start(
                db,
                user,
                body.url,
                target_playlist_id=body.target_playlist_id,
                create_playlist_name=body.create_playlist_name,
            )
        else:
            job = import_jobs.start(db, user, body.url)
    except spotify.SpotifyError as e:
        raise _spotify_http_error(e)
    except import_jobs.InvalidImportTarget as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except import_jobs.TooManyActiveJobs as e:
        raise HTTPException(status_code=429, detail=str(e))
    return ImportJobStatus(**_status_fields(job))


@router.get("/resolve/jobs", response_model=list[ImportJobStatus])
def list_import_jobs(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ImportJobStatus]:
    return [ImportJobStatus(**_status_fields(job)) for job in import_jobs.list_for(db, user)]


@router.get("/resolve/jobs/{job_id}", response_model=ImportJobDetail)
def get_import_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImportJobDetail:
    job = _owned_job(db, user, job_id)
    result = import_jobs.result_of(job)
    if job.status == "done" and result is None:
        raise HTTPException(
            status_code=500,
            detail=f"Import {job.id} ist als fertig markiert, hat aber kein gespeichertes Ergebnis.",
        )
    return ImportJobDetail(
        **_status_fields(job),
        result=_result_model(result) if result is not None else None,
    )


@router.delete("/resolve/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_import_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    import_jobs.remove(db, _owned_job(db, user, job_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
