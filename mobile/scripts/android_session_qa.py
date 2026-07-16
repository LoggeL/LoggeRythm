#!/usr/bin/env python3
"""Credential-blind QA for an installed, already-authenticated Android app.

This harness intentionally has no APK install, app-data clear, credential input,
or credential-environment support. UIAutomator XML is parsed in memory, reduced
to non-text control metadata, and immediately removed from the device.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from typing import NoReturn, Pattern
import xml.etree.ElementTree as ET


PACKAGE = "top.logge.loggerythm"
ACTIVITY = f"{PACKAGE}/.MainActivity"
REMOTE_UI_DUMP = "/data/local/tmp/loggerythm-session-qa-window.xml"

TAB_DESTINATIONS = (
    ("tab-home", "home-screen"),
    ("tab-search", "search-screen"),
    ("tab-discover", "discover-screen"),
    ("tab-radio", "radio-screen"),
    ("tab-library", "library-screen"),
)
TAB_SUFFIXES = tuple(tab for tab, _ in TAB_DESTINATIONS)
SCREEN_SUFFIXES = tuple(screen for _, screen in TAB_DESTINATIONS)

LIBRARY_SECTION_SUFFIXES = (
    "library-section-playlists",
    "library-section-liked",
    "library-section-recent",
    "library-section-downloads",
    "library-section-following",
)
RADIO_SECTION_SUFFIXES = (
    "radio-section-personal",
    "radio-section-moods",
    "radio-section-genres",
)

# These controls either change account/library data, playback state, or locally
# persisted history. The QA allowlist below never needs them.
FORBIDDEN_INTERACTION_PATTERNS: tuple[Pattern[str], ...] = tuple(
    re.compile(pattern)
    for pattern in (
        r"^logout-button$",
        r"^profile-delete(?:-|$)",
        r"^library-create(?:-|$)",
        r"^playlist-(?:edit|delete|visibility)(?:-|$)",
        r"^playlist-track-.+-(?:up|down|remove)$",
        r"^now-playing-(?:like|play-pause|next|previous|shuffle|repeat)$",
        r"^mini-player(?:-|$)",
        r"^search-recent-clear$",
        r"^search-track-.+$",
        r"^home-track-.+$",
        r"^discover-chart-.+$",
        r"^radio-(?:personal|mood|genre)-.+$",
    )
)

SAFE_EXACT_INTERACTIONS = frozenset(
    (*TAB_SUFFIXES, "profile-access", "library-open-liked")
)
SAFE_DYNAMIC_INTERACTIONS: tuple[Pattern[str], ...] = tuple(
    re.compile(pattern)
    for pattern in (
        r"^home-(?:album|genre)-[a-z0-9-]+$",
        r"^search-genre-[0-9]+$",
        r"^discover-(?:genre|album|playlist)-[a-z0-9-]+$",
        r"^library-playlist-[0-9]+$",
    )
)

DETAIL_TARGETS: tuple[tuple[Pattern[str], tuple[str, ...]], ...] = (
    (re.compile(r"^home-album-[a-z0-9-]+$"), ("album-screen", "album-loading", "album-error")),
    (re.compile(r"^home-genre-[a-z0-9-]+$"), ("genre-screen", "genre-loading", "genre-error")),
    (re.compile(r"^search-genre-[0-9]+$"), ("genre-screen", "genre-loading", "genre-error")),
    (re.compile(r"^discover-genre-[a-z0-9-]+$"), ("genre-screen", "genre-loading", "genre-error")),
    (re.compile(r"^discover-album-[a-z0-9-]+$"), ("album-screen", "album-loading", "album-error")),
    (
        re.compile(r"^discover-playlist-[a-z0-9-]+$"),
        ("playlist-screen", "playlist-loading", "playlist-error"),
    ),
    (
        re.compile(r"^library-playlist-[0-9]+$"),
        ("playlist-screen", "playlist-loading", "playlist-error"),
    ),
    (
        re.compile(r"^library-open-liked$"),
        ("playlist-screen", "playlist-loading", "playlist-error"),
    ),
)


class QaFailure(RuntimeError):
    """An installed-session QA assertion failed."""


class SessionUnavailable(QaFailure):
    """The installed app does not currently expose an authenticated shell."""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Reuse the installed LoggeRythm app and authenticated session for "
            "credential-blind, non-destructive Android QA."
        ),
    )
    parser.add_argument("--serial", help="adb device serial; required when multiple are online")
    parser.add_argument("--adb", type=Path, help="path to adb (otherwise use Android SDK or PATH)")
    parser.add_argument(
        "--cold-start",
        action="store_true",
        help=(
            "opt in to force-stopping before launch; the default warm launch does not "
            "interrupt an app already under test, and app data is never cleared"
        ),
    )
    parser.add_argument(
        "--skip-deep-links",
        action="store_true",
        help="skip the safe search/account deep-link checks",
    )
    return parser.parse_args(argv)


def resolve_adb(explicit: Path | None) -> Path:
    if explicit is not None:
        candidate = explicit.expanduser().resolve()
    else:
        sdk = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
        if sdk:
            candidate = Path(sdk).expanduser().resolve() / "platform-tools" / "adb"
        else:
            located = shutil.which("adb")
            if located is None:
                raise QaFailure(
                    "adb was not found; pass --adb or set ANDROID_SDK_ROOT/ANDROID_HOME",
                )
            candidate = Path(located).resolve()
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        raise QaFailure(f"adb is not executable: {candidate}")
    return candidate


def run_command(
    command: list[str],
    *,
    check: bool = True,
    timeout: float = 120,
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as cause:
        raise QaFailure(f"Failed to run {command[0]}: {cause}") from cause
    if check and result.returncode != 0:
        # adb arguments contain only fixed package/test identifiers in this
        # harness, but avoid echoing stdout because a platform tool could emit
        # unrelated device state.
        raise QaFailure(f"Command failed ({result.returncode}): {command[0]}")
    return result


def resource_suffix(resource_id: str) -> str | None:
    marker = ":id/"
    if marker in resource_id:
        package, suffix = resource_id.rsplit(marker, 1)
        if package != PACKAGE or not suffix:
            return None
        return suffix
    # React Native 0.86/Fabric may expose `testID` directly as Android's
    # resource-id value instead of synthesizing `package:id/testID`.
    if re.fullmatch(r"[a-z0-9][a-z0-9._:-]*", resource_id):
        return resource_id
    return None


def node_suffix(node: dict[str, str]) -> str | None:
    return resource_suffix(node.get("resource-id", ""))


def project_node_metadata(attributes: dict[str, str]) -> dict[str, str]:
    """Strip every UI field that could carry user-entered or account text."""
    allowed = ("resource-id", "clickable", "enabled", "bounds")
    return {key: attributes.get(key, "") for key in allowed}


def visible_suffixes(nodes: list[dict[str, str]]) -> set[str]:
    return {suffix for node in nodes if (suffix := node_suffix(node)) is not None}


def node_bounds(node: dict[str, str], label: str) -> tuple[int, int, int, int]:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    if match is None:
        raise QaFailure(f"{label} has invalid UI bounds")
    left, top, right, bottom = (int(value) for value in match.groups())
    if right <= left or bottom <= top:
        raise QaFailure(f"{label} has empty UI bounds")
    return left, top, right, bottom


def unobscured_center(
    node: dict[str, str],
    label: str,
    occluders: list[dict[str, str]],
) -> tuple[int, int] | None:
    """Choose an inward point that is not covered by a persistent overlay."""

    left, top, right, bottom = node_bounds(node, label)
    parsed_occluders = [node_bounds(occluder, "persistent overlay") for occluder in occluders]
    width = right - left
    height = bottom - top
    fractions = (0.5, 0.25, 0.75, 0.125, 0.875)
    for y_fraction in fractions:
        y = min(bottom - 1, top + max(1, int(height * y_fraction)))
        for x_fraction in fractions:
            x = min(right - 1, left + max(1, int(width * x_fraction)))
            if not any(
                overlay_left <= x < overlay_right and overlay_top <= y < overlay_bottom
                for overlay_left, overlay_top, overlay_right, overlay_bottom in parsed_occluders
            ):
                return x, y
    return None


def authenticated_shell_visible(nodes: list[dict[str, str]]) -> bool:
    suffixes = visible_suffixes(nodes)
    # Detail routes and the invalid-link recovery screen still sit inside the
    # authenticated tab shell. Verifying every tab is enough for this gate;
    # each root destination is asserted separately immediately afterward.
    return set(TAB_SUFFIXES).issubset(suffixes)


def classify_session_gate(nodes: list[dict[str, str]]) -> str:
    suffixes = visible_suffixes(nodes)
    if authenticated_shell_visible(nodes):
        return "authenticated"
    if "approval-screen" in suffixes:
        return "approval_pending"
    if "login-submit" in suffixes or "auth-mode-toggle" in suffixes:
        return "signed_out"
    if "session-restore-error" in suffixes:
        return "restore_error"
    if "player-startup-error" in suffixes:
        return "player_error"
    if suffixes.intersection(("profile-screen", "now-playing-screen", "queue-screen")):
        return "authenticated_overlay"
    return "starting"


def assert_safe_interaction(suffix: str) -> None:
    if any(pattern.fullmatch(suffix) for pattern in FORBIDDEN_INTERACTION_PATTERNS):
        raise QaFailure(f"Refusing destructive or stateful interaction with testID {suffix!r}")
    if suffix in SAFE_EXACT_INTERACTIONS:
        return
    if any(pattern.fullmatch(suffix) for pattern in SAFE_DYNAMIC_INTERACTIONS):
        return
    raise QaFailure(f"Refusing non-allowlisted interaction with testID {suffix!r}")


def detail_expectations(suffix: str) -> tuple[str, ...] | None:
    for pattern, expectations in DETAIL_TARGETS:
        if pattern.fullmatch(suffix):
            return expectations
    return None


def app_crash_reason(logcat: str, pid: str) -> str | None:
    for match in re.finditer(r"FATAL EXCEPTION", logcat):
        block = logcat[match.start() : match.start() + 6000]
        if f"Process: {PACKAGE}" in block or (pid and f"PID: {pid}" in block):
            return "fatal exception"
    package = re.escape(PACKAGE)
    patterns = (
        (rf"\bANR in {package}\b", "ANR"),
        (rf"\bForce finishing activity\b[^\n]*{package}", "force-finished activity"),
        (rf"\bProcess {package}\b[^\n]*(?:has died|died)", "process death"),
        (rf"\bam_(?:anr|crash|proc_died)\b[^\n]*{package}", "app exit event"),
        (rf"\bWIN DEATH\b[^\n]*{package}", "window death"),
    )
    for pattern, label in patterns:
        if re.search(pattern, logcat, flags=re.IGNORECASE):
            return label
    for index, line in enumerate(logcat.splitlines()):
        if "Fatal signal" not in line and "Abort message" not in line:
            continue
        lines = logcat.splitlines()
        context = "\n".join(lines[max(0, index - 30) : index + 160])
        if PACKAGE in context or (pid and re.search(rf"\bpid\s*[:=]?\s*{re.escape(pid)}\b", context)):
            return "native fatal signal"
    return None


def normalize_logcat_timestamp(value: str) -> str:
    """Convert an Android `date` token into logcat's timestamp format.

    `adb shell` joins argv with spaces, so passing a format string that itself
    contains a space makes Android's toybox `date` see two arguments.  The
    device therefore emits an underscore delimiter and the host restores the
    single space that `logcat -T` requires.
    """
    if not re.fullmatch(r"\d{2}-\d{2}_\d{2}:\d{2}:\d{2}\.000", value):
        raise QaFailure("Could not establish a safe logcat start timestamp")
    return value.replace("_", " ", 1)


class AndroidSessionQa:
    """Drive only allowlisted, non-destructive controls in the installed app."""

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.adb_path = resolve_adb(args.adb)
        self.serial = ""
        self.pid = ""
        self.logcat_since = ""
        self.summary: dict[str, object] = {
            "package": PACKAGE,
            "installed_app_reused": False,
            "authenticated_session_reused": False,
            "session_gate": "not_checked",
            "credentials_accessed": False,
            "credentials_persisted": False,
            "tabs_verified": [],
            "profile_verified": False,
            "flows": {},
            "deep_links": [],
            "crash_free": False,
            "overall_status": "not_run",
        }

    def adb(
        self,
        arguments: list[str],
        *,
        check: bool = True,
        timeout: float = 120,
    ) -> subprocess.CompletedProcess[str]:
        command = [str(self.adb_path)]
        if self.serial:
            command += ["-s", self.serial]
        return run_command(command + arguments, check=check, timeout=timeout)

    def select_device(self) -> None:
        result = run_command([str(self.adb_path), "devices", "-l"])
        devices: dict[str, str] = {}
        for line in result.stdout.splitlines()[1:]:
            fields = line.split()
            if len(fields) >= 2:
                devices[fields[0]] = fields[1]
        if self.args.serial:
            if devices.get(self.args.serial) != "device":
                raise QaFailure(f"Requested adb device {self.args.serial!r} is not online")
            self.serial = self.args.serial
        else:
            online = [serial for serial, state in devices.items() if state == "device"]
            if len(online) != 1:
                raise QaFailure(f"Expected exactly one online adb device, found {len(online)}")
            self.serial = online[0]
        self.summary["serial"] = self.serial

    def assert_installed(self) -> None:
        result = self.adb(["shell", "pm", "path", PACKAGE], check=False)
        if result.returncode != 0 or not any(
            line.startswith("package:") for line in result.stdout.splitlines()
        ):
            raise QaFailure(
                f"{PACKAGE} is not installed; this session harness never installs an APK",
            )
        self.summary["installed_app_reused"] = True

    def launch_existing(self) -> None:
        if self.args.cold_start:
            # Force-stop gives a deterministic cold process while preserving all
            # package data, including the already-established secure session.
            # It is opt-in so this harness cannot unexpectedly interrupt another
            # live QA pass on the same emulator.
            self.adb(["shell", "am", "force-stop", PACKAGE])
            # ActivityManager returns before WindowManager necessarily emits
            # the expected WIN DEATH record for the stopped activity.  Let
            # that asynchronous lifecycle bookkeeping settle before choosing
            # the crash-audit boundary.
            time.sleep(1)
        # Scope crash inspection to the tested launch without clearing the
        # emulator's global log buffer.  Capture this *after* an intentional
        # cold-start force-stop so its expected window-death record cannot be
        # mistaken for an app crash.
        device_timestamp = self.adb(
            ["shell", "date", "+%m-%d_%H:%M:%S.000"],
        ).stdout.strip()
        self.logcat_since = normalize_logcat_timestamp(device_timestamp)
        result = self.adb(["shell", "am", "start", "-W", "-n", ACTIVITY])
        if "Status: ok" not in result.stdout:
            raise QaFailure("Existing LoggeRythm activity did not launch successfully")
        for _ in range(20):
            time.sleep(0.25)
            pid = self.current_pid()
            if pid:
                self.pid = pid
                return
        raise QaFailure("LoggeRythm process did not appear after launch")

    def current_pid(self) -> str:
        result = self.adb(["shell", "pidof", "-s", PACKAGE], check=False)
        return result.stdout.strip() if result.returncode == 0 else ""

    def assert_alive(self, phase: str) -> None:
        current = self.current_pid()
        if not current:
            raise QaFailure(f"LoggeRythm process died during {phase}")
        if self.pid and current != self.pid:
            raise QaFailure(
                f"LoggeRythm process restarted during {phase} (was {self.pid}, now {current})",
            )
        self.pid = current

    def dump_nodes(self, phase: str) -> list[dict[str, str]]:
        """Return only non-text UI metadata and remove the raw dump immediately."""
        result: subprocess.CompletedProcess[str] | None = None
        for attempt in range(1, 4):
            try:
                try:
                    dumped = self.adb(
                        ["shell", "uiautomator", "dump", "--compressed", REMOTE_UI_DUMP],
                        check=False,
                        timeout=18,
                    )
                except QaFailure:
                    dumped = None
                if dumped is not None and dumped.returncode == 0:
                    readback = self.adb(
                        ["exec-out", "cat", REMOTE_UI_DUMP],
                        check=False,
                        timeout=10,
                    )
                    if readback.returncode == 0:
                        result = readback
                        break
            finally:
                self.adb(
                    ["shell", "rm", "-f", REMOTE_UI_DUMP],
                    check=False,
                    timeout=10,
                )
            if attempt < 3:
                time.sleep(0.4)
        if result is None:
            raise QaFailure(f"UIAutomator dump failed after 3 attempts during {phase}")
        try:
            root = ET.fromstring(result.stdout)
        except ET.ParseError as cause:
            raise QaFailure(f"UIAutomator returned invalid XML during {phase}") from cause

        # Deliberately discard text, content-desc, hints, and password fields.
        # Raw XML is never written to the host or included in errors/summary.
        return [project_node_metadata(node.attrib) for node in root.iter("node")]

    @staticmethod
    def center(node: dict[str, str], label: str) -> tuple[int, int]:
        left, top, right, bottom = node_bounds(node, label)
        return (left + right) // 2, (top + bottom) // 2

    @staticmethod
    def find_node(nodes: list[dict[str, str]], suffix: str) -> dict[str, str] | None:
        for node in nodes:
            if (
                node_suffix(node) == suffix
                and node.get("clickable") == "true"
                and node.get("enabled") == "true"
            ):
                return node
        return None

    def wait_for_authenticated_shell(self) -> list[dict[str, str]]:
        last_gate = "starting"
        for attempt in range(1, 41):
            if attempt > 1:
                time.sleep(0.75)
            self.assert_alive(f"authenticated shell wait {attempt}")
            nodes = self.dump_nodes(f"authenticated-shell-{attempt:02d}")
            last_gate = classify_session_gate(nodes)
            self.summary["session_gate"] = last_gate
            if last_gate == "authenticated":
                self.summary["authenticated_session_reused"] = True
                return nodes
            if last_gate == "authenticated_overlay":
                # A warm launch may resume Profile, Now Playing, or Queue. Back
                # is a navigation-only recovery to the tab shell.
                self.adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
                continue
            if last_gate == "signed_out":
                raise SessionUnavailable(
                    "The installed app is signed out; credentials were not requested or read",
                )
            if last_gate == "approval_pending":
                raise SessionUnavailable("The installed account is still awaiting approval")
            if last_gate == "restore_error":
                raise SessionUnavailable("The installed authenticated session could not be restored")
            if last_gate == "player_error":
                raise QaFailure("Native player startup failed before the authenticated shell")
        raise QaFailure(f"Authenticated shell did not become ready (state={last_gate})")

    def wait_for_any(
        self,
        suffixes: tuple[str, ...],
        phase: str,
        *,
        require_tabs: bool,
        attempts: int = 14,
    ) -> list[dict[str, str]]:
        for attempt in range(1, attempts + 1):
            if attempt > 1:
                time.sleep(0.5)
            self.assert_alive(f"{phase} wait {attempt}")
            nodes = self.dump_nodes(f"{phase}-{attempt:02d}")
            visible = visible_suffixes(nodes)
            if "player-startup-error" in visible:
                raise QaFailure(f"Native player startup failed during {phase}")
            if "login-submit" in visible or "approval-screen" in visible:
                raise SessionUnavailable(f"Authenticated session disappeared during {phase}")
            if require_tabs and not set(TAB_SUFFIXES).issubset(visible):
                continue
            if any(suffix in visible for suffix in suffixes):
                return nodes
        raise QaFailure(f"{phase} did not expose expected testIDs {suffixes}")

    def tap_node(
        self,
        suffix: str,
        node: dict[str, str],
        *,
        point: tuple[int, int] | None = None,
    ) -> None:
        assert_safe_interaction(suffix)
        if node_suffix(node) != suffix:
            raise QaFailure("Refusing to tap a node whose testID changed")
        if node.get("clickable") != "true" or node.get("enabled") != "true":
            raise QaFailure(f"Allowlisted testID {suffix!r} is not enabled and clickable")
        x, y = point if point is not None else self.center(node, suffix)
        left, top, right, bottom = node_bounds(node, suffix)
        if not (left <= x < right and top <= y < bottom):
            raise QaFailure(f"Refusing to tap outside allowlisted testID {suffix!r}")
        self.adb(["shell", "input", "tap", str(x), str(y)])

    def tap_visible(self, suffix: str, phase: str) -> None:
        nodes = self.dump_nodes(phase)
        node = self.find_node(nodes, suffix)
        if node is None:
            raise QaFailure(f"Could not find clickable testID {suffix!r} during {phase}")
        self.tap_node(suffix, node)

    def verify_tabs(self) -> None:
        verified: list[str] = []
        for tab_suffix, screen_suffix in TAB_DESTINATIONS:
            self.tap_visible(tab_suffix, f"before-{tab_suffix}")
            self.wait_for_any((screen_suffix,), tab_suffix, require_tabs=True)
            verified.append(tab_suffix)
            self.summary["tabs_verified"] = list(verified)

    def verify_profile(self) -> None:
        nodes = self.dump_nodes("before-profile")
        entry = self.find_node(nodes, "profile-access")
        if entry is None:
            raise QaFailure("Authenticated shell does not expose clickable profile-access")
        current_screen = next(
            (screen for screen in SCREEN_SUFFIXES if screen in visible_suffixes(nodes)),
            None,
        )
        if current_screen is None:
            raise QaFailure("Could not identify the current tab before opening Profile")
        self.tap_node("profile-access", entry)
        self.wait_for_any(("profile-screen",), "profile", require_tabs=False)
        self.summary["profile_verified"] = True
        self.adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
        self.wait_for_any((current_screen,), "profile-back", require_tabs=True)

    def screen_size(self) -> tuple[int, int]:
        result = self.adb(["shell", "wm", "size"])
        matches = re.findall(r"(\d+)x(\d+)", result.stdout)
        if not matches:
            raise QaFailure("Could not determine emulator screen size")
        width, height = (int(value) for value in matches[-1])
        return width, height

    def swipe_up(self) -> None:
        width, height = self.screen_size()
        x = width // 2
        self.adb(
            [
                "shell",
                "input",
                "swipe",
                str(x),
                str(int(height * 0.76)),
                str(x),
                str(int(height * 0.32)),
                "280",
            ],
        )
        time.sleep(0.25)

    def scan_for_suffixes(
        self,
        required: tuple[str, ...],
        phase: str,
        *,
        max_swipes: int,
    ) -> set[str]:
        found: set[str] = set()
        for index in range(max_swipes + 1):
            self.assert_alive(f"{phase} scan {index}")
            nodes = self.dump_nodes(f"{phase}-scan-{index:02d}")
            found.update(visible_suffixes(nodes).intersection(required))
            if set(required).issubset(found):
                return found
            if index < max_swipes:
                self.swipe_up()
        missing = sorted(set(required) - found)
        raise QaFailure(f"{phase} did not expose required testIDs: {missing}")

    def find_and_open_detail(
        self,
        phase: str,
        root_screen: str,
        candidate_patterns: tuple[Pattern[str], ...],
        *,
        max_swipes: int,
    ) -> str:
        for index in range(max_swipes + 1):
            nodes = self.dump_nodes(f"{phase}-detail-{index:02d}")
            persistent_overlays = [
                node
                for node in nodes
                if node_suffix(node) == "mini-player" or node_suffix(node) in TAB_SUFFIXES
            ]
            candidates = sorted(
                (
                    (suffix, node, point)
                    for node in nodes
                    if (suffix := node_suffix(node)) is not None
                    and any(pattern.fullmatch(suffix) for pattern in candidate_patterns)
                    and node.get("clickable") == "true"
                    and node.get("enabled") == "true"
                    and (point := unobscured_center(node, suffix, persistent_overlays)) is not None
                ),
                key=lambda candidate: candidate[0],
            )
            if candidates:
                suffix, node, point = candidates[0]
                expectations = detail_expectations(suffix)
                if expectations is None:
                    raise QaFailure(f"Safe detail testID {suffix!r} has no route expectation")
                self.tap_node(suffix, node, point=point)
                self.wait_for_any(expectations, f"{phase}-detail-route", require_tabs=True)
                self.adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
                self.wait_for_any((root_screen,), f"{phase}-detail-back", require_tabs=True)
                return "detail_route_verified"
            if index < max_swipes:
                self.swipe_up()
        return "read_only_surface_verified"

    def select_tab(self, tab_suffix: str, screen_suffix: str) -> None:
        self.tap_visible(tab_suffix, f"select-{tab_suffix}")
        self.wait_for_any((screen_suffix,), f"select-{screen_suffix}", require_tabs=True)

    def exercise_home(self) -> None:
        self.select_tab("tab-home", "home-screen")
        # React Navigation preserves each tab's scroll position.  A reused
        # session may therefore have the greeting above the viewport even
        # though Home is fully mounted; the scroll container is the stable
        # root contract for this credential-blind pass.
        self.wait_for_any(("home-scroll",), "home-scroll", require_tabs=True)
        result = self.find_and_open_detail(
            "home",
            "home-screen",
            (re.compile(r"^home-(?:album|genre)-[a-z0-9-]+$"),),
            max_swipes=8,
        )
        self.summary["flows"]["home"] = result  # type: ignore[index]

    def exercise_search(self) -> None:
        self.select_tab("tab-search", "search-screen")
        self.wait_for_any(("search-input",), "search-input", require_tabs=True)
        self.wait_for_any(
            (
                "search-genre-browse",
                "search-genres-loading",
                "search-genres-error",
                "search-genres-empty",
            ),
            "search-browse",
            require_tabs=True,
        )
        result = self.find_and_open_detail(
            "search",
            "search-screen",
            (re.compile(r"^search-genre-[0-9]+$"),),
            max_swipes=5,
        )
        self.summary["flows"]["search"] = result  # type: ignore[index]

    def exercise_discover(self) -> None:
        self.select_tab("tab-discover", "discover-screen")
        self.wait_for_any(("discover-title",), "discover-title", require_tabs=True)
        result = self.find_and_open_detail(
            "discover",
            "discover-screen",
            (re.compile(r"^discover-(?:genre|album|playlist)-[a-z0-9-]+$"),),
            max_swipes=10,
        )
        self.summary["flows"]["discover"] = result  # type: ignore[index]

    def exercise_radio(self) -> None:
        self.select_tab("tab-radio", "radio-screen")
        self.wait_for_any(("radio-hero",), "radio-hero", require_tabs=True)
        self.scan_for_suffixes(RADIO_SECTION_SUFFIXES, "radio", max_swipes=16)
        # Station cards start playback, so the representative radio QA remains
        # a read-only traversal of all three server-backed sections.
        self.summary["flows"]["radio"] = "read_only_sections_verified"  # type: ignore[index]

    def exercise_library(self) -> None:
        self.select_tab("tab-library", "library-screen")
        result = self.find_and_open_detail(
            "library",
            "library-screen",
            (re.compile(r"^library-playlist-[0-9]+$"), re.compile(r"^library-open-liked$")),
            max_swipes=8,
        )
        self.scan_for_suffixes(LIBRARY_SECTION_SUFFIXES, "library", max_swipes=28)
        self.summary["flows"]["library"] = result  # type: ignore[index]

    def open_deep_link(self, url: str, expected: str, label: str) -> None:
        result = self.adb(
            [
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
            ],
        )
        if "Status: ok" not in result.stdout:
            raise QaFailure(f"Safe {label} deep link did not launch")
        self.wait_for_any((expected,), f"deep-link-{label}", require_tabs=expected != "profile-screen")
        deep_links = self.summary["deep_links"]
        assert isinstance(deep_links, list)
        deep_links.append(label)

    def verify_deep_links(self) -> None:
        self.open_deep_link("loggerythm://search", "search-screen", "search")
        self.open_deep_link("loggerythm://account", "profile-screen", "profile")
        self.adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
        self.wait_for_any(SCREEN_SUFFIXES, "deep-link-profile-back", require_tabs=True)

    def assert_crash_free(self) -> None:
        time.sleep(2)
        self.assert_alive("final stabilization")
        logcat = self.adb(
            ["logcat", "-d", "-v", "threadtime", "-T", self.logcat_since],
        ).stdout
        reason = app_crash_reason(logcat, self.pid)
        if reason is not None:
            raise QaFailure(f"Logcat reports a LoggeRythm {reason}")
        self.summary["crash_free"] = True

    def run(self) -> None:
        self.select_device()
        self.assert_installed()
        self.launch_existing()
        self.wait_for_authenticated_shell()
        self.verify_tabs()
        self.verify_profile()
        self.exercise_home()
        self.exercise_search()
        self.exercise_discover()
        self.exercise_radio()
        self.exercise_library()
        if not self.args.skip_deep_links:
            self.verify_deep_links()
        self.assert_crash_free()
        self.summary["overall_status"] = "passed"


def die(message: str, code: int) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def main(argv: list[str] | None = None) -> None:
    qa: AndroidSessionQa | None = None
    try:
        args = parse_args(argv)
        qa = AndroidSessionQa(args)
        qa.run()
    except SessionUnavailable as cause:
        if qa is not None:
            qa.summary["overall_status"] = "session_unavailable"
            print(json.dumps(qa.summary, indent=2, sort_keys=True))
        die(f"SESSION UNAVAILABLE: {cause}", 3)
    except Exception as cause:  # noqa: BLE001 - concise QA failure, no raw device output
        if qa is not None:
            qa.summary["overall_status"] = "failed"
            print(json.dumps(qa.summary, indent=2, sort_keys=True))
        die(f"FAILED: {cause}", 1)
    print(json.dumps(qa.summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
