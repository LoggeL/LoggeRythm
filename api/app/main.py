"""Spotifrei API — clean REST backend.

Wires together browse/stream/auth/likes/playlists routers, the SQLAlchemy DB,
cookie-based JWT auth and the Deezer adapter. The audio stream/Range logic
lives in routers/stream.py and is preserved verbatim from the verified spike.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import CORS_ORIGINS
from .db.session import init_db
from .routers import auth, browse, follows, likes, lyrics, playlists, resolve, stream
from .services import deezer_client

app = FastAPI(title="Spotifrei API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


@app.on_event("startup")
def _startup() -> None:
    init_db()
    deezer_client.init_session()
    print("Spotifrei API started: DB ready, Deezer session initialized.")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(_STATIC_DIR, "test.html"))


app.include_router(browse.router)
app.include_router(stream.router)
app.include_router(auth.router)
app.include_router(likes.router)
app.include_router(playlists.router)
app.include_router(follows.router)
app.include_router(resolve.router)
app.include_router(lyrics.router)
