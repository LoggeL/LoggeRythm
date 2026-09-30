"""Strict HTTP transport and operating-system credential storage."""

from __future__ import annotations

import ipaddress
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import requests


class CliError(Exception):
    def __init__(self, code: str, message: str, *, status: int | None = None, validation: list[dict] | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.validation = validation

    def as_json(self) -> dict:
        error: dict = {"code": self.code, "message": str(self)}
        if self.status is not None:
            error["status"] = self.status
        if self.validation is not None:
            error["validation"] = self.validation
        return {"error": error}


def normalize_origin(value: str) -> str:
    if not value or any(ord(char) < 33 or ord(char) == 127 for char in value) or any(char in value for char in "\\%?#"):
        raise CliError("invalid_server", "Server-Adresse enthält ungültige Zeichen.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise CliError("invalid_server", "Server-Adresse enthält einen ungültigen Port.") from exc
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise CliError("invalid_server", "Server-Adresse muss eine HTTP(S)-Origin sein.")
    if parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise CliError("invalid_server", "Server-Adresse darf keine Zugangsdaten, Pfade oder Query enthalten.")
    if parsed.scheme == "http":
        try:
            loopback = ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            loopback = parsed.hostname.lower() == "localhost"
        if not loopback:
            raise CliError("invalid_server", "HTTP ist nur für localhost oder Loopback-Adressen erlaubt.")
    hostname = parsed.hostname.lower()
    if ":" in hostname:
        hostname = f"[{hostname}]"
    if port == 0:
        raise CliError("invalid_server", "Server-Port 0 ist ungültig.")
    if (parsed.scheme, port) in (("https", 443), ("http", 80)):
        port = None
    return f"{parsed.scheme}://{hostname}{f':{port}' if port else ''}"


def validate_path(path: str) -> str:
    parsed = urlsplit(path)
    if (
        not path.startswith("/api/")
        or parsed.scheme or parsed.netloc or parsed.query or parsed.fragment
        or any(char in path for char in "\\%?#") or "//" in path
        or any(part in (".", "..") for part in path.split("/"))
        or any(ord(char) < 32 or ord(char) == 127 for char in path)
    ):
        raise CliError("invalid_path", "Pfad muss ein unveränderter /api/-Pfad ohne Escape, Query oder Traversal sein.")
    return path


def path_part(value: str, label: str, *, numeric: bool = False) -> str:
    if not value or (numeric and not value.isascii()) or (numeric and not value.isdigit()):
        raise CliError("invalid_argument", f"{label} muss eine numerische ID sein." if numeric else f"{label} fehlt.")
    if any(char in value for char in "/\\%?#") or value in (".", "..") or any(ord(char) < 33 for char in value):
        raise CliError("invalid_argument", f"{label} enthält ungültige Zeichen.")
    return value


class SecretStore:
    SERVICE = "LoggeRythm CLI sf_session"

    def __init__(self, backend=None):
        if backend is None:
            try:
                import keyring
                backend = keyring.get_keyring()
            except Exception as exc:
                raise CliError("keyring_unavailable", f"OS-Schlüsselbund ist nicht verfügbar ({type(exc).__name__}).") from exc
        module = type(backend).__module__.lower()
        trusted = ("keyring.backends.macos", "keyring.backends.windows", "keyring.backends.secretservice", "keyring.backends.kwallet")
        if not module.startswith(trusted) or getattr(backend, "priority", 0) <= 0:
            raise CliError("insecure_keyring", f"Kein sicherer OS-Schlüsselbund aktiv ({type(backend).__name__}). LOGGERYTHM_SESSION kann stattdessen verwendet werden.")
        self.backend = backend

    def get(self, origin: str) -> str | None:
        try:
            return self.backend.get_password(self.SERVICE, origin)
        except Exception as exc:
            raise CliError("keyring_error", f"Schlüsselbund konnte nicht gelesen werden ({type(exc).__name__}).") from exc

    def set(self, origin: str, token: str) -> None:
        try:
            self.backend.set_password(self.SERVICE, origin, token)
        except Exception as exc:
            raise CliError("keyring_error", f"Schlüsselbund konnte nicht beschrieben werden ({type(exc).__name__}).") from exc

    def delete(self, origin: str) -> None:
        try:
            self.backend.delete_password(self.SERVICE, origin)
        except Exception as exc:
            raise CliError("keyring_error", f"Schlüsselbund-Eintrag konnte nicht gelöscht werden ({type(exc).__name__}).") from exc


class Client:
    def __init__(self, origin: str, *, session=None, store=None):
        self.origin = normalize_origin(origin)
        self.session = session or requests.Session()
        self.store = store

    def token(self) -> str | None:
        token = os.environ.get("LOGGERYTHM_SESSION")
        if token is not None:
            if not token:
                raise CliError("invalid_session", "LOGGERYTHM_SESSION ist leer.")
            return token
        return (self.store or SecretStore()).get(self.origin)

    def _send(self, method: str, path: str, *, payload=None, query=None, files=None, authenticated=True, stream=False):
        validate_path(path)
        # Explicitly supplied auth is the only cookie source. Requests otherwise
        # retains Set-Cookie values from an earlier response in the same command.
        if hasattr(self.session, "cookies"):
            self.session.cookies.clear()
        headers = {"Accept": "application/json" if not stream else "*/*"}
        if stream:
            headers["Accept-Encoding"] = "identity"
        cookies = {}
        if authenticated:
            token = self.token()
            if token:
                cookies["sf_session"] = token
        try:
            response = self.session.request(
                method.upper(), self.origin + path, json=payload, params=query,
                files=files, cookies=cookies, headers=headers, timeout=(10, 120),
                allow_redirects=False, stream=stream,
            )
        except requests.Timeout as exc:
            raise CliError("timeout", "Server-Anfrage hat das Zeitlimit überschritten.") from exc
        except requests.RequestException as exc:
            raise CliError("connection_error", f"Server-Anfrage fehlgeschlagen ({type(exc).__name__}).") from exc
        if 300 <= response.status_code < 400:
            response.close()
            raise CliError("redirect_refused", "Server-Umleitung verweigert; Zugangsdaten werden nicht weitergeleitet.", status=response.status_code)
        if response.status_code >= 400:
            detail = None
            validation = None
            try:
                body = response.json()
                if isinstance(body, dict) and isinstance(body.get("detail"), str):
                    detail = body["detail"]
                elif isinstance(body, dict) and isinstance(body.get("detail"), list):
                    validation = []
                    for issue in body["detail"]:
                        if not isinstance(issue, dict):
                            raise CliError("invalid_response", "Fehlerdetails des Servers haben ein ungültiges Format.", status=response.status_code)
                        location = issue.get("loc")
                        if not isinstance(location, list) or not all(isinstance(part, (str, int)) for part in location):
                            raise CliError("invalid_response", "Fehlerpfad des Servers hat ein ungültiges Format.", status=response.status_code)
                        field = [str(part) for part in location]
                        sensitive = any(any(secret in part.lower() for secret in ("password", "token", "secret", "session", "cookie")) for part in field)
                        validation.append({
                            "loc": field,
                            "msg": "Ungültiger geheimer Wert." if sensitive else str(issue.get("msg", "Ungültiger Wert.")),
                            "type": str(issue.get("type", "validation_error")),
                        })
            except ValueError:
                detail = "Antworttext ist kein gültiges JSON"
            except CliError:
                response.close()
                raise
            response.close()
            message = f"HTTP {response.status_code}" + (f": {detail}" if detail else "")
            raise CliError("http_error", message, status=response.status_code, validation=validation)
        return response

    def request(self, method: str, path: str, *, payload=None, query=None, files=None, authenticated=True):
        response = self._send(method, path, payload=payload, query=query, files=files, authenticated=authenticated)
        try:
            if response.status_code == 204:
                return {"ok": True}
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json" and not content_type.endswith("+json"):
                raise CliError("unexpected_content_type", "Antwort ist kein JSON. Für Binärdaten --output verwenden.")
            try:
                return response.json()
            except ValueError as exc:
                raise CliError("invalid_response", "Server lieferte ungültiges JSON.") from exc
        finally:
            response.close()

    def login(self, email: str, password: str):
        compatibility = self.request("GET", "/api/version", authenticated=False)
        if (
            not isinstance(compatibility, dict)
            or not isinstance(compatibility.get("compatible_contract_versions"), list)
            or "v2" not in compatibility["compatible_contract_versions"]
            or not isinstance(compatibility.get("current_contract_version"), str)
        ):
            raise CliError("incompatible_server", "Server unterstützt den benötigten API-Vertrag v2 nicht.")
        store = self.store or SecretStore()
        response = self._send("POST", "/api/auth/login", payload={"email": email, "password": password}, authenticated=False)
        try:
            try:
                account = response.json()
            except ValueError as exc:
                raise CliError("invalid_response", "Anmeldung lieferte ungültiges JSON.") from exc
            if not isinstance(account, dict) or not isinstance(account.get("id"), int):
                raise CliError("invalid_response", "Anmeldung lieferte kein gültiges Konto.")
            token = response.cookies.get("sf_session")
            if not token:
                raise CliError("invalid_response", "Anmeldung lieferte kein sf_session-Cookie.")
            store.set(self.origin, token)
            allowed = ("id", "email", "display_name", "is_admin", "is_approved", "avatar_url")
            return {key: account[key] for key in allowed if key in account}
        finally:
            response.close()

    def download(self, path: str, output: str, *, force=False, expected=None, query=None, authenticated=True):
        target = Path(output).expanduser().resolve()
        if target.exists() and not force:
            raise CliError("file_exists", f"Zieldatei existiert bereits: {target}")
        if not target.parent.is_dir():
            raise CliError("invalid_output", f"Zielverzeichnis existiert nicht: {target.parent}")
        response = self._send("GET", path, query=query, authenticated=authenticated, stream=True)
        temporary = None
        try:
            if response.status_code != 200:
                raise CliError("partial_download", f"Download lieferte unerwarteten HTTP-Status {response.status_code}.", status=response.status_code)
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if expected == "audio" and content_type not in ("application/octet-stream",) and not content_type.startswith("audio/"):
                raise CliError("unexpected_content_type", f"Audio-Download lieferte {content_type or 'keinen Content-Type'}.")
            if expected == "zip" and content_type not in ("application/zip", "application/x-zip-compressed"):
                raise CliError("unexpected_content_type", f"Playlist-Download lieferte {content_type or 'keinen Content-Type'}.")
            binary_types = {"application/octet-stream", "application/zip", "application/x-zip-compressed", "application/pdf", "application/gzip", "application/x-tar"}
            if expected is None and not (content_type in binary_types or content_type.startswith(("audio/", "video/", "image/"))):
                raise CliError("unexpected_content_type", f"Download lieferte keinen unterstützten Binärtyp ({content_type or 'kein Content-Type'}).")
            with tempfile.NamedTemporaryFile(mode="wb", prefix=f".{target.name}.", suffix=".part", dir=target.parent, delete=False) as handle:
                temporary = Path(handle.name)
                size = 0
                for chunk in response.iter_content(chunk_size=65536):
                    if chunk:
                        handle.write(chunk)
                        size += len(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            if size == 0:
                raise CliError("empty_download", "Download war leer.")
            length = response.headers.get("Content-Length")
            if length is not None:
                try:
                    expected_size = int(length)
                except ValueError as exc:
                    raise CliError("invalid_response", "Content-Length ist ungültig.") from exc
                if size != expected_size:
                    raise CliError("incomplete_download", f"Download unvollständig: {size} von {expected_size} Bytes.")
            if target.exists() and not force:
                raise CliError("file_exists", f"Zieldatei existiert bereits: {target}")
            if force:
                os.replace(temporary, target)
            else:
                try:
                    os.link(temporary, target)
                except FileExistsError as exc:
                    raise CliError("file_exists", f"Zieldatei existiert bereits: {target}") from exc
                temporary.unlink()
            temporary = None
            return {"path": str(target), "size": size, "content_type": content_type}
        except requests.Timeout as exc:
            raise CliError("timeout", "Download hat das Zeitlimit überschritten.") from exc
        except requests.RequestException as exc:
            raise CliError("connection_error", f"Download fehlgeschlagen ({type(exc).__name__}).") from exc
        except OSError as exc:
            raise CliError("output_error", f"Ausgabedatei konnte nicht geschrieben werden ({type(exc).__name__}).") from exc
        finally:
            response.close()
            if temporary is not None:
                temporary.unlink(missing_ok=True)
