import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
import requests

from loggerythm_cli.client import CliError, Client, SecretStore, normalize_origin, validate_path
from loggerythm_cli.main import _party_playback_payload, build_parser, execute, main


class FakeStore:
    def __init__(self, token=None):
        self.value = token

    def get(self, origin):
        return self.value

    def set(self, origin, token):
        self.value = token

    def delete(self, origin):
        self.value = None


class FakeResponse:
    def __init__(self, data=None, *, status=200, content_type="application/json", body=None, cookies=None, headers=None):
        self.status_code = status
        self._data = data
        self._body = body
        self.headers = {"Content-Type": content_type, **(headers or {})}
        self.cookies = cookies or {}
        self.closed = False

    def json(self):
        if self._body is not None:
            return json.loads(self._body)
        return self._data

    def iter_content(self, chunk_size):
        yield self._body if isinstance(self._body, bytes) else b""

    def close(self):
        self.closed = True


class FakeTransport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def client(*responses, token="secret"):
    transport = FakeTransport(*responses)
    return Client("https://example.com", session=transport, store=FakeStore(token)), transport


@pytest.mark.parametrize("origin", ["https://example.com/path", "https://user:pass@example.com", "http://example.com", "https://example.com\\@other.test", "https://example.com\n", "https://example.com:0"])
def test_invalid_origin(origin):
    with pytest.raises(CliError):
        normalize_origin(origin)


def test_default_port_normalizes_for_keyring():
    assert normalize_origin("https://EXAMPLE.com:443/") == "https://example.com"


@pytest.mark.parametrize("path", ["https://elsewhere/api/a", "//evil/api/a", "/api/../secret", "/api//a", "/api/%2e%2e/secret", "/api/a?x=1", "/api/a#b", "/api/\\evil", "/api/a\x7f"])
def test_invalid_path(path):
    with pytest.raises(CliError):
        validate_path(path)


def test_insecure_keyring_rejected():
    with pytest.raises(CliError, match="Kein sicherer"):
        SecretStore(backend=SimpleNamespace(priority=1))


def test_redirect_never_followed_and_secret_not_forwarded():
    api, transport = client(FakeResponse(status=302, headers={"Location": "https://evil.test"}))
    with pytest.raises(CliError) as err:
        api.request("GET", "/api/auth/me")
    assert err.value.code == "redirect_refused"
    assert len(transport.calls) == 1
    assert transport.calls[0][2]["allow_redirects"] is False
    assert transport.calls[0][2]["cookies"] == {"sf_session": "secret"}


def test_login_preflight_rejects_incompatible_without_password_request():
    api, transport = client(FakeResponse({"current_contract_version": "v1", "compatible_contract_versions": ["v1"]}))
    with pytest.raises(CliError) as err:
        api.login("user@example.com", "password")
    assert err.value.code == "incompatible_server"
    assert len(transport.calls) == 1
    assert transport.calls[0][2]["cookies"] == {}


def test_login_stores_cookie_and_outputs_account_only(capsys, monkeypatch):
    store = FakeStore()
    transport = FakeTransport(
        FakeResponse({"current_contract_version": "v2", "compatible_contract_versions": ["v1", "v2"]}),
        FakeResponse({"id": 7, "email": "u@example.com", "token": "must-not-output"}, cookies={"sf_session": "private-cookie"}),
    )
    api = Client("https://example.com", session=transport, store=store)
    result = api.login("u@example.com", "private-password")
    assert result == {"id": 7, "email": "u@example.com"}
    assert store.value == "private-cookie"
    assert transport.calls[1][2]["allow_redirects"] is False
    assert transport.calls[1][2]["json"]["password"] == "private-password"
    assert "private-cookie" not in repr(result)


def test_204_and_malformed_response():
    api, _ = client(FakeResponse(status=204), FakeResponse(body="not-json"))
    assert api.request("DELETE", "/api/me/likes/1") == {"ok": True}
    with pytest.raises(CliError) as err:
        api.request("GET", "/api/auth/me")
    assert err.value.code == "invalid_response"


def test_http_error_and_timeout_are_structured():
    api, _ = client(FakeResponse({"detail": "Unauthorized"}, status=401), requests.Timeout())
    with pytest.raises(CliError) as err:
        api.request("GET", "/api/auth/me")
    assert err.value.as_json() == {"error": {"code": "http_error", "message": "HTTP 401: Unauthorized", "status": 401}}
    with pytest.raises(CliError) as err:
        api.request("GET", "/api/auth/me")
    assert err.value.code == "timeout"


def test_capabilities_and_public_search_use_no_keyring():
    doc = {"paths": {"/api/search": {"get": {"operationId": "search", "summary": "Search"}}}}
    transport = FakeTransport(FakeResponse(doc), FakeResponse([]))
    api = Client("https://example.com", session=transport, store=FakeStore())
    assert execute(build_parser().parse_args(["capabilities"]), client=api) == {"operations": [{"method": "GET", "path": "/api/search", "operation_id": "search", "summary": "Search"}]}
    assert execute(build_parser().parse_args(["search", "queen"]), client=api) == []
    assert transport.calls[0][2]["cookies"] == transport.calls[1][2]["cookies"] == {}


def test_download_atomic_complete_and_no_overwrite(tmp_path):
    target = tmp_path / "track.mp3"
    api, _ = client(FakeResponse(status=200, content_type="audio/mpeg", body=b"MP3", headers={"Content-Length": "3"}))
    result = api.download("/api/tracks/1/stream", str(target), expected="audio")
    assert result["size"] == 3
    assert target.read_bytes() == b"MP3"
    with pytest.raises(CliError) as err:
        api.download("/api/tracks/1/stream", str(target), expected="audio")
    assert err.value.code == "file_exists"


def test_download_rejects_error_or_wrong_content_and_cleans_partial(tmp_path):
    target = tmp_path / "track.mp3"
    api, _ = client(FakeResponse({"detail": "bad"}, status=502), FakeResponse(content_type="application/json", body=b'{}'))
    with pytest.raises(CliError):
        api.download("/api/tracks/1/stream", str(target), expected="audio")
    with pytest.raises(CliError):
        api.download("/api/tracks/1/stream", str(target), expected="audio")
    assert list(tmp_path.iterdir()) == []


def test_download_length_mismatch_cleans_partial(tmp_path):
    api, _ = client(FakeResponse(content_type="application/zip", body=b"zip", headers={"Content-Length": "10"}))
    with pytest.raises(CliError) as err:
        api.download("/api/playlists/1/export", str(tmp_path / "playlist.zip"), expected="zip")
    assert err.value.code == "incomplete_download"
    assert list(tmp_path.iterdir()) == []


def test_hydrate_track_preserves_artists():
    track = {"id": "123", "title": "Song", "artists": [{"id": "1", "name": "A"}, {"id": "2", "name": "B"}]}
    api, transport = client(FakeResponse(track), FakeResponse(status=204))
    assert execute(build_parser().parse_args(["playlists", "add-track", "5", "123"]), client=api) == {"ok": True}
    assert transport.calls[1][2]["json"]["artists"] == track["artists"]


def test_cli_error_json_on_stderr(capsys):
    assert main(["--server", "https://example.com/x", "me"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err)["error"]["code"] == "invalid_server"


def test_usage_error_is_json(capsys):
    assert main(["request"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err)["error"]["code"] == "usage_error"


def test_public_generic_request_does_not_access_keyring():
    class FailingStore:
        def get(self, origin):
            raise AssertionError("keyring accessed")

    transport = FakeTransport(FakeResponse({"ok": True}))
    api = Client("https://example.com", session=transport, store=FailingStore())
    args = build_parser().parse_args(["request", "GET", "/api/version", "--public", "--query", "a=b"])
    assert execute(args, client=api) == {"ok": True}
    assert transport.calls[0][2]["params"] == [("a", "b")]


def test_validation_error_reports_safe_fields_only():
    body = {"detail": [{"loc": ["body", "email"], "msg": "value is not a valid email address", "type": "value_error"}, {"loc": ["body", "password"], "msg": "secret-sentinel", "type": "string_too_short", "input": "secret-sentinel"}]}
    api, _ = client(FakeResponse(body, status=422))
    with pytest.raises(CliError) as err:
        api.request("POST", "/api/auth/login", payload={})
    output = json.dumps(err.value.as_json())
    assert "email" in output and "value_error" in output
    assert "password" in output
    assert "secret-sentinel" not in output
    assert '"input"' not in output


def test_multipart_upload_includes_mime(tmp_path):
    image = tmp_path / "cover.jpg"
    image.write_bytes(b"fake-image")
    api, transport = client(FakeResponse({"id": 1}))
    args = build_parser().parse_args(["request", "PUT", "/api/playlists/1/cover", "--file", f"file={image}"])
    assert execute(args, client=api) == {"id": 1}
    assert transport.calls[0][2]["files"]["file"][2] == "image/jpeg"


def test_unknown_mime_fails_explicitly(tmp_path):
    image = tmp_path / "cover.unknownext"
    image.write_bytes(b"x")
    api, _ = client()
    args = build_parser().parse_args(["request", "PUT", "/api/playlists/1/cover", "--file", f"file={image}"])
    with pytest.raises(CliError) as err:
        execute(args, client=api)
    assert err.value.code == "unknown_mime"


@pytest.mark.parametrize("content_type", ["text/html", "application/json", "application/problem+json", ""])
def test_generic_download_rejects_nonbinary(tmp_path, content_type):
    api, _ = client(FakeResponse(content_type=content_type, body=b"data"))
    with pytest.raises(CliError) as err:
        api.download("/api/playlists/1/export", str(tmp_path / "output"))
    assert err.value.code == "unexpected_content_type"
    assert list(tmp_path.iterdir()) == []


def test_non_utf8_json_file_reports_json_error(tmp_path):
    source = tmp_path / "invalid.json"
    source.write_bytes(b"\xff")
    api, _ = client()
    args = build_parser().parse_args(["request", "POST", "/api/playlists", "--json", f"@{source}"])
    with pytest.raises(CliError) as err:
        execute(args, client=api)
    assert err.value.code == "invalid_json"


def test_party_pause_advances_running_position():
    state = {"is_host": True, "is_playing": True, "position_sec": 42.5, "playback_updated_at": "2026-09-30T12:00:00Z"}
    now = datetime(2026, 9, 30, 12, 0, 30, tzinfo=timezone.utc)
    assert _party_playback_payload(state, False, now=now) == {"is_playing": False, "position_sec": 72.5}


def test_party_play_from_paused_keeps_position():
    state = {"is_host": True, "is_playing": False, "position_sec": 42.5, "playback_updated_at": None}
    assert _party_playback_payload(state, True) == {"is_playing": True, "position_sec": 42.5}


def test_party_nonhost_and_missing_timestamp_fail_before_patch():
    api, transport = client(FakeResponse({"is_host": False, "is_playing": False, "position_sec": 3}))
    args = build_parser().parse_args(["party", "pause", "ABC123"])
    with pytest.raises(CliError) as err:
        execute(args, client=api)
    assert err.value.code == "forbidden"
    assert len(transport.calls) == 1
    with pytest.raises(CliError) as err:
        _party_playback_payload({"is_host": True, "is_playing": True, "position_sec": 3, "playback_updated_at": None}, False)
    assert err.value.code == "invalid_response"
