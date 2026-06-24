"""Central application configuration, sourced from environment variables."""
import os

from dotenv import load_dotenv

load_dotenv()

# --- Deezer ---
DEEZER_ARL: str = os.getenv("DEEZER_ARL", "")
DEEZER_QUALITY: str = os.getenv("DEEZER_QUALITY", "mp3")
STORAGE_DIR: str = os.getenv("STORAGE_DIR", "storage")

# --- Database ---
DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./spotifrei.db")

# --- Auth ---
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
