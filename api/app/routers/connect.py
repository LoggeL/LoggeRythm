"""Personal multi-device Connect endpoints (WebSocket + REST helpers)."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import anyio
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from ..auth import _decode_user_id, get_current_user
from ..config import SESSION_COOKIE
from ..db.models import User
from ..db.session import SessionLocal
from ..schemas.connect import (
    CommandAckMessage,
    CommandMessage,
    ConnectStateOut,
    ConnectTicketOut,
    PlaybackStateMessage,
    RegisterMessage,
    RestConnectCommandIn,
    RestConnectCommandOut,
    RestConnectTransferIn,
    TransferMessage,
    UpdateDeviceMessage,
)
from ..services import connect_hub

router = APIRouter(prefix="/api/connect", tags=["connect"])


@router.post(
    "/ticket",
    response_model=ConnectTicketOut,
    description=(
        "Issue a short-lived single-use WebSocket authentication ticket for "
        "clients that cannot attach the session cookie directly to a WebSocket handshake."
    ),
)
def create_connect_ticket(
    user: User = Depends(get_current_user),
) -> ConnectTicketOut:
    ticket, expires_in_sec = connect_hub.hub.issue_ticket(user.id)
    return ConnectTicketOut(ticket=ticket, expires_in_sec=expires_in_sec)


@router.get(
    "/state",
    response_model=ConnectStateOut,
    description=(
        "Return the authenticated user's currently connected devices, active "
        "device, and live (or persisted resumable) playback state."
    ),
)
def get_connect_state(
    user: User = Depends(get_current_user),
) -> ConnectStateOut:
    return connect_hub.hub.get_state(user.id, session_factory=SessionLocal)


@router.post(
    "/command",
    response_model=RestConnectCommandOut,
    description=(
        "Statelessly dispatch a playback command to the user's active (or named) "
        "Connect device and wait for its acknowledgment."
    ),
)
async def send_connect_command(
    body: RestConnectCommandIn,
    user: User = Depends(get_current_user),
) -> RestConnectCommandOut:
    try:
        return await connect_hub.hub.dispatch_rest_command(
            user.id,
            body.action,
            body.payload,
            target_device_id=body.target_device_id,
            timeout_sec=body.timeout_sec,
        )
    except connect_hub.ConnectRestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post(
    "/transfer",
    response_model=ConnectStateOut,
    description=(
        "Statelessly transfer active Connect playback to another connected device."
    ),
)
async def transfer_connect_playback(
    body: RestConnectTransferIn,
    user: User = Depends(get_current_user),
) -> ConnectStateOut:
    try:
        return await connect_hub.hub.dispatch_rest_transfer(
            user.id,
            body.target_device_id,
            play=body.play,
            session_factory=SessionLocal,
        )
    except connect_hub.ConnectRestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _lookup_ws_user(user_id: int) -> tuple[int | None, bool]:
    """Load approval status in a short-lived DB session (closed before WS loop)."""
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None:
            return None, False
        return user.id, bool(user.is_approved or user.is_admin)


async def _authenticate_ws(websocket: WebSocket) -> int | None:
    """Authenticate via ``sf_session`` cookie or single-use ``?ticket=``.

    Closes the socket loudly with ``4401`` (unauthenticated) or ``4403``
    (account pending approval) and returns ``None`` on failure.
    """
    session_cookie = websocket.cookies.get(SESSION_COOKIE)
    ticket = websocket.query_params.get("ticket")

    user_id: int | None = None
    if session_cookie:
        user_id = _decode_user_id(session_cookie)
        if user_id is None and ticket:
            user_id = connect_hub.hub.consume_ticket(ticket)
    elif ticket:
        user_id = connect_hub.hub.consume_ticket(ticket)

    if user_id is None:
        await websocket.close(code=4401, reason="Not authenticated")
        return None

    found_id, approved = await run_in_threadpool(_lookup_ws_user, user_id)
    if found_id is None:
        await websocket.close(code=4401, reason="Not authenticated")
        return None
    if not approved:
        await websocket.close(
            code=4403,
            reason="Dein Konto wartet noch auf Freigabe durch einen Admin.",
        )
        return None
    return found_id


async def _receive_json_object(websocket: WebSocket) -> dict[str, Any]:
    raw = await websocket.receive_text()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed JSON frame: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("WebSocket frame must be a JSON object")
    return parsed


async def _heartbeat_loop(conn: connect_hub.DeviceConnection) -> None:
    hub = connect_hub.hub
    while True:
        await asyncio.sleep(hub.heartbeat_interval_sec)
        idle_sec = time.monotonic() - conn.last_activity_mono
        if idle_sec >= hub.heartbeat_timeout_sec:
            try:
                async with conn.send_lock:
                    await conn.websocket.close(code=4408, reason="Heartbeat timeout")
            except Exception:  # noqa: BLE001 — socket already closed
                pass
            return
        try:
            await connect_hub.send_json(
                conn, {"type": "ping", "ts": connect_hub._utcnow_iso()}
            )
        except Exception:  # noqa: BLE001 — receive loop handles teardown
            return


@router.websocket("/ws")
async def connect_ws(websocket: WebSocket) -> None:
    """Personal multi-device WebSocket channel for presence, state sync, and control."""
    await websocket.accept()
    user_id = await _authenticate_ws(websocket)
    if user_id is None:
        return

    hub = connect_hub.hub
    try:
        raw_register = await asyncio.wait_for(
            _receive_json_object(websocket),
            timeout=hub.registration_timeout_sec,
        )
    except asyncio.TimeoutError:
        await websocket.close(code=4408, reason="Registration timeout")
        return
    except WebSocketDisconnect:
        return
    except ValueError as exc:
        await websocket.send_json(connect_hub.error_frame("invalid_registration", str(exc)))
        await websocket.close(code=4400, reason="Invalid registration frame")
        return

    try:
        register_msg = RegisterMessage.model_validate(raw_register)
    except ValidationError as exc:
        await websocket.send_json(
            connect_hub.error_frame("invalid_registration", str(exc))
        )
        await websocket.close(code=4400, reason="Expected valid register message")
        return

    try:
        conn = await hub.register(
            user_id, websocket, register_msg, session_factory=SessionLocal
        )
    except WebSocketDisconnect:
        return
    except ValueError as exc:
        await websocket.send_json(
            connect_hub.error_frame("invalid_registration", str(exc))
        )
        await websocket.close(code=4400, reason=str(exc))
        return

    heartbeat_task = asyncio.create_task(_heartbeat_loop(conn))
    try:
        while True:
            try:
                frame = await _receive_json_object(websocket)
            except ValueError as exc:
                await connect_hub.send_json(
                    conn, connect_hub.error_frame("invalid_json", str(exc))
                )
                continue

            hub.touch_activity(conn)
            msg_type = frame.get("type")
            request_id = frame.get("request_id") if isinstance(frame.get("request_id"), str) else None

            if msg_type == "ping":
                await connect_hub.send_json(
                    conn, {"type": "pong", "ts": connect_hub._utcnow_iso()}
                )
            elif msg_type == "pong":
                continue
            elif msg_type == "update_device":
                try:
                    msg = UpdateDeviceMessage.model_validate(frame)
                except ValidationError as exc:
                    await connect_hub.send_json(
                        conn, connect_hub.error_frame("invalid_payload", str(exc), request_id)
                    )
                    continue
                await hub.handle_update_device(conn, msg)
            elif msg_type == "playback_state":
                try:
                    msg = PlaybackStateMessage.model_validate(frame)
                except ValidationError as exc:
                    await connect_hub.send_json(
                        conn, connect_hub.error_frame("invalid_payload", str(exc), request_id)
                    )
                    continue
                await hub.handle_playback_state(conn, msg, session_factory=SessionLocal)
            elif msg_type == "transfer":
                try:
                    msg = TransferMessage.model_validate(frame)
                except ValidationError as exc:
                    await connect_hub.send_json(
                        conn, connect_hub.error_frame("invalid_payload", str(exc), request_id)
                    )
                    continue
                await hub.handle_transfer(conn, msg, session_factory=SessionLocal)
            elif msg_type == "command":
                try:
                    msg = CommandMessage.model_validate(frame)
                except ValidationError as exc:
                    await connect_hub.send_json(
                        conn, connect_hub.error_frame("invalid_payload", str(exc), request_id)
                    )
                    continue
                await hub.handle_command(conn, msg)
            elif msg_type == "command_ack":
                try:
                    msg = CommandAckMessage.model_validate(frame)
                except ValidationError as exc:
                    await connect_hub.send_json(
                        conn, connect_hub.error_frame("invalid_payload", str(exc), request_id)
                    )
                    continue
                await hub.handle_command_ack(conn, msg)
            else:
                await connect_hub.send_json(
                    conn,
                    connect_hub.error_frame(
                        "unknown_message_type",
                        f"Unsupported WebSocket message type {msg_type!r}",
                        request_id,
                    ),
                )
    except WebSocketDisconnect:
        pass
    finally:
        heartbeat_task.cancel()
        with anyio.CancelScope(shield=True):
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            await hub.disconnect(conn, session_factory=SessionLocal)
