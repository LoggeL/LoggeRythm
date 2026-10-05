"""Transient page failures get one retry; permanent and schema errors fail."""

import json
import unittest
from unittest.mock import Mock, patch

import requests

from app.services import deezer


def response(status=200, html=None):
    item = requests.Response()
    item.status_code = status
    item.url = "https://www.deezer.com/us/track/3416937891"
    data = {
        "DATA": {"__TYPE__": "song", "SNG_ID": "3416937891", "TRACK_TOKEN": "test-token"}
    }
    item._content = (html if html is not None else
                     f"<script>window.__DZR_APP_STATE__ = {json.dumps(data)};</script>").encode()
    return item


class DeezerPageRetryTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        session = patch.object(deezer, "session", self.session)
        sleep = patch.object(deezer.time, "sleep")
        session.start()
        self.sleep = sleep.start()
        self.addCleanup(session.stop)
        self.addCleanup(sleep.stop)

    def load(self):
        return deezer.get_song_infos_from_deezer_website("track", "3416937891")

    def test_one_transient_read_timeout_retries_the_same_track(self):
        self.session.get.side_effect = [requests.ReadTimeout("temporary failure"), response()]
        self.assertEqual(self.load()["SNG_ID"], "3416937891")
        self.assertEqual(self.session.get.call_count, 2)
        self.assertEqual(self.session.get.call_args_list[0], self.session.get.call_args_list[1])
        self.sleep.assert_called_once_with(0.7)

    def test_persistent_timeout_is_bounded_and_keeps_a_safe_cause(self):
        failure = requests.ReadTimeout("https://example.invalid/?token=test-secret")
        self.session.get.side_effect = failure
        with self.assertRaisesRegex(
            deezer.DeezerApiException, "3416937891.*www.deezer.com.*ReadTimeout.*2 attempt"
        ) as caught:
            self.load()
        self.assertIs(caught.exception.__cause__, failure)
        self.assertNotIn("test-secret", str(caught.exception))
        self.assertEqual(self.session.get.call_count, 2)
        self.sleep.assert_called_once_with(0.7)

    def test_transient_http_status_retries_but_preserves_http_errors(self):
        self.session.get.side_effect = [response(503), response()]
        self.assertEqual(self.load()["SNG_ID"], "3416937891")
        self.assertEqual(self.session.get.call_count, 2)

        self.session.get.reset_mock(side_effect=True)
        self.session.get.return_value = response(503)
        with self.assertRaisesRegex(requests.HTTPError, "www.deezer.com.*HTTP 503.*2 attempt"):
            self.load()
        self.assertEqual(self.session.get.call_count, 2)

    def test_auth_and_missing_tracks_do_not_retry(self):
        for status, kind in ((401, deezer.Deezer403Exception),
                             (403, deezer.Deezer403Exception),
                             (404, deezer.Deezer404Exception)):
            with self.subTest(status=status):
                self.session.get.reset_mock(side_effect=True)
                self.sleep.reset_mock()
                self.session.get.return_value = response(status)
                with self.assertRaises(kind):
                    self.load()
                self.assertEqual(self.session.get.call_count, 1)
                self.sleep.assert_not_called()

    def test_invalid_schema_does_not_retry(self):
        self.session.get.return_value = response(html="<html>Missing playback metadata</html>")
        with self.assertRaisesRegex(deezer.DeezerApiException, "no valid __DZR_APP_STATE__"):
            self.load()
        self.assertEqual(self.session.get.call_count, 1)
        self.sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
