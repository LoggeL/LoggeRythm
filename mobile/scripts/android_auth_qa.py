#!/usr/bin/env python3
"""Deterministic, secret-safe Android authentication acceptance QA.

The public seam is intentionally small: callers provide the candidate APK, an
emulator, and an evidence directory.  This module owns the disposable v2
backend, HTTPS quick tunnel, generated identities, fixed scenario plan, native
UI interaction, privacy checks, and teardown.

No production credential is accepted.  Generated credentials and invites live
only in memory and reach Android solely through ``adb shell sh`` stdin.  Raw
UIAutomator XML is parsed in memory and deleted from the device immediately.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from enum import Enum
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Callable, Iterable, Mapping, NoReturn, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


PACKAGE = "top.logge.loggerythm"
ACTIVITY = f"{PACKAGE}/.MainActivity"
PRODUCTION_ORIGIN = "https://loggerythm.logge.top"
REMOTE_UI_DUMP = "/data/local/tmp/loggerythm-auth-qa-window.xml"
TAB_TEST_IDS = ("tab-home", "tab-search", "tab-discover", "tab-radio", "tab-library")
RELATIVE_INVITE_MARKER = "qa-relative-marker"


class AuthQaFailure(RuntimeError):
    """Base class for classified acceptance failures."""


class CandidateFailure(AuthQaFailure):
    """The candidate APK violated an observable acceptance criterion."""


class _DisabledControlFailure(CandidateFailure):
    """A required native control exists but cannot currently be activated."""


class InfrastructureFailure(AuthQaFailure):
    """ADB, emulator, server, TLS tunnel, or filesystem infrastructure failed."""


class PrivacyFailure(AuthQaFailure):
    """A secret would have crossed the evidence boundary."""


@dataclass(frozen=True)
class AuthQaRequest:
    """Everything a caller may select for one Android auth acceptance run."""

    apk: Path
    serial: str
    evidence_dir: Path
    adb_path: Path | None = None
    cloudflared_path: Path | None = None
    deadline_seconds: float = 1_200.0


class AuthScenario(str, Enum):
    PRODUCTION_DEFAULT = "production_default"
    INCOMPATIBLE_PREFLIGHT = "incompatible_preflight"
    INVALID_LOGIN = "invalid_login"
    VALID_LOGIN = "valid_login"
    STORED_SESSION_RESTORE = "stored_session_restore"
    LOGOUT_PRODUCTION_RESET = "logout_production_reset"
    RELATIVE_INVITE_REGISTRATION = "relative_invite_registration"
    PENDING_RESTORE_RETRY_FORGET = "pending_restore_retry_forget"
    PENDING_APPROVAL_RECHECK = "pending_approval_recheck"
    FORBIDDEN_RETRY = "forbidden_retry"
    UNAUTHORIZED_CLEANUP = "unauthorized_cleanup"
    CRASH_PRIVACY_AUDIT = "crash_privacy_audit"


AUTH_SCENARIO_SEQUENCE: tuple[AuthScenario, ...] = tuple(AuthScenario)
DEFERRED_SCENARIOS = (
    "root_filesystem_cleanup_forensics",
)


@dataclass(frozen=True)
class ScenarioResult:
    scenario: str
    status: str
    checks: tuple[str, ...]


@dataclass(frozen=True)
class ApiEvent:
    sequence: int
    method: str
    path: str
    status: int


@dataclass(frozen=True)
class AuthQaReport:
    status: str
    apk_sha256: str
    serial: str
    started_at_utc: str
    completed_at_utc: str
    scenarios: tuple[ScenarioResult, ...]
    deferred_scenarios: tuple[str, ...]
    api_events: tuple[ApiEvent, ...]
    crash_free: bool
    teardown_complete: bool
    failure_kind: str | None
    failure_message: str | None
    evidence_path: Path

    def to_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["evidence_path"] = self.evidence_path.name
        return value


@dataclass(frozen=True)
class _GeneratedSecrets:
    approved_email: str
    approved_password: str
    invalid_password: str
    invited_email: str
    invited_password: str
    pending_email: str
    pending_password: str
    approval_email: str
    approval_password: str

    @classmethod
    def create(cls) -> _GeneratedSecrets:
        token = secrets.token_hex(8)

        def email(label: str) -> str:
            return f"android-qa-{label}-{token}@example.test"

        def password() -> str:
            return f"Qa{secrets.token_hex(18)}"

        return cls(
            approved_email=email("approved"),
            approved_password=password(),
            invalid_password=password(),
            invited_email=email("invited"),
            invited_password=password(),
            pending_email=email("pending"),
            pending_password=password(),
            approval_email=email("approval"),
            approval_password=password(),
        )

    def values(self) -> tuple[str, ...]:
        return tuple(str(value) for value in asdict(self).values())


class _Deadline:
    def __init__(self, seconds: float) -> None:
        if not 60 <= seconds <= 7_200:
            raise InfrastructureFailure("deadline_seconds must be between 60 and 7200")
        self._end = time.monotonic() + seconds

    def remaining(self, cap: float | None = None) -> float:
        value = self._end - time.monotonic()
        if value <= 0:
            raise InfrastructureFailure("The Android authentication QA deadline expired")
        return value if cap is None else min(value, cap)


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_executable(explicit: Path | None, name: str, fallbacks: Sequence[Path]) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit.expanduser())
    else:
        located = shutil.which(name)
        if located is not None:
            candidates.append(Path(located))
        candidates.extend(fallbacks)
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_file() and os.access(resolved, os.X_OK):
            return resolved
    raise InfrastructureFailure(f"{name} is unavailable; pass its explicit executable path")


def _resolve_adb(explicit: Path | None) -> Path:
    fallbacks: list[Path] = []
    sdk = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if sdk:
        fallbacks.append(Path(sdk) / "platform-tools" / "adb")
    fallbacks.append(Path.home() / "Library" / "Android" / "sdk" / "platform-tools" / "adb")
    return _resolve_executable(explicit, "adb", fallbacks)


def _resolve_cloudflared(explicit: Path | None) -> Path:
    return _resolve_executable(
        explicit,
        "cloudflared",
        (Path("/opt/homebrew/bin/cloudflared"), Path("/usr/local/bin/cloudflared")),
    )


def _run_command(
    command: Sequence[str],
    *,
    timeout: float,
    check: bool = True,
    stdin: str | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            list(command),
            check=False,
            capture_output=True,
            text=True,
            input=stdin,
            timeout=max(0.1, timeout),
        )
    except (OSError, subprocess.TimeoutExpired) as cause:
        raise InfrastructureFailure(f"Could not run {Path(command[0]).name}") from cause
    if check and result.returncode != 0:
        # stdout/stderr can contain arbitrary device state.  Never copy it into
        # a QA exception or evidence file.
        raise InfrastructureFailure(
            f"{Path(command[0]).name} exited with status {result.returncode}",
        )
    return result


def _resource_suffix(resource_id: str) -> str | None:
    marker = ":id/"
    if marker in resource_id:
        package, suffix = resource_id.rsplit(marker, 1)
        return suffix if package == PACKAGE and suffix else None
    if re.fullmatch(r"[a-z0-9][a-z0-9._:-]*", resource_id):
        return resource_id
    return None


def project_node_metadata(attributes: Mapping[str, str]) -> dict[str, str]:
    """Return only fields that cannot carry form or account content."""

    allowed = ("resource-id", "clickable", "enabled", "bounds", "focused")
    return {key: attributes.get(key, "") for key in allowed}


def _node_bounds(node: Mapping[str, str], label: str) -> tuple[int, int, int, int]:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    if match is None:
        raise CandidateFailure(f"testID {label!r} reported invalid native bounds")
    left, top, right, bottom = (int(value) for value in match.groups())
    if left >= right or top >= bottom:
        raise CandidateFailure(f"testID {label!r} reported empty native bounds")
    return left, top, right, bottom


def _input_text_script(value: str) -> str:
    """Build stdin-only Android input commands without a full secret token."""

    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in value):
        raise InfrastructureFailure("Generated form data contains a control character")
    commands = ["set -eu"]
    for character in value:
        encoded = "%s" if character == " " else character
        commands.append(f"input text {shlex.quote(encoded)}")
    return "\n".join(commands) + "\n"


class _SafeAdb:
    """Android adapter with a strict non-text evidence boundary."""

    def __init__(self, adb: Path, serial: str, deadline: _Deadline) -> None:
        if not serial or not re.fullmatch(r"[A-Za-z0-9._:-]+", serial):
            raise InfrastructureFailure("serial must be a non-empty adb device identifier")
        self.adb_path = adb
        self.serial = serial
        self.deadline = deadline
        self.pid = ""

    def _adb(
        self,
        arguments: Sequence[str],
        *,
        check: bool = True,
        timeout: float = 120,
        stdin: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return _run_command(
            (str(self.adb_path), "-s", self.serial, *arguments),
            timeout=self.deadline.remaining(timeout),
            check=check,
            stdin=stdin,
        )

    def assert_device(self) -> None:
        result = _run_command(
            (str(self.adb_path), "devices", "-l"),
            timeout=self.deadline.remaining(30),
        )
        devices = {
            fields[0]: fields[1]
            for line in result.stdout.splitlines()[1:]
            if len(fields := line.split()) >= 2
        }
        if devices.get(self.serial) != "device":
            raise InfrastructureFailure("The requested adb device is not online")

    def install_and_launch(self, apk: Path) -> None:
        self.assert_device()
        self._adb(("uninstall", PACKAGE), check=False, timeout=120)
        result = self._adb(("install", "--no-streaming", str(apk)), timeout=240)
        if "Success" not in result.stdout:
            raise InfrastructureFailure("adb did not confirm APK installation")
        self._adb(("shell", "am", "force-stop", PACKAGE), timeout=30)
        self.launch()

    def launch(self) -> None:
        result = self._adb(("shell", "am", "start", "-W", "-n", ACTIVITY), timeout=60)
        if "Status: ok" not in result.stdout:
            raise InfrastructureFailure("Android did not confirm the LoggeRythm activity launch")
        for _ in range(30):
            pid = self._adb(
                ("shell", "pidof", "-s", PACKAGE),
                check=False,
                timeout=10,
            ).stdout.strip()
            if pid:
                self.pid = pid
                return
            time.sleep(0.25)
        raise CandidateFailure("The LoggeRythm process did not remain alive after launch")

    def restart(self) -> None:
        self._adb(("shell", "am", "force-stop", PACKAGE), timeout=30)
        time.sleep(0.5)
        self.pid = ""
        self.launch()

    def _delete_remote_ui_dump(self) -> None:
        removed = self._adb(
            ("shell", "rm", "-f", REMOTE_UI_DUMP),
            check=False,
            timeout=10,
        )
        remaining = self._adb(
            ("shell", "ls", REMOTE_UI_DUMP),
            check=False,
            timeout=10,
        )
        if removed.returncode != 0 or remaining.returncode == 0:
            raise PrivacyFailure("Device-side UI evidence cleanup failed")

    def _raw_nodes(self, phase: str) -> list[dict[str, str]]:
        """Read raw nodes transiently, always deleting the device-side XML."""

        readback: subprocess.CompletedProcess[str] | None = None
        for attempt in range(1, 4):
            try:
                dumped = self._adb(
                    ("shell", "uiautomator", "dump", "--compressed", REMOTE_UI_DUMP),
                    check=False,
                    timeout=20,
                )
                if dumped.returncode == 0:
                    candidate = self._adb(
                        ("exec-out", "cat", REMOTE_UI_DUMP),
                        check=False,
                        timeout=15,
                    )
                    if candidate.returncode == 0:
                        readback = candidate
                        break
            finally:
                self._delete_remote_ui_dump()
            if attempt < 3:
                time.sleep(0.4)
        if readback is None:
            raise InfrastructureFailure(f"UIAutomator was unavailable during {phase}")
        try:
            root = ET.fromstring(readback.stdout)
        except ET.ParseError as cause:
            raise InfrastructureFailure(f"UIAutomator returned invalid XML during {phase}") from cause
        return [dict(node.attrib) for node in root.iter("node")]

    def safe_metadata(self, phase: str) -> tuple[dict[str, str], ...]:
        return tuple(project_node_metadata(node) for node in self._raw_nodes(phase))

    def _visible_suffixes(self, phase: str) -> set[str]:
        return {
            suffix
            for node in self.safe_metadata(phase)
            if (suffix := _resource_suffix(node.get("resource-id", ""))) is not None
        }

    @staticmethod
    def _gate(suffixes: set[str]) -> str:
        if set(TAB_TEST_IDS).issubset(suffixes):
            return "authenticated"
        if "approval-screen" in suffixes:
            return "pending"
        if "session-restore-error" in suffixes:
            return "restore_error"
        if "login-submit" in suffixes or "auth-mode-toggle" in suffixes:
            return "signed_out"
        return "starting"

    def wait_gate(self, expected: str, phase: str, timeout: float = 45) -> None:
        end = time.monotonic() + min(timeout, self.deadline.remaining())
        last = "starting"
        while time.monotonic() < end:
            pid = self._adb(
                ("shell", "pidof", "-s", PACKAGE),
                check=False,
                timeout=10,
            ).stdout.strip()
            if not pid:
                raise CandidateFailure(f"The app process died while waiting for {phase}")
            last = self._gate(self._visible_suffixes(phase))
            if last == expected:
                return
            time.sleep(0.5)
        raise CandidateFailure(f"{phase} reached gate {last!r}, expected {expected!r}")

    def wait_signed_out(self, phase: str = "signed-out") -> None:
        self.wait_gate("signed_out", phase)

    def wait_authenticated(self, phase: str = "authenticated") -> None:
        self.wait_gate("authenticated", phase, timeout=60)

    def wait_pending(self, phase: str = "pending") -> None:
        self.wait_gate("pending", phase)

    def wait_restore_error(self, phase: str = "restore-error") -> None:
        self.wait_gate("restore_error", phase)

    def _screen_size(self) -> tuple[int, int]:
        result = self._adb(("shell", "wm", "size"), timeout=20)
        matches = re.findall(r"(\d+)x(\d+)", result.stdout)
        if not matches:
            raise InfrastructureFailure("Android did not report a screen size")
        width, height = (int(value) for value in matches[-1])
        return width, height

    def _swipe(self, direction: str) -> None:
        width, height = self._screen_size()
        x = width // 2
        if direction == "down":
            start_y, end_y = int(height * 0.30), int(height * 0.78)
        else:
            start_y, end_y = int(height * 0.78), int(height * 0.30)
        self._adb(
            (
                "shell",
                "input",
                "swipe",
                str(x),
                str(start_y),
                str(x),
                str(end_y),
                "240",
            ),
            timeout=20,
        )
        time.sleep(0.25)

    def _scroll_to_top(self) -> None:
        for _ in range(4):
            self._swipe("down")

    @staticmethod
    def _find_raw(
        nodes: Iterable[Mapping[str, str]],
        suffix: str,
        *,
        interactive: bool,
    ) -> dict[str, str] | None:
        for node in nodes:
            if _resource_suffix(node.get("resource-id", "")) != suffix:
                continue
            if interactive and (
                node.get("enabled") != "true" or node.get("clickable") != "true"
            ):
                continue
            bounds = node.get("bounds", "")
            if bounds == "[0,0][0,0]":
                continue
            return dict(node)
        return None

    def _find_with_scroll(
        self,
        suffix: str,
        phase: str,
        *,
        interactive: bool,
        direction: str = "up",
        swipes: int = 7,
    ) -> dict[str, str]:
        for attempt in range(swipes + 1):
            nodes = self._raw_nodes(f"{phase}-{attempt:02d}")
            node = self._find_raw(nodes, suffix, interactive=interactive)
            if node is not None:
                return node
            if interactive and self._find_raw(nodes, suffix, interactive=False) is not None:
                raise _DisabledControlFailure(
                    f"Required testID {suffix!r} was present but disabled during {phase}",
                )
            if attempt < swipes:
                self._swipe(direction)
        raise CandidateFailure(f"Required testID {suffix!r} was absent during {phase}")

    def _wait_and_tap(
        self,
        suffix: str,
        phase: str,
        *,
        direction: str = "up",
        attempts: int = 8,
        interval: float = 0.25,
        swipes: int = 7,
    ) -> None:
        if attempts < 1:
            raise InfrastructureFailure("Native control wait attempts must be positive")
        saw_disabled = False
        for attempt in range(attempts):
            try:
                node = self._find_with_scroll(
                    suffix,
                    f"{phase}-ready-{attempt:02d}",
                    interactive=True,
                    direction=direction,
                    swipes=swipes if attempt == 0 else 0,
                )
            except _DisabledControlFailure:
                saw_disabled = True
                if attempt + 1 == attempts:
                    raise CandidateFailure(
                        f"Required testID {suffix!r} remained present but disabled during {phase}",
                    ) from None
                if interval > 0:
                    time.sleep(interval)
                continue
            except CandidateFailure:
                if attempt + 1 == attempts:
                    state = "present but disabled" if saw_disabled else "absent"
                    raise CandidateFailure(
                        f"Required testID {suffix!r} remained {state} during {phase}",
                    ) from None
                if interval > 0:
                    time.sleep(interval)
                continue
            self._tap_node(suffix, node)
            return
        raise InfrastructureFailure("Native control wait retry invariant failed")

    def _wait_for_present(
        self,
        suffix: str,
        phase: str,
        *,
        direction: str = "up",
        attempts: int = 8,
        interval: float = 0.25,
        swipes: int = 7,
    ) -> dict[str, str]:
        if attempts < 1:
            raise InfrastructureFailure("Native control presence attempts must be positive")
        for attempt in range(attempts):
            try:
                return self._find_with_scroll(
                    suffix,
                    f"{phase}-present-{attempt:02d}",
                    interactive=False,
                    direction=direction,
                    swipes=swipes if attempt == 0 else 0,
                )
            except CandidateFailure:
                if attempt + 1 == attempts:
                    raise CandidateFailure(
                        f"Required testID {suffix!r} remained absent during {phase}",
                    ) from None
                if interval > 0:
                    time.sleep(interval)
        raise InfrastructureFailure("Native control presence retry invariant failed")

    def _tap_node(self, suffix: str, node: Mapping[str, str]) -> None:
        if _resource_suffix(node.get("resource-id", "")) != suffix:
            raise CandidateFailure("A native testID changed before interaction")
        left, top, right, bottom = _node_bounds(node, suffix)
        self._adb(
            ("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2)),
            timeout=20,
        )

    def tap(self, suffix: str, phase: str, *, direction: str = "up") -> None:
        node = self._find_with_scroll(
            suffix,
            phase,
            interactive=True,
            direction=direction,
        )
        self._tap_node(suffix, node)

    def _shell_stdin(self, script: str) -> None:
        # The complete script is never present in argv, environment, logs, or
        # evidence.  It is consumed by the device shell directly from stdin.
        self._adb(("shell", "sh"), timeout=120, stdin=script)

    def _acquire_field_focus(
        self,
        suffix: str,
        *,
        direction: str,
        tap_attempts: int = 3,
        polls_per_tap: int = 2,
        interval: float = 0.2,
    ) -> dict[str, str]:
        if tap_attempts < 1 or polls_per_tap < 1:
            raise InfrastructureFailure("Native field focus retry limits must be positive")
        node = self._find_with_scroll(
            suffix,
            f"{suffix}-focus-target",
            interactive=True,
            direction=direction,
        )
        swipe_used = False
        for tap_attempt in range(tap_attempts):
            self._tap_node(suffix, node)
            for poll in range(polls_per_tap):
                if interval > 0:
                    time.sleep(interval)
                nodes = self._raw_nodes(
                    f"{suffix}-focus-{tap_attempt:02d}-{poll:02d}",
                )
                candidate = self._find_raw(nodes, suffix, interactive=True)
                if candidate is None:
                    continue
                node = candidate
                if candidate.get("focused") == "true":
                    return candidate
            if tap_attempt + 1 < tap_attempts:
                if not swipe_used:
                    self._swipe(direction)
                    swipe_used = True
                try:
                    node = self._find_with_scroll(
                        suffix,
                        f"{suffix}-focus-retry-{tap_attempt:02d}",
                        interactive=True,
                        direction=direction,
                        swipes=0,
                    )
                except CandidateFailure:
                    # Retain the last safe native bounds for the bounded retry.
                    # The final error deliberately exposes only the testID.
                    pass
        raise CandidateFailure(f"Android did not focus required testID {suffix!r}")

    def _enter_field(
        self,
        suffix: str,
        value: str,
        phase: str,
        *,
        direction: str = "up",
        verify: bool,
    ) -> None:
        entry_attempts = 2 if verify else 1
        for entry_attempt in range(entry_attempts):
            focused = self._acquire_field_focus(suffix, direction=direction)
            current = focused.get("text", "")
            if current and current == focused.get("hint", ""):
                current = ""
            clear_count = max(len(current), 140 if focused.get("password") == "true" else 1)
            clear_script = (
                "set -eu\n"
                "input keyevent KEYCODE_MOVE_END\n"
                + "\n".join("input keyevent KEYCODE_DEL" for _ in range(clear_count))
                + "\n"
            )
            self._shell_stdin(clear_script)
            if value:
                self._shell_stdin(_input_text_script(value))
            if not verify or self._field_value_matches(
                suffix,
                value,
                f"{phase}-verify-{entry_attempt:02d}",
            ):
                return
        raise CandidateFailure(f"Android did not retain the exact {suffix!r} field value")

    def _field_value_matches(self, suffix: str, expected: str, phase: str) -> bool:
        # Text is compared only in memory and reduced to one boolean.  It never
        # crosses the evidence boundary.
        node = self._find_with_scroll(
            suffix,
            phase,
            interactive=False,
            direction="up",
            swipes=7,
        )
        actual = node.get("text", "")
        if actual and actual == node.get("hint", ""):
            actual = ""
        return secrets.compare_digest(actual, expected)

    def _field_text_contains(self, suffix: str, expected: str, phase: str) -> bool:
        node = self._find_with_scroll(
            suffix,
            phase,
            interactive=False,
            direction="up",
            swipes=10,
        )
        return expected in node.get("text", "")

    def dismiss_keyboard(self) -> None:
        self._adb(("shell", "input", "keyevent", "KEYCODE_BACK"), timeout=20)
        time.sleep(0.5)

    def assert_production_default(self) -> None:
        self._scroll_to_top()
        if not self._field_value_matches(
            "login-server",
            PRODUCTION_ORIGIN,
            "production-origin",
        ):
            raise CandidateFailure("The signed-out server field did not reset to production")

    def configure_server(self, origin: str) -> None:
        self._scroll_to_top()
        self._enter_field(
            "login-server",
            origin,
            "custom-server",
            direction="down",
            verify=True,
        )

    def submit_login(self, email: str, password: str) -> None:
        self._scroll_to_top()
        self._enter_field("login-email", email, "login-email", verify=True)
        self._enter_field("login-password", password, "login-password", verify=False)
        self.dismiss_keyboard()
        self._wait_and_tap("login-submit", "login-submit")

    def open_relative_invite(self) -> None:
        # This fixed marker is deliberately non-secret.  The real invite is
        # entered separately through shell stdin and never appears in argv.
        url = f"loggerythm://register?invite={RELATIVE_INVITE_MARKER}"
        result = self._adb(
            (
                "shell",
                "am",
                "start",
                "-W",
                "-a",
                "android.intent.action.VIEW",
                "-c",
                "android.intent.category.BROWSABLE",
                "-d",
                url,
                "-p",
                PACKAGE,
            ),
            timeout=60,
        )
        if "Status: ok" not in result.stdout:
            raise CandidateFailure("The relative registration deep link did not launch")
        self._find_with_scroll(
            "register-submit",
            "relative-register-mode",
            interactive=False,
            direction="up",
        )

    def assert_relative_invite(self, origin: str) -> None:
        self._scroll_to_top()
        if not self._field_value_matches("login-server", origin, "relative-origin"):
            raise CandidateFailure("A relative invite changed the selected custom origin")
        if not self._field_value_matches(
            "register-invite",
            RELATIVE_INVITE_MARKER,
            "relative-invite-marker",
        ):
            raise CandidateFailure("The relative invite marker was not applied to registration")

    def enter_registration_mode(self) -> None:
        self._scroll_to_top()
        try:
            self._find_with_scroll(
                "register-submit",
                "registration-mode-existing",
                interactive=False,
                direction="up",
            )
            return
        except CandidateFailure:
            pass
        self._wait_and_tap(
            "auth-mode-toggle",
            "registration-mode",
            direction="up",
        )
        self._wait_for_present(
            "register-submit",
            "registration-mode-ready",
            direction="up",
        )

    def submit_registration(
        self,
        display_name: str,
        email: str,
        password: str,
        invite: str | None,
    ) -> None:
        self._scroll_to_top()
        self._enter_field(
            "register-display-name",
            display_name,
            "register-display-name",
            verify=True,
        )
        self._enter_field("login-email", email, "register-email", verify=True)
        self._enter_field("login-password", password, "register-password", verify=False)
        self.dismiss_keyboard()
        self._enter_field(
            "register-confirm-password",
            password,
            "register-confirm-password",
            verify=False,
        )
        self.dismiss_keyboard()
        self._enter_field(
            "register-invite",
            invite or "",
            "register-invite",
            verify=True,
        )
        self.dismiss_keyboard()
        self._wait_and_tap("register-submit", "register-submit", direction="up")

    def assert_pending_origin(self, origin: str) -> None:
        if not self._field_text_contains(
            "approval-server-origin",
            origin,
            "approval-origin",
        ):
            raise CandidateFailure("Pending approval did not render the full custom origin")

    def assert_profile_origin(self, origin: str) -> None:
        self.tap("profile-access", "open-profile")
        self._find_with_scroll(
            "profile-screen",
            "profile-screen",
            interactive=False,
            direction="up",
        )
        if not self._field_text_contains(
            "profile-server-origin",
            origin,
            "profile-origin",
        ):
            raise CandidateFailure("Profile did not render the full custom origin")
        self._adb(("shell", "input", "keyevent", "KEYCODE_BACK"), timeout=20)
        self.wait_authenticated("profile-back")

    def tap_logout(self) -> None:
        # Logout lives in Profile's native header, not in the five-tab roots.
        # Open that route explicitly so the acceptance flow does not depend on
        # stale navigation state from a preceding profile-origin assertion.
        self.tap("profile-access", "open-profile-for-logout")
        self._find_with_scroll(
            "profile-screen",
            "profile-before-logout",
            interactive=False,
            direction="up",
        )
        self.tap("logout-button", "logout", direction="down")

    def tap_recheck(self) -> None:
        self.tap("approval-recheck", "approval-recheck")

    def tap_session_retry(self) -> None:
        self.tap("session-retry", "session-retry")

    def tap_session_forget(self) -> None:
        self.tap("session-forget", "session-forget")

    def begin_crash_audit(self) -> str:
        self._adb(("shell", "am", "force-stop", PACKAGE), timeout=30)
        time.sleep(0.7)
        timestamp = self._adb(
            ("shell", "date", "+%m-%d_%H:%M:%S.000"),
            timeout=20,
        ).stdout.strip()
        if not re.fullmatch(r"\d{2}-\d{2}_\d{2}:\d{2}:\d{2}\.000", timestamp):
            raise InfrastructureFailure("Android did not provide a safe logcat boundary")
        self.pid = ""
        self.launch()
        return timestamp.replace("_", " ", 1)

    def assert_crash_free(self, since: str) -> None:
        self.wait_signed_out("crash-audit-signed-out")
        time.sleep(1)
        current_pid = self._adb(
            ("shell", "pidof", "-s", PACKAGE),
            check=False,
            timeout=10,
        ).stdout.strip()
        if not current_pid:
            raise CandidateFailure("The app process died during the final crash audit")
        logcat = self._adb(
            ("logcat", "-d", "-v", "threadtime", "-T", since),
            timeout=60,
        ).stdout
        if _app_crash_reason(logcat, current_pid) is not None:
            raise CandidateFailure("Logcat reported an app-scoped crash, ANR, or process death")

    def teardown(self) -> bool:
        # Remove generated credentials, cookies, cache, and origin selection
        # even after a failed assertion.  Leave the candidate installed but in
        # the same data-clean state as a fresh install.
        result = self._adb(("shell", "pm", "clear", PACKAGE), check=False, timeout=60)
        return result.returncode == 0 and "Success" in result.stdout


def _app_crash_reason(logcat: str, pid: str) -> str | None:
    for match in re.finditer(r"FATAL EXCEPTION", logcat):
        block = logcat[match.start() : match.start() + 6_000]
        if f"Process: {PACKAGE}" in block or f"PID: {pid}" in block:
            return "fatal exception"
    package = re.escape(PACKAGE)
    for pattern, label in (
        (rf"\bANR in {package}\b", "ANR"),
        (rf"\bForce finishing activity\b[^\n]*{package}", "force finish"),
        (rf"\bProcess {package}\b[^\n]*(?:has died|died)", "process death"),
        (rf"\bam_(?:anr|crash|proc_died)\b[^\n]*{package}", "app exit"),
    ):
        if re.search(pattern, logcat, flags=re.IGNORECASE):
            return label
    for index, line in enumerate(logcat.splitlines()):
        if "Fatal signal" not in line and "Abort message" not in line:
            continue
        lines = logcat.splitlines()
        context = "\n".join(lines[max(0, index - 30) : index + 160])
        if PACKAGE in context or re.search(rf"\bpid\s*[:=]?\s*{re.escape(pid)}\b", context):
            return "native fatal signal"
    return None


def _cloudflared_quick_tunnel_command(
    executable: Path,
    local_origin: str,
) -> tuple[str, ...]:
    return (
        str(executable),
        "tunnel",
        "--url",
        local_origin,
        "--no-autoupdate",
        "--protocol",
        "quic",
        "--loglevel",
        "info",
    )


@dataclass(frozen=True)
class _CloudflaredAttemptSignals:
    origin: str = ""
    registered: bool = False

    @property
    def ready_to_probe(self) -> bool:
        return bool(self.origin and self.registered)

    def consume(self, line: str) -> _CloudflaredAttemptSignals:
        match = _CloudflaredQuickTunnel.URL_PATTERN.search(line)
        origin = self.origin or (match.group(0).lower() if match is not None else "")
        registered = self.registered or "Registered tunnel connection" in line
        return _CloudflaredAttemptSignals(origin=origin, registered=registered)


class _CloudflaredQuickTunnel:
    URL_PATTERN = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.IGNORECASE)
    MAX_ATTEMPTS = 3
    REGISTRATION_PROPAGATION_SECONDS = 10.0
    READINESS_SECONDS = 90.0

    def __init__(self, executable: Path, local_origin: str, deadline: _Deadline) -> None:
        self.executable = executable
        self.local_origin = local_origin
        self.deadline = deadline
        self.process: subprocess.Popen[str] | None = None
        self.origin = ""
        self._lines: queue.Queue[str] = queue.Queue()
        self._threads: list[threading.Thread] = []

    def start(self) -> _CloudflaredQuickTunnel:
        for attempt in range(1, self.MAX_ATTEMPTS + 1):
            self.deadline.remaining()
            try:
                self._start_attempt()
                return self
            except InfrastructureFailure:
                self._close_attempt()
                if attempt == self.MAX_ATTEMPTS:
                    raise InfrastructureFailure(
                        "cloudflared could not establish a ready HTTPS quick tunnel "
                        f"after {self.MAX_ATTEMPTS} attempts",
                    ) from None
        raise InfrastructureFailure("cloudflared quick-tunnel retry invariant failed")

    def _start_attempt(self) -> None:
        command = _cloudflared_quick_tunnel_command(
            self.executable,
            self.local_origin,
        )
        try:
            self.process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env={key: value for key, value in os.environ.items() if "LOGGERYTHM" not in key},
            )
        except OSError as cause:
            raise InfrastructureFailure("cloudflared could not start") from cause

        def drain(stream: Any) -> None:
            try:
                for line in stream:
                    self._lines.put(line)
            finally:
                stream.close()

        for stream in (self.process.stdout, self.process.stderr):
            if stream is None:
                continue
            thread = threading.Thread(target=drain, args=(stream,), daemon=True)
            thread.start()
            self._threads.append(thread)

        signals = _CloudflaredAttemptSignals()
        end = time.monotonic() + self.deadline.remaining(45)
        while time.monotonic() < end:
            if self.process.poll() is not None:
                raise InfrastructureFailure("cloudflared exited before publishing HTTPS")
            try:
                line = self._lines.get(timeout=0.25)
            except queue.Empty:
                continue
            signals = signals.consume(line)
            if signals.ready_to_probe:
                self.origin = signals.origin
                time.sleep(self.REGISTRATION_PROPAGATION_SECONDS)
                self._wait_ready()
                return
        raise InfrastructureFailure("cloudflared did not register a quick-tunnel origin")

    def _wait_ready(self) -> None:
        end = time.monotonic() + self.deadline.remaining(self.READINESS_SECONDS)
        while time.monotonic() < end:
            request = Request(
                f"{self.origin}/api/version",
                headers={"Accept": "application/json", "Cache-Control": "no-store"},
            )
            try:
                with urlopen(request, timeout=min(8, self.deadline.remaining())) as response:
                    if response.status == 200:
                        response.read(64 * 1024)
                        return
            except (HTTPError, URLError, TimeoutError, OSError):
                pass
            time.sleep(0.5)
        raise InfrastructureFailure("The HTTPS quick tunnel never reached the disposable server")

    def close(self) -> None:
        self._close_attempt()

    def _close_attempt(self) -> None:
        process = self.process
        threads = tuple(self._threads)
        cleanup_failed = False
        try:
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        except BaseException:  # noqa: BLE001 - cleanup must stay redacted
            cleanup_failed = True
            if process is not None:
                try:
                    process.kill()
                    process.wait(timeout=5)
                except BaseException:
                    pass
        for thread in threads:
            try:
                thread.join(timeout=1)
                cleanup_failed = thread.is_alive() or cleanup_failed
            except BaseException:  # noqa: BLE001 - cleanup must stay redacted
                cleanup_failed = True
        self.process = None
        self.origin = ""
        self._threads = []
        self._lines = queue.Queue()
        if cleanup_failed:
            raise InfrastructureFailure("cloudflared quick-tunnel cleanup failed")


def _ledger_events(server: Any) -> tuple[ApiEvent, ...]:
    events: list[ApiEvent] = []
    for entry in tuple(server.ledger):
        events.append(
            ApiEvent(
                sequence=int(entry.sequence),
                method=str(entry.method).upper(),
                path=str(entry.path),
                status=int(entry.status),
            ),
        )
    return tuple(events)


def _wait_for_event(
    server: Any,
    after: int,
    predicate: Callable[[ApiEvent], bool],
    deadline: _Deadline,
    label: str,
) -> ApiEvent:
    end = time.monotonic() + deadline.remaining(30)
    while time.monotonic() < end:
        events = _ledger_events(server)[after:]
        match = next((event for event in events if predicate(event)), None)
        if match is not None:
            return match
        time.sleep(0.2)
    raise CandidateFailure(f"The disposable server did not observe {label}")


def _assert_no_event(
    server: Any,
    after: int,
    predicate: Callable[[ApiEvent], bool],
    label: str,
) -> None:
    if any(predicate(event) for event in _ledger_events(server)[after:]):
        raise CandidateFailure(f"The disposable server unexpectedly observed {label}")


def _run_scenario_plan(
    actions: Mapping[AuthScenario, Callable[[], tuple[str, ...]]],
    record: Callable[[AuthScenario, Callable[[], tuple[str, ...]]], None],
) -> None:
    if set(actions) != set(AUTH_SCENARIO_SEQUENCE):
        raise InfrastructureFailure("The fixed auth QA scenario plan is incomplete")
    for scenario in AUTH_SCENARIO_SEQUENCE:
        record(scenario, actions[scenario])


class _AuthQaEngine:
    def __init__(
        self,
        request: AuthQaRequest,
        deadline: _Deadline,
        server: Any,
        tunnel: _CloudflaredQuickTunnel,
        device: _SafeAdb,
        generated: _GeneratedSecrets,
    ) -> None:
        self.request = request
        self.deadline = deadline
        self.server = server
        self.tunnel = tunnel
        self.device = device
        self.generated = generated
        self.results: list[ScenarioResult] = []
        self.invite = ""
        self.crash_free = False

    def _record(self, scenario: AuthScenario, action: Callable[[], tuple[str, ...]]) -> None:
        try:
            checks = action()
        except Exception:
            self.results.append(ScenarioResult(scenario.value, "failed", ()))
            raise
        self.results.append(ScenarioResult(scenario.value, "passed", checks))

    def run(self) -> None:
        actions: dict[AuthScenario, Callable[[], tuple[str, ...]]] = {
            AuthScenario.PRODUCTION_DEFAULT: self._production_default,
            AuthScenario.INCOMPATIBLE_PREFLIGHT: self._incompatible_preflight,
            AuthScenario.INVALID_LOGIN: self._invalid_login,
            AuthScenario.VALID_LOGIN: self._valid_login,
            AuthScenario.STORED_SESSION_RESTORE: self._stored_session_restore,
            AuthScenario.LOGOUT_PRODUCTION_RESET: self._logout_production_reset,
            AuthScenario.RELATIVE_INVITE_REGISTRATION: self._relative_invite_registration,
            AuthScenario.PENDING_RESTORE_RETRY_FORGET: self._pending_restore_retry_forget,
            AuthScenario.PENDING_APPROVAL_RECHECK: self._pending_approval_recheck,
            AuthScenario.FORBIDDEN_RETRY: self._forbidden_retry,
            AuthScenario.UNAUTHORIZED_CLEANUP: self._unauthorized_cleanup,
            AuthScenario.CRASH_PRIVACY_AUDIT: self._crash_privacy_audit,
        }
        _run_scenario_plan(actions, self._record)

    def _production_default(self) -> tuple[str, ...]:
        self.device.wait_signed_out("fresh-install-login")
        self.device.assert_production_default()
        return ("fresh_install_signed_out", "production_origin_exact")

    def _incompatible_preflight(self) -> tuple[str, ...]:
        self.server.set_compatibility(
            current_contract_version="v1",
            compatible_contract_versions=("v1",),
        )
        self.device.configure_server(self.tunnel.origin)
        after = len(_ledger_events(self.server))
        self.device.submit_login(
            self.generated.approved_email,
            self.generated.invalid_password,
        )
        _wait_for_event(
            self.server,
            after,
            lambda event: event.method == "GET" and event.path == "/api/version",
            self.deadline,
            "the compatibility preflight",
        )
        self.device.wait_signed_out("incompatible-preflight-result")
        _assert_no_event(
            self.server,
            after,
            lambda event: event.method == "POST" and event.path == "/api/auth/login",
            "a login POST behind an incompatible preflight",
        )
        self.server.set_compatibility()
        return ("preflight_observed", "login_post_blocked", "signed_out_preserved")

    def _invalid_login(self) -> tuple[str, ...]:
        after = len(_ledger_events(self.server))
        self.device.submit_login(
            self.generated.approved_email,
            self.generated.invalid_password,
        )
        _wait_for_event(
            self.server,
            after,
            lambda event: event.method == "POST"
            and event.path == "/api/auth/login"
            and event.status == 401,
            self.deadline,
            "an invalid-login 401",
        )
        self.device.wait_signed_out("invalid-login-result")
        return ("login_401_observed", "signed_out_preserved")

    def _valid_login(self) -> tuple[str, ...]:
        after = len(_ledger_events(self.server))
        self.device.submit_login(
            self.generated.approved_email,
            self.generated.approved_password,
        )
        _wait_for_event(
            self.server,
            after,
            lambda event: event.method == "POST"
            and event.path == "/api/auth/login"
            and 200 <= event.status < 300,
            self.deadline,
            "a valid login",
        )
        self.device.wait_authenticated("valid-login-shell")
        self.device.assert_profile_origin(self.tunnel.origin)
        return ("login_success_observed", "five_tab_shell", "profile_origin_full")

    def _stored_session_restore(self) -> tuple[str, ...]:
        after = len(_ledger_events(self.server))
        self.device.restart()
        _wait_for_event(
            self.server,
            after,
            lambda event: event.method == "GET"
            and event.path == "/api/auth/me"
            and event.status == 200,
            self.deadline,
            "stored-session /me",
        )
        self.device.wait_authenticated("stored-session-shell")
        self.device.assert_profile_origin(self.tunnel.origin)
        return ("cold_restore_me_200", "same_origin_restored", "five_tab_shell")

    def _logout_production_reset(self) -> tuple[str, ...]:
        after = len(_ledger_events(self.server))
        self.device.tap_logout()
        _wait_for_event(
            self.server,
            after,
            lambda event: event.method == "POST"
            and event.path == "/api/auth/logout"
            and 200 <= event.status < 300,
            self.deadline,
            "logout",
        )
        self.device.wait_signed_out("logout-result")
        self.device.assert_production_default()
        me_before_restart = sum(
            event.path == "/api/auth/me" for event in _ledger_events(self.server)
        )
        self.device.restart()
        self.device.wait_signed_out("logout-restart")
        self.device.assert_production_default()
        me_after_restart = sum(
            event.path == "/api/auth/me" for event in _ledger_events(self.server)
        )
        if me_after_restart != me_before_restart:
            raise CandidateFailure("A logged-out session attempted /me after another restart")
        return (
            "logout_success_observed",
            "production_reset",
            "restart_stays_signed_out",
            "restart_no_me",
        )

    def _relative_invite_registration(self) -> tuple[str, ...]:
        self.invite = str(self.server.issue_invite())
        if not self.invite:
            raise InfrastructureFailure("The disposable server did not issue an invite")
        self.device.configure_server(self.tunnel.origin)
        self.device.open_relative_invite()
        self.device.assert_relative_invite(self.tunnel.origin)
        after = len(_ledger_events(self.server))
        self.device.submit_registration(
            "Android QA Invited",
            self.generated.invited_email,
            self.generated.invited_password,
            self.invite,
        )
        _wait_for_event(
            self.server,
            after,
            lambda event: event.method == "POST"
            and event.path == "/api/auth/register"
            and 200 <= event.status < 300,
            self.deadline,
            "invited registration",
        )
        self.device.wait_authenticated("invited-registration-shell")
        self.device.assert_profile_origin(self.tunnel.origin)
        self.device.tap_logout()
        self.device.wait_signed_out("invited-registration-logout")
        self.device.assert_production_default()
        return (
            "relative_marker_applied",
            "custom_origin_preserved",
            "manual_invite_via_stdin",
            "invited_account_approved",
        )

    def _register_pending(self, email: str, password: str, label: str) -> None:
        self.device.configure_server(self.tunnel.origin)
        self.device.dismiss_keyboard()
        self.device.enter_registration_mode()
        after = len(_ledger_events(self.server))
        self.device.submit_registration(label, email, password, None)
        _wait_for_event(
            self.server,
            after,
            lambda event: event.method == "POST"
            and event.path == "/api/auth/register"
            and 200 <= event.status < 300,
            self.deadline,
            "pending registration",
        )
        self.device.wait_pending("pending-registration")
        self.device.assert_pending_origin(self.tunnel.origin)

    def _pending_restore_retry_forget(self) -> tuple[str, ...]:
        self._register_pending(
            self.generated.pending_email,
            self.generated.pending_password,
            "Android QA Pending",
        )
        self.device.restart()
        self.device.wait_pending("pending-normal-restart")
        self.device.assert_pending_origin(self.tunnel.origin)

        self.server.fault_next("/api/auth/me", 503)
        after = len(_ledger_events(self.server))
        self.device.restart()
        _wait_for_event(
            self.server,
            after,
            lambda event: event.path == "/api/auth/me" and event.status == 503,
            self.deadline,
            "pending restore 503",
        )
        self.device.wait_restore_error("pending-503-restore-error")
        after_retry = len(_ledger_events(self.server))
        self.device.tap_session_retry()
        _wait_for_event(
            self.server,
            after_retry,
            lambda event: event.method == "GET"
            and event.path == "/api/auth/me"
            and event.status == 200,
            self.deadline,
            "pending Retry /me",
        )
        self.device.wait_pending("pending-retry")

        self.server.fault_next("/api/auth/me", 503)
        after = len(_ledger_events(self.server))
        self.device.restart()
        self.device.wait_restore_error("pending-forget-restore-error")
        self.device.tap_session_forget()
        self.device.wait_signed_out("pending-forget-result")
        self.device.assert_production_default()
        _assert_no_event(
            self.server,
            after,
            lambda event: event.method == "POST" and event.path == "/api/auth/logout",
            "a remote logout from local Forget",
        )
        self.device.restart()
        self.device.wait_signed_out("pending-forget-restart")
        self.device.assert_production_default()
        return (
            "pending_cold_restore",
            "503_restore_error",
            "retry_me_200_returns_pending",
            "forget_is_local_only",
            "forget_resets_production",
        )

    def _pending_approval_recheck(self) -> tuple[str, ...]:
        self._register_pending(
            self.generated.approval_email,
            self.generated.approval_password,
            "Android QA Approval",
        )
        self.server.approve(self.generated.approval_email)
        after = len(_ledger_events(self.server))
        self.device.tap_recheck()
        _wait_for_event(
            self.server,
            after,
            lambda event: event.method == "GET"
            and event.path == "/api/auth/me"
            and event.status == 200,
            self.deadline,
            "approved-account recheck",
        )
        self.device.wait_authenticated("approval-recheck-shell")
        self.device.assert_profile_origin(self.tunnel.origin)
        return ("approval_direct_control", "recheck_me_200", "pending_to_shell")

    def _forbidden_retry(self) -> tuple[str, ...]:
        self.server.fault_next("/api/auth/me", 403)
        after = len(_ledger_events(self.server))
        self.device.restart()
        _wait_for_event(
            self.server,
            after,
            lambda event: event.path == "/api/auth/me" and event.status == 403,
            self.deadline,
            "stored-session 403",
        )
        self.device.wait_restore_error("forbidden-restore-error")
        self.device.tap_session_retry()
        _wait_for_event(
            self.server,
            after,
            lambda event: event.path == "/api/auth/me" and event.status == 200,
            self.deadline,
            "403 Retry /me",
        )
        self.device.wait_authenticated("forbidden-retry-shell")
        self.device.assert_profile_origin(self.tunnel.origin)
        _assert_no_event(
            self.server,
            after,
            lambda event: event.method == "POST" and event.path == "/api/auth/login",
            "a replacement login after 403",
        )
        return ("403_restore_error", "session_preserved", "retry_restores_same_origin")

    def _unauthorized_cleanup(self) -> tuple[str, ...]:
        self.server.fault_next("/api/auth/me", 401)
        after = len(_ledger_events(self.server))
        self.device.restart()
        _wait_for_event(
            self.server,
            after,
            lambda event: event.path == "/api/auth/me" and event.status == 401,
            self.deadline,
            "authoritative stored-session 401",
        )
        self.device.wait_signed_out("unauthorized-cleanup")
        self.device.assert_production_default()
        me_before_restart = sum(
            event.path == "/api/auth/me" for event in _ledger_events(self.server)
        )
        self.device.restart()
        self.device.wait_signed_out("unauthorized-cleanup-restart")
        self.device.assert_production_default()
        me_after_restart = sum(
            event.path == "/api/auth/me" for event in _ledger_events(self.server)
        )
        if me_after_restart != me_before_restart:
            raise CandidateFailure("A cleaned 401 session attempted /me after another restart")
        return ("401_authoritative", "session_removed", "production_reset", "restart_no_me")

    def _crash_privacy_audit(self) -> tuple[str, ...]:
        since = self.device.begin_crash_audit()
        self.device.assert_crash_free(since)
        self.device.assert_production_default()
        self.crash_free = True
        return ("fresh_process_alive", "app_scoped_logcat_clean", "raw_ui_not_persisted")


def _safe_failure(cause: BaseException) -> tuple[str, str]:
    if isinstance(cause, PrivacyFailure):
        return "privacy_failure", str(cause)
    if isinstance(cause, CandidateFailure):
        return "candidate_failure", str(cause)
    if isinstance(cause, InfrastructureFailure):
        return "infrastructure_failure", str(cause)
    return "infrastructure_failure", f"Unexpected {type(cause).__name__}"


def _privacy_guard(serialized: str, secret_values: Iterable[str]) -> None:
    for secret_value in secret_values:
        if not secret_value:
            continue
        representations = {
            secret_value,
            json.dumps(secret_value)[1:-1],
        }
        if any(representation and representation in serialized for representation in representations):
            raise PrivacyFailure("Generated authentication material reached the evidence boundary")
    forbidden_markers = (
        '"text":',
        '"content-desc":',
        '"hint":',
        '"password":',
        "set-cookie",
        "cookie",
        REMOTE_UI_DUMP,
    )
    lowered = serialized.lower()
    if any(marker in lowered for marker in forbidden_markers):
        raise PrivacyFailure("Raw UI or authentication transport data reached evidence")


def _write_report(report: AuthQaReport, secret_values: Iterable[str]) -> None:
    serialized = json.dumps(report.to_dict(), indent=2, sort_keys=True) + "\n"
    _privacy_guard(serialized, secret_values)
    path = report.evidence_path
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    if any(path.parent.iterdir()):
        existing = {item.name for item in path.parent.iterdir()}
        if existing != {path.name}:
            raise InfrastructureFailure("evidence_dir must be empty before an auth QA run")
    path.write_text(serialized, encoding="utf-8")
    path.chmod(0o600)


def _validate_request(request: AuthQaRequest) -> tuple[Path, Path]:
    apk = request.apk.expanduser().resolve()
    if not apk.is_file() or apk.stat().st_size == 0:
        raise InfrastructureFailure("The requested APK is missing or empty")
    evidence_dir = request.evidence_dir.expanduser().resolve()
    if evidence_dir.exists() and (not evidence_dir.is_dir() or any(evidence_dir.iterdir())):
        raise InfrastructureFailure("evidence_dir must not already contain files")
    return apk, evidence_dir


def _load_server_type() -> type[Any]:
    try:
        from auth_qa_server import DisposableAuthServer
    except (ImportError, SyntaxError) as cause:
        raise InfrastructureFailure("mobile/scripts/auth_qa_server.py is unavailable") from cause
    return DisposableAuthServer


def run_auth_qa(request: AuthQaRequest) -> AuthQaReport:
    """Run the fixed QA-06 auth matrix and return its redacted report."""

    apk, evidence_dir = _validate_request(request)
    deadline = _Deadline(request.deadline_seconds)
    started = _utc_now()
    apk_digest = _sha256(apk)
    generated = _GeneratedSecrets.create()
    server: Any | None = None
    tunnel: _CloudflaredQuickTunnel | None = None
    device: _SafeAdb | None = None
    engine: _AuthQaEngine | None = None
    teardown_complete = True
    failure_kind: str | None = None
    failure_message: str | None = None

    try:
        server_type = _load_server_type()
        server = server_type()
        server.start()
        server.seed_account(
            generated.approved_email,
            generated.approved_password,
            display_name="Android QA Approved",
            is_approved=True,
        )
        tunnel = _CloudflaredQuickTunnel(
            _resolve_cloudflared(request.cloudflared_path),
            str(server.origin),
            deadline,
        )
        tunnel.start()
        device = _SafeAdb(_resolve_adb(request.adb_path), request.serial, deadline)
        device.install_and_launch(apk)
        engine = _AuthQaEngine(request, deadline, server, tunnel, device, generated)
        engine.run()
        status = "passed"
    except BaseException as cause:  # noqa: BLE001 - classify without echoing external output
        failure_kind, failure_message = _safe_failure(cause)
        status = {
            "candidate_failure": "candidate_failed",
            "privacy_failure": "privacy_failed",
        }.get(failure_kind, "infrastructure_failed")
    finally:
        if device is not None:
            try:
                teardown_complete = device.teardown() and teardown_complete
            except BaseException:  # noqa: BLE001 - teardown status is evidence, not another leak
                teardown_complete = False
        if tunnel is not None:
            try:
                tunnel.close()
            except BaseException:
                teardown_complete = False
        if server is not None:
            try:
                server.close()
            except BaseException:
                teardown_complete = False

    if status == "passed" and not teardown_complete:
        status = "infrastructure_failed"
        failure_kind = "teardown_failure"
        failure_message = "Generated Android auth state could not be fully removed"

    events = _ledger_events(server) if server is not None else ()
    report = AuthQaReport(
        status=status,
        apk_sha256=apk_digest,
        serial=request.serial,
        started_at_utc=started,
        completed_at_utc=_utc_now(),
        scenarios=tuple(engine.results) if engine is not None else (),
        deferred_scenarios=DEFERRED_SCENARIOS,
        api_events=events,
        crash_free=engine.crash_free if engine is not None else False,
        teardown_complete=teardown_complete,
        failure_kind=failure_kind,
        failure_message=failure_message,
        evidence_path=evidence_dir / "auth-qa-report.json",
    )
    secret_values = (*generated.values(), engine.invite if engine is not None else "")
    try:
        _write_report(report, secret_values)
    except PrivacyFailure:
        if report.evidence_path.exists():
            report.evidence_path.unlink()
        raise
    return report


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run secret-safe Android custom-server authentication acceptance QA.",
    )
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    parser.add_argument("--adb", type=Path)
    parser.add_argument("--cloudflared", type=Path)
    parser.add_argument("--deadline-seconds", type=float, default=1_200.0)
    return parser.parse_args(argv)


def die(message: str, code: int) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    request = AuthQaRequest(
        apk=args.apk,
        serial=args.serial,
        evidence_dir=args.evidence_dir,
        adb_path=args.adb,
        cloudflared_path=args.cloudflared,
        deadline_seconds=args.deadline_seconds,
    )
    try:
        report = run_auth_qa(request)
    except AuthQaFailure as cause:
        die(f"FAILED: {cause}", 1)
    print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    if report.status != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
