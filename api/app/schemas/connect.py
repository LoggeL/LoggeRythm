"""Schemas and strict WebSocket message validators for personal Connect mode."""
from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .track import Track

DeviceType = Literal["web", "mobile", "tablet", "desktop", "tv", "speaker", "other"]
QueueOrigin = Literal["manual", "context"]
RepeatMode = Literal["off", "all", "one"]
CommandAction = Literal[
    "play",
    "pause",
    "toggle",
    "next",
    "prev",
    "clear_queue",
    "seek",
    "set_volume",
    "set_mute",
    "set_shuffle",
    "set_repeat",
    "play_tracks",
    "queue_add",
    "queue_play_next",
    "queue_remove",
    "queue_reorder",
    "select_index",
]


def _require_non_blank(value: str, label: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError(f"{label} must not be blank")
    return cleaned


def _require_finite_non_negative(value: float, label: str) -> float:
    if not math.isfinite(value) or value < 0.0:
        raise ValueError(f"{label} must be a finite, non-negative number")
    return float(value)


def _require_valid_track(track: Track, label: str = "track") -> Track:
    if not track.id or not track.id.strip():
        raise ValueError(f"{label}.id must be a non-empty string")
    return track


class DeviceCapabilities(BaseModel):
    can_play_audio: bool = True
    can_control_volume: bool = True


class ConnectDeviceOut(BaseModel):
    device_id: str
    name: str
    device_type: DeviceType
    capabilities: DeviceCapabilities = Field(default_factory=DeviceCapabilities)
    volume: float = Field(default=1.0, ge=0.0, le=1.0)
    muted: bool = False
    is_active: bool = False
    party_code: str | None = None
    connected_at: str
    last_seen_at: str


class ConnectPlaybackInput(BaseModel):
    queue: list[Track] = Field(default_factory=list)
    origins: list[QueueOrigin] | None = None
    queue_context: str | None = None
    current_index: int = -1
    is_playing: bool = False
    position_sec: float = 0.0
    duration_sec: float = 0.0
    shuffle: bool = False
    repeat: RepeatMode = "off"
    volume: float | None = Field(default=None, ge=0.0, le=1.0)
    muted: bool | None = None

    @field_validator("position_sec")
    @classmethod
    def _validate_position(cls, value: float) -> float:
        return _require_finite_non_negative(value, "position_sec")

    @field_validator("duration_sec")
    @classmethod
    def _validate_duration(cls, value: float) -> float:
        return _require_finite_non_negative(value, "duration_sec")

    @field_validator("volume")
    @classmethod
    def _validate_volume(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("volume must be finite")
        return value

    @model_validator(mode="after")
    def _validate_consistency(self) -> "ConnectPlaybackInput":
        for idx, track in enumerate(self.queue):
            _require_valid_track(track, f"queue[{idx}]")
        if self.current_index < -1 or self.current_index >= len(self.queue):
            raise ValueError(
                f"current_index {self.current_index} is outside the {len(self.queue)}-track queue"
            )
        if self.is_playing and self.current_index == -1:
            raise ValueError("Playback cannot be playing without a selected track")
        if self.origins is not None and len(self.origins) != len(self.queue):
            raise ValueError(
                f"origins length ({len(self.origins)}) must match queue length ({len(self.queue)})"
            )
        return self


class ConnectPlaybackState(BaseModel):
    queue: list[Track] = Field(default_factory=list)
    origins: list[QueueOrigin] = Field(default_factory=list)
    queue_context: str | None = None
    current_index: int = -1
    is_playing: bool = False
    position_sec: float = 0.0
    duration_sec: float = 0.0
    shuffle: bool = False
    repeat: RepeatMode = "off"
    volume: float = Field(default=1.0, ge=0.0, le=1.0)
    muted: bool = False
    updated_at: str | None = None


class ConnectStateOut(BaseModel):
    revision: int = 0
    active_device_id: str | None = None
    devices: list[ConnectDeviceOut] = Field(default_factory=list)
    playback: ConnectPlaybackState = Field(default_factory=ConnectPlaybackState)
    server_time: str


class ConnectTicketOut(BaseModel):
    ticket: str
    expires_in_sec: int


class RestConnectCommandIn(BaseModel):
    action: CommandAction
    payload: dict[str, Any] = Field(default_factory=dict)
    target_device_id: str | None = Field(default=None, max_length=64)
    timeout_sec: float = Field(default=5.0, ge=0.5, le=15.0)


class RestConnectCommandOut(BaseModel):
    command_id: str
    target_device_id: str
    ok: bool
    error: str | None = None


class RestConnectTransferIn(BaseModel):
    target_device_id: str = Field(min_length=1, max_length=64)
    play: bool | None = None

    @field_validator("target_device_id")
    @classmethod
    def _validate_rest_target(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("target_device_id must not be blank")
        return stripped


# --- Incoming WebSocket message schemas -----------------------------------


class RegisterMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["register"]
    device_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    device_type: DeviceType
    capabilities: DeviceCapabilities = Field(default_factory=DeviceCapabilities)
    volume: float = Field(default=1.0, ge=0.0, le=1.0)
    muted: bool = False
    party_code: str | None = Field(default=None, max_length=16)
    take_active: bool = False
    playback: ConnectPlaybackInput | None = None

    @field_validator("device_id")
    @classmethod
    def _validate_device_id(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("device_id must not be blank")
        return stripped

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return _require_non_blank(value, "name")

    @field_validator("volume")
    @classmethod
    def _validate_volume(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("volume must be finite")
        return value


class UpdateDeviceMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["update_device"]
    name: str | None = Field(default=None, min_length=1, max_length=80)
    volume: float | None = Field(default=None, ge=0.0, le=1.0)
    muted: bool | None = None
    party_code: str | None = Field(default=None, max_length=16)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _require_non_blank(value, "name")

    @field_validator("volume")
    @classmethod
    def _validate_volume(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("volume must be finite")
        return value


class PlaybackStateMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["playback_state"]
    claim_active: bool = False
    state: ConnectPlaybackInput


class TransferMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["transfer"]
    target_device_id: str = Field(min_length=1, max_length=64)
    play: bool | None = None
    request_id: str | None = Field(default=None, max_length=64)

    @field_validator("target_device_id")
    @classmethod
    def _validate_target(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("target_device_id must not be blank")
        return stripped


class CommandMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["command"]
    request_id: str | None = Field(default=None, max_length=64)
    target_device_id: str | None = Field(default=None, max_length=64)
    action: CommandAction
    payload: dict[str, Any] = Field(default_factory=dict)


class CommandAckMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["command_ack"]
    command_id: str = Field(min_length=1, max_length=64)
    ok: bool
    error: str | None = None


# --- Per-action command payload models ------------------------------------


class _EmptyPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _SeekPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position_sec: float

    @field_validator("position_sec")
    @classmethod
    def _validate_position(cls, value: float) -> float:
        return _require_finite_non_negative(value, "position_sec")


class _SetVolumePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    volume: float = Field(ge=0.0, le=1.0)

    @field_validator("volume")
    @classmethod
    def _validate_volume(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("volume must be finite")
        return value


class _SetMutePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    muted: bool


class _SetShufflePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shuffle: bool


class _SetRepeatPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repeat: RepeatMode


class _PlayTracksPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tracks: list[Track] = Field(min_length=1)
    start_index: int = Field(default=0, ge=0)
    queue_context: str | None = None
    origins: list[QueueOrigin] | None = None

    @model_validator(mode="after")
    def _validate_tracks(self) -> "_PlayTracksPayload":
        for idx, track in enumerate(self.tracks):
            _require_valid_track(track, f"tracks[{idx}]")
        if self.start_index >= len(self.tracks):
            raise ValueError(
                f"start_index {self.start_index} is outside {len(self.tracks)} tracks"
            )
        if self.origins is not None and len(self.origins) != len(self.tracks):
            raise ValueError(
                f"origins length ({len(self.origins)}) must match tracks length ({len(self.tracks)})"
            )
        return self


class _QueueTrackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    track: Track

    @model_validator(mode="after")
    def _validate_track(self) -> "_QueueTrackPayload":
        _require_valid_track(self.track, "track")
        return self


class _IndexPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: int = Field(ge=0)


class _ReorderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_index: int = Field(ge=0)
    to_index: int = Field(ge=0)


_COMMAND_PAYLOAD_MODELS: dict[CommandAction, type[BaseModel]] = {
    "play": _EmptyPayload,
    "pause": _EmptyPayload,
    "toggle": _EmptyPayload,
    "next": _EmptyPayload,
    "prev": _EmptyPayload,
    "clear_queue": _EmptyPayload,
    "seek": _SeekPayload,
    "set_volume": _SetVolumePayload,
    "set_mute": _SetMutePayload,
    "set_shuffle": _SetShufflePayload,
    "set_repeat": _SetRepeatPayload,
    "play_tracks": _PlayTracksPayload,
    "queue_add": _QueueTrackPayload,
    "queue_play_next": _QueueTrackPayload,
    "queue_remove": _IndexPayload,
    "queue_reorder": _ReorderPayload,
    "select_index": _IndexPayload,
}


def validate_command_payload(action: CommandAction, payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize a Connect remote-command payload."""
    model_cls = _COMMAND_PAYLOAD_MODELS[action]
    validated = model_cls.model_validate(payload)
    # mode="json" guarantees every nested Track carries all canonical schema fields.
    return validated.model_dump(mode="json")
