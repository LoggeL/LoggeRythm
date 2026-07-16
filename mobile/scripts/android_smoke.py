#!/usr/bin/env python3
"""Install and smoke-test the standalone LoggeRythm APK with adb/UIAutomator."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from typing import NoReturn
from urllib.parse import quote, quote_plus
import xml.etree.ElementTree as ET


PACKAGE = "top.logge.loggerythm"
ACTIVITY = f"{PACKAGE}/.MainActivity"
PRODUCTION_ORIGIN = "https://loggerythm.logge.top"
PRODUCTION_ORIGIN_MARKER = f"[LoggeRythm] API origin: {PRODUCTION_ORIGIN}"
API_ORIGIN_MARKER_PREFIX = "[LoggeRythm] API origin:"
API_ORIGIN_FAILURE_MARKER = "[LoggeRythm] API origin configuration failed"
METRO_PORTS = (8081, 19000, 19001, 19002)
METRO_FAILURE_PATTERNS = (
    "could not connect to development server",
    "could not connect to the development server",
    "unable to load script. make sure you're either running metro",
    "packager is not running",
    "react native packager is not running",
    "dev server returned a response error",
    "unable to load script from assets",
)
EMAIL_ENV = "LOGGERYTHM_TEST_EMAIL"
PASSWORD_ENV = "LOGGERYTHM_TEST_PASSWORD"
TAB_DESTINATIONS = (
    ("tab-home", "home-screen"),
    ("tab-search", "search-screen"),
    ("tab-discover", "discover-screen"),
    ("tab-radio", "radio-screen"),
    ("tab-library", "library-screen"),
)
PROFILE_ACCESS_SUFFIXES = (
    "profile-access",
    "profile-button",
    "open-profile",
)
PROFILE_SCREEN_SUFFIX = "profile-screen"


def node_has_resource_suffix(node: dict[str, str], suffix: str) -> bool:
    """Return whether a UIAutomator node carries a React Native testID."""
    resource_id = node.get("resource-id", "")
    return resource_id == suffix or resource_id == f"{PACKAGE}:id/{suffix}"


def missing_resource_suffixes(
    nodes: list[dict[str, str]],
    suffixes: tuple[str, ...],
) -> list[str]:
    """Return required testIDs that are not represented in a UI tree."""
    return [
        suffix
        for suffix in suffixes
        if not any(node_has_resource_suffix(node, suffix) for node in nodes)
    ]


def authenticated_shell_visible(nodes: list[dict[str, str]]) -> bool:
    """Recognize the production shell only from stable native testIDs."""
    tab_suffixes = tuple(tab_suffix for tab_suffix, _ in TAB_DESTINATIONS)
    screen_suffixes = tuple(screen_suffix for _, screen_suffix in TAB_DESTINATIONS)
    return not missing_resource_suffixes(nodes, tab_suffixes) and any(
        any(node_has_resource_suffix(node, screen_suffix) for node in nodes)
        for screen_suffix in screen_suffixes
    )


def runtime_api_origins(logcat: str) -> list[str]:
    """Extract origins emitted after runtime configuration has resolved."""
    return re.findall(
        rf"{re.escape(API_ORIGIN_MARKER_PREFIX)}\s*(\S+)",
        logcat,
    )


def production_origin_marker_present(logcat: str) -> bool:
    """Require exactly the production runtime origin, with no conflicting marker."""
    origins = runtime_api_origins(logcat)
    return (
        bool(origins)
        and set(origins) == {PRODUCTION_ORIGIN}
        and API_ORIGIN_FAILURE_MARKER not in logcat
    )


def installed_package_metadata(package_dump: str) -> dict[str, object]:
    """Extract release identity and debuggability from `dumpsys package`."""
    version_code = re.search(r"^\s*versionCode=(\d+)\b", package_dump, re.MULTILINE)
    version_name = re.search(r"^\s*versionName=(\S+)\s*$", package_dump, re.MULTILINE)
    min_sdk = re.search(r"\bminSdk=(\d+)\b", package_dump)
    target_sdk = re.search(r"\btargetSdk=(\d+)\b", package_dump)
    flag_blocks = re.findall(
        r"^\s*(?:pkgFlags|flags)=\[([^\]]*)\]\s*$",
        package_dump,
        re.MULTILINE,
    )
    if version_code is None or version_name is None or not flag_blocks:
        raise SmokeFailure("Could not extract installed package release metadata")
    flags = {
        flag
        for block in flag_blocks
        for flag in re.split(r"[\s,]+", block.strip())
        if flag
    }
    return {
        "version_code": int(version_code.group(1)),
        "version_name": version_name.group(1),
        "min_sdk": int(min_sdk.group(1)) if min_sdk else None,
        "target_sdk": int(target_sdk.group(1)) if target_sdk else None,
        "debuggable": "DEBUGGABLE" in flags,
    }


def metro_reverse_present(reverse_list: str) -> bool:
    """Return whether adb exposes a conventional Metro/Expo port to the device."""
    return any(re.search(rf"\btcp:{port}\b", reverse_list) for port in METRO_PORTS)


def parse_threadtime_line(line: str) -> tuple[str, str, str] | None:
    """Parse the PID, priority, and tag from `adb logcat -v threadtime`."""
    match = re.match(
        r"^\S+\s+\S+\s+(\d+)\s+\d+\s+([A-Z])\s+([^:]+?)\s*:\s?.*$",
        line,
    )
    if match is None:
        return None
    return match.group(1), match.group(2), match.group(3).strip()


def metro_runtime_failure(logcat: str, app_pids: set[str]) -> str | None:
    """Find an app-scoped failure to load the embedded bundle without Metro."""
    for line in logcat.splitlines():
        lowered = line.lower()
        pattern = next((item for item in METRO_FAILURE_PATTERNS if item in lowered), None)
        if pattern is None:
            continue
        parsed = parse_threadtime_line(line)
        if PACKAGE in line or (parsed is not None and parsed[0] in app_pids):
            return pattern
    return None


def app_runtime_failure(logcat: str, app_pids: set[str]) -> str | None:
    """Return an app-scoped crash/ANR/ReactNativeJS failure, if present."""
    for match in re.finditer(r"FATAL EXCEPTION", logcat):
        block = logcat[match.start() : match.start() + 6000]
        if f"Process: {PACKAGE}" in block or any(f"PID: {pid}" in block for pid in app_pids):
            return "fatal exception"

    package = re.escape(PACKAGE)
    fatal_patterns = (
        (rf"\bANR in {package}\b", "ANR"),
        (rf"\bForce finishing activity\b[^\n]*{package}", "force-finished activity"),
        (rf"\bProcess {package}\b[^\n]*(?:has died|died)", "app process death"),
        (rf"\bKilling \d+:{package}(?:/|\s)", "app process kill"),
        (rf"\bam_(?:anr|crash|proc_died)\b[^\n]*{package}", "app exit event"),
        (rf"\bWIN DEATH\b[^\n]*{package}", "app window death"),
    )
    for pattern, label in fatal_patterns:
        if re.search(pattern, logcat, flags=re.IGNORECASE):
            return label

    for line in logcat.splitlines():
        parsed = parse_threadtime_line(line)
        if parsed is None:
            continue
        pid, priority, tag = parsed
        if pid in app_pids and priority in {"E", "F"} and tag == "ReactNativeJS":
            return "ReactNativeJS error"

    lines = logcat.splitlines()
    for index, line in enumerate(lines):
        if "Fatal signal" not in line and "Abort message" not in line:
            continue
        context = "\n".join(lines[max(0, index - 30) : index + 160])
        pid_markers = tuple(
            marker
            for pid in app_pids
            for marker in (
                rf"\bpid\s*[:=]?\s*{re.escape(pid)}\b",
                rf"\bPID\s*[:=]?\s*{re.escape(pid)}\b",
            )
        )
        if PACKAGE in context or any(re.search(marker, context) for marker in pid_markers):
            return "native fatal signal"
    return None


class SmokeFailure(RuntimeError):
    """The APK failed a native smoke-test assertion."""


class CredentialBlocker(SmokeFailure):
    """Startup passed, but a full login could not run without credentials."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Install a release APK, launch it with adb, and verify it through UIAutomator.",
    )
    parser.add_argument("--apk", required=True, type=Path, help="Standalone APK to install")
    parser.add_argument("--serial", help="adb device serial; required when more than one is online")
    parser.add_argument("--adb", type=Path, help="path to adb (otherwise use ANDROID_* or PATH)")
    parser.add_argument("--output-dir", type=Path, help="directory for logcat/UI evidence")
    parser.add_argument(
        "--startup-only",
        action="store_true",
        help="explicitly stop after verifying the login screen; do not attempt authentication",
    )
    return parser.parse_args()


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
                raise SmokeFailure(
                    "adb was not found; pass --adb or set ANDROID_SDK_ROOT/ANDROID_HOME",
                )
            candidate = Path(located).resolve()
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        raise SmokeFailure(f"adb is not an executable file: {candidate}")
    return candidate


def run(
    command: list[str],
    *,
    check: bool = True,
    binary: bool = False,
    sensitive: bool = False,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]:
    if binary and input_text is not None:
        raise SmokeFailure("run() cannot combine binary output with text input")
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=not binary,
            input=input_text,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as cause:
        label = command[0] if sensitive else " ".join(command)
        raise SmokeFailure(f"Failed to run {label}: {cause}") from cause
    if check and result.returncode != 0:
        label = command[0] if sensitive else " ".join(command)
        stdout = (
            "<redacted>"
            if sensitive
            else result.stdout if isinstance(result.stdout, str) else "<binary>"
        )
        stderr = (
            "<redacted>"
            if sensitive
            else result.stderr if isinstance(result.stderr, str) else "<binary>"
        )
        raise SmokeFailure(
            f"Command failed ({result.returncode}): {label}\n"
            f"stdout: {stdout.strip()}\nstderr: {stderr.strip()}",
        )
    return result


class AndroidSmoke:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.apk = args.apk.expanduser().resolve()
        if not self.apk.is_file() or self.apk.stat().st_size == 0:
            raise SmokeFailure(f"APK is missing or empty: {self.apk}")
        self.adb_path = resolve_adb(args.adb)
        timestamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        self.output_dir = (
            args.output_dir.expanduser().resolve()
            if args.output_dir
            else Path(tempfile.gettempdir()) / f"loggerythm-android-smoke-{timestamp}"
        )
        self.output_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
        self.output_dir.chmod(0o700)
        self.serial = ""
        self.pid = ""
        self.app_pids: set[str] = set()
        # Remove credentials from this process's environment before spawning adb.
        # They remain only in memory and are never inherited by child processes.
        self.email = os.environ.pop(EMAIL_ENV, None)
        self.password = os.environ.pop(PASSWORD_ENV, None)
        if (self.email is None) != (self.password is None):
            raise SmokeFailure(f"Set both {EMAIL_ENV} and {PASSWORD_ENV}, or neither")
        if self.email == "" or self.password == "":
            raise SmokeFailure(f"{EMAIL_ENV} and {PASSWORD_ENV} must not be empty")
        self.credentials_entered = False
        self.artifact_failures: list[str] = []
        self.summary: dict[str, object] = {
            "started_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "completed_at_utc": None,
            "apk": str(self.apk),
            "apk_bytes": self.apk.stat().st_size,
            "apk_sha256": hashlib.sha256(self.apk.read_bytes()).hexdigest(),
            "startup_verified": False,
            "production_origin_verified": False,
            "effective_api_origin": None,
            "installed_package": None,
            "device": None,
            "launches": {
                "cold": {"status": "not_checked", "pid": None},
                "warm": {"status": "not_checked", "pid": None},
            },
            "standalone_runtime": {
                "non_debuggable_package": False,
                "metro_reverse_absent": False,
                "embedded_js_ui_rendered": False,
                "metro_runtime_errors_absent": False,
            },
            "runtime_log_audit": {
                "status": "not_checked",
                "phases": [],
                "pids": [],
            },
            "standalone_release_verified": False,
            "login_tested": False,
            "authenticated_navigation_verified": False,
            "five_tab_shell_verified": False,
            "tab_destinations_verified": [],
            "profile_access": {
                "status": "not_checked",
                "entry_test_id": None,
            },
            "player_and_browse_tree_survived": False,
            "credential_blocker": None,
            "overall_status": "not_run",
            "startup_only_requested": args.startup_only,
        }

    def adb(self, arguments: list[str], *, check: bool = True, sensitive: bool = False):
        prefix = [str(self.adb_path)]
        if self.serial:
            prefix += ["-s", self.serial]
        return run(prefix + arguments, check=check, sensitive=sensitive)

    def adb_shell_stdin(self, script: str, *, sensitive: bool = True) -> None:
        """Run a private shell script without placing its contents in process argv."""
        prefix = [str(self.adb_path)]
        if self.serial:
            prefix += ["-s", self.serial]
        run(prefix + ["shell", "sh"], input_text=script, sensitive=sensitive)

    @staticmethod
    def input_text_script(value: str) -> str:
        """Build shell-safe, character-at-a-time Android input commands."""
        if any(ord(character) < 0x20 or ord(character) == 0x7F for character in value):
            raise SmokeFailure("Test credentials must not contain control characters")
        commands = ["set -eu"]
        for character in value:
            # Android's input command uses %s for a literal space. Sending one
            # character per command prevents a literal "%s" in a password from
            # being mistaken for a space and keeps the complete secret out of argv.
            encoded = "%s" if character == " " else character
            commands.append(f"input text {shlex.quote(encoded)}")
        return "\n".join(commands) + "\n"

    @staticmethod
    def write_private_text(path: Path, value: str) -> None:
        path.write_text(value, encoding="utf-8")
        path.chmod(0o600)

    @staticmethod
    def write_private_bytes(path: Path, value: bytes) -> None:
        path.write_bytes(value)
        path.chmod(0o600)

    def select_device(self) -> None:
        result = run([str(self.adb_path), "devices", "-l"])
        assert isinstance(result.stdout, str)
        devices: dict[str, str] = {}
        for line in result.stdout.splitlines()[1:]:
            if not line.strip():
                continue
            fields = line.split()
            if len(fields) >= 2:
                devices[fields[0]] = fields[1]
        if self.args.serial:
            state = devices.get(self.args.serial)
            if state != "device":
                raise SmokeFailure(
                    f"Requested adb device {self.args.serial!r} is not online (state={state!r})",
                )
            self.serial = self.args.serial
        else:
            online = [serial for serial, state in devices.items() if state == "device"]
            if len(online) != 1:
                raise SmokeFailure(
                    f"Expected exactly one online adb device, found {len(online)}: {devices}",
                )
            self.serial = online[0]
        self.summary["serial"] = self.serial

    def clean_install_and_launch(self) -> None:
        # `pm path` exits 1 when the package is absent, which is the expected
        # state on a fresh emulator and must not prevent the clean install.
        installed = self.adb(["shell", "pm", "path", PACKAGE], check=False)
        assert isinstance(installed.stdout, str)
        if installed.stdout.strip():
            self.adb(["uninstall", PACKAGE])
        install = self.adb(["install", "--no-streaming", str(self.apk)])
        assert isinstance(install.stdout, str)
        if "Success" not in install.stdout:
            raise SmokeFailure(f"adb install did not report success: {install.stdout.strip()}")
        self.collect_install_evidence()
        self.adb(["shell", "am", "force-stop", PACKAGE])
        # The evidence window begins after intentional uninstall/force-stop
        # lifecycle events so they cannot be mistaken for a release crash.
        self.adb(["logcat", "-c"])
        self.launch_activity("cold")

    def launch_activity(self, phase: str) -> None:
        launch = self.adb(["shell", "am", "start", "-W", "-n", ACTIVITY])
        assert isinstance(launch.stdout, str)
        if "Status: ok" not in launch.stdout:
            raise SmokeFailure(
                f"Activity {phase} launch did not report Status: ok: {launch.stdout.strip()}",
            )
        time.sleep(1)
        self.assert_alive(f"{phase} launch")
        launches = self.summary["launches"]
        assert isinstance(launches, dict)
        launches[phase] = {"status": "passed", "pid": self.pid}

    def collect_install_evidence(self) -> None:
        package_result = self.adb(["shell", "dumpsys", "package", PACKAGE])
        assert isinstance(package_result.stdout, str)
        package_metadata = installed_package_metadata(package_result.stdout)
        if package_metadata["debuggable"]:
            raise SmokeFailure("Installed APK is debuggable; it is not a standalone release package")

        reverse_result = self.adb(["reverse", "--list"])
        assert isinstance(reverse_result.stdout, str)
        if metro_reverse_present(reverse_result.stdout):
            raise SmokeFailure(
                "A Metro/Expo adb reverse is active; remove it before standalone release QA",
            )

        def device_property(name: str, *, required: bool = True) -> str:
            result = self.adb(["shell", "getprop", name])
            assert isinstance(result.stdout, str)
            value = result.stdout.strip()
            if required and not value:
                raise SmokeFailure(f"Device did not report required property {name}")
            return value

        emulator_property = device_property("ro.kernel.qemu", required=False)
        self.summary["installed_package"] = {
            "package": PACKAGE,
            **package_metadata,
        }
        self.summary["device"] = {
            "build_fingerprint": device_property("ro.build.fingerprint"),
            "api_level": int(device_property("ro.build.version.sdk")),
            "primary_abi": device_property("ro.product.cpu.abi"),
            "is_emulator": emulator_property == "1",
        }
        standalone = self.summary["standalone_runtime"]
        assert isinstance(standalone, dict)
        standalone["non_debuggable_package"] = True
        standalone["metro_reverse_absent"] = True

    def assert_alive(self, phase: str) -> None:
        result = self.adb(["shell", "pidof", "-s", PACKAGE], check=False)
        assert isinstance(result.stdout, str)
        pid = result.stdout.strip()
        if result.returncode != 0 or not pid:
            raise SmokeFailure(f"LoggeRythm process died during {phase}")
        if self.pid and pid != self.pid:
            raise SmokeFailure(
                f"LoggeRythm process restarted during {phase} (was {self.pid}, now {pid})",
            )
        self.pid = pid
        self.app_pids.add(pid)
        audit = self.summary["runtime_log_audit"]
        assert isinstance(audit, dict)
        audit["pids"] = sorted(self.app_pids)

    def redact(self, value: str) -> str:
        for secret in (self.email, self.password):
            if secret:
                representations = {
                    secret,
                    html.escape(secret, quote=True),
                    json.dumps(secret)[1:-1],
                    quote(secret, safe=""),
                    quote_plus(secret, safe=""),
                }
                for representation in sorted(representations, key=len, reverse=True):
                    value = value.replace(representation, "<redacted>")
        return value

    def dump_ui(self, name: str, *, persist: bool) -> tuple[ET.Element, str]:
        remote = "/data/local/tmp/loggerythm-smoke-window.xml"
        result: subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]
        try:
            self.adb_shell_stdin(
                "set -eu\n"
                "umask 077\n"
                f"uiautomator dump {shlex.quote(remote)} >/dev/null\n",
                sensitive=False,
            )
            result = self.adb(["exec-out", "cat", remote])
            assert isinstance(result.stdout, str)
        finally:
            self.adb(["shell", "rm", "-f", remote])
        try:
            root = ET.fromstring(result.stdout)
        except ET.ParseError as cause:
            raise SmokeFailure(f"UIAutomator returned invalid XML during {name}: {cause}") from cause
        if persist:
            if self.credentials_entered:
                raise SmokeFailure(
                    f"Refusing to persist UI XML after credential entry during {name}",
                )
            self.write_private_text(
                self.output_dir / f"window-{name}.xml",
                self.redact(result.stdout),
            )
        return root, result.stdout

    @staticmethod
    def nodes(root: ET.Element) -> list[dict[str, str]]:
        return [dict(node.attrib) for node in root.iter("node")]

    @staticmethod
    def center(node: dict[str, str], label: str) -> tuple[int, int]:
        match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if match is None:
            raise SmokeFailure(f"{label} has invalid UIAutomator bounds: {node.get('bounds')!r}")
        left, top, right, bottom = (int(value) for value in match.groups())
        return (left + right) // 2, (top + bottom) // 2

    @staticmethod
    def find_node(
        nodes: list[dict[str, str]],
        *,
        text: str | None = None,
        description: str | None = None,
        resource_suffix: str | None = None,
        class_name: str | None = None,
        editable: bool | None = None,
        clickable: bool | None = None,
        enabled: bool | None = None,
        password: bool | None = None,
    ) -> dict[str, str] | None:
        for node in nodes:
            matches = (
                (text is None or node.get("text") == text)
                and (description is None or node.get("content-desc") == description)
                and (
                    resource_suffix is None
                    or node.get("resource-id", "").endswith(resource_suffix)
                )
                and (class_name is None or node.get("class") == class_name)
                and (
                    editable is None
                    or (
                        node.get("editable") == str(editable).lower()
                        or (
                            editable
                            and node.get("class") == "android.widget.EditText"
                        )
                    )
                )
                and (clickable is None or node.get("clickable") == str(clickable).lower())
                and (enabled is None or node.get("enabled") == str(enabled).lower())
                and (password is None or node.get("password") == str(password).lower())
            )
            if matches:
                return node
        return None

    @staticmethod
    def has_label(nodes: list[dict[str, str]], label: str) -> bool:
        return any(
            node.get("text") == label or node.get("content-desc") == label for node in nodes
        )

    @staticmethod
    def has_resource_suffix(nodes: list[dict[str, str]], suffix: str) -> bool:
        return not missing_resource_suffixes(nodes, (suffix,))

    def find_login_input(
        self,
        nodes: list[dict[str, str]],
        *,
        resource_suffix: str,
        label: str,
        password: bool,
    ) -> dict[str, str] | None:
        common = {
            "editable": True,
            "clickable": True,
            "enabled": True,
            "password": password,
        }
        return (
            self.find_node(nodes, resource_suffix=resource_suffix, **common)
            or self.find_node(nodes, description=label, **common)
            or self.find_node(nodes, text=label, **common)
        )

    def find_submit(self, nodes: list[dict[str, str]]) -> dict[str, str] | None:
        common = {"clickable": True, "enabled": True}
        return (
            self.find_node(nodes, resource_suffix="login-submit", **common)
            or self.find_node(nodes, description="Sign in", **common)
            or self.find_node(nodes, text="Sign in", **common)
        )

    def find_rendered_login_submit(
        self,
        nodes: list[dict[str, str]],
    ) -> dict[str, str] | None:
        """Find the stable login control before credentials enable it.

        Visible copy is localized, so startup evidence must be anchored to the
        resource id emitted from the React Native testID rather than English text.
        """
        return self.find_node(
            nodes,
            resource_suffix="login-submit",
            clickable=True,
        )

    def verify_login_screen(
        self,
        phase: str = "cold",
    ) -> tuple[dict[str, str], dict[str, str]]:
        last_labels: set[str] = set()
        for attempt in range(1, 13):
            if attempt > 1:
                time.sleep(2.5)
            self.assert_alive(f"{phase} login screen wait {attempt}")
            root, raw_xml = self.dump_ui(
                f"{phase}-startup-wait-{attempt:02d}",
                persist=False,
            )
            nodes = self.nodes(root)
            last_labels = {
                value
                for node in nodes
                for value in (node.get("text", ""), node.get("content-desc", ""))
                if value
            }
            email_node = self.find_login_input(
                nodes,
                resource_suffix="login-email",
                label="Email address",
                password=False,
            ) or self.find_login_input(
                nodes,
                resource_suffix="login-email",
                label="Email",
                password=False,
            )
            password_node = self.find_login_input(
                nodes,
                resource_suffix="login-password",
                label="Password",
                password=True,
            )
            submit_node = self.find_rendered_login_submit(nodes)
            if (
                self.has_label(nodes, "LoggeRythm")
                and email_node is not None
                and password_node is not None
                and submit_node is not None
            ):
                self.write_private_text(
                    self.output_dir
                    / ("window-startup.xml" if phase == "cold" else f"window-{phase}.xml"),
                    self.redact(raw_xml),
                )
                self.summary["startup_verified"] = True
                standalone = self.summary["standalone_runtime"]
                assert isinstance(standalone, dict)
                standalone["embedded_js_ui_rendered"] = True
                return email_node, password_node
        raise SmokeFailure(
            f"Login screen did not become ready during {phase} launch within 30 seconds; "
            f"last labels={sorted(self.redact(label) for label in last_labels)}",
        )

    def verify_production_origin(self) -> None:
        for attempt in range(1, 9):
            logcat = self.read_logcat()
            origins = runtime_api_origins(logcat)
            if API_ORIGIN_FAILURE_MARKER in logcat:
                raise SmokeFailure("The app rejected its runtime API origin configuration")
            unexpected = sorted(set(origins) - {PRODUCTION_ORIGIN})
            if unexpected:
                raise SmokeFailure(
                    "Runtime logcat reports a non-production effective API origin",
                )
            if production_origin_marker_present(logcat):
                self.summary["production_origin_verified"] = True
                self.summary["effective_api_origin"] = PRODUCTION_ORIGIN
                return
            if attempt < 8:
                time.sleep(0.25)
        raise SmokeFailure(
            "Runtime logcat did not prove that the effective API origin is production",
        )

    def verify_warm_launch(self) -> tuple[dict[str, str], dict[str, str]]:
        cold_pid = self.pid
        if not cold_pid:
            raise SmokeFailure("Cannot verify a warm launch before a cold process exists")
        self.adb(["shell", "input", "keyevent", "KEYCODE_HOME"])
        time.sleep(0.75)
        self.assert_alive("backgrounding before warm launch")
        self.launch_activity("warm")
        if self.pid != cold_pid:
            raise SmokeFailure(
                f"Warm launch replaced the process (was {cold_pid}, now {self.pid})",
            )
        return self.verify_login_screen("warm")

    def input_credentials(
        self,
        email_node: dict[str, str],
        password_node: dict[str, str],
    ) -> None:
        assert self.email is not None and self.password is not None
        self.credentials_entered = True
        for node, value, label, is_password in (
            (email_node, self.email, "email input", False),
            (password_node, self.password, "password input", True),
        ):
            if is_password:
                current, _ = self.dump_ui("before-password-entry", persist=False)
                current_nodes = self.nodes(current)
                node = self.find_login_input(
                    current_nodes,
                    resource_suffix="login-password",
                    label="Password",
                    password=True,
                )
                if node is None:
                    raise SmokeFailure(
                        "Could not relocate the password input after the Android keyboard opened",
                    )
            x, y = self.center(node, label)
            self.adb(["shell", "input", "tap", str(x), str(y)])
            self.adb_shell_stdin(self.input_text_script(value))
            if not is_password:
                current, _ = self.dump_ui("after-email-entry", persist=False)
                current_nodes = self.nodes(current)
                populated_email = (
                    self.find_node(
                        current_nodes,
                        resource_suffix="login-email",
                        editable=True,
                        clickable=True,
                        enabled=True,
                        password=False,
                    )
                    or self.find_node(
                        current_nodes,
                        description="Email address",
                        editable=True,
                        clickable=True,
                        enabled=True,
                        password=False,
                    )
                    or self.find_node(
                        current_nodes,
                        class_name="android.widget.EditText",
                        editable=True,
                        clickable=True,
                        enabled=True,
                        password=False,
                    )
                )
                if populated_email is None or populated_email.get("text") != self.email:
                    raise SmokeFailure(
                        "The email input did not receive the credential exactly; "
                        "check Android input-method character support",
                    )
        time.sleep(2.5)
        filled, _ = self.dump_ui("credentials-entered", persist=False)
        submit = self.find_submit(self.nodes(filled))
        if submit is None:
            raise SmokeFailure("Could not locate the enabled Sign in button after entering credentials")
        x, y = self.center(submit, "Sign in button")
        self.adb(["shell", "input", "tap", str(x), str(y)])
        self.summary["login_tested"] = True

    @staticmethod
    def authenticated_navigation_visible(nodes: list[dict[str, str]]) -> bool:
        # Copy is localized and may change. The five production testIDs plus a
        # mounted destination are the authoritative readiness contract.
        return authenticated_shell_visible(nodes)

    def find_profile_access(
        self,
        nodes: list[dict[str, str]],
    ) -> tuple[str, dict[str, str]] | None:
        for suffix in PROFILE_ACCESS_SUFFIXES:
            node = self.find_node(
                nodes,
                resource_suffix=suffix,
                clickable=True,
                enabled=True,
            )
            if node is not None:
                return suffix, node
            if self.has_resource_suffix(nodes, suffix):
                raise SmokeFailure(
                    f"Profile entry {suffix!r} is rendered but is not enabled and clickable",
                )
        return None

    def wait_for_tab_destination(
        self,
        tab_suffix: str,
        screen_suffix: str,
    ) -> list[dict[str, str]]:
        tab_suffixes = tuple(tab for tab, _ in TAB_DESTINATIONS)
        last_missing_tabs: list[str] = list(tab_suffixes)
        for attempt in range(1, 9):
            if attempt > 1:
                time.sleep(0.75)
            self.assert_alive(f"{tab_suffix} navigation wait {attempt}")
            root, _ = self.dump_ui(
                f"{tab_suffix}-wait-{attempt:02d}",
                persist=False,
            )
            nodes = self.nodes(root)
            last_missing_tabs = missing_resource_suffixes(nodes, tab_suffixes)
            if not last_missing_tabs and self.has_resource_suffix(nodes, screen_suffix):
                return nodes
            if self.has_resource_suffix(nodes, "player-startup-error"):
                raise SmokeFailure(
                    f"Native player startup failed while opening {tab_suffix}",
                )
        raise SmokeFailure(
            f"{tab_suffix} did not mount {screen_suffix!r}; "
            f"missing shell testIDs={last_missing_tabs}",
        )

    def verify_profile_access(
        self,
        entry_suffix: str,
        entry_node: dict[str, str],
        return_tab_suffix: str,
        return_screen_suffix: str,
    ) -> None:
        x, y = self.center(entry_node, f"{entry_suffix} control")
        self.adb(["shell", "input", "tap", str(x), str(y)])
        for attempt in range(1, 9):
            if attempt > 1:
                time.sleep(0.75)
            self.assert_alive(f"profile navigation wait {attempt}")
            root, _ = self.dump_ui(f"profile-wait-{attempt:02d}", persist=False)
            if self.has_resource_suffix(self.nodes(root), PROFILE_SCREEN_SUFFIX):
                break
        else:
            raise SmokeFailure(
                f"Profile entry {entry_suffix!r} did not mount {PROFILE_SCREEN_SUFFIX!r}",
            )

        self.summary["profile_access"] = {
            "status": "verified",
            "entry_test_id": entry_suffix,
        }
        self.adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
        self.wait_for_tab_destination(return_tab_suffix, return_screen_suffix)

    def verify_tab_destinations(self) -> None:
        verified: list[str] = []
        profile_checked = False
        for tab_suffix, screen_suffix in TAB_DESTINATIONS:
            root, _ = self.dump_ui(f"before-{tab_suffix}", persist=False)
            nodes = self.nodes(root)
            tab_node = self.find_node(
                nodes,
                resource_suffix=tab_suffix,
                clickable=True,
                enabled=True,
            )
            if tab_node is None:
                if self.has_resource_suffix(nodes, tab_suffix):
                    raise SmokeFailure(
                        f"Tab {tab_suffix!r} is rendered but is not enabled and clickable",
                    )
                raise SmokeFailure(f"Authenticated shell is missing tab {tab_suffix!r}")
            x, y = self.center(tab_node, f"{tab_suffix} control")
            self.adb(["shell", "input", "tap", str(x), str(y)])
            destination_nodes = self.wait_for_tab_destination(tab_suffix, screen_suffix)
            verified.append(tab_suffix)
            self.summary["tab_destinations_verified"] = list(verified)

            if not profile_checked:
                profile_access = self.find_profile_access(destination_nodes)
                if profile_access is not None:
                    entry_suffix, entry_node = profile_access
                    self.verify_profile_access(
                        entry_suffix,
                        entry_node,
                        tab_suffix,
                        screen_suffix,
                    )
                    profile_checked = True

        self.summary["five_tab_shell_verified"] = True
        if not profile_checked:
            self.summary["profile_access"] = {
                "status": "not_discoverable_by_stable_test_id",
                "entry_test_id": None,
            }

    def wait_for_authenticated_navigation(self) -> None:
        last_visible: set[str] = set()
        for attempt in range(1, 13):
            time.sleep(3)
            self.assert_alive(f"login wait {attempt}")
            root, _ = self.dump_ui(f"login-wait-{attempt:02d}", persist=False)
            nodes = self.nodes(root)
            last_visible = {node.get("text", "") for node in nodes if node.get("text")}
            if self.has_resource_suffix(nodes, "approval-screen") or any(
                label in last_visible for label in ("Waiting for approval", "Freigabe ausstehend")
            ):
                raise SmokeFailure("Test account authenticated but is not approved")
            if self.has_resource_suffix(nodes, "session-restore-error"):
                raise SmokeFailure("Session restore failed after authentication")
            if self.has_resource_suffix(nodes, "player-startup-error"):
                raise SmokeFailure("Native player startup failed after authentication")
            if self.authenticated_navigation_visible(nodes):
                self.summary["authenticated_navigation_verified"] = True
                break
            login_errors = [
                text
                for text in last_visible
                if text.startswith("POST /api/auth/login") or "Invalid credentials" in text
            ]
            if login_errors:
                raise SmokeFailure(
                    f"Test account login failed: {self.redact(login_errors[0])}",
                )
        else:
            safe_visible = sorted(self.redact(text) for text in last_visible)
            raise SmokeFailure(
                f"Authenticated navigation did not appear within 36 seconds; visible={safe_visible}",
            )

        self.verify_tab_destinations()

        # The reported crash occurs after the library calls complete and the
        # authenticated Android Auto browse tree crosses the TurboModule bridge.
        time.sleep(15)
        self.assert_alive("post-login player and Android Auto initialization")
        stable_root, _ = self.dump_ui("post-login-stable", persist=False)
        if not self.authenticated_navigation_visible(self.nodes(stable_root)):
            raise SmokeFailure(
                "Authenticated navigation disappeared during post-login player and "
                "Android Auto initialization",
            )
        logcat = self.read_logcat()
        required_markers = (
            "[LoggeRythm] app gate: authenticated",
            "[LoggeRythm] native player setup starting",
            "[LoggeRythm] native player commands/listeners ready",
            "[LoggeRythm] Android Auto library ready",
        )
        missing = [marker for marker in required_markers if marker not in logcat]
        if missing:
            raise SmokeFailure(f"Post-login logcat is missing readiness markers: {missing}")
        self.assert_runtime_log_clean("authenticated-native-ready", logcat=logcat)
        self.summary["player_and_browse_tree_survived"] = True

    def read_logcat(self) -> str:
        result = self.adb(["logcat", "-d", "-v", "threadtime"])
        assert isinstance(result.stdout, str)
        return result.stdout

    def assert_no_app_fatal(self, logcat: str) -> None:
        reason = app_runtime_failure(logcat, self.app_pids)
        if reason is not None:
            raise SmokeFailure(f"logcat contains a LoggeRythm {reason}")

    def assert_runtime_log_clean(self, phase: str, *, logcat: str | None = None) -> None:
        inspected = self.read_logcat() if logcat is None else logcat
        self.assert_no_app_fatal(inspected)
        metro_failure = metro_runtime_failure(inspected, self.app_pids)
        if metro_failure is not None:
            raise SmokeFailure(
                f"logcat contains an app-scoped Metro/dev-server failure: {metro_failure}",
            )
        audit = self.summary["runtime_log_audit"]
        assert isinstance(audit, dict)
        phases = audit["phases"]
        assert isinstance(phases, list)
        if phase not in phases:
            phases.append(phase)
        audit["status"] = "passed"
        audit["pids"] = sorted(self.app_pids)
        standalone = self.summary["standalone_runtime"]
        assert isinstance(standalone, dict)
        standalone["metro_runtime_errors_absent"] = True

    def capture_startup_screenshot(self) -> None:
        if self.credentials_entered:
            raise SmokeFailure("Refusing to capture a screenshot after credential entry")
        binary = run(
            [str(self.adb_path), "-s", self.serial, "exec-out", "screencap", "-p"],
            binary=True,
        )
        assert isinstance(binary.stdout, bytes)
        if not binary.stdout.startswith(b"\x89PNG\r\n\x1a\n"):
            raise SmokeFailure("adb screencap did not return a PNG")
        self.write_private_bytes(self.output_dir / "screen-startup.png", binary.stdout)

    def capture_artifacts(self) -> list[str]:
        failures = list(self.artifact_failures)
        try:
            self.assert_alive("final evidence capture")
        except Exception as cause:  # noqa: BLE001 - collected and reported by the caller
            failures.append(f"process state: {cause}")
        try:
            logcat = self.read_logcat()
            self.write_private_text(self.output_dir / "logcat.txt", self.redact(logcat))
            self.assert_runtime_log_clean("final-evidence", logcat=logcat)
        except Exception as cause:  # noqa: BLE001 - collected and reported by the caller
            failures.append(f"logcat: {cause}")
        if not (self.output_dir / "screen-startup.png").exists() and not self.credentials_entered:
            try:
                self.capture_startup_screenshot()
            except Exception as cause:  # noqa: BLE001 - collected and reported by the caller
                failures.append(f"startup screenshot: {cause}")
        return failures

    def run(self) -> None:
        self.select_device()
        self.clean_install_and_launch()
        email_node, password_node = self.verify_login_screen("cold")
        self.verify_production_origin()
        self.assert_runtime_log_clean("cold-launch")
        try:
            self.capture_startup_screenshot()
        except Exception as cause:  # noqa: BLE001 - collected and reported after the smoke flow
            self.artifact_failures.append(f"startup screenshot: {cause}")
        email_node, password_node = self.verify_warm_launch()
        self.assert_runtime_log_clean("warm-launch")
        standalone = self.summary["standalone_runtime"]
        launches = self.summary["launches"]
        audit = self.summary["runtime_log_audit"]
        assert isinstance(standalone, dict)
        assert isinstance(launches, dict)
        assert isinstance(audit, dict)
        self.summary["standalone_release_verified"] = bool(
            self.summary["production_origin_verified"]
            and launches["cold"]["status"] == "passed"
            and launches["warm"]["status"] == "passed"
            and all(standalone.values())
            and audit["status"] == "passed"
        )
        if not self.summary["standalone_release_verified"]:
            raise SmokeFailure("Standalone release assertions ended without complete evidence")
        if self.args.startup_only:
            self.summary["credential_blocker"] = (
                "Standalone cold/warm release QA passed; full login deliberately not tested "
                "because --startup-only was requested. Rerun without --startup-only with an "
                "approved test account"
            )
            return
        if self.email is None:
            message = (
                f"Standalone APK startup passed, but full login is blocked: set {EMAIL_ENV} and "
                f"{PASSWORD_ENV} with an approved test account"
            )
            self.summary["credential_blocker"] = message
            raise CredentialBlocker(message)
        self.input_credentials(email_node, password_node)
        self.wait_for_authenticated_navigation()


def die(message: str, code: int) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def main() -> None:
    args = parse_args()
    smoke: AndroidSmoke | None = None
    failure: Exception | None = None
    try:
        smoke = AndroidSmoke(args)
        smoke.run()
    except Exception as cause:  # noqa: BLE001 - evidence is captured, then the failure is reported
        failure = cause

    artifact_failures: list[str] = []
    if smoke is not None and smoke.serial:
        artifact_failures = smoke.capture_artifacts()
    if artifact_failures:
        detail = "; ".join(artifact_failures)
        if failure is None:
            failure = SmokeFailure(f"Smoke assertions passed but artifact capture failed: {detail}")
        else:
            failure = SmokeFailure(f"{failure}; artifact capture also failed: {detail}")
    if smoke is not None:
        smoke.summary["completed_at_utc"] = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ",
            time.gmtime(),
        )
        if failure is not None:
            overall_status = "blocked" if isinstance(failure, CredentialBlocker) else "failed"
        elif args.startup_only:
            overall_status = "limited"
        elif all(
            smoke.summary[key]
            for key in (
                "startup_verified",
                "production_origin_verified",
                "standalone_release_verified",
                "login_tested",
                "authenticated_navigation_verified",
                "five_tab_shell_verified",
                "player_and_browse_tree_survived",
            )
        ):
            overall_status = "passed"
        else:
            failure = SmokeFailure("Smoke flow ended without satisfying all full-test assertions")
            overall_status = "failed"
        smoke.summary["overall_status"] = overall_status
        smoke.summary["error"] = smoke.redact(str(failure)) if failure else None
        smoke.summary["artifact_capture_failures"] = [
            smoke.redact(item) for item in artifact_failures
        ]
        smoke.write_private_text(
            smoke.output_dir / "summary.json",
            json.dumps(smoke.summary, indent=2, sort_keys=True) + "\n",
        )
        print(f"Android smoke status: {overall_status}")
        print(f"Android smoke evidence: {smoke.output_dir}")
    if failure is not None:
        code = 2 if isinstance(failure, CredentialBlocker) else 1
        safe_failure = smoke.redact(str(failure)) if smoke is not None else str(failure)
        die(f"Android smoke failed: {safe_failure}", code)
    assert smoke is not None
    if smoke.summary["overall_status"] == "passed":
        print("Android standalone APK smoke passed, including approved-account login.")
    else:
        blocker = smoke.summary.get("credential_blocker")
        print(f"Android startup smoke passed (limited; login was not tested). {blocker}")


if __name__ == "__main__":
    main()
