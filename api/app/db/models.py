"""SQLAlchemy ORM models for SpotiFrei."""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .session import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    crossfade_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    crossfade_duration_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    playlists: Mapped[list["Playlist"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    likes: Mapped[list["Like"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    follows: Mapped[list["FollowedArtist"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Playlist(Base):
    __tablename__ = "playlists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    user: Mapped["User"] = relationship(back_populates="playlists")
    tracks: Mapped[list["PlaylistTrack"]] = relationship(
        back_populates="playlist",
        cascade="all, delete-orphan",
        # `position` predates stable entry mutation and old rows may contain
        # ties.  The immutable primary key makes reads deterministic without a
        # destructive data rewrite; every new reorder writes unique positions.
        order_by=lambda: (PlaylistTrack.position, PlaylistTrack.id),
    )


class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playlist_id: Mapped[int] = mapped_column(
        ForeignKey("playlists.id"), nullable=False, index=True
    )
    deezer_id: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    artist: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # Full performer credit list as a JSON string (see schemas.track helpers).
    artists_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    album: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    album_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    playlist: Mapped["Playlist"] = relationship(back_populates="tracks")


class Like(Base):
    __tablename__ = "likes"
    __table_args__ = (UniqueConstraint("user_id", "deezer_id", name="uq_like_user_track"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    deezer_id: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    artist: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # Full performer credit list as a JSON string (see schemas.track helpers).
    artists_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    album: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    album_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    user: Mapped["User"] = relationship(back_populates="likes")


class FollowedArtist(Base):
    __tablename__ = "followed_artists"
    __table_args__ = (
        UniqueConstraint("user_id", "artist_id", name="uq_follow_user_artist"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    artist_id: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    picture_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    user: Mapped["User"] = relationship(back_populates="follows")


class InviteCode(Base):
    """An admin-issued invite; registering with it auto-approves the account."""

    __tablename__ = "invite_codes"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    used_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Play(Base):
    """A recorded play event, for personal listening statistics."""

    __tablename__ = "plays"
    __table_args__ = (
        Index("uq_play_user_event_id", "user_id", "event_id", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    event_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    deezer_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    artist: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    artist_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    # Full performer credit list as a JSON string (see schemas.track helpers).
    artists_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    album: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    album_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    played_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)


class PartySession(Base):
    __tablename__ = "party_sessions"

    code: Mapped[str] = mapped_column(String(12), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    current_index: Mapped[int] = mapped_column(Integer, nullable=False, default=-1)
    # Host-authoritative playback state, broadcast to guests via SSE.
    is_playing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position_sec: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    playback_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    tracks: Mapped[list["PartyTrack"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="PartyTrack.position",
    )
    members: Mapped[list["PartyMember"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class PartyTrack(Base):
    __tablename__ = "party_tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_code: Mapped[str] = mapped_column(
        ForeignKey("party_sessions.code"), nullable=False, index=True
    )
    deezer_id: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    artist: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    artist_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    # Full performer credit list as a JSON string (see schemas.track helpers).
    artists_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    album: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    album_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    added_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    session: Mapped["PartySession"] = relationship(back_populates="tracks")


class PartyMember(Base):
    __tablename__ = "party_members"
    __table_args__ = (
        UniqueConstraint("session_code", "user_id", name="uq_party_member"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_code: Mapped[str] = mapped_column(
        ForeignKey("party_sessions.code"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    session: Mapped["PartySession"] = relationship(back_populates="members")


class StoredLyrics(Base):
    __tablename__ = "stored_lyrics"

    deezer_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    lines_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    synced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="lrclib")
    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class StoredTrack(Base):
    __tablename__ = "stored_tracks"

    deezer_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    artist: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    album: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ready")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    # Updated on every play; tracks not accessed within the retention window are evicted.
    last_accessed: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)
