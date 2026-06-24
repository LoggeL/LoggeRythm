"""Followed artists for the current user."""
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db.models import FollowedArtist, User
from ..db.session import get_db
from ..schemas.track import ArtistSummary

router = APIRouter(prefix="/api/me/following/artists", tags=["follows"])


def _to_summary(f: FollowedArtist) -> ArtistSummary:
    return ArtistSummary(id=f.artist_id, name=f.name, picture=f.picture_url or "")


@router.get("", response_model=list[ArtistSummary])
def list_following(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ArtistSummary]:
    rows = db.scalars(
        select(FollowedArtist)
        .where(FollowedArtist.user_id == user.id)
        .order_by(FollowedArtist.created_at.desc())
    ).all()
    return [_to_summary(f) for f in rows]


@router.get("/contains")
def following_contains(
    ids: str = Query(default=""),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    wanted = [i for i in ids.split(",") if i]
    if not wanted:
        return {}
    followed = set(
        db.scalars(
            select(FollowedArtist.artist_id).where(
                FollowedArtist.user_id == user.id,
                FollowedArtist.artist_id.in_(wanted),
            )
        ).all()
    )
    return {i: (i in followed) for i in wanted}


@router.put("/{artist_id}", status_code=status.HTTP_204_NO_CONTENT)
def follow_artist(
    artist_id: str,
    artist: ArtistSummary,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    existing = db.scalar(
        select(FollowedArtist).where(
            FollowedArtist.user_id == user.id,
            FollowedArtist.artist_id == artist_id,
        )
    )
    if existing is None:
        db.add(
            FollowedArtist(
                user_id=user.id,
                artist_id=artist_id,
                name=artist.name,
                picture_url=artist.picture or None,
            )
        )
    else:
        existing.name = artist.name
        existing.picture_url = artist.picture or None
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{artist_id}", status_code=status.HTTP_204_NO_CONTENT)
def unfollow_artist(
    artist_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    db.execute(
        delete(FollowedArtist).where(
            FollowedArtist.user_id == user.id,
            FollowedArtist.artist_id == artist_id,
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
