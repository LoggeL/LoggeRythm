"""In-process multi-device Connect hub (Spotify Connect-like personal sessions).

Each authenticated user gets an ephemeral room holding their live WebSocket
device connections, one active audio device at a time, and the canonical
playback snapshot. All state is in-process (matching ``party_bus`` and
``party_preload`` on the single uvicorn worker).

Error handling follows ``AGENTS.md``: invalid payloads, unauthorized state
publishes, missing devices, unsupported capabilities, and unreachable targets
always produce explicit error frames rather than failing silently.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket
from pydantic import ValidationError

from ..schemas.connect import (
    CommandAckMessage,
    CommandMessage,
    ConnectDeviceOut,
    ConnectPlaybackInput,
    ConnectPlaybackState,
    ConnectStateOut,
    DeviceCapabilities,
    DeviceType,
    PlaybackStateMessage,
    RegisterMessage,
    TransferMessage,
    UpdateDeviceMessage,
    validate_command_payload,
)

logger = logging.getLogger(__name__)

TICKET_TTL_SEC = 30
HEARTBEAT_INTERVAL_SEC = 20
HEARTBEAT_TIMEOUT_SEC = 45
REGISTRATION_TIMEOUT_SEC = 10
PENDING_COMMAND_TTL_SEC = 30


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utcnow_iso() -> str:
    return _utcnow().isoformat()


def _parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _hash_ticket(ticket: str) -> str:
    return hashlib.sha256(ticket.encode("utf-8")).hexdigest()


@dataclass
class _TicketEntry:
    user_id: int
    expires_at_mono: float


@dataclass
class _PendingCommand:
    command_id: str
    sender_device_id: str
    target_device_id: str
    request_id: str | None
    created_at_mono: float


@dataclass
class DeviceConnection:
    user_id: int
    device_id: str
    name: str
    device_type: DeviceType
    capabilities: DeviceCapabilities
    volume: float
    muted: bool
    party_code: str | None
    websocket: WebSocket
    connected_at: str
    last_seen_at: str
    last_activity_mono: float
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def to_out(self, active_device_id: str | None) -> ConnectDeviceOut:
        return ConnectDeviceOut(
            device_id=self.device_id,
            name=self.name,
            device_type=self.device_type,
            capabilities=self.capabilities,
            volume=self.volume,
            muted=self.muted,
            is_active=(self.device_id == active_device_id),
            party_code=self.party_code,
            connected_at=self.connected_at,
            last_seen_at=self.last_seen_at,
        )


@dataclass
class _UserRoom:
    revision: int = 0
    active_device_id: str | None = None
    devices: dict[str, DeviceConnection] = field(default_factory=dict)
    playback: ConnectPlaybackState = field(default_factory=ConnectPlaybackState)
    pending_commands: dict[str, _PendingCommand] = field(default_factory=dict)

    def snapshot(self) -> ConnectStateOut:
        return ConnectStateOut(
            revision=self.revision,
            active_device_id=self.active_device_id,
            devices=[
                conn.to_out(self.active_device_id)
                for conn in self.devices.values()
            ],
            playback=self.playback.model_copy(deep=True),
            server_time=_utcnow_iso(),
        )

    def interpolated_position(self, now: datetime) -> float:
        pos = self.playback.position_sec
        if self.playback.is_playing and self.playback.updated_at:
            elapsed = max(0.0, (now - _parse_iso(self.playback.updated_at)).total_seconds())
            pos += elapsed
            if self.playback.duration_sec > 0.0:
                pos = min(pos, self.playback.duration_sec)
        return pos

    def prune_pending(self, now_mono: float) -> None:
        expired = [
            cid
            for cid, entry in self.pending_commands.items()
            if now_mono - entry.created_at_mono > PENDING_COMMAND_TTL_SEC
        ]
        for cid in expired:
            del self.pending_commands[cid]


def _apply_playback_input(
    existing: ConnectPlaybackState,
    incoming: ConnectPlaybackInput,
    device: DeviceConnection,
    now_iso: str,
) -> ConnectPlaybackState:
    origins = (
        list(incoming.origins)
        if incoming.origins is not None
        else ["context"] * len(incoming.queue)
    )
    if incoming.volume is not None:
        device.volume = incoming.volume
    if incoming.muted is not None:
        device.muted = incoming.muted
    return ConnectPlaybackState(
        queue=[track.model_copy(deep=True) for track in incoming.queue],
        origins=origins,
        queue_context=incoming.queue_context,
        current_index=incoming.current_index,
        is_playing=incoming.is_playing,
        position_sec=incoming.position_sec,
        duration_sec=incoming.duration_sec,
        shuffle=incoming.shuffle,
        repeat=incoming.repeat,
        volume=device.volume,
        muted=device.muted,
        updated_at=now_iso,
    )


def error_frame(code: str, detail: str, request_id: str | None = None) -> dict[str, Any]:
    return {
        "type": "error",
        "code": code,
        "detail": detail,
        "request_id": request_id,
    }


async def send_json(conn: DeviceConnection, payload: dict[str, Any]) -> None:
    async with conn.send_lock:
        await conn.websocket.send_json(payload)


async def _send_broadcast(conns: list[DeviceConnection], payload: dict[str, Any]) -> None:
    for conn in conns:
        try:
            await send_json(conn, payload)
        except Exception as exc:  # noqa: BLE001 — peer socket dropped; its loop cleans up
            logger.warning(
                "Connect broadcast to user=%s device=%s failed: %s",
                conn.user_id,
                conn.device_id,
                exc,
            )


class ConnectHub:
    """Thread-safe in-process registry of connected personal devices per user."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rooms: dict[int, _UserRoom] = {}
        self._tickets: dict[str, _TicketEntry] = {}
        self.heartbeat_interval_sec: int = HEARTBEAT_INTERVAL_SEC
        self.heartbeat_timeout_sec: int = HEARTBEAT_TIMEOUT_SEC
        self.registration_timeout_sec: int = REGISTRATION_TIMEOUT_SEC

    # --- single-use WS tickets --------------------------------------------

    def issue_ticket(self, user_id: int) -> tuple[str, int]:
        now = time.monotonic()
        token = secrets.token_urlsafe(32)
        digest = _hash_ticket(token)
        with self._lock:
            self._prune_tickets_locked(now)
            self._tickets[digest] = _TicketEntry(
                user_id=user_id, expires_at_mono=now + TICKET_TTL_SEC
            )
        return token, TICKET_TTL_SEC

    def consume_ticket(self, token: str) -> int | None:
        if not token:
            return None
        now = time.monotonic()
        digest = _hash_ticket(token)
        with self._lock:
            self._prune_tickets_locked(now)
            entry = self._tickets.pop(digest, None)
        if entry is None or entry.expires_at_mono <= now:
            return None
        return entry.user_id

    def _prune_tickets_locked(self, now: float) -> None:
        expired = [k for k, v in self._tickets.items() if v.expires_at_mono <= now]
        for k in expired:
            del self._tickets[k]

    # --- state inspection -------------------------------------------------

    def get_state(self, user_id: int) -> ConnectStateOut:
        with self._lock:
            room = self._rooms.get(user_id)
            if room is None:
                return ConnectStateOut(server_time=_utcnow_iso())
            return room.snapshot()

    def touch_activity(self, conn: DeviceConnection) -> None:
        with self._lock:
            conn.last_activity_mono = time.monotonic()
            conn.last_seen_at = _utcnow_iso()

    # --- lifecycle --------------------------------------------------------

    async def register(
        self,
        user_id: int,
        websocket: WebSocket,
        msg: RegisterMessage,
    ) -> DeviceConnection:
        now = _utcnow()
        now_iso = now.isoformat()
        now_mono = time.monotonic()
        conn = DeviceConnection(
            user_id=user_id,
            device_id=msg.device_id,
            name=msg.name,
            device_type=msg.device_type,
            capabilities=msg.capabilities,
            volume=msg.volume,
            muted=msg.muted,
            party_code=msg.party_code,
            websocket=websocket,
            connected_at=now_iso,
            last_seen_at=now_iso,
            last_activity_mono=now_mono,
        )

        replaced_conn: DeviceConnection | None = None
        deactivated_target: DeviceConnection | None = None
        deactivated_payload: dict[str, Any] | None = None
        failed_results: list[tuple[DeviceConnection, dict[str, Any]]] = []

        with self._lock:
            if msg.take_active and not msg.capabilities.can_play_audio:
                raise ValueError("Cannot take_active on a device with can_play_audio=false")
            room = self._rooms.setdefault(user_id, _UserRoom())
            replaced_conn = room.devices.get(conn.device_id)
            room.devices[conn.device_id] = conn

            if replaced_conn is not None:
                # Replaced socket's disconnect() exits early; fail its in-flight commands now.
                dropped_ids = [
                    cid
                    for cid, entry in room.pending_commands.items()
                    if entry.target_device_id == conn.device_id
                ]
                for cid in dropped_ids:
                    entry = room.pending_commands.pop(cid)
                    sender = room.devices.get(entry.sender_device_id)
                    if sender is not None and sender is not replaced_conn:
                        failed_results.append(
                            (
                                sender,
                                {
                                    "type": "command_result",
                                    "request_id": entry.request_id,
                                    "command_id": cid,
                                    "ok": False,
                                    "error": (
                                        f"Device {replaced_conn.name!r} reconnected before "
                                        "acknowledging command"
                                    ),
                                },
                            )
                        )

            should_claim = msg.take_active or (
                room.active_device_id is None
                and conn.capabilities.can_play_audio
                and msg.playback is not None
                and (msg.playback.is_playing or msg.playback.current_index >= 0)
            )

            if should_claim:
                old_active_id = room.active_device_id
                if old_active_id and old_active_id != conn.device_id:
                    old_conn = room.devices.get(old_active_id)
                    if old_conn is not None:
                        deactivated_target = old_conn
                        deactivated_payload = {
                            "type": "deactivated",
                            "new_active_device_id": conn.device_id,
                            "reason": "claimed_by_other_device",
                        }
                room.active_device_id = conn.device_id
                if msg.playback is not None:
                    room.playback = _apply_playback_input(
                        room.playback, msg.playback, conn, now_iso
                    )
                else:
                    room.playback.volume = conn.volume
                    room.playback.muted = conn.muted
            elif room.active_device_id == conn.device_id:
                if not conn.capabilities.can_play_audio:
                    # A reconnecting device that can no longer play audio cannot stay active.
                    pos = room.interpolated_position(now)
                    room.active_device_id = None
                    room.playback.is_playing = False
                    room.playback.position_sec = pos
                    room.playback.updated_at = now_iso
                elif msg.playback is not None:
                    room.playback = _apply_playback_input(
                        room.playback, msg.playback, conn, now_iso
                    )
                else:
                    room.playback.volume = conn.volume
                    room.playback.muted = conn.muted

            room.revision += 1
            snapshot = room.snapshot().model_dump(mode="json")
            other_conns = [c for c in room.devices.values() if c is not conn]

        if replaced_conn is not None:
            try:
                async with replaced_conn.send_lock:
                    await replaced_conn.websocket.close(
                        code=4409, reason="Replaced by newer connection for this device"
                    )
            except Exception as exc:  # noqa: BLE001 — stale socket may already be dead
                logger.warning("Closing replaced Connect socket failed: %s", exc)

        for sender, result_payload in failed_results:
            await _send_broadcast([sender], result_payload)

        try:
            await send_json(
                conn,
                {
                    "type": "welcome",
                    "self_device_id": conn.device_id,
                    "heartbeat_interval_sec": self.heartbeat_interval_sec,
                    "state": snapshot,
                },
            )
        except BaseException:
            # Never leak a registered device if the socket drops before welcome completes.
            await self.disconnect(conn)
            raise

        if deactivated_target is not None and deactivated_payload is not None:
            await _send_broadcast([deactivated_target], deactivated_payload)
        if other_conns:
            await _send_broadcast(other_conns, {"type": "state", "state": snapshot})
        return conn

    async def disconnect(self, conn: DeviceConnection) -> None:
        now = _utcnow()
        now_iso = now.isoformat()
        state_payload: dict[str, Any] | None = None
        remaining_conns: list[DeviceConnection] = []
        failed_results: list[tuple[DeviceConnection, dict[str, Any]]] = []

        with self._lock:
            room = self._rooms.get(conn.user_id)
            if room is None:
                return
            if room.devices.get(conn.device_id) is not conn:
                # Replaced by a newer socket for the same device_id; leave it alone.
                return
            del room.devices[conn.device_id]

            # Fail any in-flight commands waiting for this device so senders do not hang.
            dropped_ids = [
                cid
                for cid, entry in room.pending_commands.items()
                if entry.target_device_id == conn.device_id
            ]
            for cid in dropped_ids:
                entry = room.pending_commands.pop(cid)
                sender = room.devices.get(entry.sender_device_id)
                if sender is not None:
                    failed_results.append(
                        (
                            sender,
                            {
                                "type": "command_result",
                                "request_id": entry.request_id,
                                "command_id": cid,
                                "ok": False,
                                "error": f"Device {conn.name!r} disconnected before acknowledging command",
                            },
                        )
                    )

            if room.active_device_id == conn.device_id:
                pos = room.interpolated_position(now)
                room.active_device_id = None
                room.playback.is_playing = False
                room.playback.position_sec = pos
                room.playback.updated_at = now_iso

            if not room.devices:
                del self._rooms[conn.user_id]
                return

            room.revision += 1
            state_payload = {"type": "state", "state": room.snapshot().model_dump(mode="json")}
            remaining_conns = list(room.devices.values())

        for sender, result_payload in failed_results:
            await _send_broadcast([sender], result_payload)
        if state_payload is not None and remaining_conns:
            await _send_broadcast(remaining_conns, state_payload)

    # --- message handlers -------------------------------------------------

    async def handle_update_device(
        self, conn: DeviceConnection, msg: UpdateDeviceMessage
    ) -> None:
        fields = msg.model_fields_set - {"type"}
        if not fields:
            await send_json(
                conn,
                error_frame("invalid_payload", "At least one device field must be provided"),
            )
            return
        for non_nullable in ("name", "volume", "muted"):
            if non_nullable in fields and getattr(msg, non_nullable) is None:
                await send_json(
                    conn,
                    error_frame("invalid_payload", f"{non_nullable} cannot be null"),
                )
                return

        with self._lock:
            room = self._rooms.get(conn.user_id)
            if room is None or room.devices.get(conn.device_id) is not conn:
                return
            if "name" in fields and msg.name is not None:
                conn.name = msg.name
            if "volume" in fields and msg.volume is not None:
                conn.volume = msg.volume
                if room.active_device_id == conn.device_id:
                    room.playback.volume = msg.volume
            if "muted" in fields and msg.muted is not None:
                conn.muted = msg.muted
                if room.active_device_id == conn.device_id:
                    room.playback.muted = msg.muted
            if "party_code" in fields:
                conn.party_code = msg.party_code
            conn.last_seen_at = _utcnow_iso()
            room.revision += 1
            state_payload = {"type": "state", "state": room.snapshot().model_dump(mode="json")}
            recipients = list(room.devices.values())

        await _send_broadcast(recipients, state_payload)

    async def handle_playback_state(
        self, conn: DeviceConnection, msg: PlaybackStateMessage
    ) -> None:
        now_iso = _utcnow_iso()
        deactivated_target: DeviceConnection | None = None
        deactivated_payload: dict[str, Any] | None = None

        with self._lock:
            room = self._rooms.get(conn.user_id)
            if room is None or room.devices.get(conn.device_id) is not conn:
                return
            if room.active_device_id != conn.device_id:
                if not msg.claim_active:
                    err = error_frame(
                        "not_active_device",
                        "Only the active device may publish playback_state without claim_active=true",
                    )
                    recipients: list[DeviceConnection] = []
                    state_payload = None
                elif not conn.capabilities.can_play_audio:
                    err = error_frame(
                        "device_cannot_play",
                        f"Device {conn.name!r} cannot become active because can_play_audio is false",
                    )
                    recipients = []
                    state_payload = None
                else:
                    err = None
                    old_active_id = room.active_device_id
                    if old_active_id and old_active_id != conn.device_id:
                        old_conn = room.devices.get(old_active_id)
                        if old_conn is not None:
                            deactivated_target = old_conn
                            deactivated_payload = {
                                "type": "deactivated",
                                "new_active_device_id": conn.device_id,
                                "reason": "claimed_by_other_device",
                            }
                    room.active_device_id = conn.device_id
                    room.playback = _apply_playback_input(
                        room.playback, msg.state, conn, now_iso
                    )
                    room.revision += 1
                    state_payload = {
                        "type": "state",
                        "state": room.snapshot().model_dump(mode="json"),
                    }
                    recipients = list(room.devices.values())
            else:
                err = None
                room.playback = _apply_playback_input(
                    room.playback, msg.state, conn, now_iso
                )
                room.revision += 1
                state_payload = {
                    "type": "state",
                    "state": room.snapshot().model_dump(mode="json"),
                }
                recipients = list(room.devices.values())

        if err is not None:
            await send_json(conn, err)
            return
        if deactivated_target is not None and deactivated_payload is not None:
            await _send_broadcast([deactivated_target], deactivated_payload)
        if state_payload is not None:
            await _send_broadcast(recipients, state_payload)

    async def handle_transfer(self, conn: DeviceConnection, msg: TransferMessage) -> None:
        now = _utcnow()
        now_iso = now.isoformat()

        # Phase 1: validate and prepare the activate frame without mutating room
        # state or deactivating the current active device yet.
        with self._lock:
            room = self._rooms.get(conn.user_id)
            if room is None or room.devices.get(conn.device_id) is not conn:
                return
            target = room.devices.get(msg.target_device_id)
            if target is None:
                err = error_frame(
                    "device_not_found",
                    f"Connected device {msg.target_device_id!r} not found",
                    msg.request_id,
                )
                activate_payload = None
            elif not target.capabilities.can_play_audio:
                err = error_frame(
                    "device_cannot_play",
                    f"Device {target.name!r} cannot play audio",
                    msg.request_id,
                )
                activate_payload = None
            else:
                err = None
                pos = room.interpolated_position(now)
                has_track = 0 <= room.playback.current_index < len(room.playback.queue)
                if msg.play is not None:
                    next_is_playing = bool(msg.play and has_track)
                else:
                    next_is_playing = bool(room.playback.is_playing and has_track)
                projected_playback = room.playback.model_copy(
                    deep=True,
                    update={
                        "position_sec": pos,
                        "is_playing": next_is_playing,
                        "volume": target.volume,
                        "muted": target.muted,
                        "updated_at": now_iso,
                    },
                )
                activate_payload = {
                    "type": "activate",
                    "from_device_id": room.active_device_id,
                    "playback": projected_playback.model_dump(mode="json"),
                }

        if err is not None:
            await send_json(conn, err)
            return

        assert target is not None and activate_payload is not None
        try:
            await send_json(target, activate_payload)
        except Exception as exc:  # noqa: BLE001 — fail loud without mutating active state
            await send_json(
                conn,
                error_frame(
                    "device_unreachable",
                    f"Could not deliver transfer to device {target.name!r}: {exc}",
                    msg.request_id,
                ),
            )
            return

        # Phase 2: target accepted the activate frame; commit active device swap
        # only if target is still the live connection for its device_id.
        deactivated_target: DeviceConnection | None = None
        deactivated_payload: dict[str, Any] | None = None
        commit_err: dict[str, Any] | None = None
        state_payload: dict[str, Any] | None = None
        recipients: list[DeviceConnection] = []

        with self._lock:
            room = self._rooms.get(conn.user_id)
            if room is None:
                return
            if room.devices.get(target.device_id) is not target:
                commit_err = error_frame(
                    "device_unreachable",
                    f"Device {target.name!r} disconnected or reconnected during transfer",
                    msg.request_id,
                )
            else:
                old_active_id = room.active_device_id
                if old_active_id and old_active_id != target.device_id:
                    old_conn = room.devices.get(old_active_id)
                    if old_conn is not None:
                        deactivated_target = old_conn
                        deactivated_payload = {
                            "type": "deactivated",
                            "new_active_device_id": target.device_id,
                            "reason": "transferred",
                        }
                room.active_device_id = target.device_id
                room.playback = projected_playback
                room.revision += 1
                state_payload = {
                    "type": "state",
                    "state": room.snapshot().model_dump(mode="json"),
                }
                recipients = list(room.devices.values())

        if commit_err is not None:
            await send_json(conn, commit_err)
            return
        if deactivated_target is not None and deactivated_payload is not None:
            await _send_broadcast([deactivated_target], deactivated_payload)
        if state_payload is not None:
            await _send_broadcast(recipients, state_payload)

    async def handle_command(self, conn: DeviceConnection, msg: CommandMessage) -> None:
        try:
            normalized_payload = validate_command_payload(msg.action, msg.payload)
        except ValidationError as exc:
            await send_json(
                conn,
                error_frame("invalid_payload", str(exc), msg.request_id),
            )
            return

        now_mono = time.monotonic()
        with self._lock:
            room = self._rooms.get(conn.user_id)
            if room is None or room.devices.get(conn.device_id) is not conn:
                return
            room.prune_pending(now_mono)
            target_id = msg.target_device_id or room.active_device_id
            if target_id is None:
                err = error_frame(
                    "no_active_device",
                    "No active device to receive playback command",
                    msg.request_id,
                )
                target = None
                command_frame = None
                command_id = ""
            else:
                target = room.devices.get(target_id)
                if target is None:
                    err = error_frame(
                        "device_not_found",
                        f"Connected device {target_id!r} not found",
                        msg.request_id,
                    )
                    command_frame = None
                    command_id = ""
                elif (
                    msg.action in ("set_volume", "set_mute")
                    and not target.capabilities.can_control_volume
                ):
                    err = error_frame(
                        "unsupported_capability",
                        f"Device {target.name!r} does not support remote volume control",
                        msg.request_id,
                    )
                    command_frame = None
                    command_id = ""
                elif (
                    msg.action in ("play", "toggle", "play_tracks")
                    and not target.capabilities.can_play_audio
                ):
                    err = error_frame(
                        "device_cannot_play",
                        f"Device {target.name!r} cannot play audio",
                        msg.request_id,
                    )
                    command_frame = None
                    command_id = ""
                else:
                    err = None
                    command_id = uuid.uuid4().hex
                    room.pending_commands[command_id] = _PendingCommand(
                        command_id=command_id,
                        sender_device_id=conn.device_id,
                        target_device_id=target.device_id,
                        request_id=msg.request_id,
                        created_at_mono=now_mono,
                    )
                    command_frame = {
                        "type": "command",
                        "command_id": command_id,
                        "request_id": msg.request_id,
                        "from_device_id": conn.device_id,
                        "action": msg.action,
                        "payload": normalized_payload,
                    }

        if err is not None:
            await send_json(conn, err)
            return

        assert target is not None and command_frame is not None
        try:
            await send_json(target, command_frame)
        except Exception as exc:  # noqa: BLE001 — fail loud to sender
            with self._lock:
                room = self._rooms.get(conn.user_id)
                if room is not None:
                    room.pending_commands.pop(command_id, None)
            await send_json(
                conn,
                error_frame(
                    "device_unreachable",
                    f"Could not deliver command {msg.action!r} to device {target.name!r}: {exc}",
                    msg.request_id,
                ),
            )

    async def handle_command_ack(
        self, conn: DeviceConnection, msg: CommandAckMessage
    ) -> None:
        with self._lock:
            room = self._rooms.get(conn.user_id)
            if room is None or room.devices.get(conn.device_id) is not conn:
                return
            pending = room.pending_commands.get(msg.command_id)
            if pending is None or pending.target_device_id != conn.device_id:
                err = error_frame(
                    "unknown_command",
                    f"Unknown or expired command_id {msg.command_id!r}",
                )
                sender = None
                result_payload = None
            else:
                room.pending_commands.pop(msg.command_id, None)
                sender = room.devices.get(pending.sender_device_id)
                if not msg.ok and not (msg.error and msg.error.strip()):
                    err = error_frame(
                        "invalid_payload",
                        "Failed command_ack must include a non-empty error message",
                    )
                    result_error: str | None = (
                        "Remote device rejected command without providing an error message"
                    )
                else:
                    err = None
                    result_error = None if msg.ok else msg.error
                result_payload = {
                    "type": "command_result",
                    "request_id": pending.request_id,
                    "command_id": msg.command_id,
                    "ok": msg.ok,
                    "error": result_error,
                }

        if err is not None:
            await send_json(conn, err)
        if sender is not None and result_payload is not None:
            await _send_broadcast([sender], result_payload)

    def reset_for_tests(self) -> None:
        with self._lock:
            self._rooms.clear()
            self._tickets.clear()
            self.heartbeat_interval_sec = HEARTBEAT_INTERVAL_SEC
            self.heartbeat_timeout_sec = HEARTBEAT_TIMEOUT_SEC
            self.registration_timeout_sec = REGISTRATION_TIMEOUT_SEC


hub = ConnectHub()
