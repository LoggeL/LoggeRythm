import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANDROID_UPDATE_FINAL_INSTALL_CODES, androidInstallFailureIsFinal } from './updateErrors';

const NATIVE_DIR = '../../modules/loggerythm-updater/android/src/main/java/top/logge/loggerythm/updater/';

/** The module and the install receiver: every code either can raise or store. */
const NATIVE_SOURCE = ['LoggeRythmUpdaterModule.kt', 'LoggeRythmUpdateInstallReceiver.kt']
  .map((file) => readFileSync(fileURLToPath(new URL(`${NATIVE_DIR}${file}`, import.meta.url)), 'utf8'))
  .join('\n');

function failure(code: string | null) {
  return { code, message: 'detail', httpStatus: null };
}

describe('androidInstallFailureIsFinal', () => {
  it.each([
    'updater-digest-mismatch',
    'updater-signature-mismatch',
    'updater-signature-missing',
    'updater-apk-not-newer',
    'updater-apk-version-mismatch',
    'updater-apk-version-code-mismatch',
    'updater-package-mismatch',
    'updater-apk-invalid',
    'updater-install-incompatible',
    'updater-install-blocked',
    'updater-install-conflict',
  ])('%s cannot succeed on retry', (code) => {
    expect(androidInstallFailureIsFinal(failure(code))).toBe(true);
  });

  it.each([
    'updater-install-aborted',
    'updater-install-failed',
    'updater-install-confirmation-blocked',
    'updater-install-outcome-unsaved',
    'updater-download-io',
    'updater-download-http',
    'updater-install-busy',
    'updater-install-permission-required',
    'network',
  ])('%s is retryable', (code) => {
    expect(androidInstallFailureIsFinal(failure(code))).toBe(false);
  });

  it('treats a failure without a code as retryable', () => {
    expect(androidInstallFailureIsFinal(failure(null))).toBe(false);
  });

  it('names only codes the native side actually raises or stores', () => {
    for (const code of ANDROID_UPDATE_FINAL_INSTALL_CODES) {
      expect(NATIVE_SOURCE, code).toContain(`"${code}"`);
    }
  });

  it('maps exactly the final PackageInstaller statuses to final codes', () => {
    // STATUS_FAILURE, STATUS_FAILURE_STORAGE and newer statuses stay retryable.
    expect(NATIVE_SOURCE).toMatch(/STATUS_FAILURE_INCOMPATIBLE -> INSTALL_INCOMPATIBLE_CODE/);
    expect(NATIVE_SOURCE).toMatch(/STATUS_FAILURE_BLOCKED -> INSTALL_BLOCKED_CODE/);
    expect(NATIVE_SOURCE).toMatch(/STATUS_FAILURE_CONFLICT -> INSTALL_CONFLICT_CODE/);
    expect(NATIVE_SOURCE).toMatch(/else -> INSTALL_FAILED_CODE/);
    expect(NATIVE_SOURCE).not.toMatch(/STATUS_FAILURE_STORAGE ->/);
  });
});
