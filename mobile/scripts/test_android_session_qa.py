from __future__ import annotations

import unittest

from android_session_qa import (
    PACKAGE,
    QaFailure,
    app_crash_reason,
    assert_safe_interaction,
    authenticated_shell_visible,
    classify_session_gate,
    detail_expectations,
    normalize_logcat_timestamp,
    parse_args,
    project_node_metadata,
    resource_suffix,
    unobscured_center,
    visible_suffixes,
)


def resource_node(
    suffix: str,
    *,
    clickable: bool = True,
    enabled: bool = True,
) -> dict[str, str]:
    return {
        "resource-id": f"{PACKAGE}:id/{suffix}",
        "clickable": str(clickable).lower(),
        "enabled": str(enabled).lower(),
        "bounds": "[0,0][100,100]",
    }


class SessionGateTests(unittest.TestCase):
    def test_default_cli_reuses_warm_installed_app_without_apk_or_cold_stop(self) -> None:
        args = parse_args([])

        self.assertFalse(args.cold_start)
        self.assertFalse(hasattr(args, "apk"))

    def test_accepts_complete_five_tab_authenticated_shell_from_any_nested_route(self) -> None:
        nodes = [
            resource_node("tab-home"),
            resource_node("tab-search"),
            resource_node("tab-discover"),
            resource_node("tab-radio"),
            resource_node("tab-library"),
            resource_node("invalid-content-link", clickable=False),
        ]

        self.assertTrue(authenticated_shell_visible(nodes))
        self.assertEqual(classify_session_gate(nodes), "authenticated")

    def test_recognizes_authenticated_root_overlays_for_safe_back_navigation(self) -> None:
        for suffix in ("profile-screen", "now-playing-screen", "queue-screen"):
            with self.subTest(suffix=suffix):
                self.assertEqual(
                    classify_session_gate([resource_node(suffix, clickable=False)]),
                    "authenticated_overlay",
                )

    def test_rejects_partial_shell_and_classifies_credential_gates_without_text(self) -> None:
        partial = [resource_node("tab-home"), resource_node("home-screen", clickable=False)]
        signed_out = [resource_node("login-submit")]
        pending = [resource_node("approval-screen", clickable=False)]

        self.assertFalse(authenticated_shell_visible(partial))
        self.assertEqual(classify_session_gate(signed_out), "signed_out")
        self.assertEqual(classify_session_gate(pending), "approval_pending")

    def test_ignores_foreign_package_and_non_resource_ids(self) -> None:
        nodes = [
            {"resource-id": "com.example:id/tab-home"},
            {"resource-id": "not a resource id"},
            resource_node("tab-radio"),
        ]

        self.assertEqual(visible_suffixes(nodes), {"tab-radio"})
        self.assertIsNone(resource_suffix("com.example:id/profile-access"))

    def test_accepts_raw_fabric_test_ids(self) -> None:
        self.assertEqual(resource_suffix("tab-home"), "tab-home")
        self.assertEqual(resource_suffix("library-section-liked"), "library-section-liked")

    def test_ui_metadata_projection_excludes_textual_and_password_fields(self) -> None:
        projected = project_node_metadata({
            "resource-id": f"{PACKAGE}:id/login-password",
            "clickable": "true",
            "enabled": "true",
            "bounds": "[0,0][100,100]",
            "text": "do-not-read-this",
            "content-desc": "account@example.test",
            "password": "true",
        })

        self.assertEqual(
            projected,
            {
                "resource-id": f"{PACKAGE}:id/login-password",
                "clickable": "true",
                "enabled": "true",
                "bounds": "[0,0][100,100]",
            },
        )


class InteractionSafetyTests(unittest.TestCase):
    def test_detail_tap_avoids_restored_mini_player_overlay(self) -> None:
        album = resource_node("home-album-1026203192")
        album["bounds"] = "[42,1940][441,2208]"
        mini_player = resource_node("mini-player", clickable=False)
        mini_player["bounds"] = "[21,2022][1059,2190]"

        point = unobscured_center(album, "home album", [mini_player])

        self.assertIsNotNone(point)
        assert point is not None
        self.assertLess(point[1], 2022)
        self.assertGreaterEqual(point[0], 42)
        self.assertLess(point[0], 441)

    def test_detail_tap_refuses_a_fully_covered_node(self) -> None:
        album = resource_node("home-album-12")
        overlay = resource_node("mini-player", clickable=False)

        self.assertIsNone(unobscured_center(album, "home album", [overlay]))

    def test_allows_only_navigation_and_read_only_detail_routes(self) -> None:
        for suffix in (
            "tab-home",
            "profile-access",
            "home-album-12",
            "search-genre-132",
            "discover-playlist-7",
            "library-playlist-4",
            "library-open-liked",
        ):
            assert_safe_interaction(suffix)

    def test_refuses_destructive_playback_and_unknown_controls(self) -> None:
        for suffix in (
            "logout-button",
            "profile-delete-confirm",
            "library-create-submit",
            "playlist-delete",
            "playlist-visibility",
            "playlist-track-12-0-remove",
            "radio-mood-focus",
            "discover-chart-12-0",
            "unknown-control",
        ):
            with self.subTest(suffix=suffix), self.assertRaises(QaFailure):
                assert_safe_interaction(suffix)

    def test_detail_routes_accept_loading_error_or_content_states(self) -> None:
        self.assertEqual(
            detail_expectations("discover-album-42"),
            ("album-screen", "album-loading", "album-error"),
        )
        self.assertEqual(
            detail_expectations("library-open-liked"),
            ("playlist-screen", "playlist-loading", "playlist-error"),
        )
        self.assertIsNone(detail_expectations("library-create-playlist"))


class CrashDetectionTests(unittest.TestCase):
    def test_normalizes_single_token_device_timestamp_for_logcat(self) -> None:
        self.assertEqual(
            normalize_logcat_timestamp("07-15_22:45:01.000"),
            "07-15 22:45:01.000",
        )

    def test_rejects_malformed_device_timestamp(self) -> None:
        with self.assertRaises(QaFailure):
            normalize_logcat_timestamp("07-15 22:45:01.000")

    def test_detects_java_native_and_anr_failures_for_this_app(self) -> None:
        java = "FATAL EXCEPTION: main\nProcess: top.logge.loggerythm, PID: 77\n"
        native = "Fatal signal 6\npid: 77, tid: 80\ntop.logge.loggerythm\n"
        anr = "ANR in top.logge.loggerythm\n"

        self.assertEqual(app_crash_reason(java, "77"), "fatal exception")
        self.assertEqual(app_crash_reason(native, "77"), "native fatal signal")
        self.assertEqual(app_crash_reason(anr, "77"), "ANR")

    def test_ignores_other_app_crashes(self) -> None:
        other = "FATAL EXCEPTION: main\nProcess: com.example.other, PID: 99\n"
        self.assertIsNone(app_crash_reason(other, "77"))


if __name__ == "__main__":
    unittest.main()
