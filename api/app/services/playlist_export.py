"""Build downloadable ZIP archives containing a playlist's MP3 files."""

import os
import re
import tempfile
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass

import requests

from . import deezer, storage

_UNSAFE_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_COVER_SIZE_RE = re.compile(r"/\d+x\d+(-\d+-\d+-\d+-\d+)?\.jpg$", re.IGNORECASE)
_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


class PlaylistExportError(RuntimeError):
    """A playlist could not be exported completely."""


@dataclass(frozen=True)
class PlaylistExportTrack:
    deezer_id: str
    artist: str
    title: str
    cover_url: str | None = None


def _hi_res_cover_url(url: str) -> str:
    if "dzcdn.net/images/cover/" in url:
        return _COVER_SIZE_RE.sub("/1200x1200.jpg", url)
    return url


def _fetch_cover_jpeg(cover_url: str, cache: dict[str, bytes]) -> bytes:
    hi_res = _hi_res_cover_url(cover_url)
    if hi_res in cache:
        return cache[hi_res]
    resp = requests.get(hi_res, timeout=(5, 15))
    resp.raise_for_status()
    data = resp.content
    if not data:
        raise PlaylistExportError(f"Empty cover image response from {hi_res}")
    cache[hi_res] = data
    return data


def _looks_like_mp3_bytes(path: str) -> bool:
    with open(path, "rb") as fh:
        head = fh.read(4)
    if head[:3] == b"ID3":
        return True
    return len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0


def _safe_filename_component(value: str, field: str) -> str:
    if not value.strip():
        raise PlaylistExportError(f"Playlist export requires a non-empty {field}.")
    cleaned = _UNSAFE_FILENAME_CHARS.sub("_", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    cleaned = cleaned[:120].rstrip(" .")
    if not cleaned:
        raise PlaylistExportError(
            f"Playlist export {field} contains no filename-safe characters."
        )
    if cleaned.upper() in _WINDOWS_RESERVED_NAMES:
        cleaned += "_"
    return cleaned


def build_playlist_archive(
    playlist_name: str,
    tracks: Sequence[PlaylistExportTrack],
    *,
    requested_by_user_id: int | None = None,
) -> tuple[str, str]:
    """Materialize every track and return ``(temp_path, download_filename)``.

    The export is all-or-nothing: a failed track removes the temporary archive
    and raises a contextual error instead of returning a partial playlist.
    """
    if not tracks:
        raise PlaylistExportError("An empty playlist cannot be exported.")

    safe_playlist_name = _safe_filename_component(playlist_name, "playlist name")
    archive_filename = f"{safe_playlist_name}.zip"
    fd, archive_path = tempfile.mkstemp(
        prefix="loggerhythm-playlist-",
        suffix=".zip",
    )
    os.close(fd)

    width = max(2, len(str(len(tracks))))
    cover_cache: dict[str, bytes] = {}
    try:
        with zipfile.ZipFile(
            archive_path,
            mode="w",
            compression=zipfile.ZIP_STORED,
        ) as archive:
            for index, track in enumerate(tracks, start=1):
                if not track.deezer_id.isdigit():
                    raise PlaylistExportError(
                        f"Track {index} has an invalid Deezer id: {track.deezer_id!r}."
                    )
                artist = _safe_filename_component(
                    track.artist,
                    f"artist for track {index}",
                )
                title = _safe_filename_component(
                    track.title,
                    f"title for track {index}",
                )
                tagged_tmp: str | None = None
                try:
                    source_path = storage.materialize(
                        track.deezer_id,
                        requested_by_user_id=requested_by_user_id,
                        source="playlist_export",
                    )
                    is_flac = storage.media_type_for_path(source_path) == "audio/flac"
                    ext = "flac" if is_flac else "mp3"
                    write_path = source_path
                    if not is_flac and track.cover_url and _looks_like_mp3_bytes(source_path):
                        cover_bytes = _fetch_cover_jpeg(track.cover_url, cover_cache)
                        tfd, tagged_tmp = tempfile.mkstemp(
                            prefix="loggerhythm-export-track-",
                            suffix=".mp3",
                        )
                        os.close(tfd)
                        deezer.inject_cover_art_to_mp3(source_path, cover_bytes, tagged_tmp)
                        write_path = tagged_tmp
                    archive.write(
                        write_path,
                        arcname=f"{index:0{width}d} - {artist} - {title}.{ext}",
                    )
                except Exception as exc:  # noqa: BLE001 - add track context
                    raise PlaylistExportError(
                        f"Could not export track {index} “{track.artist} – "
                        f"{track.title}”: {exc}"
                    ) from exc
                finally:
                    if tagged_tmp and os.path.exists(tagged_tmp):
                        os.remove(tagged_tmp)
    except Exception:
        os.remove(archive_path)
        raise

    return archive_path, archive_filename
