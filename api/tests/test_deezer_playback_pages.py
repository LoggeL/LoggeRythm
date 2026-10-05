import json
import unittest
from unittest.mock import Mock, patch

import requests

from app.services import deezer


def song(track_id="67238732"):
    return {"__TYPE__": "song", "SNG_ID": track_id, "TRACK_TOKEN": "test-track-token"}


def page(state, suffix=""):
    return f"<html><script>window.__DZR_APP_STATE__ = {json.dumps(state)}{suffix}</script></html>"


class DeezerPlaybackPageTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        self.response = requests.Response()
        self.response.status_code = 200
        self.response.url = "https://www.deezer.com/us/track/67238732"
        self.session.get.return_value = self.response
        self.patch = patch.object(deezer, "session", self.session)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def html(self, text):
        self.response._content = text.encode("utf-8")

    def test_current_track_page_works_without_md5_origin(self):
        data = song()
        self.html(page({"DATA": data}))
        self.assertEqual(deezer.get_song_infos_from_deezer_website("track", "67238732"), data)
        self.session.get.assert_called_once_with(
            "https://www.deezer.com/us/track/67238732", timeout=deezer.REQUEST_TIMEOUT
        )

    def test_state_accepts_reordered_keys_whitespace_and_script_suffix(self):
        data = song()
        self.html(page({"ISRC": "test", "DATA": data}, "; window.other = true;").replace(
            "__DZR_APP_STATE__ = ", "__DZR_APP_STATE__\n=\n   "
        ))
        self.assertEqual(deezer.get_song_infos_from_deezer_website("track", "67238732"), data)

    def test_old_marker_does_not_hide_missing_playback_token(self):
        data = song()
        del data["TRACK_TOKEN"]
        data["MD5_ORIGIN"] = "obsolete"
        self.html(page({"DATA": data}))
        with self.assertRaisesRegex(deezer.Deezer403Exception, "67238732.*no TRACK_TOKEN"):
            deezer.get_song_infos_from_deezer_website("track", "67238732")

    def test_blank_or_invalid_playback_token_fails_with_context(self):
        for token in (None, "", " ", 123):
            with self.subTest(token=token):
                self.html(page({"DATA": {**song(), "TRACK_TOKEN": token}}))
                with self.assertRaisesRegex(deezer.Deezer403Exception, "no TRACK_TOKEN"):
                    deezer.get_song_infos_from_deezer_website("track", "67238732")

    def test_missing_or_malformed_state_fails_without_index_error(self):
        for html in ("<html>Sign in</html>", "<script>window.__DZR_APP_STATE__ = invalid;</script>", page([])):
            with self.subTest(html=html):
                self.html(html)
                with self.assertRaisesRegex(deezer.DeezerApiException, "Deezer track 67238732"):
                    deezer.get_song_infos_from_deezer_website("track", "67238732")

    def test_unexpected_data_and_missing_song_id_fail_with_context(self):
        for data in (None, [], {"__TYPE__": "album"}, {"__TYPE__": "song", "TRACK_TOKEN": "test"}):
            with self.subTest(data=data):
                self.html(page({"DATA": data}))
                with self.assertRaisesRegex(deezer.DeezerApiException, "Deezer track 67238732"):
                    deezer.get_song_infos_from_deezer_website("track", "67238732")

    def test_album_and_playlist_keep_metadata_on_each_song(self):
        for kind in ("album", "playlist"):
            with self.subTest(kind=kind):
                metadata = {"__TYPE__": kind, "ALB_TITLE": "Test album"}
                self.html(page({"DATA": metadata, "SONGS": {"data": [song("10"), song("20")]}}))
                songs = deezer.get_song_infos_from_deezer_website(kind, "5")
                self.assertEqual([s["SNG_ID"] for s in songs], ["10", "20"])
                self.assertTrue(all(s["_ALBUM_DATA"] == metadata for s in songs))

    def test_malformed_collection_fails_instead_of_returning_empty_data(self):
        for collection in (None, [], {"data": None}, {"data": [None]}):
            with self.subTest(collection=collection):
                self.html(page({"DATA": {"__TYPE__": "album"}, "SONGS": collection}))
                with self.assertRaisesRegex(deezer.DeezerApiException, "Deezer album 5"):
                    deezer.get_song_infos_from_deezer_website("album", "5")

    def test_http_failures_are_not_misreported_as_an_expired_cookie(self):
        for status, error in ((401, deezer.Deezer403Exception), (403, deezer.Deezer403Exception),
                              (404, deezer.Deezer404Exception), (429, requests.HTTPError),
                              (500, requests.HTTPError)):
            with self.subTest(status=status):
                self.response.status_code = status
                self.html("<html>Upstream error</html>")
                with self.assertRaises(error):
                    deezer.get_song_infos_from_deezer_website("track", "67238732")

    def test_health_uses_current_playback_metadata(self):
        self.html(page({"DATA": song("3135556")}))
        with patch.object(deezer, "get_user_data", return_value=("test-license", {"standard": True})):
            self.assertTrue(deezer.test_deezer_login())

    def test_health_rejects_anonymous_session_even_with_a_track_token(self):
        self.html(page({"DATA": song("3135556")}))
        with patch.object(deezer, "get_user_data", side_effect=deezer.Deezer403Exception("anonymous")):
            self.assertFalse(deezer.test_deezer_login())


class DeezerPlaybackLicenseTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        self.response = requests.Response()
        self.response.status_code = 200
        self.response.url = "https://www.deezer.com/ajax/gw-light.php"
        self.session.get.return_value = self.response
        self.patch = patch.object(deezer, "session", self.session)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def payload(self, value):
        self.response._content = json.dumps(value).encode()

    def account(self, user_id=123, **options):
        return {"results": {"USER": {"USER_ID": user_id, "OPTIONS": {
            "license_token": "current-test-license", "web_streaming": True,
            "web_sound_quality": {"standard": True}, **options,
        }}}}

    def test_valid_account_returns_current_license(self):
        self.payload(self.account())
        self.assertEqual(deezer.get_user_data(), ("current-test-license", {"standard": True}))

    def test_anonymous_user_fails_even_when_license_metadata_exists(self):
        for user_id in (0, "0"):
            with self.subTest(user_id=user_id):
                self.payload(self.account(user_id))
                with self.assertRaisesRegex(deezer.Deezer403Exception, "DEEZER_ARL.*anonymous"):
                    deezer.get_user_data()

    def test_account_without_full_playback_rights_fails_explicitly(self):
        self.payload(self.account(web_streaming=False))
        with self.assertRaisesRegex(deezer.Deezer403Exception, "no full-track web playback rights"):
            deezer.get_user_data()

    def test_malformed_user_metadata_fails_with_context(self):
        for payload in ([], {}, {"results": []}, self.account(None), self.account(True),
                        self.account(web_streaming=None), self.account(license_token=""),
                        self.account(web_sound_quality=None)):
            with self.subTest(payload=payload):
                self.payload(payload)
                with self.assertRaisesRegex(deezer.DeezerApiException, "deezer.getUserData"):
                    deezer.get_user_data()

    def test_invalid_json_fails_with_specific_error(self):
        self.response._content = b"<html>upstream error</html>"
        with self.assertRaisesRegex(deezer.DeezerApiException, "invalid JSON"):
            deezer.get_user_data()

    def test_media_request_uses_fresh_license_instead_of_startup_token(self):
        response = Mock(status_code=200)
        response.json.return_value = {"data": [{"media": [{"sources": [{"url": "https://audio.example/test"}]}]}]}
        with (
            patch.object(deezer, "license_token", "expired-test-license"),
            patch.object(deezer, "get_user_data", return_value=("fresh-test-license", {})) as refresh,
            patch.object(deezer.requests, "post", return_value=response) as post,
        ):
            self.assertEqual(deezer.get_song_url("track-test-token", "MP3_128"), "https://audio.example/test")
            refresh.assert_called_once_with()
            self.assertEqual(post.call_args.kwargs["json"]["license_token"], "fresh-test-license")

    def test_media_rights_failure_is_explicit_and_stops_quality_retries(self):
        response = Mock(status_code=403)
        with (
            patch.object(deezer, "get_user_data", return_value=("test-license", {})),
            patch.object(deezer.requests, "post", return_value=response),
        ):
            with self.assertRaisesRegex(deezer.Deezer403Exception, "denied full-track playback"):
                deezer.get_song_url("track-test-token", "MP3_128")
        with patch.object(deezer, "get_song_url", side_effect=deezer.Deezer403Exception("expired ARL")) as url:
            with self.assertRaisesRegex(deezer.Deezer403Exception, "expired ARL"):
                deezer.download_song({**song(), "FILESIZE_MP3_128": "10000"}, "/unused.mp3")
            self.assertEqual(url.call_count, 1)


if __name__ == "__main__":
    unittest.main()
