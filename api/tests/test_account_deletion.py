import unittest
from unittest.mock import patch

from fastapi import HTTPException, Response
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    FollowedArtist,
    InviteCode,
    Like,
    PartyMember,
    PartySession,
    PartyTrack,
    Play,
    Playlist,
    PlaylistCollaborator,
    PlaylistInvite,
    PlaylistTrack,
    StoredTrack,
    TrackRequest,
    User,
)
from app.db.session import Base
from app.routers import profile


class AccountDeletionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        with self.engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def add_user(
        self,
        email: str,
        *,
        admin: bool = False,
    ) -> User:
        user = User(
            email=email,
            password_hash="not-used-by-this-test",
            display_name=email.split("@", 1)[0],
            is_admin=admin,
            is_approved=True,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def count(self, model: type) -> int:
        return int(self.db.scalar(select(func.count()).select_from(model)) or 0)

    def test_success_deletes_every_account_owned_row_and_unlinks_shared_rows(self) -> None:
        admin = self.add_user("admin@example.test", admin=True)
        deleted = self.add_user("delete@example.test")
        survivor = self.add_user("survivor@example.test")

        playlist = Playlist(user_id=deleted.id, name="Private history")
        self.db.add(playlist)
        self.db.flush()
        playlist_track = PlaylistTrack(
            playlist_id=playlist.id,
            deezer_id="101",
            title="Owned track",
            artist="Artist",
        )
        self.db.add_all(
            [
                playlist_track,
                Like(user_id=deleted.id, deezer_id="102", title="Liked track"),
                FollowedArtist(user_id=deleted.id, artist_id="103", name="Followed"),
                Play(user_id=deleted.id, deezer_id="104", title="Played track"),
                TrackRequest(
                    user_id=deleted.id,
                    deezer_id="104",
                    source="stream",
                    materialized=True,
                    size_bytes=2048,
                    title="Played track",
                    artist="Artist",
                ),
                StoredTrack(
                    deezer_id="104",
                    file_path="/tmp/104.mp3",
                    title="Played track",
                    artist="Artist",
                    size_bytes=2048,
                    status="ready",
                    requested_by_user_id=deleted.id,
                    request_source="stream",
                ),
            ]
        )

        hosted = PartySession(code="OWNED1", name="Owned", host_id=deleted.id)
        surviving_party = PartySession(
            code="KEPT01",
            name="Kept",
            host_id=survivor.id,
        )
        self.db.add_all([hosted, surviving_party])
        self.db.flush()
        hosted_track = PartyTrack(
            session_code=hosted.code,
            deezer_id="105",
            title="Party track",
        )
        hosted_member = PartyMember(
            session_code=hosted.code,
            user_id=survivor.id,
            display_name="survivor",
        )
        deleted_membership = PartyMember(
            session_code=surviving_party.code,
            user_id=deleted.id,
            display_name="delete",
        )
        self.db.add_all([hosted_track, hosted_member, deleted_membership])

        created_invite = InviteCode(
            code="CREATED1",
            created_by=deleted.id,
            used_by=survivor.id,
        )
        used_invite = InviteCode(
            code="USED0001",
            created_by=admin.id,
            used_by=deleted.id,
        )
        self.db.add_all([created_invite, used_invite])
        self.db.commit()

        deleted_id = deleted.id
        playlist_id = playlist.id
        playlist_track_id = playlist_track.id
        hosted_track_id = hosted_track.id
        hosted_member_id = hosted_member.id
        deleted_membership_id = deleted_membership.id
        created_invite_code = created_invite.code
        used_invite_code = used_invite.code
        response = Response()

        with (
            patch.object(profile, "_remove_playlist_cover_files") as remove_cover,
            patch.object(profile, "_remove_avatar_files") as remove_avatar,
        ):
            profile.delete_me(response=response, user=deleted, db=self.db)

        self.db.expire_all()
        self.assertIsNone(self.db.get(User, deleted_id))
        self.assertIsNotNone(self.db.get(User, admin.id))
        self.assertIsNotNone(self.db.get(User, survivor.id))
        self.assertIsNone(self.db.get(Playlist, playlist_id))
        self.assertIsNone(self.db.get(PlaylistTrack, playlist_track_id))
        self.assertEqual(self.count(Like), 0)
        self.assertEqual(self.count(FollowedArtist), 0)
        self.assertEqual(self.count(Play), 0)
        self.assertEqual(self.count(TrackRequest), 0)
        surviving_stored = self.db.get(StoredTrack, "104")
        self.assertIsNotNone(surviving_stored)
        self.assertIsNone(surviving_stored.requested_by_user_id)

        self.assertIsNone(self.db.get(PartySession, hosted.code))
        self.assertIsNone(self.db.get(PartyTrack, hosted_track_id))
        self.assertIsNone(self.db.get(PartyMember, hosted_member_id))
        self.assertIsNotNone(self.db.get(PartySession, surviving_party.code))
        self.assertIsNone(self.db.get(PartyMember, deleted_membership_id))

        self.assertIsNone(self.db.get(InviteCode, created_invite_code))
        surviving_invite = self.db.get(InviteCode, used_invite_code)
        self.assertIsNotNone(surviving_invite)
        self.assertIsNone(surviving_invite.used_by)

        remove_cover.assert_called_once_with(playlist_id)
        remove_avatar.assert_called_once_with(deleted_id)
        cookie = response.headers.get("set-cookie", "")
        self.assertIn("sf_session=", cookie)
        self.assertIn("Max-Age=0", cookie)

    def test_last_admin_is_rejected_without_deleting_or_clearing_session(self) -> None:
        last_admin = self.add_user("last-admin@example.test", admin=True)
        playlist = Playlist(user_id=last_admin.id, name="Must survive")
        self.db.add(playlist)
        self.db.commit()
        response = Response()

        with (
            patch.object(profile, "_remove_playlist_cover_files") as remove_cover,
            patch.object(profile, "_remove_avatar_files") as remove_avatar,
            self.assertRaises(HTTPException) as raised,
        ):
            profile.delete_me(response=response, user=last_admin, db=self.db)

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(
            raised.exception.detail,
            "Der letzte Admin kann sein Konto nicht löschen.",
        )
        self.assertIsNotNone(self.db.get(User, last_admin.id))
        self.assertIsNotNone(self.db.get(Playlist, playlist.id))
        self.assertNotIn("set-cookie", response.headers)
        remove_cover.assert_not_called()
        remove_avatar.assert_not_called()

    def test_admin_can_delete_their_account_when_another_admin_survives(self) -> None:
        departing = self.add_user("departing-admin@example.test", admin=True)
        surviving = self.add_user("surviving-admin@example.test", admin=True)
        self.db.commit()
        response = Response()

        with (
            patch.object(profile, "_remove_playlist_cover_files"),
            patch.object(profile, "_remove_avatar_files"),
        ):
            profile.delete_me(response=response, user=departing, db=self.db)

        self.assertIsNone(self.db.get(User, departing.id))
        self.assertIsNotNone(self.db.get(User, surviving.id))
        self.assertTrue(self.db.get(User, surviving.id).is_admin)

    def test_collaborator_deletion_unlinks_tracks_and_removes_membership(self) -> None:
        owner = self.add_user("owner@example.test")
        departing_collab = self.add_user("collab@example.test")
        other_collab = self.add_user("other@example.test")

        shared = Playlist(
            user_id=owner.id, name="Shared", is_collaborative=True
        )
        self.db.add(shared)
        self.db.flush()
        collab_row = PlaylistCollaborator(
            playlist_id=shared.id,
            user_id=departing_collab.id,
            role="editor",
            added_by_user_id=owner.id,
        )
        other_row = PlaylistCollaborator(
            playlist_id=shared.id,
            user_id=other_collab.id,
            role="editor",
            added_by_user_id=departing_collab.id,
        )
        collab_track = PlaylistTrack(
            playlist_id=shared.id,
            deezer_id="501",
            title="Added by departing",
            artist="Artist",
            position=0,
            added_by_user_id=departing_collab.id,
        )
        invite = PlaylistInvite(
            playlist_id=shared.id,
            token="tok_collaborator_delete_123456",
            created_by_user_id=departing_collab.id,
        )
        self.db.add_all([collab_row, other_row, collab_track, invite])
        self.db.commit()

        collab_row_id = collab_row.id
        other_row_id = other_row.id
        collab_track_id = collab_track.id
        invite_id = invite.id

        with (
            patch.object(profile, "_remove_playlist_cover_files"),
            patch.object(profile, "_remove_avatar_files"),
        ):
            profile.delete_me(response=Response(), user=departing_collab, db=self.db)

        self.db.expire_all()
        self.assertIsNotNone(self.db.get(Playlist, shared.id))
        self.assertIsNone(self.db.get(PlaylistCollaborator, collab_row_id))
        surviving_other = self.db.get(PlaylistCollaborator, other_row_id)
        self.assertIsNotNone(surviving_other)
        self.assertIsNone(surviving_other.added_by_user_id)
        surviving_track = self.db.get(PlaylistTrack, collab_track_id)
        self.assertIsNotNone(surviving_track)
        self.assertIsNone(surviving_track.added_by_user_id)
        surviving_invite = self.db.get(PlaylistInvite, invite_id)
        self.assertIsNotNone(surviving_invite)
        self.assertIsNone(surviving_invite.created_by_user_id)

    def test_collaborative_owner_deletion_cascades_playlist_members_and_invites(self) -> None:
        departing_owner = self.add_user("owner-del@example.test")
        survivor = self.add_user("survivor-collab@example.test")

        owned_collab = Playlist(
            user_id=departing_owner.id, name="Owned Collab", is_collaborative=True
        )
        self.db.add(owned_collab)
        self.db.flush()
        member = PlaylistCollaborator(
            playlist_id=owned_collab.id,
            user_id=survivor.id,
            role="editor",
            added_by_user_id=departing_owner.id,
        )
        track = PlaylistTrack(
            playlist_id=owned_collab.id,
            deezer_id="601",
            title="Collab Track",
            artist="Artist",
            position=0,
            added_by_user_id=survivor.id,
        )
        invite = PlaylistInvite(
            playlist_id=owned_collab.id,
            token="tok_owner_delete_1234567890",
            created_by_user_id=departing_owner.id,
        )
        self.db.add_all([member, track, invite])
        self.db.commit()

        pid = owned_collab.id
        member_id = member.id
        track_id = track.id
        invite_id = invite.id

        with (
            patch.object(profile, "_remove_playlist_cover_files") as remove_cover,
            patch.object(profile, "_remove_avatar_files"),
        ):
            profile.delete_me(response=Response(), user=departing_owner, db=self.db)

        self.db.expire_all()
        self.assertIsNone(self.db.get(Playlist, pid))
        self.assertIsNone(self.db.get(PlaylistCollaborator, member_id))
        self.assertIsNone(self.db.get(PlaylistTrack, track_id))
        self.assertIsNone(self.db.get(PlaylistInvite, invite_id))
        self.assertIsNotNone(self.db.get(User, survivor.id))
        remove_cover.assert_called_once_with(pid)


if __name__ == "__main__":
    unittest.main()
