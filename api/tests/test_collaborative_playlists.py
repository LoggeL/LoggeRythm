"""Tests for collaborative playlists: migrations, account invitations, permissions, attribution, and listing."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import create_token
from app.config import SESSION_COOKIE
from app.db.models import (
    Playlist,
    PlaylistCollaborator,
    PlaylistInvitation,
    PlaylistTrack,
    User,
)
from app.db.session import Base, get_db
from app.main import _run_column_migrations, app
from app.routers import playlists, profile
from app.schemas.playlist import (
    PlaylistCollaborativeUpdate,
    PlaylistInvitationCreate,
    PlaylistCreate,
    PlaylistEntryReorder,
    PlaylistReorder,
    PlaylistUpdate,
)
from app.schemas.track import Track

def _sample_track(track_id: str, title: str = "Song", cover: str = "") -> Track:
    return Track(
        id=track_id,
        title=title,
        artist="Artist",
        artist_id="1",
        album="Album",
        album_id="10",
        cover=cover,
        duration_sec=180,
    )


class CollaborativePlaylistMigrationTests(unittest.TestCase):
    def test_portable_migration_adds_columns_and_backfills_once(self) -> None:
        engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        try:
            with engine.begin() as conn:
                conn.exec_driver_sql(
                    """
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY,
                        email VARCHAR(320) NOT NULL UNIQUE,
                        password_hash VARCHAR(255) NOT NULL,
                        display_name VARCHAR(120),
                        avatar_url VARCHAR(500),
                        is_admin BOOLEAN NOT NULL DEFAULT 0,
                        is_approved BOOLEAN NOT NULL DEFAULT 0,
                        crossfade_enabled BOOLEAN NOT NULL DEFAULT 0,
                        crossfade_duration_sec INTEGER NOT NULL DEFAULT 5,
                        created_at DATETIME
                    )
                    """
                )
                conn.exec_driver_sql(
                    """
                    CREATE TABLE playlists (
                        id INTEGER PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        name VARCHAR(200) NOT NULL,
                        description TEXT,
                        cover_url VARCHAR(500),
                        is_public BOOLEAN NOT NULL DEFAULT 0,
                        created_at DATETIME
                    )
                    """
                )
                conn.exec_driver_sql(
                    """
                    CREATE TABLE playlist_tracks (
                        id INTEGER PRIMARY KEY,
                        playlist_id INTEGER NOT NULL,
                        deezer_id VARCHAR(32) NOT NULL,
                        title VARCHAR(500) NOT NULL DEFAULT '',
                        artist VARCHAR(500) NOT NULL DEFAULT '',
                        artists_json TEXT NOT NULL DEFAULT '[]',
                        album VARCHAR(500) NOT NULL DEFAULT '',
                        album_id VARCHAR(32) NOT NULL DEFAULT '',
                        cover_url VARCHAR(500),
                        duration_sec INTEGER NOT NULL DEFAULT 0,
                        position INTEGER NOT NULL DEFAULT 0,
                        added_at DATETIME
                    )
                    """
                )
                conn.exec_driver_sql(
                    "INSERT INTO users (id, email, password_hash, display_name, is_approved) "
                    "VALUES (1, 'owner@example.com', 'x', 'Owner', 1)"
                )
                conn.exec_driver_sql(
                    "INSERT INTO playlists (id, user_id, name, is_public) "
                    "VALUES (10, 1, 'Legacy Mix', 0)"
                )
                conn.exec_driver_sql(
                    "INSERT INTO playlist_tracks (id, playlist_id, deezer_id, title, artist, position) "
                    "VALUES (100, 10, '42', 'Legacy Track', 'Artist', 0)"
                )

            _run_column_migrations(target_engine=engine)
            Base.metadata.create_all(engine)

            inspector = inspect(engine)
            playlist_cols = {c["name"] for c in inspector.get_columns("playlists")}
            track_cols = {c["name"] for c in inspector.get_columns("playlist_tracks")}
            track_indexes = {idx["name"] for idx in inspector.get_indexes("playlist_tracks")}
            self.assertIn("is_collaborative", playlist_cols)
            self.assertIn("revision", playlist_cols)
            self.assertIn("added_by_user_id", track_cols)
            self.assertIn("ix_playlist_tracks_added_by_user_id", track_indexes)
            self.assertTrue(inspector.has_table("playlist_collaborators"))
            self.assertTrue(inspector.has_table("playlist_invitations"))

            with Session(engine) as db:
                pl = db.get(Playlist, 10)
                pt = db.get(PlaylistTrack, 100)
                self.assertIsNotNone(pl)
                self.assertIsNotNone(pt)
                self.assertFalse(pl.is_collaborative)
                self.assertEqual(pl.revision, 0)
                # Backfilled once to the playlist owner.
                self.assertEqual(pt.added_by_user_id, 1)

                # A later explicit NULL (e.g. deleted user) must NOT be overwritten on restart.
                pt.added_by_user_id = None
                db.commit()

            _run_column_migrations(target_engine=engine)

            with Session(engine) as db:
                pt = db.get(PlaylistTrack, 100)
                self.assertIsNotNone(pt)
                self.assertIsNone(pt.added_by_user_id)
        finally:
            engine.dispose()


class CollaborativePlaylistTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            future=True,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        with self.engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

        self.owner = self._add_user("owner@example.com", "Owner", avatar="/api/users/1/avatar")
        self.collab = self._add_user("collab@example.com", "Bob", avatar="/api/users/2/avatar")
        self.collab2 = self._add_user("collab2@example.com", "Clara")
        self.outsider = self._add_user("outsider@example.com", "Outsider")
        self.pending = self._add_user("pending@example.com", "Pending", approved=False)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _add_user(
        self,
        email: str,
        display_name: str,
        *,
        avatar: str | None = None,
        approved: bool = True,
    ) -> User:
        user = User(
            email=email,
            password_hash="unused",
            display_name=display_name,
            avatar_url=avatar,
            is_approved=approved,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def _create_playlist(
        self,
        owner: User,
        name: str = "Shared Mix",
        *,
        collaborative: bool = True,
        public: bool = False,
    ) -> Playlist:
        summary = playlists.create_playlist(
            body=PlaylistCreate(name=name, is_collaborative=collaborative),
            user=owner,
            db=self.db,
        )
        pl = self.db.get(Playlist, summary.id)
        assert pl is not None
        if public:
            pl.is_public = True
            self.db.commit()
        return pl

    def _invite(self, playlist_id: int, invitee: User) -> None:
        playlists.invite_to_playlist(
            playlist_id,
            body=PlaylistInvitationCreate(user_id=invitee.id),
            user=self.owner,
            db=self.db,
        )

    def _incoming_id(self, playlist_id: int, invitee: User) -> int:
        matches = [
            inv.id
            for inv in playlists.list_my_playlist_invitations(user=invitee, db=self.db)
            if inv.playlist.playlist_id == playlist_id
        ]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def _join(self, playlist_id: int, invitee: User) -> None:
        """Owner invites ``invitee`` and the invitee accepts."""
        self._invite(playlist_id, invitee)
        joined = playlists.accept_playlist_invitation(
            self._incoming_id(playlist_id, invitee), user=invitee, db=self.db
        )
        self.assertTrue(joined.joined)

    def test_create_toggle_and_invite_lifecycle(self) -> None:
        pl = self._create_playlist(self.owner, "Solo", collaborative=False)
        self.assertFalse(pl.is_collaborative)
        with self.assertRaises(HTTPException) as disabled:
            self._invite(pl.id, self.collab)
        self.assertEqual(disabled.exception.status_code, 409)

        updated = playlists.set_collaborative(
            pl.id,
            body=PlaylistCollaborativeUpdate(is_collaborative=True),
            user=self.owner,
            db=self.db,
        )
        self.assertTrue(updated.is_collaborative)
        self.assertTrue(updated.is_owner)
        self.assertTrue(updated.can_edit_tracks)
        self.assertEqual(updated.owner_id, self.owner.id)

        # Owner invites Bob: Bob is NOT a collaborator until he accepts.
        created = playlists.invite_to_playlist(
            pl.id,
            body=PlaylistInvitationCreate(user_id=self.collab.id),
            user=self.owner,
            db=self.db,
        )
        self.assertEqual(created.invitee.id, self.collab.id)
        self.assertEqual(created.invitee.display_name, "Bob")
        assert created.invited_by is not None
        self.assertEqual(created.invited_by.id, self.owner.id)
        self.assertIsNotNone(created.created_at.tzinfo)
        outgoing = playlists.list_playlist_invitations(pl.id, user=self.owner, db=self.db)
        self.assertEqual([o.invitee.id for o in outgoing], [self.collab.id])
        self.assertFalse(playlists._is_collaborator(self.db, pl.id, self.collab.id))
        with self.assertRaises(HTTPException) as hidden_before_accept:
            playlists.get_playlist(pl.id, user=self.collab, db=self.db)
        self.assertEqual(hidden_before_accept.exception.status_code, 404)

        # Duplicate invite -> 409; self-invite -> 400; unknown/unapproved -> 404.
        with self.assertRaises(HTTPException) as dup:
            self._invite(pl.id, self.collab)
        self.assertEqual(dup.exception.status_code, 409)
        with self.assertRaises(HTTPException) as self_invite:
            self._invite(pl.id, self.owner)
        self.assertEqual(self_invite.exception.status_code, 400)
        for bad_id in (self.pending.id, 999999):
            with self.assertRaises(HTTPException) as nf:
                playlists.invite_to_playlist(
                    pl.id,
                    body=PlaylistInvitationCreate(user_id=bad_id),
                    user=self.owner,
                    db=self.db,
                )
            self.assertEqual(nf.exception.status_code, 404)

        # Bob sees the invitation with a playlist preview.
        incoming = playlists.list_my_playlist_invitations(user=self.collab, db=self.db)
        self.assertEqual(len(incoming), 1)
        self.assertEqual(incoming[0].playlist.playlist_id, pl.id)
        self.assertEqual(incoming[0].playlist.name, "Solo")
        self.assertEqual(incoming[0].playlist.owner.id, self.owner.id)
        assert incoming[0].invited_by is not None
        self.assertEqual(incoming[0].invited_by.id, self.owner.id)
        self.assertEqual(playlists.list_my_playlist_invitations(user=self.collab2, db=self.db), [])

        # Someone else cannot accept or decline Bob's invitation (no existence oracle).
        for action in (
            playlists.accept_playlist_invitation,
            playlists.decline_playlist_invitation,
        ):
            with self.assertRaises(HTTPException) as foreign:
                action(incoming[0].id, user=self.collab2, db=self.db)
            self.assertEqual(foreign.exception.status_code, 404)
            self.assertEqual(foreign.exception.detail, "Einladung nicht gefunden.")

        # Bob accepts: becomes editor, invitation is consumed.
        joined = playlists.accept_playlist_invitation(incoming[0].id, user=self.collab, db=self.db)
        self.assertTrue(joined.joined)
        self.assertFalse(joined.already_member)
        self.assertEqual(joined.role, "editor")
        self.assertEqual(joined.playlist_id, pl.id)
        self.assertTrue(playlists._is_collaborator(self.db, pl.id, self.collab.id))
        collab_row = self.db.scalar(
            select(PlaylistCollaborator).where(PlaylistCollaborator.user_id == self.collab.id)
        )
        assert collab_row is not None
        self.assertEqual(collab_row.added_by_user_id, self.owner.id)
        self.assertEqual(playlists.list_my_playlist_invitations(user=self.collab, db=self.db), [])
        self.assertEqual(playlists.list_playlist_invitations(pl.id, user=self.owner, db=self.db), [])
        with self.assertRaises(HTTPException) as consumed:
            playlists.accept_playlist_invitation(incoming[0].id, user=self.collab, db=self.db)
        self.assertEqual(consumed.exception.status_code, 404)

        # Inviting an existing collaborator -> 409.
        with self.assertRaises(HTTPException) as member:
            self._invite(pl.id, self.collab)
        self.assertEqual(member.exception.status_code, 409)

        # Clara declines: no membership, invitation gone, owner may invite again.
        self._invite(pl.id, self.collab2)
        declined = playlists.decline_playlist_invitation(
            self._incoming_id(pl.id, self.collab2), user=self.collab2, db=self.db
        )
        self.assertEqual(declined.status_code, 204)
        self.assertFalse(playlists._is_collaborator(self.db, pl.id, self.collab2.id))
        self.assertEqual(playlists.list_playlist_invitations(pl.id, user=self.owner, db=self.db), [])
        self._invite(pl.id, self.collab2)

        # Owner withdraws Clara's invitation; withdrawing again -> 404.
        withdrawn = playlists.withdraw_playlist_invitation(
            pl.id, self.collab2.id, user=self.owner, db=self.db
        )
        self.assertEqual(withdrawn.status_code, 204)
        self.assertEqual(playlists.list_my_playlist_invitations(user=self.collab2, db=self.db), [])
        with self.assertRaises(HTTPException) as gone:
            playlists.withdraw_playlist_invitation(
                pl.id, self.collab2.id, user=self.owner, db=self.db
            )
        self.assertEqual(gone.exception.status_code, 404)

        # Disabling collaboration deletes pending invitations, keeps collaborators.
        self._invite(pl.id, self.collab2)
        playlists.set_collaborative(
            pl.id,
            body=PlaylistCollaborativeUpdate(is_collaborative=False),
            user=self.owner,
            db=self.db,
        )
        self.assertEqual(playlists.list_my_playlist_invitations(user=self.collab2, db=self.db), [])
        self.assertIsNone(self.db.scalar(select(PlaylistInvitation)))
        self.assertTrue(playlists._is_collaborator(self.db, pl.id, self.collab.id))

    def test_accept_with_pending_invitation_on_disabled_playlist_fails_loudly(self) -> None:
        pl = self._create_playlist(self.owner, "Corrupt Invite", collaborative=True)
        self._invite(pl.id, self.collab)
        invitation_id = self._incoming_id(pl.id, self.collab)
        # Bypass set_collaborative (which deletes invitations) to simulate corrupt state.
        pl.is_collaborative = False
        self.db.commit()
        with self.assertRaisesRegex(RuntimeError, "collaboration is disabled"):
            playlists.accept_playlist_invitation(invitation_id, user=self.collab, db=self.db)

    def test_invite_candidate_search_by_display_name_only(self) -> None:
        pl = self._create_playlist(self.owner, "Search Mix", collaborative=True)
        self._add_user("nameless@example.com", None)  # type: ignore[arg-type]
        self._add_user("percent@example.com", "100% Clara_Fan")
        self.db.commit()
        self._join(pl.id, self.collab)
        self._invite(pl.id, self.collab2)

        def search(q: str) -> dict[str, str]:
            return {
                c.user.display_name or "": c.status
                for c in playlists.search_invite_candidates(pl.id, q=q, user=self.owner, db=self.db)
            }

        # Case-insensitive substring; statuses reflect membership and pending invites.
        self.assertEqual(search("CLA"), {"Clara": "invited", "100% Clara_Fan": "available"})
        self.assertEqual(search("bo"), {"Bob": "collaborator"})
        # Owner, unapproved and nameless accounts are never offered; emails don't match.
        self.assertEqual(search("Owner"), {})
        self.assertEqual(search("Pending"), {})
        self.assertEqual(search("example.com"), {})
        self.assertEqual(search("outsider@"), {})
        # LIKE wildcards are literal.
        self.assertEqual(search("%"), {"100% Clara_Fan": "available"})
        self.assertEqual(search("_"), {"100% Clara_Fan": "available"})
        with self.assertRaises(HTTPException) as blank:
            playlists.search_invite_candidates(pl.id, q="   ", user=self.owner, db=self.db)
        self.assertEqual(blank.exception.status_code, 422)
        with self.assertRaises(HTTPException) as not_owner:
            playlists.search_invite_candidates(pl.id, q="Cla", user=self.collab, db=self.db)
        self.assertEqual(not_owner.exception.status_code, 403)

    def test_concurrent_accept_integrity_error_race_and_non_duplicate_re_raise(self) -> None:
        pl = self._create_playlist(self.owner, "Race Mix", collaborative=True)
        self._invite(pl.id, self.collab)
        invitation_id = self._incoming_id(pl.id, self.collab)

        def racing_commit() -> None:
            raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed"))

        # Another request added Bob between our check and commit: report membership,
        # and the invitation is consumed.
        real_commit = self.db.commit
        commits = iter([racing_commit, real_commit])
        with (
            patch.object(self.db, "commit", side_effect=lambda: next(commits)()),
            patch.object(playlists, "_is_collaborator", side_effect=[False, True]),
        ):
            res = playlists.accept_playlist_invitation(invitation_id, user=self.collab, db=self.db)
        self.assertFalse(res.joined)
        self.assertTrue(res.already_member)
        self.assertEqual(res.role, "editor")
        self.assertIsNone(self.db.get(PlaylistInvitation, invitation_id))

        # Unrelated IntegrityError (user still NOT a collaborator) must re-raise loudly.
        self._invite(pl.id, self.collab2)
        second_id = self._incoming_id(pl.id, self.collab2)
        with (
            patch.object(self.db, "commit", side_effect=racing_commit),
            patch.object(playlists, "_is_collaborator", side_effect=[False, False]),
            self.assertRaises(IntegrityError),
        ):
            playlists.accept_playlist_invitation(second_id, user=self.collab2, db=self.db)

    def test_remove_and_leave_collaborators(self) -> None:
        pl = self._create_playlist(self.owner, "Direct Mix", collaborative=True)
        self._join(pl.id, self.collab)

        # Owner cannot remove self (400); removing non-member -> 404.
        with self.assertRaises(HTTPException) as rm_self:
            playlists.remove_collaborator(pl.id, self.owner.id, user=self.owner, db=self.db)
        self.assertEqual(rm_self.exception.status_code, 400)
        with self.assertRaises(HTTPException) as rm_missing:
            playlists.remove_collaborator(pl.id, self.outsider.id, user=self.owner, db=self.db)
        self.assertEqual(rm_missing.exception.status_code, 404)

        # Collaborator cannot remove another collaborator (403).
        self._join(pl.id, self.collab2)
        with self.assertRaises(HTTPException) as collab_rm:
            playlists.remove_collaborator(pl.id, self.collab2.id, user=self.collab, db=self.db)
        self.assertEqual(collab_rm.exception.status_code, 403)

        # Owner removes collab2.
        resp = playlists.remove_collaborator(pl.id, self.collab2.id, user=self.owner, db=self.db)
        self.assertEqual(resp.status_code, 204)

        # Owner cannot leave own playlist (400); outsider gets identical 404 detail
        # on private vs non-existent playlists (no existence oracle).
        with self.assertRaises(HTTPException) as owner_leave:
            playlists.leave_playlist(pl.id, user=self.owner, db=self.db)
        self.assertEqual(owner_leave.exception.status_code, 400)
        with self.assertRaises(HTTPException) as missing_leave:
            playlists.leave_playlist(999999, user=self.outsider, db=self.db)
        with self.assertRaises(HTTPException) as outsider_private_leave:
            playlists.leave_playlist(pl.id, user=self.outsider, db=self.db)
        self.assertEqual(missing_leave.exception.status_code, 404)
        self.assertEqual(outsider_private_leave.exception.status_code, 404)
        self.assertEqual(
            outsider_private_leave.exception.detail,
            missing_leave.exception.detail,
        )
        self.assertEqual(outsider_private_leave.exception.detail, "Playlist not found")

        # Non-member on a public playlist still gets 404 when leaving.
        public_pl = self._create_playlist(self.owner, "Public Leave", collaborative=True, public=True)
        with self.assertRaises(HTTPException) as outsider_public_leave:
            playlists.leave_playlist(public_pl.id, user=self.outsider, db=self.db)
        self.assertEqual(outsider_public_leave.exception.status_code, 404)

        # Collaborator can leave EVEN when collaboration is toggled OFF.
        playlists.set_collaborative(
            pl.id,
            body=PlaylistCollaborativeUpdate(is_collaborative=False),
            user=self.owner,
            db=self.db,
        )
        leave_resp = playlists.leave_playlist(pl.id, user=self.collab, db=self.db)
        self.assertEqual(leave_resp.status_code, 204)
        # Private playlist is now invisible to former collaborator.
        with self.assertRaises(HTTPException) as hidden:
            playlists.get_playlist(pl.id, user=self.collab, db=self.db)
        self.assertEqual(hidden.exception.status_code, 404)

    def test_permissions_matrix_track_attribution_and_freeze(self) -> None:
        pl = self._create_playlist(self.owner, "Private Collab", collaborative=True, public=False)
        self._invite(pl.id, self.collab2)
        self._join(pl.id, self.collab)

        # Owner adds track 1; collaborator adds track 2 + bulk track 3.
        playlists.add_track(pl.id, _sample_track("101", "Owner Song"), user=self.owner, db=self.db)
        playlists.add_track(pl.id, _sample_track("102", "Bob Song"), user=self.collab, db=self.db)
        bulk = playlists.add_tracks_bulk(
            pl.id,
            [_sample_track("102", "Dup"), _sample_track("103", "Bob Bulk")],
            user=self.collab,
            db=self.db,
        )
        self.assertEqual(bulk, {"added": 1})

        detail = playlists.get_playlist(pl.id, user=self.collab, db=self.db)
        self.assertFalse(detail.is_owner)
        self.assertTrue(detail.is_collaborator)
        self.assertTrue(detail.is_collaborative)
        self.assertTrue(detail.can_edit_tracks)
        self.assertEqual(detail.owner_id, self.owner.id)
        self.assertEqual(detail.owner_name, "Owner")
        self.assertEqual(detail.owner_avatar_url, "/api/users/1/avatar")
        self.assertEqual(detail.collaborator_count, 1)
        self.assertEqual([c.user_id for c in detail.collaborators], [self.collab.id])
        self.assertGreater(detail.revision, 0)
        self.assertEqual(
            [(t.id, t.added_by.id if t.added_by else None) for t in detail.tracks],
            [("101", self.owner.id), ("102", self.collab.id), ("103", self.collab.id)],
        )
        for t in detail.tracks:
            self.assertIsNotNone(t.added_at)
            assert t.added_at is not None
            self.assertIsNotNone(t.added_at.tzinfo)

        # Collaborator can reorder tracks (v2 snapshot + v1 legacy).
        entry_ids = [t.playlist_entry_id for t in detail.tracks]
        playlists.reorder_playlist_entries(
            pl.id,
            body=PlaylistEntryReorder(entry_ids=[entry_ids[2], entry_ids[0], entry_ids[1]]),
            user=self.collab,
            db=self.db,
        )
        # Stale snapshot rejected with 409.
        with self.assertRaises(HTTPException) as stale:
            playlists.reorder_playlist_entries(
                pl.id,
                body=PlaylistEntryReorder(entry_ids=entry_ids[:2]),
                user=self.collab,
                db=self.db,
            )
        self.assertEqual(stale.exception.status_code, 409)

        playlists.reorder_tracks(
            pl.id,
            body=PlaylistReorder(deezer_ids=["101", "102", "103"]),
            user=self.collab,
            db=self.db,
        )

        # Collaborator can remove ANY track (including owner's track!).
        owner_entry_id = entry_ids[0]
        playlists.remove_playlist_entry(pl.id, owner_entry_id, user=self.collab, db=self.db)
        playlists.remove_track(pl.id, "103", user=self.collab, db=self.db)
        self.db.expire_all()
        after_rm = playlists.get_playlist(pl.id, user=self.owner, db=self.db)
        self.assertEqual([t.id for t in after_rm.tracks], ["102"])

        # Collaborator CANNOT perform owner-only actions -> 403.
        for action in (
            lambda: playlists.update_playlist(pl.id, PlaylistUpdate(name="Hack"), user=self.collab, db=self.db),
            lambda: playlists.set_visibility(pl.id, playlists._VisibilityUpdate(is_public=True), user=self.collab, db=self.db),
            lambda: playlists.set_collaborative(pl.id, PlaylistCollaborativeUpdate(is_collaborative=False), user=self.collab, db=self.db),
            lambda: playlists.search_invite_candidates(pl.id, q="Cla", user=self.collab, db=self.db),
            lambda: playlists.list_playlist_invitations(pl.id, user=self.collab, db=self.db),
            lambda: playlists.invite_to_playlist(pl.id, PlaylistInvitationCreate(user_id=self.collab2.id), user=self.collab, db=self.db),
            lambda: playlists.withdraw_playlist_invitation(pl.id, self.collab2.id, user=self.collab, db=self.db),
            lambda: playlists.delete_playlist(pl.id, user=self.collab, db=self.db),
        ):
            with self.assertRaises(HTTPException) as forbidden:
                action()
            self.assertEqual(forbidden.exception.status_code, 403)

        # Outsider gets 404 on private collaborative playlist (all read & write routes).
        for action in (
            lambda: playlists.get_playlist(pl.id, user=self.outsider, db=self.db),
            lambda: playlists.get_playlist(pl.id, user=None, db=self.db),
            lambda: playlists.add_track(pl.id, _sample_track("999"), user=self.outsider, db=self.db),
            lambda: playlists.update_playlist(pl.id, PlaylistUpdate(name="No"), user=self.outsider, db=self.db),
            lambda: playlists.get_cover(pl.id, user=self.outsider, db=self.db),
        ):
            with self.assertRaises(HTTPException) as hidden:
                action()
            self.assertEqual(hidden.exception.status_code, 404)

        # Collaborator CAN access private playlist cover.
        with tempfile.TemporaryDirectory() as cover_dir:
            cover_path = os.path.join(cover_dir, f"{pl.id}.jpg")
            with open(cover_path, "wb") as handle:
                handle.write(b"jpeg-bytes")
            with patch.object(playlists, "_COVERS_DIR", cover_dir):
                cover_resp = playlists.get_cover(pl.id, user=self.collab, db=self.db)
                self.assertEqual(cover_resp.path, cover_path)

        # Toggle collaborative OFF: withdraws Clara's pending invitation, preserves collaborator read-only.
        playlists.set_collaborative(
            pl.id,
            body=PlaylistCollaborativeUpdate(is_collaborative=False),
            user=self.owner,
            db=self.db,
        )
        self.assertEqual(playlists.list_my_playlist_invitations(user=self.collab2, db=self.db), [])

        frozen_detail = playlists.get_playlist(pl.id, user=self.collab, db=self.db)
        self.assertTrue(frozen_detail.is_collaborator)
        self.assertFalse(frozen_detail.is_collaborative)
        self.assertFalse(frozen_detail.can_edit_tracks)
        self.assertEqual(frozen_detail.collaborator_count, 1)
        for frozen_write in (
            lambda: playlists.add_track(pl.id, _sample_track("200"), user=self.collab, db=self.db),
            lambda: playlists.add_tracks_bulk(pl.id, [_sample_track("201")], user=self.collab, db=self.db),
            lambda: playlists.reorder_playlist_entries(
                pl.id,
                PlaylistEntryReorder(entry_ids=[frozen_detail.tracks[0].playlist_entry_id]),
                user=self.collab,
                db=self.db,
            ),
            lambda: playlists.remove_playlist_entry(
                pl.id, frozen_detail.tracks[0].playlist_entry_id, user=self.collab, db=self.db
            ),
        ):
            with self.assertRaises(HTTPException) as exc:
                frozen_write()
            self.assertEqual(exc.exception.status_code, 403)

        # Make playlist public: outsider can view, NOT edit (403).
        playlists.set_visibility(
            pl.id, playlists._VisibilityUpdate(is_public=True), user=self.owner, db=self.db
        )
        pub_detail = playlists.get_playlist(pl.id, user=self.outsider, db=self.db)
        self.assertFalse(pub_detail.is_owner)
        self.assertFalse(pub_detail.is_collaborator)
        self.assertFalse(pub_detail.can_edit_tracks)
        with self.assertRaises(HTTPException) as pub_write:
            playlists.add_track(pl.id, _sample_track("300"), user=self.outsider, db=self.db)
        self.assertEqual(pub_write.exception.status_code, 403)

    def test_listing_scopes_public_exclusion_counts_and_profile(self) -> None:
        owned_solo = self._create_playlist(self.owner, "Solo", collaborative=False, public=True)
        owned_collab = self._create_playlist(self.owner, "Team", collaborative=True, public=True)
        other_pub = self._create_playlist(self.outsider, "Other Public", collaborative=False, public=True)

        # Add 3 tracks and 2 collaborators to verify no join-multiplication on counts.
        self._join(owned_collab.id, self.collab)
        self._join(owned_collab.id, self.collab2)
        playlists.add_tracks_bulk(
            owned_collab.id,
            [_sample_track("1"), _sample_track("2"), _sample_track("3")],
            user=self.owner,
            db=self.db,
        )
        playlists.add_track(owned_solo.id, _sample_track("4"), user=self.owner, db=self.db)
        playlists.add_track(other_pub.id, _sample_track("5"), user=self.outsider, db=self.db)

        owner_all = playlists.list_playlists(scope="all", user=self.owner, db=self.db)
        owner_by_id = {p.id: p for p in owner_all}
        self.assertEqual(set(owner_by_id), {owned_solo.id, owned_collab.id})
        self.assertEqual(owner_by_id[owned_collab.id].track_count, 3)
        self.assertEqual(owner_by_id[owned_collab.id].collaborator_count, 2)
        self.assertTrue(owner_by_id[owned_collab.id].is_owner)
        self.assertFalse(owner_by_id[owned_collab.id].is_collaborator)
        self.assertTrue(owner_by_id[owned_collab.id].can_edit_tracks)

        owner_collab_scope = playlists.list_playlists(
            scope="collaborative", user=self.owner, db=self.db
        )
        self.assertEqual([p.id for p in owner_collab_scope], [owned_collab.id])

        # Collaborator sees shared playlist in scope=all and scope=collaborative, NOT scope=owned.
        bob_all = playlists.list_playlists(scope="all", user=self.collab, db=self.db)
        self.assertEqual([p.id for p in bob_all], [owned_collab.id])
        self.assertFalse(bob_all[0].is_owner)
        self.assertTrue(bob_all[0].is_collaborator)
        self.assertTrue(bob_all[0].can_edit_tracks)
        self.assertEqual(bob_all[0].track_count, 3)
        self.assertEqual(bob_all[0].collaborator_count, 2)
        self.assertEqual(bob_all[0].owner_id, self.owner.id)
        self.assertEqual(bob_all[0].owner_name, "Owner")
        self.assertEqual(
            playlists.list_playlists(scope="owned", user=self.collab, db=self.db),
            [],
        )
        self.assertEqual(
            [p.id for p in playlists.list_playlists(scope="collaborative", user=self.collab, db=self.db)],
            [owned_collab.id],
        )

        # GET /playlists/public excludes BOTH owned and collaborated playlists.
        bob_public = playlists.public_playlists(user=self.collab, db=self.db)
        self.assertEqual({p.id for p in bob_public}, {owned_solo.id, other_pub.id})

        # Public profile populates collaborative metadata consistently.
        pub_prof = profile.public_profile(self.owner.id, db=self.db)
        prof_by_id = {p.id: p for p in pub_prof.playlists}
        self.assertEqual(prof_by_id[owned_collab.id].collaborator_count, 2)
        self.assertTrue(prof_by_id[owned_collab.id].is_collaborative)
        self.assertEqual(prof_by_id[owned_collab.id].owner_id, self.owner.id)

    def test_collaborator_can_export_private_playlist(self) -> None:
        pl = self._create_playlist(self.owner, "Export Collab", collaborative=True, public=False)
        self._join(pl.id, self.collab)
        playlists.add_track(pl.id, _sample_track("123", "Track"), user=self.collab, db=self.db)

        import asyncio

        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp.write(b"PK")
            zip_path = tmp.name
        try:
            with patch.object(
                playlists,
                "build_playlist_archive",
                return_value=(zip_path, "Export Collab.zip"),
            ) as build_mock:
                resp = asyncio.run(
                    playlists.export_playlist(pl.id, user=self.collab, db=self.db)
                )
            self.assertEqual(resp.headers["X-Playlist-Track-Count"], "1")
            build_mock.assert_called_once()
            self.assertEqual(
                build_mock.call_args.kwargs["requested_by_user_id"],
                self.collab.id,
            )
            with self.assertRaises(HTTPException) as denied:
                asyncio.run(
                    playlists.export_playlist(pl.id, user=self.outsider, db=self.db)
                )
            self.assertEqual(denied.exception.status_code, 404)
        finally:
            if os.path.exists(zip_path):
                os.remove(zip_path)

    def test_http_routes_auth_enforcement_and_invitation_route_ordering(self) -> None:
        SessionTesting = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )

        def override_db():
            session = SessionTesting()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_db
        # Instantiate without context manager to skip app startup (DB/Deezer).
        client = TestClient(app)
        try:
            owner_headers = {"Cookie": f"{SESSION_COOKIE}={create_token(self.owner.id)}"}
            collab_headers = {"Cookie": f"{SESSION_COOKIE}={create_token(self.collab.id)}"}
            pending_headers = {"Cookie": f"{SESSION_COOKIE}={create_token(self.pending.id)}"}

            # Unauthenticated -> 401; pending -> 403.
            self.assertEqual(client.get("/api/playlists/invitations").status_code, 401)
            self.assertEqual(
                client.get("/api/playlists/invitations", headers=pending_headers).status_code,
                403,
            )

            created = client.post(
                "/api/playlists",
                json={"name": "HTTP Collab", "is_collaborative": True},
                headers=owner_headers,
            )
            self.assertEqual(created.status_code, 201)
            pid = created.json()["id"]

            found = client.get(
                f"/api/playlists/{pid}/invite-candidates",
                params={"q": "bo"},
                headers=owner_headers,
            )
            self.assertEqual(found.status_code, 200)
            self.assertEqual(
                found.json(),
                [
                    {
                        "user": {
                            "id": self.collab.id,
                            "display_name": "Bob",
                            "avatar_url": "/api/users/2/avatar",
                        },
                        "status": "available",
                    }
                ],
            )
            self.assertEqual(
                client.get(
                    f"/api/playlists/{pid}/invite-candidates", headers=owner_headers
                ).status_code,
                422,
            )

            inv = client.post(
                f"/api/playlists/{pid}/invitations",
                json={"user_id": self.collab.id},
                headers=owner_headers,
            )
            self.assertEqual(inv.status_code, 201)
            self.assertNotIn("email", inv.text)

            # Static /invitations routes cleanly before /{playlist_id}.
            mine = client.get("/api/playlists/invitations", headers=collab_headers)
            self.assertEqual(mine.status_code, 200)
            self.assertEqual(len(mine.json()), 1)
            self.assertEqual(mine.json()[0]["playlist"]["playlist_id"], pid)
            self.assertNotIn("email", mine.text)
            invitation_id = mine.json()[0]["id"]

            acc = client.post(
                f"/api/playlists/invitations/{invitation_id}/accept", headers=collab_headers
            )
            self.assertEqual(acc.status_code, 200)
            self.assertTrue(acc.json()["joined"])

            # The removed link and email routes are gone.
            self.assertEqual(
                client.post(f"/api/playlists/{pid}/invite", headers=owner_headers).status_code,
                404,
            )
            self.assertEqual(
                client.post(
                    f"/api/playlists/{pid}/collaborators",
                    json={"email": "collab2@example.com"},
                    headers=owner_headers,
                ).status_code,
                404,
            )

            # Collaborator leaves cleanly.
            left = client.post(f"/api/playlists/{pid}/leave", headers=collab_headers)
            self.assertEqual(left.status_code, 204)
        finally:
            client.close()
            app.dependency_overrides.pop(get_db, None)

    def test_dangling_user_reference_fails_loudly(self) -> None:
        # Use an engine without FK enforcement to simulate pre-existing corrupt rows.
        raw_engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        try:
            Base.metadata.create_all(raw_engine)
            with Session(raw_engine) as raw_db:
                owner = User(
                    email="o@example.com",
                    password_hash="x",
                    display_name="Owner",
                    is_approved=True,
                )
                raw_db.add(owner)
                raw_db.flush()
                pl = Playlist(user_id=owner.id, name="Corrupt", is_collaborative=True)
                raw_db.add(pl)
                raw_db.flush()
                raw_db.add(
                    PlaylistTrack(
                        playlist_id=pl.id,
                        deezer_id="1",
                        title="T",
                        artist="A",
                        position=0,
                        added_by_user_id=999999,
                    )
                )
                raw_db.commit()

                with self.assertRaisesRegex(RuntimeError, "references missing user 999999"):
                    playlists.get_playlist(pl.id, user=owner, db=raw_db)
        finally:
            raw_engine.dispose()

    def test_missing_collaborator_joined_at_fails_loudly(self) -> None:
        pl = self._create_playlist(self.owner, "Corrupt Timestamp", collaborative=True)
        self._join(pl.id, self.collab)
        row = self.db.scalar(
            select(PlaylistCollaborator).where(
                PlaylistCollaborator.playlist_id == pl.id,
                PlaylistCollaborator.user_id == self.collab.id,
            )
        )
        assert row is not None
        row.joined_at = None  # type: ignore[assignment]
        with self.assertRaisesRegex(RuntimeError, "has no joined_at timestamp"):
            playlists._require_joined_at(row)


if __name__ == "__main__":
    unittest.main()
