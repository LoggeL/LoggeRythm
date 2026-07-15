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
EMAIL_ENV = "LOGGERYTHM_TEST_EMAIL"
PASSWORD_ENV = "LOGGERYTHM_TEST_PASSWORD"


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
            "apk": str(self.apk),
            "apk_sha256": hashlib.sha256(self.apk.read_bytes()).hexdigest(),
            "startup_verified": False,
            "login_tested": False,
            "authenticated_navigation_verified": False,
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
        self.adb(["logcat", "-c"])
        install = self.adb(["install", "--no-streaming", str(self.apk)])
        assert isinstance(install.stdout, str)
        if "Success" not in install.stdout:
            raise SmokeFailure(f"adb install did not report success: {install.stdout.strip()}")
        self.adb(["shell", "am", "force-stop", PACKAGE])
        launch = self.adb(["shell", "am", "start", "-W", "-n", ACTIVITY])
        assert isinstance(launch.stdout, str)
        if "Status: ok" not in launch.stdout:
            raise SmokeFailure(f"Activity launch did not report Status: ok: {launch.stdout.strip()}")
        time.sleep(1)
        self.assert_alive("cold launch")

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

    def verify_login_screen(self) -> tuple[dict[str, str], dict[str, str]]:
        last_labels: set[str] = set()
        for attempt in range(1, 13):
            if attempt > 1:
                time.sleep(2.5)
            self.assert_alive(f"login screen wait {attempt}")
            root, raw_xml = self.dump_ui(f"startup-wait-{attempt:02d}", persist=False)
            nodes = self.nodes(root)
            last_labels = {
                value
                for node in nodes
                for value in (node.get("text", ""), node.get("content-desc", ""))
                if value
            }
            required = ("LoggeRythm", "Sign in to your library", "Sign in")
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
            if (
                all(self.has_label(nodes, label) for label in required)
                and email_node is not None
                and password_node is not None
            ):
                self.write_private_text(
                    self.output_dir / "window-startup.xml",
                    self.redact(raw_xml),
                )
                self.summary["startup_verified"] = True
                return email_node, password_node
        raise SmokeFailure(
            "Login screen did not become ready within 30 seconds; "
            f"last labels={sorted(self.redact(label) for label in last_labels)}",
        )

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

    def authenticated_navigation_visible(self, nodes: list[dict[str, str]]) -> bool:
        return (
            self.has_label(nodes, "Search") and self.has_label(nodes, "Library")
        ) or self.has_label(nodes, "Search songs and artists")

    def wait_for_authenticated_navigation(self) -> None:
        last_visible: set[str] = set()
        for attempt in range(1, 13):
            time.sleep(3)
            self.assert_alive(f"login wait {attempt}")
            root, _ = self.dump_ui(f"login-wait-{attempt:02d}", persist=False)
            nodes = self.nodes(root)
            last_visible = {node.get("text", "") for node in nodes if node.get("text")}
            if "Waiting for approval" in last_visible:
                raise SmokeFailure("Test account authenticated but is not approved")
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
        self.assert_no_app_fatal(logcat)
        self.summary["player_and_browse_tree_survived"] = True

    def read_logcat(self) -> str:
        result = self.adb(["logcat", "-d", "-v", "threadtime"])
        assert isinstance(result.stdout, str)
        return result.stdout

    def assert_no_app_fatal(self, logcat: str) -> None:
        for match in re.finditer(r"FATAL EXCEPTION", logcat):
            block = logcat[match.start() : match.start() + 6000]
            if f"Process: {PACKAGE}" in block or (self.pid and f"PID: {self.pid}" in block):
                raise SmokeFailure("logcat contains a fatal exception for LoggeRythm")
        package = re.escape(PACKAGE)
        fatal_patterns = (
            (rf"\bANR in {package}\b", "an ANR"),
            (rf"\bForce finishing activity\b[^\n]*{package}", "a force-finished activity"),
            (rf"\bProcess {package}\b[^\n]*(?:has died|died)", "an app process death"),
            (rf"\bKilling \d+:{package}(?:/|\s)", "an app process kill"),
            (rf"\bam_(?:anr|crash|proc_died)\b[^\n]*{package}", "an app exit event"),
            (rf"\bWIN DEATH\b[^\n]*{package}", "an app window death"),
        )
        for pattern, label in fatal_patterns:
            if re.search(pattern, logcat, flags=re.IGNORECASE):
                raise SmokeFailure(f"logcat contains {label} for LoggeRythm")
        if re.search(r"\b[EF]\s+ReactNativeJS\s*:", logcat):
            raise SmokeFailure("logcat contains a ReactNativeJS error for LoggeRythm")

        lines = logcat.splitlines()
        for index, line in enumerate(lines):
            if "Fatal signal" not in line and "Abort message" not in line:
                continue
            context = "\n".join(lines[max(0, index - 30) : index + 160])
            pid_markers = (
                rf"\bpid\s*[:=]?\s*{re.escape(self.pid)}\b" if self.pid else r"(?!)",
                rf"\bPID\s*[:=]?\s*{re.escape(self.pid)}\b" if self.pid else r"(?!)",
            )
            if PACKAGE in context or any(re.search(marker, context) for marker in pid_markers):
                raise SmokeFailure("logcat contains a native fatal signal for LoggeRythm")

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
            self.assert_no_app_fatal(logcat)
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
        email_node, password_node = self.verify_login_screen()
        try:
            self.capture_startup_screenshot()
        except Exception as cause:  # noqa: BLE001 - collected and reported after the smoke flow
            self.artifact_failures.append(f"startup screenshot: {cause}")
        if self.args.startup_only:
            self.summary["credential_blocker"] = (
                "Full login deliberately not tested because --startup-only was requested; "
                "rerun without --startup-only with an approved test account"
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
        if failure is not None:
            overall_status = "blocked" if isinstance(failure, CredentialBlocker) else "failed"
        elif args.startup_only:
            overall_status = "limited"
        elif all(
            smoke.summary[key]
            for key in (
                "startup_verified",
                "login_tested",
                "authenticated_navigation_verified",
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
