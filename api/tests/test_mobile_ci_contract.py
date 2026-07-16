from __future__ import annotations

import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MOBILE_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "mobile-android.yml"
API_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "api-contract.yml"


class MobileCiContractTests(unittest.TestCase):
    def test_every_api_change_triggers_the_android_contract_and_build_workflow(self) -> None:
        workflow = MOBILE_WORKFLOW.read_text(encoding="utf-8")

        # The path must be present independently under push and pull_request.
        # A narrow router/schema allowlist previously let backend wire changes
        # bypass Android compilation and decoder tests.
        self.assertEqual(workflow.count('- "api/**"'), 2)
        self.assertIn('python -m app.openapi_contract check', workflow)
        self.assertIn('python -m app.android_contract check', workflow)
        self.assertIn('run: npm run check', workflow)
        self.assertIn('npx expo prebuild --platform android --clean --no-install', workflow)
        self.assertIn(':app:testReleaseUnitTest :app:assembleRelease', workflow)

    def test_api_contract_workflow_has_the_same_complete_api_trigger(self) -> None:
        workflow = API_WORKFLOW.read_text(encoding="utf-8")

        self.assertEqual(workflow.count('- "api/**"'), 2)
        self.assertEqual(workflow.count('- "mobile/src/api/generated/**"'), 2)
        self.assertIn('python -m app.openapi_contract check', workflow)
        self.assertIn('python -m app.android_contract check', workflow)
        self.assertIn('tests.test_openapi_contract', workflow)
        self.assertIn('tests.test_mobile_ci_contract', workflow)


if __name__ == "__main__":
    unittest.main()
