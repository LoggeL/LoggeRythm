from __future__ import annotations

import unittest
import xml.etree.ElementTree as ET
from unittest.mock import Mock, call, patch

from android_smoke import (
    AndroidSmoke,
    PROFILE_ACCESS_SUFFIXES,
    SmokeFailure,
    TAB_DESTINATIONS,
    app_runtime_failure,
    authenticated_shell_visible,
    installed_package_metadata,
    metro_reverse_present,
    metro_runtime_failure,
    missing_resource_suffixes,
    selected_server_origin,
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

    def test_submit_discovery_requires_the_exact_enabled_visible_test_id(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        valid = resource_node("login-submit")
        valid.update({"displayed": "true", "bounds": "[10,20][110,70]"})

        self.assertIs(smoke.find_submit([valid]), valid)
        self.assertIsNone(
            smoke.find_submit(
                [
                    dict(valid, **{"resource-id": "foreign.app:id/login-submit"}),
                    dict(valid, **{"resource-id": "login-submit", "enabled": "false"}),
                    dict(valid, **{"resource-id": "login-submit", "displayed": "false"}),
                    dict(valid, **{"resource-id": "", "text": "Sign in"}),
                ],
            ),
        )

    def test_dismisses_keyboard_then_relocates_the_fresh_enabled_submit(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        smoke.adb = Mock()
        smoke.assert_alive = Mock()
        disabled = resource_node("login-submit", enabled=False)
        disabled.update({"displayed": "true", "bounds": "[10,20][110,70]"})
        enabled = dict(disabled, enabled="true")
        smoke.dump_ui = Mock(
            side_effect=[
                (ET.Element("hierarchy", {}), ""),
                (ET.Element("hierarchy", {}), ""),
            ],
        )
        smoke.nodes = Mock(side_effect=[[disabled], [enabled]])

        with patch("android_smoke.time.sleep"):
            result = smoke.dismiss_ime_and_wait_for_submit()

        self.assertEqual(result, enabled)
        smoke.adb.assert_called_once_with(
            ["shell", "input", "keyevent", "KEYCODE_BACK"],
        )
        smoke.assert_alive.assert_has_calls(
            [
                call("enabled login submit wait 1"),
                call("enabled login submit wait 2"),
            ],
        )
        self.assertEqual(smoke.dump_ui.call_count, 2)

    def test_submit_wait_failure_reports_only_safe_control_state(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        smoke.adb = Mock()
        smoke.assert_alive = Mock()
        disabled = resource_node("login-submit", enabled=False)
        disabled.update(
            {
                "class": "android.widget.Button",
                "package": "top.logge.loggerythm",
                "displayed": "true",
                "focused": "false",
                "bounds": "[10,20][110,70]",
                "text": "credential-value-must-not-leak",
            },
        )
        smoke.dump_ui = Mock(
            return_value=(ET.Element("hierarchy", {}), ""),
        )
        smoke.nodes = Mock(return_value=[disabled])

        with patch("android_smoke.time.sleep"), self.assertRaisesRegex(
            SmokeFailure,
            "login-submit candidates=1.*enabled='false'.*bounds='\\[10,20\\]\\[110,70\\]'",
        ) as raised:
            smoke.dismiss_ime_and_wait_for_submit()

        self.assertNotIn("credential-value-must-not-leak", str(raised.exception))
        self.assertEqual(smoke.dump_ui.call_count, 8)


class ProductionOriginEvidenceTests(unittest.TestCase):
    def test_requires_one_visible_server_input_with_the_selected_origin(self) -> None:
        node = resource_node("login-server", clickable=True)
        node.update(
            {
                "class": "android.widget.EditText",
                "text": "https://loggerythm.logge.top",
            },
        )
        self.assertEqual(
            selected_server_origin([node]),
            "https://loggerythm.logge.top",
        )

    def test_rejects_missing_duplicate_or_non_input_server_nodes(self) -> None:
        first = resource_node("login-server")
        first.update(
            {
                "class": "android.widget.EditText",
                "text": "https://one.example.test",
            },
        )
        second = dict(first, text="https://two.example.test")
        self.assertIsNone(selected_server_origin([]))
        self.assertIsNone(selected_server_origin([first, second]))
        self.assertIsNone(
            selected_server_origin(
                [dict(first, **{"class": "android.widget.TextView"})],
            ),
        )

    def test_server_input_discovery_uses_only_the_exact_stable_test_id(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        valid = resource_node("login-server")
        valid.update(
            {
                "class": "android.widget.EditText",
                "password": "false",
                "text": "https://one.example.test",
            },
        )

        self.assertIs(smoke.find_server_input([valid]), valid)
        self.assertIsNone(
            smoke.find_server_input(
                [dict(valid, **{"resource-id": "foreign.app:id/login-server"})],
            ),
        )
        self.assertIsNone(smoke.find_server_input([valid, dict(valid)]))
        self.assertIsNone(
            smoke.find_server_input(
                [dict(valid, **{"resource-id": "", "content-desc": "Server URL"})],
            ),
        )

    def test_server_entry_separates_focus_clear_type_and_exact_verification(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        smoke.expected_origin = "https://custom.example.test"
        current = resource_node("login-server")
        current.update(
            {
                "class": "android.widget.EditText",
                "password": "false",
                "focused": "false",
                "text": "https://loggerythm.logge.top",
                "bounds": "[10,20][110,70]",
            },
        )
        focused = dict(current, focused="true")
        cleared = dict(focused, text="")
        typed = dict(focused, text=smoke.expected_origin)
        smoke.dump_ui = Mock(return_value=(ET.Element("hierarchy", {}), ""))
        smoke.nodes = Mock(return_value=[current])
        smoke.adb = Mock()
        smoke.adb_shell_stdin = Mock()
        smoke.wait_for_focused_server_input = Mock(return_value=focused)
        smoke.wait_for_server_value = Mock(side_effect=[cleared, typed])

        smoke.configure_server_origin()

        smoke.adb.assert_called_once_with(
            ["shell", "input", "tap", "60", "45"],
        )
        self.assertEqual(smoke.adb_shell_stdin.call_count, 2)
        clear_script = smoke.adb_shell_stdin.call_args_list[0].args[0]
        type_script = smoke.adb_shell_stdin.call_args_list[1].args[0]
        self.assertIn("input keyevent KEYCODE_MOVE_END", clear_script)
        self.assertEqual(
            clear_script.count("input keyevent KEYCODE_DEL"),
            len(current["text"]),
        )
        self.assertNotIn(smoke.expected_origin, clear_script)
        self.assertEqual(type_script, smoke.input_text_script(smoke.expected_origin))
        self.assertEqual(
            smoke.wait_for_server_value.call_args_list,
            [
                call("", "clear", 1),
                call(smoke.expected_origin, "type", 1),
            ],
        )

    def test_clear_phase_treats_ui_automator_hint_text_as_empty_without_literal(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        localized_hint = "localized-placeholder.example"
        hinted_empty = resource_node("login-server")
        hinted_empty.update(
            {
                "class": "android.widget.EditText",
                "password": "false",
                "text": localized_hint,
                "hint": localized_hint,
            },
        )
        smoke.dump_ui = Mock(return_value=(ET.Element("hierarchy", {}), ""))
        smoke.nodes = Mock(return_value=[hinted_empty])

        result = smoke.wait_for_server_value("", "clear", 1)

        self.assertIs(result, hinted_empty)
        smoke.dump_ui.reset_mock()
        with patch("android_smoke.time.sleep"):
            self.assertIsNone(smoke.wait_for_server_value("", "type", 1))
        self.assertEqual(smoke.dump_ui.call_count, 6)

    def test_server_entry_retries_a_non_exact_typed_value_without_logging_it(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        smoke.expected_origin = "https://custom.example.test"
        actual_wrong_value = "ttps://custom.example.test"
        current = resource_node("login-server")
        current.update(
            {
                "class": "android.widget.EditText",
                "password": "false",
                "focused": "true",
                "text": actual_wrong_value,
                "bounds": "[10,20][110,70]",
            },
        )
        cleared = dict(current, text="")
        typed = dict(current, text=smoke.expected_origin)
        smoke.dump_ui = Mock(return_value=(ET.Element("hierarchy", {}), ""))
        smoke.nodes = Mock(return_value=[current])
        smoke.adb = Mock()
        smoke.adb_shell_stdin = Mock()
        smoke.wait_for_focused_server_input = Mock(return_value=current)
        smoke.wait_for_server_value = Mock(
            side_effect=[cleared, None, cleared, typed],
        )

        smoke.configure_server_origin()

        self.assertEqual(smoke.adb.call_count, 2)
        self.assertEqual(smoke.adb_shell_stdin.call_count, 4)
        self.assertEqual(
            smoke.wait_for_server_value.call_args_list[-1],
            call(smoke.expected_origin, "type", 2),
        )

    def test_server_entry_bounded_failure_does_not_disclose_form_values(self) -> None:
        smoke = AndroidSmoke.__new__(AndroidSmoke)
        smoke.expected_origin = "https://expected.example.test"
        actual_wrong_value = "https://wrong.example.test"
        current = resource_node("login-server")
        current.update(
            {
                "class": "android.widget.EditText",
                "password": "false",
                "focused": "true",
                "text": actual_wrong_value,
                "bounds": "[10,20][110,70]",
            },
        )
        cleared = dict(current, text="")
        smoke.dump_ui = Mock(return_value=(ET.Element("hierarchy", {}), ""))
        smoke.nodes = Mock(return_value=[current])
        smoke.adb = Mock()
        smoke.adb_shell_stdin = Mock()
        smoke.wait_for_focused_server_input = Mock(return_value=current)
        smoke.wait_for_server_value = Mock(
            side_effect=[cleared, None, cleared, None, cleared, None],
        )

        with self.assertRaisesRegex(SmokeFailure, "three bounded attempts") as raised:
            smoke.configure_server_origin()

        message = str(raised.exception)
        self.assertNotIn(smoke.expected_origin, message)
        self.assertNotIn(actual_wrong_value, message)
        self.assertEqual(smoke.adb.call_count, 3)
        self.assertEqual(smoke.adb_shell_stdin.call_count, 6)


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
