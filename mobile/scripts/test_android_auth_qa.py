from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import android_auth_qa as auth_qa

from android_auth_qa import (
    AUTH_SCENARIO_SEQUENCE,
    DEFERRED_SCENARIOS,
    AuthQaRequest,
    AuthQaReport,
    AuthScenario,
    ApiEvent,
    CandidateFailure,
    InfrastructureFailure,
    PrivacyFailure,
    _AuthQaEngine,
    _CloudflaredAttemptSignals,
    _CloudflaredQuickTunnel,
    _SafeAdb,
    _cloudflared_quick_tunnel_command,
    _input_text_script,
    _privacy_guard,
    _run_scenario_plan,
    _safe_failure,
    _validate_request,
    project_node_metadata,
    run_auth_qa,
)


class NodeEvidenceBoundaryTests(unittest.TestCase):
    def test_projects_only_non_text_control_metadata(self) -> None:
        projected = project_node_metadata({
            "resource-id": "top.logge.loggerythm:id/login-password",
            "clickable": "true",
            "enabled": "true",
            "bounds": "[10,20][110,70]",
            "focused": "true",
            "text": "must-not-survive",
            "content-desc": "account@example.test",
            "hint": "private hint",
            "password": "true",
            "class": "android.widget.EditText",
        })

        self.assertEqual(
            projected,
            {
                "resource-id": "top.logge.loggerythm:id/login-password",
                "clickable": "true",
                "enabled": "true",
                "bounds": "[10,20][110,70]",
                "focused": "true",
            },
        )


class UiDumpCleanupTests(unittest.TestCase):
    @staticmethod
    def completed(returncode: int = 0, stdout: str = "") -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(["adb"], returncode, stdout, "")

    def test_raw_nodes_require_verified_device_side_cleanup(self) -> None:
        device = _SafeAdb.__new__(_SafeAdb)
        device._adb = Mock(side_effect=[
            self.completed(),
            self.completed(stdout="<hierarchy><node resource-id=\"login-email\" /></hierarchy>"),
            self.completed(),
            self.completed(returncode=1),
        ])

        self.assertEqual(
            device._raw_nodes("cleanup-success"),
            [{"resource-id": "login-email"}],
        )
        cleanup_calls = device._adb.call_args_list[-2:]
        self.assertEqual(cleanup_calls[0].args[0][:3], ("shell", "rm", "-f"))
        self.assertEqual(cleanup_calls[1].args[0][:2], ("shell", "ls"))

    def test_raw_nodes_fail_closed_when_device_side_cleanup_fails(self) -> None:
        device = _SafeAdb.__new__(_SafeAdb)
        device._adb = Mock(side_effect=[
            self.completed(),
            self.completed(stdout="<hierarchy />"),
            self.completed(returncode=1),
            self.completed(),
        ])

        with self.assertRaisesRegex(PrivacyFailure, "UI evidence cleanup failed"):
            device._raw_nodes("cleanup-failure")


class SecretInputTests(unittest.TestCase):
    def test_secret_is_split_into_stdin_only_character_commands(self) -> None:
        secret = "Qa-private-42"
        script = _input_text_script(secret)

        self.assertNotIn(secret, script)
        self.assertEqual(script.count("input text "), len(secret))

        device = _SafeAdb.__new__(_SafeAdb)
        device._adb = Mock(
            return_value=subprocess.CompletedProcess(["adb"], 0, "", ""),
        )
        device._shell_stdin(script)

        positional, keyword = device._adb.call_args
        self.assertNotIn(secret, repr(positional))
        self.assertEqual(positional, (("shell", "sh"),))
        self.assertEqual(keyword["stdin"], script)

    def test_control_characters_are_rejected_before_adb(self) -> None:
        with self.assertRaises(InfrastructureFailure):
            _input_text_script("safe-prefix\nunsafe")


class NativeControlReadinessTests(unittest.TestCase):
    @staticmethod
    def node(*, enabled: bool, clickable: bool) -> dict[str, str]:
        return {
            "resource-id": "top.logge.loggerythm:id/register-submit",
            "enabled": str(enabled).lower(),
            "clickable": str(clickable).lower(),
            "bounds": "[10,20][110,70]",
        }

    def device_with_nodes(self, nodes: list[list[dict[str, str]]]) -> _SafeAdb:
        device = _SafeAdb.__new__(_SafeAdb)
        device._raw_nodes = Mock(side_effect=nodes)  # type: ignore[method-assign]
        device._swipe = Mock()  # type: ignore[method-assign]
        device._tap_node = Mock()  # type: ignore[method-assign]
        return device

    def test_finder_distinguishes_disabled_control_from_absent_test_id(self) -> None:
        disabled = self.device_with_nodes([[self.node(enabled=False, clickable=False)]])
        with self.assertRaisesRegex(CandidateFailure, "present but disabled"):
            disabled._find_with_scroll(
                "register-submit",
                "disabled-submit",
                interactive=True,
                swipes=0,
            )

        absent = self.device_with_nodes([[]])
        with self.assertRaisesRegex(CandidateFailure, "was absent"):
            absent._find_with_scroll(
                "register-submit",
                "absent-submit",
                interactive=True,
                swipes=0,
            )

    def test_submit_wait_retries_until_control_becomes_interactive(self) -> None:
        enabled = self.node(enabled=True, clickable=True)
        device = self.device_with_nodes([
            [self.node(enabled=False, clickable=False)],
            [self.node(enabled=True, clickable=False)],
            [enabled],
        ])

        device._wait_and_tap(
            "register-submit",
            "registration-submit",
            attempts=3,
            interval=0,
            swipes=0,
        )

        self.assertEqual(device._raw_nodes.call_count, 3)
        device._tap_node.assert_called_once_with("register-submit", enabled)

    def test_submit_wait_is_bounded_and_keeps_disabled_diagnostic(self) -> None:
        device = self.device_with_nodes([
            [self.node(enabled=False, clickable=False)],
            [self.node(enabled=False, clickable=False)],
            [self.node(enabled=False, clickable=False)],
        ])

        with self.assertRaisesRegex(CandidateFailure, "remained present but disabled"):
            device._wait_and_tap(
                "register-submit",
                "registration-submit",
                attempts=3,
                interval=0,
                swipes=0,
            )

        self.assertEqual(device._raw_nodes.call_count, 3)
        device._tap_node.assert_not_called()

    def test_presence_wait_allows_delayed_node_and_only_initial_scroll(self) -> None:
        present = self.node(enabled=False, clickable=False)
        device = self.device_with_nodes([[], [], [present]])

        observed = device._wait_for_present(
            "register-submit",
            "registration-mode",
            attempts=2,
            interval=0,
            swipes=1,
        )

        self.assertEqual(observed, present)
        self.assertEqual(device._raw_nodes.call_count, 3)
        device._swipe.assert_called_once_with("up")

    def test_presence_wait_is_bounded_with_test_id_only_diagnostic(self) -> None:
        device = self.device_with_nodes([[], [], []])

        with self.assertRaises(CandidateFailure) as raised:
            device._wait_for_present(
                "register-submit",
                "registration-mode",
                attempts=3,
                interval=0,
                swipes=0,
            )

        self.assertEqual(device._raw_nodes.call_count, 3)
        self.assertIn("register-submit", str(raised.exception))
        self.assertIn("remained absent", str(raised.exception))


class NativeFieldFocusTests(unittest.TestCase):
    @staticmethod
    def node(
        *,
        suffix: str = "register-invite",
        focused: bool,
        text: str = "",
    ) -> dict[str, str]:
        return {
            "resource-id": f"top.logge.loggerythm:id/{suffix}",
            "enabled": "true",
            "clickable": "true",
            "focused": str(focused).lower(),
            "bounds": "[10,20][210,90]",
            "text": text,
            "hint": "",
            "password": "false",
        }

    def test_focus_acquisition_polls_same_test_id_before_typing(self) -> None:
        initial = self.node(focused=False)
        focused = self.node(focused=True)
        device = _SafeAdb.__new__(_SafeAdb)
        device._find_with_scroll = Mock(return_value=initial)  # type: ignore[method-assign]
        device._tap_node = Mock()  # type: ignore[method-assign]
        device._raw_nodes = Mock(side_effect=[[initial], [focused]])  # type: ignore[method-assign]

        observed = device._acquire_field_focus(
            "register-invite",
            direction="up",
            tap_attempts=2,
            polls_per_tap=2,
            interval=0,
        )

        self.assertEqual(observed, focused)
        device._tap_node.assert_called_once_with("register-invite", initial)
        self.assertEqual(device._raw_nodes.call_count, 2)

    def test_focus_acquisition_retries_tap_and_is_bounded(self) -> None:
        unfocused = self.node(focused=False, text="must-not-leak")
        focused = self.node(focused=True)
        retrying = _SafeAdb.__new__(_SafeAdb)
        retrying._find_with_scroll = Mock(return_value=unfocused)  # type: ignore[method-assign]
        retrying._tap_node = Mock()  # type: ignore[method-assign]
        retrying._swipe = Mock()  # type: ignore[method-assign]
        retrying._raw_nodes = Mock(side_effect=[[unfocused], [focused]])  # type: ignore[method-assign]

        observed = retrying._acquire_field_focus(
            "register-invite",
            direction="up",
            tap_attempts=2,
            polls_per_tap=1,
            interval=0,
        )

        self.assertEqual(observed, focused)
        self.assertEqual(retrying._tap_node.call_count, 2)
        retrying._swipe.assert_called_once_with("up")

        failing = _SafeAdb.__new__(_SafeAdb)
        failing._find_with_scroll = Mock(return_value=unfocused)  # type: ignore[method-assign]
        failing._tap_node = Mock()  # type: ignore[method-assign]
        failing._swipe = Mock()  # type: ignore[method-assign]
        failing._raw_nodes = Mock(side_effect=[[unfocused], [unfocused]])  # type: ignore[method-assign]
        with self.assertRaises(CandidateFailure) as raised:
            failing._acquire_field_focus(
                "register-invite",
                direction="up",
                tap_attempts=2,
                polls_per_tap=1,
                interval=0,
            )

        self.assertEqual(failing._tap_node.call_count, 2)
        self.assertIn("register-invite", str(raised.exception))
        self.assertNotIn("must-not-leak", str(raised.exception))

    def test_focus_retry_swipes_before_refind_and_taps_refreshed_bounds(self) -> None:
        initial = self.node(
            suffix="register-confirm-password",
            focused=False,
            text="must-not-leak",
        )
        initial["bounds"] = "[10,800][210,870]"
        refreshed = self.node(
            suffix="register-confirm-password",
            focused=False,
            text="must-not-leak",
        )
        refreshed["bounds"] = "[10,200][210,270]"
        focused = dict(refreshed, focused="true")
        events: list[str] = []
        find_nodes = iter((initial, refreshed))
        poll_nodes = iter(([initial], [focused]))

        device = _SafeAdb.__new__(_SafeAdb)
        device._find_with_scroll = Mock(  # type: ignore[method-assign]
            side_effect=lambda *_args, **_kwargs: (
                events.append("find") or next(find_nodes)
            ),
        )
        device._tap_node = Mock(  # type: ignore[method-assign]
            side_effect=lambda _suffix, node: events.append(f"tap:{node['bounds']}"),
        )
        device._swipe = Mock(  # type: ignore[method-assign]
            side_effect=lambda direction: events.append(f"swipe:{direction}"),
        )
        device._raw_nodes = Mock(  # type: ignore[method-assign]
            side_effect=lambda _phase: events.append("poll") or next(poll_nodes),
        )

        observed = device._acquire_field_focus(
            "register-confirm-password",
            direction="up",
            tap_attempts=2,
            polls_per_tap=1,
            interval=0,
        )

        self.assertEqual(observed["bounds"], refreshed["bounds"])
        self.assertEqual(
            events,
            [
                "find",
                "tap:[10,800][210,870]",
                "poll",
                "swipe:up",
                "find",
                "tap:[10,200][210,270]",
                "poll",
            ],
        )
        self.assertNotIn("must-not-leak", repr(events))

    def test_verified_field_gets_one_bounded_reentry_after_mismatch(self) -> None:
        focused = self.node(focused=True)
        device = _SafeAdb.__new__(_SafeAdb)
        device._acquire_field_focus = Mock(return_value=focused)  # type: ignore[method-assign]
        device._shell_stdin = Mock()  # type: ignore[method-assign]
        device._field_value_matches = Mock(side_effect=[False, True])  # type: ignore[method-assign]

        device._enter_field(
            "register-invite",
            "private-invite",
            "register-invite",
            verify=True,
        )

        self.assertEqual(device._acquire_field_focus.call_count, 2)
        self.assertEqual(device._field_value_matches.call_count, 2)

        failing = _SafeAdb.__new__(_SafeAdb)
        failing._acquire_field_focus = Mock(return_value=focused)  # type: ignore[method-assign]
        failing._shell_stdin = Mock()  # type: ignore[method-assign]
        failing._field_value_matches = Mock(return_value=False)  # type: ignore[method-assign]
        with self.assertRaises(CandidateFailure) as raised:
            failing._enter_field(
                "register-invite",
                "private-invite",
                "register-invite",
                verify=True,
            )
        self.assertNotIn("private-invite", str(raised.exception))

    def test_registration_requires_exact_invite_verification(self) -> None:
        events: list[str] = []
        device = _SafeAdb.__new__(_SafeAdb)
        device._scroll_to_top = Mock(  # type: ignore[method-assign]
            side_effect=lambda: events.append("scroll-top"),
        )
        device._enter_field = Mock(  # type: ignore[method-assign]
            side_effect=lambda suffix, *_args, **_kwargs: events.append(f"field:{suffix}"),
        )
        device.dismiss_keyboard = Mock(  # type: ignore[method-assign]
            side_effect=lambda: events.append("dismiss-keyboard"),
        )
        device._wait_and_tap = Mock(  # type: ignore[method-assign]
            side_effect=lambda suffix, *_args, **_kwargs: events.append(f"tap:{suffix}"),
        )

        device.submit_registration(
            "QA",
            "qa@example.test",
            "private-password",
            "private-invite",
        )

        invite_call = device._enter_field.call_args_list[-1]
        self.assertEqual(invite_call.args[:3], (
            "register-invite",
            "private-invite",
            "register-invite",
        ))
        self.assertTrue(invite_call.kwargs["verify"])
        self.assertEqual(
            events,
            [
                "scroll-top",
                "field:register-display-name",
                "field:login-email",
                "field:login-password",
                "dismiss-keyboard",
                "field:register-confirm-password",
                "dismiss-keyboard",
                "field:register-invite",
                "dismiss-keyboard",
                "tap:register-submit",
            ],
        )


class RegistrationModeTests(unittest.TestCase):
    def test_existing_registration_mode_returns_without_toggle(self) -> None:
        register_submit = {
            "resource-id": "top.logge.loggerythm:id/register-submit",
            "enabled": "false",
            "clickable": "false",
            "bounds": "[63,1765][1017,1891]",
        }
        device = _SafeAdb.__new__(_SafeAdb)
        device._scroll_to_top = Mock()  # type: ignore[method-assign]
        device._find_with_scroll = Mock(return_value=register_submit)  # type: ignore[method-assign]
        device._wait_and_tap = Mock()  # type: ignore[method-assign]
        device._wait_for_present = Mock()  # type: ignore[method-assign]

        device.enter_registration_mode()

        device._scroll_to_top.assert_called_once_with()
        device._find_with_scroll.assert_called_once_with(
            "register-submit",
            "registration-mode-existing",
            interactive=False,
            direction="up",
        )
        device._wait_and_tap.assert_not_called()
        device._wait_for_present.assert_not_called()

    def test_sign_in_mode_toggles_then_waits_for_registration_commit(self) -> None:
        device = _SafeAdb.__new__(_SafeAdb)
        device._scroll_to_top = Mock()  # type: ignore[method-assign]
        device._find_with_scroll = Mock(  # type: ignore[method-assign]
            side_effect=CandidateFailure("register-submit absent"),
        )
        device._wait_and_tap = Mock()  # type: ignore[method-assign]
        device._wait_for_present = Mock()  # type: ignore[method-assign]

        device.enter_registration_mode()

        device._wait_and_tap.assert_called_once_with(
            "auth-mode-toggle",
            "registration-mode",
            direction="up",
        )
        device._wait_for_present.assert_called_once_with(
            "register-submit",
            "registration-mode-ready",
            direction="up",
        )


class PrivacyGuardTests(unittest.TestCase):
    def test_accepts_allowlisted_redacted_evidence(self) -> None:
        _privacy_guard(
            '{"scenario":"valid_login","method":"POST","path":"/api/auth/login","status":200}',
            ("Qa-secret-never-present",),
        )

    def test_rejects_generated_secret_and_raw_ui_or_cookie_fields(self) -> None:
        with self.assertRaises(PrivacyFailure):
            _privacy_guard('{"value":"Qa-secret"}', ("Qa-secret",))
        for marker in ('{"text":"private"}', '{"content-desc":"private"}', '{"cookie":true}'):
            with self.subTest(marker=marker), self.assertRaises(PrivacyFailure):
                _privacy_guard(marker, ())


class FixedScenarioPlanTests(unittest.TestCase):
    def test_full_auth_sequence_is_fixed_and_ordered(self) -> None:
        self.assertEqual(
            AUTH_SCENARIO_SEQUENCE,
            (
                AuthScenario.PRODUCTION_DEFAULT,
                AuthScenario.INCOMPATIBLE_PREFLIGHT,
                AuthScenario.INVALID_LOGIN,
                AuthScenario.VALID_LOGIN,
                AuthScenario.STORED_SESSION_RESTORE,
                AuthScenario.LOGOUT_PRODUCTION_RESET,
                AuthScenario.RELATIVE_INVITE_REGISTRATION,
                AuthScenario.PENDING_RESTORE_RETRY_FORGET,
                AuthScenario.PENDING_APPROVAL_RECHECK,
                AuthScenario.FORBIDDEN_RETRY,
                AuthScenario.UNAUTHORIZED_CLEANUP,
                AuthScenario.CRASH_PRIVACY_AUDIT,
            ),
        )

    def test_only_root_filesystem_forensics_remains_deferred(self) -> None:
        self.assertEqual(DEFERRED_SCENARIOS, ("root_filesystem_cleanup_forensics",))

    def test_engine_wires_each_scenario_to_its_auth_action(self) -> None:
        engine = _AuthQaEngine.__new__(_AuthQaEngine)
        engine._record = Mock()  # type: ignore[method-assign]

        engine.run()

        observed = tuple(
            (call.args[0], call.args[1].__name__)
            for call in engine._record.call_args_list
        )
        self.assertEqual(
            observed,
            (
                (AuthScenario.PRODUCTION_DEFAULT, "_production_default"),
                (AuthScenario.INCOMPATIBLE_PREFLIGHT, "_incompatible_preflight"),
                (AuthScenario.INVALID_LOGIN, "_invalid_login"),
                (AuthScenario.VALID_LOGIN, "_valid_login"),
                (AuthScenario.STORED_SESSION_RESTORE, "_stored_session_restore"),
                (AuthScenario.LOGOUT_PRODUCTION_RESET, "_logout_production_reset"),
                (
                    AuthScenario.RELATIVE_INVITE_REGISTRATION,
                    "_relative_invite_registration",
                ),
                (
                    AuthScenario.PENDING_RESTORE_RETRY_FORGET,
                    "_pending_restore_retry_forget",
                ),
                (
                    AuthScenario.PENDING_APPROVAL_RECHECK,
                    "_pending_approval_recheck",
                ),
                (AuthScenario.FORBIDDEN_RETRY, "_forbidden_retry"),
                (AuthScenario.UNAUTHORIZED_CLEANUP, "_unauthorized_cleanup"),
                (AuthScenario.CRASH_PRIVACY_AUDIT, "_crash_privacy_audit"),
            ),
        )

    def test_plan_runs_every_action_once_in_declared_order(self) -> None:
        actions_seen: list[AuthScenario] = []
        records_seen: list[AuthScenario] = []
        actions = {
            scenario: (lambda selected=scenario: actions_seen.append(selected) or ("passed",))
            for scenario in AUTH_SCENARIO_SEQUENCE
        }

        def record(scenario: AuthScenario, action):  # type: ignore[no-untyped-def]
            records_seen.append(scenario)
            self.assertEqual(action(), ("passed",))

        _run_scenario_plan(actions, record)

        self.assertEqual(records_seen, list(AUTH_SCENARIO_SEQUENCE))
        self.assertEqual(actions_seen, list(AUTH_SCENARIO_SEQUENCE))

    def test_plan_rejects_missing_or_extra_scenarios(self) -> None:
        incomplete = {
            scenario: (lambda: ())
            for scenario in AUTH_SCENARIO_SEQUENCE[:-1]
        }
        with self.assertRaises(InfrastructureFailure):
            _run_scenario_plan(incomplete, lambda _scenario, _action: None)


class PendingRegistrationSequenceTests(unittest.TestCase):
    def test_custom_origin_ime_is_dismissed_before_registration_mode_toggle(self) -> None:
        events: list[str] = []
        device = Mock()
        device.configure_server.side_effect = lambda _origin: events.append("configure")
        device.dismiss_keyboard.side_effect = lambda: events.append("dismiss-keyboard")
        device.enter_registration_mode.side_effect = lambda: events.append("mode")
        device.submit_registration.side_effect = (
            lambda *_args: events.append("submit")
        )
        device.wait_pending.side_effect = lambda _phase: events.append("wait-pending")
        device.assert_pending_origin = Mock(  # type: ignore[attr-defined]
            side_effect=lambda _origin: events.append("assert-origin"),
        )
        engine = _AuthQaEngine.__new__(_AuthQaEngine)
        engine.device = device
        engine.tunnel = Mock(origin="https://qa-origin.example")
        engine.server = Mock(ledger=())
        engine.deadline = Mock()

        with patch.object(auth_qa, "_wait_for_event", return_value=Mock()):
            engine._register_pending(
                "qa@example.test",
                "private-password",
                "Android QA Pending",
            )

        self.assertEqual(
            events,
            [
                "configure",
                "dismiss-keyboard",
                "mode",
                "submit",
                "wait-pending",
                "assert-origin",
            ],
        )


class AuthScenarioEvidenceTests(unittest.TestCase):
    @staticmethod
    def event(sequence: int, status: int) -> ApiEvent:
        return ApiEvent(
            sequence=sequence,
            method="GET",
            path="/api/auth/me",
            status=status,
        )

    def test_logout_restart_rejects_a_new_me_request(self) -> None:
        engine = _AuthQaEngine.__new__(_AuthQaEngine)
        engine.server = Mock()
        engine.device = Mock()
        engine.device.assert_production_default = Mock()
        engine.deadline = Mock()

        with patch.object(auth_qa, "_wait_for_event", return_value=Mock()):
            with patch.object(
                auth_qa,
                "_ledger_events",
                side_effect=[
                    (),
                    (self.event(1, 200),),
                    (self.event(1, 200), self.event(2, 401)),
                ],
            ):
                with self.assertRaisesRegex(CandidateFailure, "logged-out session attempted /me"):
                    engine._logout_production_reset()

    def test_pending_retry_requires_a_fresh_successful_me(self) -> None:
        engine = _AuthQaEngine.__new__(_AuthQaEngine)
        engine._register_pending = Mock()  # type: ignore[method-assign]
        engine.server = Mock()
        engine.device = Mock()
        engine.device.assert_pending_origin = Mock()
        engine.device.assert_production_default = Mock()
        engine.deadline = Mock()
        engine.tunnel = Mock(origin="https://qa-origin.example")
        engine.generated = Mock(
            pending_email="pending@example.test",
            pending_password="private-password",
        )

        with patch.object(auth_qa, "_wait_for_event", return_value=Mock()) as wait:
            with patch.object(auth_qa, "_assert_no_event"):
                with patch.object(
                    auth_qa,
                    "_ledger_events",
                    side_effect=[
                        (),
                        (self.event(1, 503),),
                        (self.event(1, 503), self.event(2, 200)),
                    ],
                ):
                    checks = engine._pending_restore_retry_forget()

        retry_wait = wait.call_args_list[1]
        self.assertEqual(retry_wait.args[1], 1)
        self.assertTrue(retry_wait.args[2](self.event(2, 200)))
        self.assertFalse(retry_wait.args[2](self.event(2, 503)))
        self.assertEqual(retry_wait.args[4], "pending Retry /me")
        self.assertIn("retry_me_200_returns_pending", checks)


class CloudflaredCommandTests(unittest.TestCase):
    def test_quick_tunnel_explicitly_uses_quic(self) -> None:
        command = _cloudflared_quick_tunnel_command(
            Path("/opt/homebrew/bin/cloudflared"),
            "http://127.0.0.1:18765",
        )

        protocol_index = command.index("--protocol")
        self.assertEqual(command[protocol_index + 1], "quic")
        self.assertNotIn("http2", command)

    def test_probe_gate_requires_url_and_registered_connection_in_any_order(self) -> None:
        url_line = "Visit https://fresh-host.trycloudflare.com for your quick tunnel"
        registered_line = "INF Registered tunnel connection connIndex=0"

        url_first = _CloudflaredAttemptSignals().consume(url_line)
        self.assertEqual(url_first.origin, "https://fresh-host.trycloudflare.com")
        self.assertFalse(url_first.ready_to_probe)
        self.assertTrue(url_first.consume(registered_line).ready_to_probe)

        registration_first = _CloudflaredAttemptSignals().consume(registered_line)
        self.assertTrue(registration_first.registered)
        self.assertFalse(registration_first.ready_to_probe)
        self.assertTrue(registration_first.consume(url_line).ready_to_probe)

    def test_failed_hostname_is_closed_before_a_fresh_retry(self) -> None:
        tunnel = _CloudflaredQuickTunnel(
            Path("/opt/homebrew/bin/cloudflared"),
            "http://127.0.0.1:18765",
            Mock(),
        )
        lifecycle: list[str] = []

        def start_attempt() -> None:
            lifecycle.append("start")
            if lifecycle.count("start") == 1:
                raise InfrastructureFailure("unready allocated hostname")

        tunnel._start_attempt = start_attempt  # type: ignore[method-assign]
        tunnel._close_attempt = lambda: lifecycle.append("close")  # type: ignore[method-assign]

        self.assertIs(tunnel.start(), tunnel)
        self.assertEqual(lifecycle, ["start", "close", "start"])

    def test_retry_is_bounded_and_hides_attempt_error(self) -> None:
        tunnel = _CloudflaredQuickTunnel(
            Path("/opt/homebrew/bin/cloudflared"),
            "http://127.0.0.1:18765",
            Mock(),
        )
        tunnel._start_attempt = Mock(  # type: ignore[method-assign]
            side_effect=InfrastructureFailure("sensitive allocated hostname"),
        )
        tunnel._close_attempt = Mock()  # type: ignore[method-assign]

        with self.assertRaises(InfrastructureFailure) as raised:
            tunnel.start()

        self.assertEqual(tunnel._start_attempt.call_count, 3)
        self.assertEqual(tunnel._close_attempt.call_count, 3)
        self.assertNotIn("sensitive allocated hostname", str(raised.exception))
        self.assertIn("after 3 attempts", str(raised.exception))

    def test_attempt_cleanup_terminates_process_threads_and_queue(self) -> None:
        tunnel = _CloudflaredQuickTunnel(
            Path("/opt/homebrew/bin/cloudflared"),
            "http://127.0.0.1:18765",
            Mock(),
        )
        process = Mock(stdout=None, stderr=None)
        process.poll.return_value = None
        thread = Mock()
        thread.is_alive.return_value = False
        old_queue = tunnel._lines
        old_queue.put("old-attempt-output")
        tunnel.process = process
        tunnel.origin = "https://old-host.trycloudflare.com"
        tunnel._threads = [thread]

        tunnel.close()

        process.terminate.assert_called_once_with()
        process.wait.assert_called_once_with(timeout=8)
        thread.join.assert_called_once_with(timeout=1)
        self.assertIsNone(tunnel.process)
        self.assertEqual(tunnel.origin, "")
        self.assertEqual(tunnel._threads, [])
        self.assertIsNot(tunnel._lines, old_queue)
        self.assertTrue(tunnel._lines.empty())


class EarlyFailureTeardownTests(unittest.TestCase):
    def test_pre_device_tunnel_failure_is_fully_torn_down(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            apk = root / "candidate.apk"
            apk.write_bytes(b"candidate")
            server = Mock()
            server.start.return_value = server
            server.origin = "http://127.0.0.1:18765"
            server.ledger = ()
            server_type = Mock(return_value=server)
            tunnel = Mock()
            tunnel.start.side_effect = InfrastructureFailure("quick tunnel unavailable")
            tunnel_type = Mock(return_value=tunnel)
            device_type = Mock()

            with patch.object(auth_qa, "_load_server_type", return_value=server_type):
                with patch.object(auth_qa, "_resolve_cloudflared", return_value=Path("cf")):
                    with patch.object(auth_qa, "_CloudflaredQuickTunnel", tunnel_type):
                        with patch.object(auth_qa, "_SafeAdb", device_type):
                            report = run_auth_qa(
                                AuthQaRequest(
                                    apk=apk,
                                    serial="emulator-5554",
                                    evidence_dir=root / "evidence",
                                ),
                            )

        self.assertEqual(report.status, "infrastructure_failed")
        self.assertTrue(report.teardown_complete)
        tunnel.close.assert_called_once_with()
        server.close.assert_called_once_with()
        device_type.assert_not_called()


class FailureClassificationTests(unittest.TestCase):
    def test_classifies_candidate_infrastructure_privacy_and_unknown_failures(self) -> None:
        self.assertEqual(
            _safe_failure(CandidateFailure("candidate-safe")),
            ("candidate_failure", "candidate-safe"),
        )
        self.assertEqual(
            _safe_failure(InfrastructureFailure("infra-safe")),
            ("infrastructure_failure", "infra-safe"),
        )
        self.assertEqual(
            _safe_failure(PrivacyFailure("privacy-safe")),
            ("privacy_failure", "privacy-safe"),
        )
        kind, message = _safe_failure(ValueError("must-not-be-echoed"))
        self.assertEqual(kind, "infrastructure_failure")
        self.assertEqual(message, "Unexpected ValueError")
        self.assertNotIn("must-not-be-echoed", message)


class RequestValidationTests(unittest.TestCase):
    def request(self, apk: Path, evidence: Path) -> AuthQaRequest:
        return AuthQaRequest(
            apk=apk,
            serial="emulator-5554",
            evidence_dir=evidence,
        )

    def test_accepts_non_empty_apk_and_new_or_empty_evidence_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            apk = root / "candidate.apk"
            apk.write_bytes(b"not-empty")

            resolved_apk, new_evidence = _validate_request(
                self.request(apk, root / "new-evidence"),
            )
            self.assertEqual(resolved_apk, apk.resolve())
            self.assertEqual(new_evidence, (root / "new-evidence").resolve())

            empty = root / "empty-evidence"
            empty.mkdir()
            _, resolved_empty = _validate_request(self.request(apk, empty))
            self.assertEqual(resolved_empty, empty.resolve())

    def test_rejects_missing_or_empty_apk_and_non_empty_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            empty_apk = root / "empty.apk"
            empty_apk.touch()
            with self.assertRaises(InfrastructureFailure):
                _validate_request(self.request(root / "missing.apk", root / "evidence-a"))
            with self.assertRaises(InfrastructureFailure):
                _validate_request(self.request(empty_apk, root / "evidence-b"))

            apk = root / "candidate.apk"
            apk.write_bytes(b"candidate")
            evidence = root / "evidence"
            evidence.mkdir()
            (evidence / "old-report.json").write_text("{}", encoding="utf-8")
            with self.assertRaises(InfrastructureFailure):
                _validate_request(self.request(apk, evidence))


class ReportSerializationTests(unittest.TestCase):
    def test_evidence_path_is_portable_and_contains_no_parent_directory(self) -> None:
        report = AuthQaReport(
            status="passed",
            apk_sha256="0" * 64,
            serial="emulator-5554",
            started_at_utc="2026-07-17T00:00:00Z",
            completed_at_utc="2026-07-17T00:01:00Z",
            scenarios=(),
            deferred_scenarios=(),
            api_events=(),
            crash_free=True,
            teardown_complete=True,
            failure_kind=None,
            failure_message=None,
            evidence_path=Path("/private/build/qa/auth-qa-report.json"),
        )

        self.assertEqual(report.to_dict()["evidence_path"], "auth-qa-report.json")


if __name__ == "__main__":
    unittest.main()
