from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from android_auth_qa import (
    AUTH_SCENARIO_SEQUENCE,
    AuthQaRequest,
    AuthScenario,
    CandidateFailure,
    InfrastructureFailure,
    PrivacyFailure,
    _SafeAdb,
    _input_text_script,
    _privacy_guard,
    _run_scenario_plan,
    _safe_failure,
    _validate_request,
    project_node_metadata,
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
    def test_mvp_sequence_is_fixed_and_ordered(self) -> None:
        self.assertEqual(
            AUTH_SCENARIO_SEQUENCE,
            (
                AuthScenario.PRODUCTION_DEFAULT,
                AuthScenario.INCOMPATIBLE_PREFLIGHT,
                AuthScenario.INVALID_LOGIN,
                AuthScenario.VALID_LOGIN,
                AuthScenario.STORED_SESSION_RESTORE,
                AuthScenario.LOGOUT_PRODUCTION_RESET,
                AuthScenario.CRASH_PRIVACY_AUDIT,
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


if __name__ == "__main__":
    unittest.main()
