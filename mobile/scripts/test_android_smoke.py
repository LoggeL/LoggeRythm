from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from android_smoke import (
    AndroidSmoke,
    PROFILE_ACCESS_SUFFIXES,
    PRODUCTION_ORIGIN_MARKER,
    SmokeFailure,
    TAB_DESTINATIONS,
    app_runtime_failure,
    authenticated_shell_visible,
    installed_package_metadata,
    metro_reverse_present,
    metro_runtime_failure,
    missing_resource_suffixes,
    production_origin_marker_present,
    runtime_api_origins,
)


def resource_node(
    suffix: str,
    *,
    clickable: bool = True,
    enabled: bool = True,
) -> dict[str, str]:
    return {
        "resource-id": f"top.logge.loggerythm:id/{suffix}",
        "clickable": str(clickable).lower(),
        "enabled": str(enabled).lower(),
    }


class AuthenticatedShellTests(unittest.TestCase):
    def test_accepts_all_five_tabs_with_a_mounted_destination(self) -> None:
        nodes = [resource_node(tab) for tab, _ in TAB_DESTINATIONS]
        nodes.append(resource_node("home-screen", clickable=False))

        self.assertTrue(authenticated_shell_visible(nodes))

    def test_accepts_raw_fabric_test_ids_and_rejects_foreign_packages(self) -> None:
        raw = [
            {"resource-id": tab, "clickable": "true", "enabled": "true"}
            for tab, _ in TAB_DESTINATIONS
        ]
        raw.append({"resource-id": "home-screen", "clickable": "false", "enabled": "true"})
        self.assertTrue(authenticated_shell_visible(raw))

        foreign = [
            {"resource-id": f"com.example:id/{tab}", "clickable": "true", "enabled": "true"}
            for tab, _ in TAB_DESTINATIONS
        ]
        foreign.append(resource_node("home-screen", clickable=False))
        self.assertFalse(authenticated_shell_visible(foreign))

    def test_rejects_a_shell_missing_any_required_tab(self) -> None:
        nodes = [resource_node(tab) for tab, _ in TAB_DESTINATIONS if tab != "tab-radio"]
        nodes.append(resource_node("home-screen", clickable=False))

        self.assertFalse(authenticated_shell_visible(nodes))
        self.assertEqual(
            missing_resource_suffixes(
                nodes,
                tuple(tab for tab, _ in TAB_DESTINATIONS),
            ),
            ["tab-radio"],
        )

    def test_rejects_tabs_without_a_mounted_root_screen(self) -> None:
        nodes = [resource_node(tab) for tab, _ in TAB_DESTINATIONS]

        self.assertFalse(authenticated_shell_visible(nodes))

    def test_does_not_treat_localized_copy_as_the_stable_shell_contract(self) -> None:
        nodes = [
            {"text": "Start"},
            {"text": "Suche"},
            {"text": "Entdecken"},
            {"text": "Radio"},
            {"text": "Mediathek"},
        ]

        self.assertFalse(authenticated_shell_visible(nodes))


class ProfileDiscoveryTests(unittest.TestCase):
    def test_discovers_a_clickable_stable_profile_entry(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        nodes = [resource_node(PROFILE_ACCESS_SUFFIXES[0])]

        match = smoke.find_profile_access(nodes)

        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match[0], PROFILE_ACCESS_SUFFIXES[0])

    def test_fails_loudly_when_profile_entry_is_not_interactive(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        nodes = [resource_node(PROFILE_ACCESS_SUFFIXES[0], clickable=False)]

        with self.assertRaisesRegex(SmokeFailure, "not enabled and clickable"):
            smoke.find_profile_access(nodes)


class CredentialInputTests(unittest.TestCase):
    def test_secret_is_sent_one_character_per_input_command(self) -> None:
        secret = "a b%s"

        script = AndroidSmoke.input_text_script(secret)

        self.assertNotIn(secret, script)
        self.assertEqual(script.count("input text "), len(secret))


class ProductionOriginEvidenceTests(unittest.TestCase):
    def test_requires_the_runtime_selected_origin_marker(self) -> None:
        self.assertTrue(production_origin_marker_present(f"I/ReactNativeJS: {PRODUCTION_ORIGIN_MARKER}"))
        self.assertFalse(
            production_origin_marker_present(
                "Hermes bundle contains https://loggerythm.logge.top as a fallback constant",
            ),
        )

    def test_rejects_a_conflicting_or_failed_runtime_origin(self) -> None:
        conflicting = (
            f"I/ReactNativeJS: {PRODUCTION_ORIGIN_MARKER}\n"
            "I/ReactNativeJS: [LoggeRythm] API origin: https://staging.example.test"
        )
        self.assertEqual(
            runtime_api_origins(conflicting),
            ["https://loggerythm.logge.top", "https://staging.example.test"],
        )
        self.assertFalse(production_origin_marker_present(conflicting))
        self.assertFalse(
            production_origin_marker_present(
                f"{PRODUCTION_ORIGIN_MARKER}\n"
                "[LoggeRythm] API origin configuration failed",
            ),
        )


class StandalonePackageEvidenceTests(unittest.TestCase):
    RELEASE_DUMP = """
      Package [top.logge.loggerythm]:
        versionCode=10005 minSdk=24 targetSdk=36
        versionName=1.0.1
        flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
    """

    def test_extracts_release_identity_and_requires_non_debuggable_flags(self) -> None:
        self.assertEqual(
            installed_package_metadata(self.RELEASE_DUMP),
            {
                "version_code": 10005,
                "version_name": "1.0.1",
                "min_sdk": 24,
                "target_sdk": 36,
                "debuggable": False,
            },
        )
        debug_dump = self.RELEASE_DUMP.replace("HAS_CODE", "HAS_CODE DEBUGGABLE")
        self.assertTrue(installed_package_metadata(debug_dump)["debuggable"])

    def test_refuses_incomplete_package_evidence(self) -> None:
        with self.assertRaisesRegex(SmokeFailure, "release metadata"):
            installed_package_metadata("versionName=1.0.1")

    def test_detects_only_conventional_metro_reverse_ports(self) -> None:
        self.assertTrue(metro_reverse_present("emulator-5554 tcp:8081 tcp:8081\n"))
        self.assertTrue(metro_reverse_present("emulator-5554 tcp:19000 tcp:19000\n"))
        self.assertFalse(metro_reverse_present("emulator-5554 tcp:8000 tcp:8000\n"))


class RuntimeLogEvidenceTests(unittest.TestCase):
    APP_PID = "4242"

    @staticmethod
    def line(pid: str, level: str, tag: str, message: str) -> str:
        return f"07-16 14:01:02.003  {pid}  {pid} {level} {tag}: {message}"

    def test_scopes_react_native_errors_to_the_tested_app_pid(self) -> None:
        unrelated = self.line("9999", "E", "ReactNativeJS", "another app failed")
        app_error = self.line(self.APP_PID, "E", "ReactNativeJS", "render failed")

        self.assertIsNone(app_runtime_failure(unrelated, {self.APP_PID}))
        self.assertEqual(
            app_runtime_failure(f"{unrelated}\n{app_error}", {self.APP_PID}),
            "ReactNativeJS error",
        )

    def test_detects_app_crash_anr_and_native_signal_without_pid_false_positives(self) -> None:
        self.assertEqual(
            app_runtime_failure(
                "ANR in top.logge.loggerythm (top.logge.loggerythm/.MainActivity)",
                {self.APP_PID},
            ),
            "ANR",
        )
        self.assertEqual(
            app_runtime_failure(
                "FATAL EXCEPTION: main\nProcess: top.logge.loggerythm, PID: 4242",
                {self.APP_PID},
            ),
            "fatal exception",
        )
        unrelated_signal = (
            self.line("9999", "F", "libc", "Fatal signal 6 (SIGABRT)")
            + "\nforeign.package"
        )
        self.assertIsNone(app_runtime_failure(unrelated_signal, {self.APP_PID}))

    def test_scopes_metro_failures_to_the_tested_app_pid(self) -> None:
        message = "Could not connect to development server"
        unrelated = self.line("9999", "E", "ReactNative", message)
        app_line = self.line(self.APP_PID, "E", "ReactNative", message)

        self.assertIsNone(metro_runtime_failure(unrelated, {self.APP_PID}))
        self.assertEqual(
            metro_runtime_failure(f"{unrelated}\n{app_line}", {self.APP_PID}),
            message.lower(),
        )


class WarmLaunchFlowTests(unittest.TestCase):
    def test_backgrounds_then_resumes_the_same_process_and_rechecks_ui(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        smoke.pid = "4242"
        smoke.adb = Mock()
        smoke.assert_alive = Mock()
        smoke.launch_activity = Mock()
        expected = ({"resource-id": "login-email"}, {"resource-id": "login-password"})
        smoke.verify_login_screen = Mock(return_value=expected)

        with patch("android_smoke.time.sleep"):
            result = smoke.verify_warm_launch()

        self.assertEqual(result, expected)
        smoke.adb.assert_called_once_with(
            ["shell", "input", "keyevent", "KEYCODE_HOME"],
        )
        smoke.assert_alive.assert_called_once_with("backgrounding before warm launch")
        smoke.launch_activity.assert_called_once_with("warm")
        smoke.verify_login_screen.assert_called_once_with("warm")

    def test_fails_if_the_warm_launch_replaces_the_process(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        smoke.pid = "4242"
        smoke.adb = Mock()
        smoke.assert_alive = Mock()

        def replace_process(_phase: str) -> None:
            smoke.pid = "5252"

        smoke.launch_activity = replace_process
        smoke.verify_login_screen = Mock()

        with patch("android_smoke.time.sleep"), self.assertRaisesRegex(
            SmokeFailure,
            "Warm launch replaced the process",
        ):
            smoke.verify_warm_launch()

        smoke.verify_login_screen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
