"""Central application configuration, sourced from environment variables."""
import os

from dotenv import load_dotenv

# ``utf-8-sig`` strips a leading UTF-8 BOM if the .env was saved with one
# (common on Windows editors). Without this the first key is read as
# ``﻿DEEZER_ARL`` and silently goes missing.
load_dotenv(encoding="utf-8-sig")

# --- Deezer ---
DEEZER_ARL: str = os.getenv("DEEZER_ARL", "")
DEEZER_QUALITY: str = os.getenv("DEEZER_QUALITY", "mp3")
STORAGE_DIR: str = os.getenv("STORAGE_DIR", "storage")
# Stored tracks not played within this many days are evicted (0 = keep forever).
STORAGE_RETENTION_DAYS: int = int(os.getenv("STORAGE_RETENTION_DAYS", "30"))

# --- Database ---
DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./spotifrei.db")
APP_ENV: str = os.getenv("APP_ENV", "development").lower()

# --- Auth ---
_DEV_JWT_SECRETS = {"", "dev-secret-change-me-in-production", "change-me-in-production"}
JWT_SECRET: str = os.getenv("JWT_SECRET", "dev-secret-change-me-in-production")
JWT_ALGORITHM: str = "HS256"
JWT_EXPIRE_DAYS: int = 30
SESSION_COOKIE: str = "sf_session"
COOKIE_MAX_AGE: int = JWT_EXPIRE_DAYS * 24 * 60 * 60
# Secure cookie over HTTPS only. Default off for localhost dev; enable in prod.
COOKIE_SECURE: bool = os.getenv("COOKIE_SECURE", "false").lower() in ("1", "true", "yes")
COOKIE_SAMESITE: str = os.getenv("COOKIE_SAMESITE", "lax")

# --- CORS ---
CORS_ORIGINS: list[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# --- Public Deezer API ---
DEEZER_PUBLIC_API: str = "https://api.deezer.com"

# --- Last.fm (external song-similarity source for the radio) ---
# Free API key from https://www.last.fm/api/account/create — optional; the radio
# falls back to Deezer's own artist mix when this is empty.
LASTFM_API_KEY: str = os.getenv("LASTFM_API_KEY", "")

# --- Spotify (metadata / link resolution via Client Credentials) ---
SPOTIFY_CLIENT_ID: str = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET: str = os.getenv("SPOTIFY_CLIENT_SECRET", "")
# Cap how many tracks we resolve from one Spotify playlist/album.
SPOTIFY_RESOLVE_LIMIT: int = int(os.getenv("SPOTIFY_RESOLVE_LIMIT", "200"))

# --- Groq (optional lyrics transcription fallback) ---
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_TRANSCRIPTION_MODEL: str = os.getenv(
    "GROQ_TRANSCRIPTION_MODEL", "whisper-large-v3-turbo"
)


def validate_runtime_config() -> None:
    if APP_ENV in {"prod", "production"} and JWT_SECRET in _DEV_JWT_SECRETS:
        raise RuntimeError(
            "JWT_SECRET must be set to a strong unique value when APP_ENV=production."
        )
