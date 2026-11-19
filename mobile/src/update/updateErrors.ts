/**
 * Typed failures of the Android release updater. JavaScript checks throw an
 * {@link AndroidUpdateError} with a stable code; the native module rejects its
 * promises with `error.code` (for example `updater-apk-not-newer`). The UI maps
 * both to a localized cause and always keeps the raw detail visible.
 */
export type AndroidUpdateCheckErrorCode =
  | 'network'
  | 'github-http'
  | 'github-rate-limited'
  | 'release-invalid'
  | 'release-version-code-missing'
  | 'release-version-code-ambiguous'
  | 'installed-version-invalid'
  | 'update-marker-invalid';

export interface AndroidUpdateErrorOptions {
  cause?: unknown;
  /** Normalized version of the release the failure is about, e.g. `1.0.17`. */
  releaseVersion?: string;
  /** The installed versionName as Android reports it, when the failure is about it. */
  installedVersion?: string;
}

export class AndroidUpdateError extends Error {
  public readonly releaseVersion: string | null;
  public readonly installedVersion: string | null;

  constructor(
    public readonly code: AndroidUpdateCheckErrorCode,
    message: string,
    public readonly httpStatus: number | null = null,
    options: AndroidUpdateErrorOptions = {},
  ) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'AndroidUpdateError';
    this.releaseVersion = options.releaseVersion ?? null;
    this.installedVersion = options.installedVersion ?? null;
  }
}

/** Code and message of any updater failure, JavaScript or native. */
export interface AndroidUpdateFailure {
  code: string | null;
  message: string;
  httpStatus: number | null;
  /** The release the failure is about, when the failing step knew it. */
  releaseVersion?: string | null;
  /** The installed versionName, for `installed-version-invalid`. */
  installedVersion?: string | null;
}

const NATIVE_CODE = /^updater-[a-z0-9-]+$/;

/**
 * `releaseVersion` and `installedVersion` are set only when the failing step
 * knew them, so a plain failure keeps exactly `{ code, message, httpStatus }`.
 */
export function androidUpdateFailure(value: unknown): AndroidUpdateFailure {
  if (value instanceof AndroidUpdateError) {
    return {
      code: value.code,
      message: value.message,
      httpStatus: value.httpStatus,
      ...(value.releaseVersion !== null ? { releaseVersion: value.releaseVersion } : {}),
      ...(value.installedVersion !== null ? { installedVersion: value.installedVersion } : {}),
    };
  }
  if (value instanceof Error) {
    const nativeCode = (value as Error & { code?: unknown }).code;
    return {
      code: typeof nativeCode === 'string' && NATIVE_CODE.test(nativeCode) ? nativeCode : null,
      message: value.message,
      httpStatus: null,
    };
  }
  return { code: null, message: String(value), httpStatus: null };
}

/**
 * Native install codes for which retrying the same release cannot succeed:
 * the release's own data or its APK is wrong, so every attempt fails the same
 * deterministic validation, or Android's installer rejects this APK on this
 * device for good. Transient download, cache and installer codes
 * (`updater-download-*`, `updater-cache-*`, `updater-install-failed`,
 * `updater-install-aborted`, `updater-install-outcome-unsaved`, …) are not here.
 */
export const ANDROID_UPDATE_FINAL_INSTALL_CODES: ReadonlySet<string> = new Set([
  // The release's declared data, rejected before the download.
  'updater-version-code-invalid',
  'updater-version-invalid',
  'updater-digest-invalid',
  'updater-url-invalid',
  'updater-url-host-rejected',
  'updater-url-release-rejected',
  // The downloaded APK, rejected by validation.
  'updater-digest-mismatch',
  'updater-apk-invalid',
  'updater-package-mismatch',
  'updater-apk-version-missing',
  'updater-apk-version-mismatch',
  'updater-apk-version-code-mismatch',
  'updater-apk-not-newer',
  'updater-signature-mismatch',
  'updater-signature-missing',
  // Android's installer refused the verified APK (install receiver outcomes):
  // STATUS_FAILURE_INCOMPATIBLE, STATUS_FAILURE_BLOCKED, STATUS_FAILURE_CONFLICT.
  'updater-install-incompatible',
  'updater-install-blocked',
  'updater-install-conflict',
]);

/**
 * Final codes caused by this device, not by the release: Android's installer
 * refused the verified APK here, or the installed build is already newer.
 * The release page cannot explain them; the card's detail names the cause.
 */
export const ANDROID_UPDATE_DEVICE_FINAL_CODES: ReadonlySet<string> = new Set([
  'updater-install-incompatible',
  'updater-install-blocked',
  'updater-install-conflict',
  'updater-apk-not-newer',
]);

/** True when installing the same release again cannot succeed. */
export function androidInstallFailureIsFinal(failure: AndroidUpdateFailure): boolean {
  return failure.code !== null && ANDROID_UPDATE_FINAL_INSTALL_CODES.has(failure.code);
}

/**
 * Where the cause of a final failure lies: the release (its data or its APK)
 * or this device. Throws for a failure that is not final.
 */
export function androidFinalFailureCause(failure: AndroidUpdateFailure): 'release' | 'device' {
  if (!androidInstallFailureIsFinal(failure)) {
    throw new Error(`Update failure ${failure.code ?? '<no code>'} is not final and has no final cause`);
  }
  return failure.code !== null && ANDROID_UPDATE_DEVICE_FINAL_CODES.has(failure.code) ? 'device' : 'release';
}
