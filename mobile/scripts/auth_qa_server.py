"""Disposable, credential-safe HTTP backend for Android authentication QA.

The server deliberately exposes only the same public routes that the APK uses.
Scenario control stays in-process through :class:`DisposableAuthServer`; there
is no HTTP control plane that could accidentally be exposed by an HTTPS tunnel.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import secrets
import threading
from typing import Any, Iterable
from urllib.parse import urlsplit


_COOKIE_NAME = "sf_session"
_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
_MAX_REQUEST_BYTES = 16 * 1024
_PENDING_DETAIL = "Dein Konto wartet noch auf Freigabe durch einen Admin."


@dataclass(frozen=True)
class LedgerEntry:
    """A redacted request observation safe to persist as QA evidence."""

    sequence: int
    method: str
    path: str
    status: int


@dataclass(repr=False)
class _Account:
    id: int
    email: str
    password: str
    display_name: str | None
    is_admin: bool
    is_approved: bool
    avatar_url: str | None

    def response(self) -> dict[str, object]:
        return {
            "id": self.id,
            "email": self.email,
            "display_name": self.display_name,
            "is_admin": self.is_admin,
            "is_approved": self.is_approved,
            "avatar_url": self.avatar_url,
        }


class _QaHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class _RequestHandler(BaseHTTPRequestHandler):
    """Translate HTTP requests into calls on the owning disposable server."""

    protocol_version = "HTTP/1.0"

    def __init__(
        self,
        owner: DisposableAuthServer,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        self._owner = owner
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self._dispatch("POST")

    def do_PUT(self) -> None:  # noqa: N802 - record unsupported API methods
        self._dispatch("PUT")

    def do_PATCH(self) -> None:  # noqa: N802 - record unsupported API methods
        self._dispatch("PATCH")

    def do_DELETE(self) -> None:  # noqa: N802 - record unsupported API methods
        self._dispatch("DELETE")

    def log_message(self, _format: str, *args: object) -> None:
        # BaseHTTPRequestHandler otherwise writes request details to stderr.
        # The redacted ledger below is the sole request observation.
        return

    def version_string(self) -> str:
        return "LoggeRythm-QA"

    def _dispatch(self, method: str) -> None:
        path = urlsplit(self.path).path
        status = HTTPStatus.INTERNAL_SERVER_ERROR
        self._ledger_recorded = False
        self._request_method = method
        self._request_path = path
        try:
            status = self._owner._handle_request(self, method, path)
        except (BrokenPipeError, ConnectionResetError):
            # Preserve the response decision in the ledger even if a client
            # disappears before reading it.
            pass
        except Exception:
            status = HTTPStatus.INTERNAL_SERVER_ERROR
            try:
                self._owner._write_json(
                    self,
                    status,
                    {"detail": "Disposable QA server error"},
                )
            except (BrokenPipeError, ConnectionResetError):
                pass
        finally:
            if not self._ledger_recorded:
                self._owner._record(method, path, int(status))
                self._ledger_recorded = True


class DisposableAuthServer:
    """Small in-process seam around a stateful disposable auth backend.

    Credentials and session tokens live only in memory.  The HTTP side exposes
    public app routes; scenario state is changed only through the direct host
    methods on this object.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 0) -> None:
        if not host:
            raise ValueError("host must not be empty")
        if not isinstance(port, int) or isinstance(port, bool) or not 0 <= port <= 65535:
            raise ValueError("port must be an integer between 0 and 65535")

        self._host = host
        self._requested_port = port
        self._lock = threading.RLock()
        self._httpd: _QaHttpServer | None = None
        self._thread: threading.Thread | None = None

        self._next_account_id = 1
        self._accounts_by_id: dict[int, _Account] = {}
        self._account_ids_by_email: dict[str, int] = {}
        self._sessions: dict[str, int] = {}
        self._invites: set[str] = set()
        self._faults: defaultdict[str, deque[int]] = defaultdict(deque)
        self._ledger: list[LedgerEntry] = []
        self._next_sequence = 1
        self._compatibility: dict[str, object] = {}
        self.set_compatibility()

    def __enter__(self) -> DisposableAuthServer:
        return self.start()

    def __exit__(self, *_exc: object) -> None:
        self.close()

    @property
    def origin(self) -> str:
        """Return the local HTTP origin after the server has started."""

        with self._lock:
            if self._httpd is None:
                raise RuntimeError("DisposableAuthServer has not been started")
            host, port = self._httpd.server_address[:2]
        display_host = f"[{host}]" if ":" in host else host
        return f"http://{display_host}:{port}"

    @property
    def ledger(self) -> tuple[LedgerEntry, ...]:
        """Return an immutable snapshot containing no request body or header."""

        with self._lock:
            return tuple(self._ledger)

    def start(self) -> DisposableAuthServer:
        """Bind the local listener and start serving in a daemon thread."""

        with self._lock:
            if self._httpd is not None:
                return self

            owner = self

            def handler(*args: Any, **kwargs: Any) -> _RequestHandler:
                return _RequestHandler(owner, *args, **kwargs)

            httpd = _QaHttpServer((self._host, self._requested_port), handler)
            thread = threading.Thread(
                target=httpd.serve_forever,
                name="LoggeRythmDisposableAuthServer",
                daemon=True,
            )
            self._httpd = httpd
            self._thread = thread
            thread.start()
        return self

    def close(self) -> None:
        """Stop the listener.  Calling this more than once is harmless."""

        with self._lock:
            httpd = self._httpd
            thread = self._thread
            self._httpd = None
            self._thread = None
        if httpd is None:
            return
        httpd.shutdown()
        httpd.server_close()
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=5)

    def seed_account(
        self,
        email: str,
        password: str,
        display_name: str | None = None,
        is_admin: bool = False,
        is_approved: bool = True,
        avatar_url: str | None = None,
    ) -> int:
        """Create an ephemeral account and return its non-secret integer id."""

        normalized_email = self._validated_email(email)
        self._validate_password(password, minimum=1)
        self._validate_display_name(display_name)
        with self._lock:
            if normalized_email in self._account_ids_by_email:
                raise ValueError("account email is already seeded")
            account = self._create_account_locked(
                email=normalized_email,
                password=password,
                display_name=display_name,
                is_admin=bool(is_admin),
                is_approved=bool(is_approved),
                avatar_url=avatar_url,
            )
            return account.id

    def issue_invite(self, code: str | None = None) -> str:
        """Create a one-use invite code without adding a public HTTP route."""

        with self._lock:
            if code is not None:
                if not isinstance(code, str) or not code.strip():
                    raise ValueError("invite code must be a non-empty string")
                if code in self._invites:
                    raise ValueError("invite code already exists")
                self._invites.add(code)
                return code
            while True:
                generated = secrets.token_urlsafe(18)
                if generated not in self._invites:
                    self._invites.add(generated)
                    return generated

    def approve(self, account: int | str) -> None:
        """Approve an account selected by id or email."""

        with self._lock:
            found: _Account | None
            if isinstance(account, int) and not isinstance(account, bool):
                found = self._accounts_by_id.get(account)
            elif isinstance(account, str):
                account_id = self._account_ids_by_email.get(self._normalize_email(account))
                found = self._accounts_by_id.get(account_id) if account_id is not None else None
            else:
                raise TypeError("account must be an integer id or email string")
            if found is None:
                raise KeyError("account does not exist")
            found.is_approved = True

    def fault_next(self, path: str, status: int) -> None:
        """Queue a one-shot error response for the next request to ``path``."""

        if not isinstance(path, str) or not path.startswith("/") or "?" in path or "#" in path:
            raise ValueError("path must be an absolute URL path without query or fragment")
        if (
            not isinstance(status, int)
            or isinstance(status, bool)
            or not 400 <= status <= 599
        ):
            raise ValueError("fault status must be an integer between 400 and 599")
        with self._lock:
            self._faults[path].append(status)

    def set_compatibility(
        self,
        api_version: str = "1.1.0",
        current_contract_version: str = "v2",
        compatible_contract_versions: Iterable[str] = ("v2",),
    ) -> None:
        """Replace the payload returned by ``GET /api/version``."""

        versions = list(compatible_contract_versions)
        if (
            not isinstance(api_version, str)
            or not api_version
            or not isinstance(current_contract_version, str)
            or not current_contract_version
            or any(not isinstance(version, str) or not version for version in versions)
        ):
            raise ValueError("compatibility versions must be non-empty strings")
        with self._lock:
            self._compatibility = {
                "api_version": api_version,
                "current_contract_version": current_contract_version,
                "compatible_contract_versions": versions,
            }

    def _handle_request(
        self,
        handler: _RequestHandler,
        method: str,
        path: str,
    ) -> int:
        fault = self._take_fault(path)
        if fault is not None:
            self._write_json(handler, fault, {"detail": self._fault_detail(fault)})
            return fault

        if method == "GET" and path == "/api/version":
            with self._lock:
                compatibility = {
                    **self._compatibility,
                    "compatible_contract_versions": list(
                        self._compatibility["compatible_contract_versions"]
                    ),
                }
            self._write_json(handler, HTTPStatus.OK, compatibility)
            return HTTPStatus.OK

        if method == "POST" and path == "/api/auth/login":
            body = self._read_json_object(handler)
            if body is None:
                return self._write_invalid_request(handler)
            email = body.get("email")
            password = body.get("password")
            if not isinstance(email, str) or not isinstance(password, str):
                return self._write_invalid_request(handler)
            with self._lock:
                account_id = self._account_ids_by_email.get(self._normalize_email(email))
                account = (
                    self._accounts_by_id.get(account_id)
                    if account_id is not None
                    else None
                )
                valid = (
                    account is not None
                    and hmac.compare_digest(account.password, password)
                )
                if valid and account is not None:
                    token = self._new_session_locked(account.id)
                    response = account.response()
                else:
                    token = None
                    response = None
            if token is None or response is None:
                self._write_json(
                    handler,
                    HTTPStatus.UNAUTHORIZED,
                    {"detail": "Invalid credentials"},
                )
                return HTTPStatus.UNAUTHORIZED
            self._write_json(
                handler,
                HTTPStatus.OK,
                response,
                headers=(("Set-Cookie", self._session_cookie(token)),),
            )
            return HTTPStatus.OK

        if method == "POST" and path == "/api/auth/register":
            body = self._read_json_object(handler)
            if body is None:
                return self._write_invalid_request(handler)
            try:
                email = self._validated_email(body.get("email"))
                password = body.get("password")
                self._validate_password(password, minimum=8)
                display_name = body.get("display_name")
                self._validate_display_name(display_name)
                invite = body.get("invite")
                if invite is not None and not isinstance(invite, str):
                    raise ValueError("invalid invite")
            except (TypeError, ValueError):
                return self._write_invalid_request(handler)

            with self._lock:
                if email in self._account_ids_by_email:
                    duplicate = True
                    response = None
                    token = None
                else:
                    duplicate = False
                    is_first = not self._accounts_by_id
                    invited = bool(invite) and invite in self._invites
                    account = self._create_account_locked(
                        email=email,
                        password=password,
                        display_name=display_name,
                        is_admin=is_first,
                        is_approved=is_first or invited,
                        avatar_url=None,
                    )
                    if invited and invite is not None:
                        self._invites.remove(invite)
                    token = self._new_session_locked(account.id)
                    response = account.response()
            if duplicate:
                self._write_json(
                    handler,
                    HTTPStatus.CONFLICT,
                    {"detail": "Email already registered"},
                )
                return HTTPStatus.CONFLICT
            assert token is not None and response is not None
            self._write_json(
                handler,
                HTTPStatus.OK,
                response,
                headers=(("Set-Cookie", self._session_cookie(token)),),
            )
            return HTTPStatus.OK

        if method == "POST" and path == "/api/auth/logout":
            token = self._session_token(handler)
            if token is not None:
                with self._lock:
                    self._sessions.pop(token, None)
            self._write_json(
                handler,
                HTTPStatus.OK,
                {"ok": True},
                headers=(("Set-Cookie", self._expired_session_cookie()),),
            )
            return HTTPStatus.OK

        if method == "GET" and path == "/api/auth/me":
            account = self._session_account(handler)
            if account is None:
                self._write_json(
                    handler,
                    HTTPStatus.UNAUTHORIZED,
                    {"detail": "Not authenticated"},
                )
                return HTTPStatus.UNAUTHORIZED
            self._write_json(handler, HTTPStatus.OK, account.response())
            return HTTPStatus.OK

        if method == "GET" and path in {"/api/me/likes", "/api/playlists"}:
            account = self._session_account(handler)
            if account is None:
                self._write_json(
                    handler,
                    HTTPStatus.UNAUTHORIZED,
                    {"detail": "Not authenticated"},
                )
                return HTTPStatus.UNAUTHORIZED
            if not account.is_approved and not account.is_admin:
                self._write_json(
                    handler,
                    HTTPStatus.FORBIDDEN,
                    {"detail": _PENDING_DETAIL},
                )
                return HTTPStatus.FORBIDDEN
            self._write_json(handler, HTTPStatus.OK, [])
            return HTTPStatus.OK

        self._write_json(
            handler,
            HTTPStatus.NOT_FOUND,
            {"detail": "Not Found"},
        )
        return HTTPStatus.NOT_FOUND

    def _write_invalid_request(self, handler: _RequestHandler) -> HTTPStatus:
        self._write_json(
            handler,
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {"detail": "Invalid request"},
        )
        return HTTPStatus.UNPROCESSABLE_ENTITY

    @staticmethod
    def _read_json_object(handler: _RequestHandler) -> dict[str, Any] | None:
        raw_length = handler.headers.get("Content-Length")
        try:
            length = int(raw_length) if raw_length is not None else 0
        except ValueError:
            return None
        if length <= 0 or length > _MAX_REQUEST_BYTES:
            return None
        try:
            decoded = json.loads(handler.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return decoded if isinstance(decoded, dict) else None

    def _write_json(
        self,
        handler: _RequestHandler,
        status: int | HTTPStatus,
        payload: object,
        headers: Iterable[tuple[str, str]] = (),
    ) -> None:
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        if not handler._ledger_recorded:
            self._record(
                handler._request_method,
                handler._request_path,
                int(status),
            )
            handler._ledger_recorded = True
        handler.send_response(int(status))
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(encoded)))
        handler.send_header("X-Content-Type-Options", "nosniff")
        for name, value in headers:
            handler.send_header(name, value)
        handler.end_headers()
        handler.wfile.write(encoded)

    def _session_account(self, handler: _RequestHandler) -> _Account | None:
        token = self._session_token(handler)
        if token is None:
            return None
        with self._lock:
            account_id = self._sessions.get(token)
            return (
                self._accounts_by_id.get(account_id)
                if account_id is not None
                else None
            )

    @staticmethod
    def _session_token(handler: _RequestHandler) -> str | None:
        raw_cookie = handler.headers.get("Cookie")
        if not raw_cookie:
            return None
        parsed = SimpleCookie()
        try:
            parsed.load(raw_cookie)
        except Exception:
            return None
        morsel = parsed.get(_COOKIE_NAME)
        return morsel.value if morsel is not None else None

    def _new_session_locked(self, account_id: int) -> str:
        while True:
            token = secrets.token_urlsafe(32)
            if token not in self._sessions:
                self._sessions[token] = account_id
                return token

    @staticmethod
    def _session_cookie(token: str) -> str:
        return (
            f"{_COOKIE_NAME}={token}; Max-Age={_COOKIE_MAX_AGE_SECONDS}; "
            "HttpOnly; Secure; SameSite=Lax; Path=/"
        )

    @staticmethod
    def _expired_session_cookie() -> str:
        return (
            f"{_COOKIE_NAME}=; Max-Age=0; HttpOnly; Secure; "
            "SameSite=Lax; Path=/"
        )

    def _create_account_locked(
        self,
        *,
        email: str,
        password: str,
        display_name: str | None,
        is_admin: bool,
        is_approved: bool,
        avatar_url: str | None,
    ) -> _Account:
        account = _Account(
            id=self._next_account_id,
            email=email,
            password=password,
            display_name=display_name,
            is_admin=is_admin,
            is_approved=is_approved,
            avatar_url=avatar_url,
        )
        self._next_account_id += 1
        self._accounts_by_id[account.id] = account
        self._account_ids_by_email[account.email] = account.id
        return account

    def _take_fault(self, path: str) -> int | None:
        with self._lock:
            queued = self._faults.get(path)
            if not queued:
                return None
            status = queued.popleft()
            if not queued:
                self._faults.pop(path, None)
            return status

    @staticmethod
    def _fault_detail(status: int) -> str:
        if status == HTTPStatus.UNAUTHORIZED:
            return "Not authenticated"
        if status == HTTPStatus.FORBIDDEN:
            return _PENDING_DETAIL
        return "Injected disposable QA fault"

    def _record(self, method: str, path: str, status: int) -> None:
        with self._lock:
            self._ledger.append(
                LedgerEntry(
                    sequence=self._next_sequence,
                    method=method,
                    path=path,
                    status=status,
                )
            )
            self._next_sequence += 1

    @staticmethod
    def _normalize_email(email: str) -> str:
        return email.strip().lower()

    @classmethod
    def _validated_email(cls, email: object) -> str:
        if not isinstance(email, str):
            raise TypeError("email must be a string")
        normalized = cls._normalize_email(email)
        local, separator, domain = normalized.partition("@")
        if not local or separator != "@" or not domain or "@" in domain:
            raise ValueError("email must contain one @ with non-empty sides")
        return normalized

    @staticmethod
    def _validate_password(password: object, *, minimum: int) -> None:
        if not isinstance(password, str) or not minimum <= len(password) <= 128:
            raise ValueError("password length is outside the API contract")

    @staticmethod
    def _validate_display_name(display_name: object) -> None:
        if display_name is not None and (
            not isinstance(display_name, str) or len(display_name) > 120
        ):
            raise ValueError("display_name is outside the API contract")


__all__ = ["DisposableAuthServer", "LedgerEntry"]
