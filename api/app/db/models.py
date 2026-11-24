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
    false,
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
    is_collaborative: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
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
    collaborators: Mapped[list["PlaylistCollaborator"]] = relationship(
        back_populates="playlist",
        cascade="all, delete-orphan",
        order_by=lambda: (PlaylistCollaborator.joined_at, PlaylistCollaborator.id),
    )
    invites: Mapped[list["PlaylistInvite"]] = relationship(
        back_populates="playlist",
        cascade="all, delete-orphan",
        order_by=lambda: (PlaylistInvite.created_at, PlaylistInvite.id),
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
    added_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    added_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    playlist: Mapped["Playlist"] = relationship(back_populates="tracks")


class PlaylistCollaborator(Base):
    """Non-owner collaborator on a playlist (owner lives on ``Playlist.user_id``)."""

    __tablename__ = "playlist_collaborators"
    __table_args__ = (
        UniqueConstraint("playlist_id", "user_id", name="uq_playlist_collaborator"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playlist_id: Mapped[int] = mapped_column(
        ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(
        String(24), nullable=False, default="editor", server_default="editor"
    )
    added_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)

    playlist: Mapped["Playlist"] = relationship(back_populates="collaborators")


class PlaylistInvite(Base):
    """Shareable invite link token allowing approved accounts to join a collaborative playlist."""

    __tablename__ = "playlist_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playlist_id: Mapped[int] = mapped_column(
        ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    playlist: Mapped["Playlist"] = relationship(back_populates="invites")


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
    # Spotify Jam-style permission: allow non-host participants to control
    # playback, reorder the queue, and remove upcoming non-playing tracks.
    guests_can_control: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # Member key ("u:<id>" or "g:<id>") of whoever last changed playback/current.
    playback_changed_by: Mapped[str] = mapped_column(
        String(24), nullable=False, default="", server_default=""
    )
    # Strictly monotonic counter incremented on explicit playback/current changes.
    playback_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
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
    guests: Mapped[list["PartyGuest"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="PartyGuest.id",
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
    # Who added it, as a party member key ("u:<user id>" or "g:<guest id>").
    # Lets members remove their own additions. "" for rows from before this.
    added_by_member: Mapped[str] = mapped_column(
        String(24), nullable=False, default="", server_default=""
    )
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


class PartyGuest(Base):
    """An anonymous party participant: a nickname and nothing else.

    Guests have no account. They hold a random token in a cookie scoped to
    their party's API path; only its SHA-256 is stored. A guest can see the
    party, add tracks and remove their own additions — never anything outside
    this one party.
    """

    __tablename__ = "party_guests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_code: Mapped[str] = mapped_column(
        ForeignKey("party_sessions.code"), nullable=False, index=True
    )
    nickname: Mapped[str] = mapped_column(String(40), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    session: Mapped["PartySession"] = relationship(back_populates="guests")


class StoredLyrics(Base):
    __tablename__ = "stored_lyrics"

    deezer_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    lines_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    synced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="lrclib")
    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Whisper transcription stored alongside a non-AI primary result so clients
    # can toggle between provider lyrics and the AI transcription. NULL until a
    # client requests variant=ai; unused when the primary is already AI.
    whisper_lines_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    whisper_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
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
    # User whose request originally materialized this cached audio file on disk.
    # NULL for pre-existing files from before tracking existed or anonymous party guests.
    requested_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    request_source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    # Updated on every play; tracks not accessed within the retention window are evicted.
    last_accessed: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)


class TrackRequest(Base):
    """A recorded server-side track request or upstream Deezer materialization."""

    __tablename__ = "track_requests"
    __table_args__ = (
        Index("ix_track_requests_user_requested_at", "user_id", "requested_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    deezer_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    # stream | preload | playlist_export | party_preload | radar_preload | lyrics_ai
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    materialized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    artist: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)


class PasswordResetToken(Base):
    """Single-use password reset link. Only the SHA-256 of the token is stored."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ImportJob(Base):
    """A Spotify link import running (or finished) in the background.

    The client starts it, may leave, and fetches the result later. The result
    (a ``ResolveResult``) is stored as JSON once matching is done.
    """

    __tablename__ = "import_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    # queued | running | done | failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    type: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    image: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    matched: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_lookups: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lookup_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
