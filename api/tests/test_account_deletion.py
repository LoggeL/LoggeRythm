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
    PlaylistTrack,
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


if __name__ == "__main__":
    unittest.main()
