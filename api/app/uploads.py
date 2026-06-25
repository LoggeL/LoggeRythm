"""Shared upload validation helpers."""
from __future__ import annotations

import os
import tempfile
from collections.abc import BinaryIO

from fastapi import HTTPException, UploadFile

MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024

_EXT_BY_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def image_extension(content_type: str | None) -> str:
    ext = _EXT_BY_TYPE.get((content_type or "").lower())
    if ext is None:
        raise HTTPException(
            status_code=400, detail="Nur Bilddateien (JPG, PNG, WEBP, GIF)."
        )
    return ext


def _looks_like_image(header: bytes, ext: str) -> bool:
    if ext == ".jpg":
        return header.startswith(b"\xff\xd8\xff")
    if ext == ".png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == ".webp":
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
    if ext == ".gif":
        return header.startswith((b"GIF87a", b"GIF89a"))
    return False


def save_image_upload(file: UploadFile, destination: str, ext: str) -> None:
    """Stream an uploaded image to disk after size and magic-byte checks."""
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".upload-", suffix=ext, dir=os.path.dirname(destination))
    total = 0
    header = b""
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = file.file.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_IMAGE_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Bilddatei ist zu groß (maximal 5 MB).",
                    )
                if len(header) < 16:
                    header = (header + chunk)[:16]
                out.write(chunk)
        if total == 0 or not _looks_like_image(header, ext):
            raise HTTPException(
                status_code=400,
                detail="Bilddatei passt nicht zum angegebenen Format.",
            )
        os.replace(tmp_path, destination)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise
    finally:
        _close_upload(file.file)


def _close_upload(stream: BinaryIO) -> None:
    try:
        stream.close()
    except OSError:
        pass
