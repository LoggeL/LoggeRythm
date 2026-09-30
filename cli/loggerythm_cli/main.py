"""JSON-first command-line interface to the LoggeRythm HTTP API."""

from __future__ import annotations

import argparse
import getpass
import json
import math
import mimetypes
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from .client import CliError, Client, SecretStore, path_part


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise CliError("usage_error", message)


def _json_argument(raw: str):
    if raw.startswith("@"):
        source = Path(raw[1:])
        try:
            raw = source.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise CliError("invalid_json", f"JSON-Datei konnte nicht gelesen werden ({type(exc).__name__}).") from exc
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise CliError("invalid_json", "--json enthält kein gültiges JSON.") from exc


def _queries(values: list[str]) -> list[tuple[str, str]]:
    result = []
    for value in values:
        key, separator, item = value.partition("=")
        if not separator or not key or any(ord(c) < 32 for c in key):
            raise CliError("invalid_query", "--query erwartet KEY=VALUE mit nichtleerem KEY.")
        result.append((key, item))
    return result


def _track(client: Client, track_id: str):
    track_id = path_part(track_id, "TRACK_ID", numeric=True)
    track = client.request("GET", f"/api/tracks/{track_id}", authenticated=False)
    if not isinstance(track, dict) or str(track.get("id")) != track_id or not isinstance(track.get("artists"), list):
        raise CliError("invalid_response", "Track-Antwort ist unvollständig oder hat eine andere ID.")
    return track


def _capabilities(client: Client):
    document = client.request("GET", "/api/openapi.json", authenticated=False)
    if not isinstance(document, dict) or not isinstance(document.get("paths"), dict):
        raise CliError("invalid_response", "OpenAPI-Antwort enthält keine Pfade.")
    items = []
    for path, methods in document["paths"].items():
        if not isinstance(path, str) or not isinstance(methods, dict):
            raise CliError("invalid_response", "OpenAPI-Pfade haben ein ungültiges Format.")
        for method, operation in methods.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete", "head", "options"}:
                continue
            if not isinstance(operation, dict):
                raise CliError("invalid_response", "OpenAPI-Operation hat ein ungültiges Format.")
            items.append({"method": method.upper(), "path": path, "operation_id": operation.get("operationId"), "summary": operation.get("summary")})
    return {"operations": items}


def _party_playback_payload(state: object, play: bool, *, now: datetime | None = None) -> dict:
    if not isinstance(state, dict) or not isinstance(state.get("is_host"), bool):
        raise CliError("invalid_response", "Party-Status enthält keine gültige Host-Angabe.")
    if not state["is_host"]:
        raise CliError("forbidden", "Nur der Party-Host kann die Wiedergabe steuern.", status=403)
    position = state.get("position_sec")
    is_playing = state.get("is_playing")
    if isinstance(position, bool) or not isinstance(position, (int, float)) or not math.isfinite(position) or position < 0 or not isinstance(is_playing, bool):
        raise CliError("invalid_response", "Party-Status enthält keine gültige Wiedergabeposition.")
    if is_playing:
        raw_timestamp = state.get("playback_updated_at")
        if not isinstance(raw_timestamp, str) or not raw_timestamp:
            raise CliError("invalid_response", "Party-Status enthält keinen Zeitstempel für laufende Wiedergabe.")
        try:
            updated_at = datetime.fromisoformat(raw_timestamp.replace("Z", "+00:00"))
        except ValueError as exc:
            raise CliError("invalid_response", "Party-Zeitstempel hat kein gültiges ISO-Format.") from exc
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        current_time = now or datetime.now(timezone.utc)
        elapsed = (current_time - updated_at).total_seconds()
        if elapsed < 0:
            raise CliError("invalid_response", "Party-Zeitstempel liegt in der Zukunft.")
        position += elapsed
    return {"is_playing": play, "position_sec": position}


def build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(prog="loggerythm", description="LoggeRythm über die API steuern. Daten und Fehler werden als JSON ausgegeben.")
    parser.add_argument("--server", default=os.environ.get("LOGGERYTHM_URL", "https://loggerythm.logge.top"), help="HTTPS-Origin, lokal auch HTTP (LOGGERYTHM_URL)")
    sub = parser.add_subparsers(dest="command", required=True)

    login = sub.add_parser("login", help="Anmelden und Session im OS-Schlüsselbund speichern")
    login.add_argument("--email", default=os.environ.get("LOGGERYTHM_EMAIL"))
    sub.add_parser("logout", help="Lokal gespeicherte Session löschen")
    sub.add_parser("me", help="Eigenes Konto anzeigen")
    sub.add_parser("capabilities", help="Verfügbare API-Operationen aus OpenAPI anzeigen")

    request = sub.add_parser("request", help="Beliebigen /api/-Endpunkt aufrufen")
    request.add_argument("method", choices=("GET", "POST", "PUT", "PATCH", "DELETE"), type=str.upper)
    request.add_argument("path")
    request.add_argument("--json", dest="json_payload", help="JSON-Text oder @datei.json")
    request.add_argument("--query", action="append", default=[], metavar="KEY=VALUE")
    request.add_argument("--file", action="append", default=[], metavar="FIELD=PATH")
    request.add_argument("--output", help="Binärantwort in Datei speichern")
    request.add_argument("--force", action="store_true", help="Bestehende Ausgabedatei ersetzen")
    request.add_argument("--public", action="store_true", help="Ohne Session senden")

    search = sub.add_parser("search", help="Katalog durchsuchen")
    search.add_argument("query")
    search.add_argument("--type", choices=("track", "album", "artist", "playlist"), default="track")

    playlists = sub.add_parser("playlists", help="Playlists verwalten")
    pl = playlists.add_subparsers(dest="action", required=True)
    pl.add_parser("list")
    p = pl.add_parser("get"); p.add_argument("id")
    p = pl.add_parser("create"); p.add_argument("name"); p.add_argument("--description")
    p = pl.add_parser("add-track"); p.add_argument("id"); p.add_argument("track_id")

    likes = sub.add_parser("likes", help="Likes verwalten")
    li = likes.add_subparsers(dest="action", required=True)
    li.add_parser("list")
    for action in ("add", "remove"):
        p = li.add_parser(action); p.add_argument("track_id")

    party = sub.add_parser("party", help="Party-Queue verwalten")
    pa = party.add_subparsers(dest="action", required=True)
    p = pa.add_parser("create"); p.add_argument("--name")
    for action in ("get", "play", "pause"):
        p = pa.add_parser(action); p.add_argument("code")
    p = pa.add_parser("add"); p.add_argument("code"); p.add_argument("track_id")
    p = pa.add_parser("current"); p.add_argument("code"); p.add_argument("index", type=int)

    downloads = sub.add_parser("downloads", help="Serverseitige Downloads verwalten")
    dl = downloads.add_subparsers(dest="action", required=True)
    dl.add_parser("cached")
    p = dl.add_parser("preload"); p.add_argument("track_id")

    download = sub.add_parser("download", help="Audio oder Playlist-ZIP lokal speichern")
    dl = download.add_subparsers(dest="action", required=True)
    for action in ("track", "playlist"):
        p = dl.add_parser(action)
        p.add_argument("id")
        p.add_argument("--output", required=True)
        p.add_argument("--force", action="store_true")
    return parser


def execute(args, *, client: Client | None = None):
    client = client or Client(args.server)
    if args.command == "login":
        if os.environ.get("LOGGERYTHM_SESSION") is not None:
            raise CliError("env_session_active", "LOGGERYTHM_SESSION ist gesetzt; vor einer gespeicherten Anmeldung entfernen.")
        if not args.email:
            raise CliError("missing_email", "E-Mail fehlt; --email oder LOGGERYTHM_EMAIL setzen.")
        password = os.environ.get("LOGGERYTHM_PASSWORD")
        if password is None:
            if not sys.stdin.isatty():
                raise CliError("missing_password", "Passwort fehlt; LOGGERYTHM_PASSWORD setzen oder interaktiv anmelden.")
            password = getpass.getpass("Passwort: ")
        if not password:
            raise CliError("missing_password", "Passwort ist leer.")
        return client.login(args.email, password)
    if args.command == "logout":
        if os.environ.get("LOGGERYTHM_SESSION") is not None:
            raise CliError("env_session_active", "LOGGERYTHM_SESSION ist gesetzt; diese Session muss in der Umgebung entfernt werden.")
        (client.store or SecretStore()).delete(client.origin)
        return {"ok": True, "message": "Lokale Session gelöscht. Bereits ausgegebene Server-Tokens bleiben bis zum Ablauf gültig."}
    if args.command == "me":
        return client.request("GET", "/api/auth/me")
    if args.command == "capabilities":
        return _capabilities(client)
    if args.command == "request":
        if args.json_payload is not None and args.file:
            raise CliError("invalid_argument", "--json und --file können nicht kombiniert werden.")
        if args.output:
            if args.method != "GET" or args.json_payload is not None or args.file:
                raise CliError("invalid_argument", "--output unterstützt nur GET ohne JSON oder Datei-Upload.")
            return client.download(args.path, args.output, force=args.force, query=_queries(args.query), authenticated=not args.public)
        if args.force:
            raise CliError("invalid_argument", "--force benötigt --output.")
        payload = _json_argument(args.json_payload) if args.json_payload is not None else None
        query = _queries(args.query)
        if args.file:
            from contextlib import ExitStack
            with ExitStack() as stack:
                files = {}
                for item in args.file:
                    field, separator, filename = item.partition("=")
                    if not separator or not field or not filename or field in files:
                        raise CliError("invalid_argument", "--file erwartet eindeutiges FIELD=PATH.")
                    mime_type, _ = mimetypes.guess_type(filename)
                    if mime_type is None:
                        raise CliError("unknown_mime", f"Dateityp für Upload nicht erkennbar: {Path(filename).name}")
                    try:
                        handle = stack.enter_context(open(filename, "rb"))
                    except OSError as exc:
                        raise CliError("invalid_file", f"Upload-Datei konnte nicht gelesen werden ({type(exc).__name__}).") from exc
                    files[field] = (Path(filename).name, handle, mime_type)
                return client.request(args.method, args.path, query=query, files=files, authenticated=not args.public)
        return client.request(args.method, args.path, payload=payload, query=query, authenticated=not args.public)
    if args.command == "search":
        path = "/api/search" if args.type in ("track", "album") else f"/api/search/{args.type}"
        query = [("q", args.query)]
        if args.type == "album":
            query.append(("type", "album"))
        return client.request("GET", path, query=query, authenticated=False)
    if args.command == "playlists":
        if args.action == "list":
            return client.request("GET", "/api/playlists")
        playlist_id = path_part(args.id, "Playlist-ID", numeric=True) if args.action != "create" else None
        if args.action == "get":
            return client.request("GET", f"/api/playlists/{playlist_id}")
        if args.action == "create":
            return client.request("POST", "/api/playlists", payload={"name": args.name, "description": args.description})
        track = _track(client, args.track_id)
        return client.request("POST", f"/api/playlists/{playlist_id}/tracks", payload=track)
    if args.command == "likes":
        if args.action == "list":
            return client.request("GET", "/api/me/likes")
        track_id = path_part(args.track_id, "TRACK_ID", numeric=True)
        if args.action == "remove":
            return client.request("DELETE", f"/api/me/likes/{track_id}")
        return client.request("PUT", f"/api/me/likes/{track_id}", payload=_track(client, track_id))
    if args.command == "party":
        if args.action == "create":
            return client.request("POST", "/api/party", payload={"name": args.name})
        code = path_part(args.code, "Party-Code")
        base = f"/api/party/{code}"
        if args.action == "get":
            return client.request("GET", base)
        if args.action == "add":
            return client.request("POST", base + "/tracks", payload=_track(client, args.track_id))
        if args.action == "current":
            return client.request("PATCH", base + "/current", payload={"index": args.index})
        state = client.request("GET", base)
        return client.request("PATCH", base + "/playback", payload=_party_playback_payload(state, args.action == "play"))
    if args.command == "downloads":
        if args.action == "cached":
            return client.request("GET", "/api/cached-tracks")
        track_id = path_part(args.track_id, "TRACK_ID", numeric=True)
        return client.request("POST", f"/api/tracks/{track_id}/preload")
    if args.command == "download":
        item_id = path_part(args.id, "ID", numeric=True)
        if args.action == "track":
            return client.download(f"/api/tracks/{item_id}/stream", args.output, force=args.force, expected="audio")
        return client.download(f"/api/playlists/{item_id}/export", args.output, force=args.force, expected="zip")
    raise CliError("invalid_argument", "Unbekannter Befehl.")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        result = execute(parser.parse_args(argv))
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except CliError as exc:
        print(json.dumps(exc.as_json(), ensure_ascii=False, separators=(",", ":")), file=sys.stderr)
        return 1
    except (OSError, UnicodeError) as exc:
        error = CliError("local_io_error", f"Lokale Dateioperation fehlgeschlagen ({type(exc).__name__}).")
        print(json.dumps(error.as_json(), ensure_ascii=False, separators=(",", ":")), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
