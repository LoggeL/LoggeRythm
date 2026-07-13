"""Build downloadable ZIP archives containing a playlist's MP3 files."""

import os
import re
import tempfile
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass

from . import storage

_UNSAFE_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
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
                try:
                    source_path = storage.materialize(track.deezer_id)
                    archive.write(
                        source_path,
                        arcname=f"{index:0{width}d} - {artist} - {title}.mp3",
                    )
                except Exception as exc:  # noqa: BLE001 - add track context
                    raise PlaylistExportError(
                        f"Could not export track {index} “{track.artist} – "
                        f"{track.title}”: {exc}"
                    ) from exc
    except Exception:
        os.remove(archive_path)
        raise

    return archive_path, archive_filename
