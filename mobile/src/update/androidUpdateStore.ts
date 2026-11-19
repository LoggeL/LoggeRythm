import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { getActiveLocale, onLocaleActivated, type AppLocale } from '../localization';
import {
  androidUpdater,
  installedBuild,
  readAndroidInstallation,
  checkLatestAndroidRelease,
  consumeAndroidInstallOutcome,
  setAndroidUpdaterAppLocale,
  subscribeAndroidInstallOutcome,
  subscribeAndroidUpdateDownloadProgress,
  type AndroidInstallOutcome,
  type AndroidUpdateCheck,
  type AndroidUpdateDownloadProgress,
  type AndroidUpdateRelease,
  type AndroidUpdaterPort,
  type FetchLike,
} from './githubReleaseUpdater';
import {
  AndroidUpdateError,
  androidInstallFailureIsFinal,
  androidUpdateFailure,
  type AndroidUpdateFailure,
} from './updateErrors';

/** Re-check on returning to the foreground once the last check is this old. */
export const FOREGROUND_RECHECK_MS = 6 * 60 * 60 * 1000;
/** Re-check on opening the profile once the last check is this old. */
export const PROFILE_RECHECK_MS = 60 * 60 * 1000;
/** Written before the APK goes to Android's installer; read once on the next start. */
export const PENDING_INSTALL_STORAGE_KEY = 'loggerythm.androidUpdate.pendingInstall.v1';
/**
 * A final install failure and the release it belongs to (versionCode, APK
 * digest and URL), so a restart shows it again instead of a fresh install
 * button. Cleared by a check that no longer offers exactly that release.
 */
export const FINAL_FAILURE_STORAGE_KEY = 'loggerythm.androidUpdate.finalFailure.v1';

export type AndroidUpdateCheckReason = 'startup' | 'foreground' | 'profile' | 'manual';

/** The installed build as Android reports it (versionName as-is, even if not semver). */
export interface AndroidInstalledDisplay {
  versionName: string;
  versionCode: number;
}

export type AndroidUpdateCheckState =
  | { kind: 'idle' }
  | { kind: 'checking'; previous: AndroidUpdateCheck | null; previousCheckedAt: number | null }
  | { kind: 'done'; result: AndroidUpdateCheck; checkedAt: number }
  | {
    kind: 'failed';
    failure: AndroidUpdateFailure;
    /** When this check failed. */
    checkedAt: number;
    previous: AndroidUpdateCheck | null;
    /** When `previous` was checked (the last finished check); null exactly when `previous` is. */
    previousCheckedAt: number | null;
  };

export type AndroidUpdateInstallState =
  | { kind: 'idle' }
  | { kind: 'preparing'; release: AndroidUpdateRelease }
  | { kind: 'permission'; release: AndroidUpdateRelease }
  | {
    kind: 'downloading';
    release: AndroidUpdateRelease;
    progress: AndroidUpdateDownloadProgress | null;
  }
  | {
    kind: 'awaiting-confirmation';
    release: AndroidUpdateRelease;
    /**
     * Something went wrong on the way that did not stop the handoff (an
     * invalid progress event), shown next to the confirmation wait.
     */
    warning?: AndroidUpdateFailure;
  }
  | {
    kind: 'failed';
    release: AndroidUpdateRelease;
    failure: AndroidUpdateFailure;
    /**
     * Set on a final failure that happened in this process until the user
     * acknowledges it ({@link AndroidUpdateStore.acknowledgeFinalFailure}: a
     * manual re-check, or leaving the profile). Until then it keeps the top
     * card and the header dot. A final failure restored at startup (kept in
     * storage, or an installer outcome of the previous process) never has it.
     */
    unacknowledged?: true;
  };

/**
 * An installer outcome, or a failure of the outcome channel itself, that names
 * no build while no release is offered: no install card can show it and no
 * later offer may claim it, so the card shows it as a muted line on its own.
 */
export interface AndroidUpdateOrphanedFailure {
  phase: 'install-outcome' | 'install-outcome-unavailable';
  failure: AndroidUpdateFailure;
}

export interface AndroidUpdateSnapshot {
  /** False off Android; every consumer renders nothing then. */
  supported: boolean;
  /** Known after the first local read, independent of the network check. */
  installed: AndroidInstalledDisplay | null;
  check: AndroidUpdateCheckState;
  install: AndroidUpdateInstallState;
  /** Set for this process when the previous one handed exactly this update to Android and it is now installed. */
  updatedTo: string | null;
  /** See {@link AndroidUpdateOrphanedFailure}; cleared by a manual re-check. */
  orphanedInstallFailure: AndroidUpdateOrphanedFailure | null;
  /**
   * The startup failures the card does not show otherwise, so the short
   * startup toast can point to the profile for the cause and the full
   * detail: every failure of the startup report except installer outcomes
   * that reached the install card. A failed startup check is kept too: the
   * check that opening the profile (or returning to the app) runs replaces
   * the failed check state, so the card shows the note while that check runs
   * ({@link visibleAndroidUpdateStartupNotes} hides it while the check state
   * still shows this very failure). A later check that finishes removes every
   * check-phase note: a successful one shows the current truth (the toast
   * already reported the failure), a failed one shows its own failure instead.
   * Other entries leave the list once a later check puts them on the install
   * card; a manual re-check clears the list.
   */
  startupNotes: AndroidUpdateStartupFailure[];
}

/**
 * Where a startup failure came from: the startup check, the stored state of
 * an update handed to Android earlier (its marker or a kept final failure),
 * an outcome Android's installer reported (`install-outcome`), or the outcome
 * channel itself, which could not be subscribed to or read
 * (`install-outcome-unavailable`), or handing the app's language to the
 * native install receiver for its toasts and notifications (`app-locale`).
 */
export type AndroidUpdateStartupPhase =
  | 'check'
  | 'pending-install'
  | 'install-outcome'
  | 'install-outcome-unavailable'
  | 'app-locale';

export interface AndroidUpdateStartupFailure {
  phase: AndroidUpdateStartupPhase;
  failure: AndroidUpdateFailure;
}

export interface AndroidUpdateStartupReport {
  updatedTo: string | null;
  failures: AndroidUpdateStartupFailure[];
}

interface StorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface AppStateLike {
  addEventListener(
    type: 'change',
    listener: (state: string) => void,
  ): { remove(): void };
}

export interface AndroidUpdateStoreDependencies {
  platformOS: string;
  platformVersion: number | string;
  updater: AndroidUpdaterPort;
  fetcher: FetchLike;
  now(): number;
  storage: StorageLike;
  appState: AppStateLike;
  /** Android 13+ notification permission; the answer is the user's choice and not required. */
  requestNotificationPermission(): Promise<unknown>;
  subscribeProgress(
    listener: (progress: AndroidUpdateDownloadProgress) => void,
    onInvalid: (error: unknown) => void,
  ): () => void;
  /** Reads and clears the outcome Android's installer reported, if any. */
  consumeInstallOutcome(): Promise<AndroidInstallOutcome | null>;
  /** Live signal that the installer reported an outcome while the app runs. */
  subscribeInstallOutcome(
    listener: (outcome: AndroidInstallOutcome) => void,
    onInvalid: (error: unknown) => void,
  ): () => void;
  /** Stores the app's language natively for the install receiver's texts. */
  setAppLocale(locale: AppLocale): Promise<void>;
  /** The locale the app shows now. */
  activeLocale(): AppLocale;
  /** Called with every locale the app activates later. */
  subscribeLocale(listener: (locale: AppLocale) => void): () => void;
}

/** The latest known check result, kept visible while a re-check runs or after it failed. */
export function currentAndroidUpdateResult(snapshot: AndroidUpdateSnapshot): AndroidUpdateCheck | null {
  switch (snapshot.check.kind) {
    case 'done':
      return snapshot.check.result;
    case 'checking':
    case 'failed':
      return snapshot.check.previous;
    case 'idle':
      return null;
  }
}

/**
 * The startup notes the card shows: all of them, except a failed startup
 * check while the check state still shows that very failure (the card's
 * check ErrorState, or its folded line next to an install failure).
 */
export function visibleAndroidUpdateStartupNotes(
  snapshot: AndroidUpdateSnapshot,
): AndroidUpdateStartupFailure[] {
  const check = snapshot.check;
  if (check.kind !== 'failed') return snapshot.startupNotes;
  return snapshot.startupNotes.filter((note) => note.failure !== check.failure);
}

/** The release the profile offers to install, if any. */
export function availableAndroidUpdate(snapshot: AndroidUpdateSnapshot): AndroidUpdateRelease | null {
  if (snapshot.install.kind !== 'idle') return snapshot.install.release;
  const result = currentAndroidUpdateResult(snapshot);
  return result?.kind === 'available' ? result.release : null;
}

/**
 * What waits for the user in the profile, if anything: an offered update
 * (`update-available`, including an install in progress or a retryable
 * failure), or a final install failure of this process the user has not
 * acknowledged yet (`install-failed`). An install that failed for good
 * (retrying the same release cannot succeed) waits only until the user
 * acknowledged it (see the `unacknowledged` flag of a failed install);
 * afterwards, and when it was restored at startup, nothing waits and the card
 * shows it at the bottom.
 */
export type AndroidUpdateAttention = 'none' | 'update-available' | 'install-failed';

export function androidUpdateAttention(snapshot: AndroidUpdateSnapshot): AndroidUpdateAttention {
  if (!snapshot.supported) return 'none';
  if (snapshot.install.kind === 'failed' && androidInstallFailureIsFinal(snapshot.install.failure)) {
    return snapshot.install.unacknowledged === true ? 'install-failed' : 'none';
  }
  return availableAndroidUpdate(snapshot) !== null ? 'update-available' : 'none';
}

/** True when something waits for the user in the profile: the header dot and the top card. */
export function androidUpdateNeedsAttention(snapshot: AndroidUpdateSnapshot): boolean {
  return androidUpdateAttention(snapshot) !== 'none';
}

/**
 * When the result `currentAndroidUpdateResult` returns was checked: the last
 * finished check. A failed check is not it, so a re-check that follows a
 * failure still dates the result it keeps visible correctly.
 */
export function androidUpdateResultCheckedAt(snapshot: AndroidUpdateSnapshot): number | null {
  switch (snapshot.check.kind) {
    case 'done':
      return snapshot.check.checkedAt;
    case 'checking':
    case 'failed':
      return snapshot.check.previousCheckedAt;
    case 'idle':
      return null;
  }
}

function parsePendingInstall(raw: string): { versionName: string; versionCode: number } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new AndroidUpdateError('update-marker-invalid', 'Pending update marker is not JSON', null, {
      cause: error,
    });
  }
  const record = value as Record<string, unknown> | null;
  if (
    record === null ||
    typeof record !== 'object' ||
    typeof record.versionName !== 'string' ||
    record.versionName.trim() === '' ||
    !Number.isSafeInteger(record.versionCode) ||
    (record.versionCode as number) <= 0
  ) {
    throw new AndroidUpdateError('update-marker-invalid', 'Pending update marker has an invalid shape');
  }
  return { versionName: record.versionName, versionCode: record.versionCode as number };
}

/** A release's identity: what the APK download is bound to. */
interface ReleaseIdentity {
  versionCode: number;
  apkDigest: string;
  apkUrl: string;
}

/** A final install failure kept across restarts for exactly one release. */
interface FinalInstallFailure {
  release: ReleaseIdentity;
  failure: AndroidUpdateFailure;
}

function invalidFinalFailure(message: string, cause?: unknown): AndroidUpdateError {
  return new AndroidUpdateError(
    'update-marker-invalid',
    `Stored final update failure ${message}`,
    null,
    cause === undefined ? {} : { cause },
  );
}

function optionalText(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function parseFinalFailure(raw: string): FinalInstallFailure {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw invalidFinalFailure('is not JSON', error);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidFinalFailure('is not an object');
  }
  const { release, failure } = value as Record<string, unknown>;
  if (release === null || typeof release !== 'object' || Array.isArray(release)) {
    throw invalidFinalFailure('has no release');
  }
  const identity = release as Record<string, unknown>;
  if (
    !Number.isSafeInteger(identity.versionCode) ||
    (identity.versionCode as number) <= 0 ||
    typeof identity.apkDigest !== 'string' ||
    identity.apkDigest === '' ||
    typeof identity.apkUrl !== 'string' ||
    identity.apkUrl === ''
  ) {
    throw invalidFinalFailure('has an invalid release identity');
  }
  if (failure === null || typeof failure !== 'object' || Array.isArray(failure)) {
    throw invalidFinalFailure('has no failure');
  }
  const stored = failure as Record<string, unknown>;
  if (
    typeof stored.code !== 'string' ||
    typeof stored.message !== 'string' ||
    !(stored.httpStatus === null || Number.isSafeInteger(stored.httpStatus)) ||
    !optionalText(stored.releaseVersion) ||
    !optionalText(stored.installedVersion)
  ) {
    throw invalidFinalFailure('has an invalid failure');
  }
  const kept: AndroidUpdateFailure = {
    code: stored.code,
    message: stored.message,
    httpStatus: stored.httpStatus as number | null,
    ...(stored.releaseVersion !== undefined ? { releaseVersion: stored.releaseVersion } : {}),
    ...(stored.installedVersion !== undefined ? { installedVersion: stored.installedVersion } : {}),
  };
  if (!androidInstallFailureIsFinal(kept)) {
    throw invalidFinalFailure(`has the retryable code ${stored.code}`);
  }
  return {
    release: {
      versionCode: identity.versionCode as number,
      apkDigest: identity.apkDigest,
      apkUrl: identity.apkUrl,
    },
    failure: kept,
  };
}

function sameRelease(left: ReleaseIdentity, right: ReleaseIdentity): boolean {
  return (
    left.versionCode === right.versionCode &&
    left.apkDigest === right.apkDigest &&
    left.apkUrl === right.apkUrl
  );
}

/** The failure an installer outcome stands for; it names the release the session installed. */
function outcomeFailure(outcome: AndroidInstallOutcome): AndroidUpdateFailure {
  return {
    code: outcome.code,
    message: outcome.message,
    httpStatus: null,
    ...(outcome.versionName !== null ? { releaseVersion: outcome.versionName } : {}),
  };
}

/** Where an installer failure comes from; decides where it can be shown. */
interface InstallFailureOrigin {
  /** The build the installer session was for; null when the failure names none. */
  versionCode: number | null;
  /**
   * Read by start() from what the previous process left behind (the native
   * outcome store): the startup report already names it, and a final one goes
   * straight to the bottom card.
   */
  restored: boolean;
  /** How it is named when no install card can show it. */
  phase: AndroidUpdateOrphanedFailure['phase'];
}

/** A failure of the outcome channel itself (unreadable or malformed outcome). */
const CHANNEL_FAILURE: InstallFailureOrigin = {
  versionCode: null,
  restored: false,
  phase: 'install-outcome-unavailable',
};

function outcomeOrigin(outcome: AndroidInstallOutcome, restored: boolean): InstallFailureOrigin {
  return { versionCode: outcome.versionCode, restored, phase: 'install-outcome' };
}

/** An installer failure for a known build, waiting for a check that offers that build. */
interface ParkedInstallFailure {
  failure: AndroidUpdateFailure;
  versionCode: number;
  restored: boolean;
}

function failureMatchesRelease(versionCode: number | null, release: AndroidUpdateRelease): boolean {
  return versionCode === null || versionCode === release.versionCode;
}

/** `failure`, with a second failure of the same attempt appended to its message. */
function withAlso(failure: AndroidUpdateFailure, also: AndroidUpdateFailure): AndroidUpdateFailure {
  return {
    ...failure,
    message: `${failure.message} (also: ${also.code === null ? '' : `${also.code}: `}${also.message})`,
  };
}

/**
 * Two failures of the same release as one. The earlier one keeps the lead (and
 * its code), the later one is appended; only a final failure arriving on a
 * retryable one leads instead, so the card never offers a retry that cannot
 * succeed and the final failure is kept across restarts.
 */
function combineFailures(earlier: AndroidUpdateFailure, later: AndroidUpdateFailure): AndroidUpdateFailure {
  return androidInstallFailureIsFinal(later) && !androidInstallFailureIsFinal(earlier)
    ? withAlso(later, earlier)
    : withAlso(earlier, later);
}

/**
 * The session id in the native installer's reply, or null when it has none
 * usable. Read on its own so a reply that fails validation otherwise still
 * names the session Android now owns.
 */
function submittedSessionId(value: unknown): number | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const { sessionId } = value as Record<string, unknown>;
  return Number.isSafeInteger(sessionId) && (sessionId as number) > 0 ? (sessionId as number) : null;
}

/** Validates what the native installer handed back for exactly this release. */
function assertSubmitted(value: unknown, release: AndroidUpdateRelease): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Android installer returned ${value === null ? 'null' : typeof value}, expected an object`);
  }
  const submitted = value as Record<string, unknown>;
  if (submitted.status !== 'awaiting-user-confirmation') {
    throw new Error(`Unexpected Android installer state: ${String(submitted.status)}`);
  }
  if (submitted.versionName !== release.versionName) {
    throw new Error(
      `Android installer received version ${String(submitted.versionName)}, expected ${release.versionName}`,
    );
  }
  if (submitted.versionCode !== release.versionCode) {
    throw new Error(
      `Android installer received versionCode ${String(submitted.versionCode)}, expected ${release.versionCode}`,
    );
  }
  if (submittedSessionId(value) === null) {
    throw new Error(`Android installer returned session id ${String(submitted.sessionId)}, expected a positive integer`);
  }
}

export interface AndroidUpdateStore {
  getSnapshot(): AndroidUpdateSnapshot;
  subscribe(listener: () => void): () => void;
  /** Runs once per process: startup check, pending-install outcome, foreground listener. */
  start(): Promise<AndroidUpdateStartupReport>;
  /**
   * Single-flight; time-based reasons skip a fresh result. Only a finished
   * check is fresh; a failed one is retried on the next trigger, except a
   * GitHub rate limit, which keeps the normal throttle. Failures land in the
   * snapshot.
   */
  check(reason: AndroidUpdateCheckReason): Promise<void>;
  /**
   * Downloads, verifies and hands the available update to Android's
   * installer. Throws when an install is already running.
   */
  install(): Promise<void>;
  /**
   * The user has seen the final install failure of this process (they left
   * the profile): the card moves to the bottom and the header dot goes.
   * A manual re-check does the same. Nothing happens without such a failure.
   */
  acknowledgeFinalFailure(): void;
}

export function createAndroidUpdateStore(deps: AndroidUpdateStoreDependencies): AndroidUpdateStore {
  const supported = deps.platformOS === 'android';
  let snapshot: AndroidUpdateSnapshot = {
    supported,
    installed: null,
    check: { kind: 'idle' },
    install: { kind: 'idle' },
    updatedTo: null,
    orphanedInstallFailure: null,
    startupNotes: [],
  };
  const listeners = new Set<() => void>();
  let inFlightCheck: Promise<void> | null = null;
  let installRunning = false;
  /**
   * Installer failures for a known build that arrived while no release was
   * known; the next check offering exactly that build shows them, chained.
   * A failure that names no build is never parked (see showInstallFailure).
   */
  let parkedInstallFailures: ParkedInstallFailure[] = [];
  /**
   * The startup report while start() runs: a failure that names no build and
   * finds no install card goes into it instead of a card.
   */
  let startupFailures: AndroidUpdateStartupFailure[] | null = null;
  /**
   * Installer failures (as they arrived, before any chaining) that reached
   * the install card; the startup notes leave them out (see `startupNotes`).
   */
  const failuresOnCard = new WeakSet<AndroidUpdateFailure>();
  /**
   * Installer outcomes read while install() ran (or that install() overtook
   * while they were being applied). Only the settled attempt knows whether it
   * superseded their session, so they wait for it. `applyFailure`: applying
   * the outcome failed before the attempt started; it is shown with it.
   */
  let heldOutcomes: { outcome: AndroidInstallOutcome; applyFailure: AndroidUpdateFailure | null }[] = [];
  /** Failures of the outcome channel itself while install() ran; shown once it settles. */
  let heldChannelFailure: AndroidUpdateFailure | null = null;
  /**
   * The installer session this process submitted last; null before the first
   * submission. `sessionId` is null when Android's reply named no usable id.
   */
  let submittedSession: { sessionId: number | null } | null = null;
  /**
   * The pending-install marker of the session submitted last, while its
   * outcome is still open. A later attempt that fails before reaching
   * Android's installer puts it back, because that session can still finish.
   */
  let pendingSessionMarker: string | null = null;
  /** The kept final install failure (see {@link FINAL_FAILURE_STORAGE_KEY}). */
  let finalFailure: FinalInstallFailure | null = null;
  let notificationPermissionRequested = false;
  /**
   * Failures of the startup GitHub check itself. A later check supersedes only
   * these; other 'check'-phase notes (a failed startup setup) stay until a
   * manual re-check, because no check resolves them.
   */
  const startupCheckFailures = new WeakSet<AndroidUpdateFailure>();
  function isStartupCheckNote(note: AndroidUpdateStartupFailure): boolean {
    return note.phase === 'check' && startupCheckFailures.has(note.failure);
  }
  let startPromise: Promise<AndroidUpdateStartupReport> | null = null;

  function publish(next: Partial<AndroidUpdateSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  }

  /**
   * A check during a download would replace the release the installer works
   * on. Waiting for the installer's confirmation does not block: that wait
   * can end without any signal reaching the app.
   */
  function installBusy(): boolean {
    const kind = snapshot.install.kind;
    return kind === 'preparing' || kind === 'downloading';
  }

  function isFresh(maxAgeMs: number): boolean {
    const current = snapshot.check;
    const throttled =
      current.kind === 'done' ||
      (current.kind === 'failed' && current.failure.code === 'github-rate-limited');
    return throttled && deps.now() - current.checkedAt < maxAgeMs;
  }

  /**
   * True when `outcome` ended another session than the one this process
   * submitted last. Before any submission (and when Android named no usable
   * session id) the stored outcome is the one the marker waits for.
   */
  function supersededOutcome(outcome: AndroidInstallOutcome): boolean {
    if (submittedSession === null || submittedSession.sessionId === null) return false;
    return outcome.sessionId !== submittedSession.sessionId;
  }

  /**
   * Keeps a final failure for its release across restarts. A failure to store
   * it is appended to the failure itself: on the card when it shows it, and in
   * this process's kept copy, so the next check offering the release shows
   * it too. It never rejects, because callers may not await it.
   */
  async function keepFinalFailure(release: AndroidUpdateRelease, failure: AndroidUpdateFailure): Promise<void> {
    const identity: ReleaseIdentity = {
      versionCode: release.versionCode,
      apkDigest: release.apkDigest,
      apkUrl: release.apkUrl,
    };
    const kept: FinalInstallFailure = { release: identity, failure };
    finalFailure = kept;
    try {
      await deps.storage.setItem(FINAL_FAILURE_STORAGE_KEY, JSON.stringify(kept));
    } catch (error) {
      const unsaved = withAlso(
        failure,
        androidUpdateFailure(
          new Error(
            `The final update failure could not be saved for the next start: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { cause: error },
          ),
        ),
      );
      // A newer final failure may have replaced this one meanwhile.
      if (finalFailure === kept) finalFailure = { release: identity, failure: unsaved };
      const install = snapshot.install;
      if (install.kind === 'failed' && install.failure === failure) {
        publish({ install: { ...install, failure: unsaved } });
      }
    }
  }

  /**
   * Publishes a failed install; a final failure is also kept across restarts.
   * A final failure of this process (not `restored`) stays on top until the
   * user acknowledges it.
   */
  async function failInstall(
    release: AndroidUpdateRelease,
    failure: AndroidUpdateFailure,
    restored = false,
  ): Promise<void> {
    const final = androidInstallFailureIsFinal(failure);
    publish({
      install: { kind: 'failed', release, failure, ...(final && !restored ? { unacknowledged: true } : {}) },
    });
    if (final) await keepFinalFailure(release, failure);
  }

  function acknowledgeFinalFailure(): void {
    const install = snapshot.install;
    if (install.kind !== 'failed' || install.unacknowledged !== true) return;
    publish({ install: { kind: 'failed', release: install.release, failure: install.failure } });
  }

  /** Forgets the kept final failure unless `offered` is exactly its release. */
  async function dropFinalFailureUnless(offered: AndroidUpdateRelease | null): Promise<void> {
    if (finalFailure === null) return;
    if (offered !== null && sameRelease(finalFailure.release, offered)) return;
    finalFailure = null;
    await deps.storage.removeItem(FINAL_FAILURE_STORAGE_KEY);
  }

  /** Reads the kept final failure; a corrupt record is removed and reported once. */
  async function restoreFinalFailure(): Promise<void> {
    const raw = await deps.storage.getItem(FINAL_FAILURE_STORAGE_KEY);
    if (raw === null) return;
    try {
      finalFailure = parseFinalFailure(raw);
    } catch (error) {
      await deps.storage.removeItem(FINAL_FAILURE_STORAGE_KEY);
      throw error;
    }
  }

  /**
   * Shows an installer failure on the install card. While install() runs it
   * is shown once that attempt settles, so it never races the running
   * download. Without a known release, a failure for a known build waits for
   * the next check that offers exactly that build; one that names no build is
   * never parked (a later offer of an unrelated release must not claim it):
   * during start() it goes into the startup report, afterwards it is shown at
   * once as the card's orphaned failure. Several such failures are chained.
   * A card that already shows a failure for this release combines both
   * ({@link combineFailures}).
   */
  function showInstallFailure(failure: AndroidUpdateFailure, origin: InstallFailureOrigin): void {
    if (installRunning) {
      heldChannelFailure = heldChannelFailure === null ? failure : withAlso(heldChannelFailure, failure);
      return;
    }
    const release = availableAndroidUpdate(snapshot);
    if (release === null) {
      if (origin.versionCode !== null) {
        parkedInstallFailures.push({ failure, versionCode: origin.versionCode, restored: origin.restored });
        return;
      }
      // Restored outcomes are read by start() itself, which reports them (and
      // keeps them as startup notes).
      if (origin.restored) return;
      if (startupFailures !== null) {
        startupFailures.push({ phase: origin.phase, failure });
        return;
      }
      const earlier = snapshot.orphanedInstallFailure;
      publish({
        orphanedInstallFailure:
          earlier === null
            ? { phase: origin.phase, failure }
            : { phase: earlier.phase, failure: withAlso(earlier.failure, failure) },
      });
      return;
    }
    parkedInstallFailures = [];
    // An installer outcome for another build than the one offered now belongs to
    // a superseded release: showing it on this offer would blame the wrong
    // version. The startup report still toasts it; the new offer stands.
    if (!failureMatchesRelease(origin.versionCode, release)) return;
    const install = snapshot.install;
    const onCard = install.kind === 'failed' && install.release === release ? install : null;
    const shown = onCard === null ? failure : combineFailures(onCard.failure, failure);
    failuresOnCard.add(failure);
    // A restored failure joining one of this process keeps it on top.
    void failInstall(release, shown, origin.restored && onCard?.unacknowledged !== true);
  }

  /** Leaves `outcome` to the running install() (see {@link heldOutcomes}). */
  function holdOutcome(outcome: AndroidInstallOutcome, applyFailure: AndroidUpdateFailure | null = null): void {
    heldOutcomes.push({ outcome, applyFailure });
  }

  /**
   * Turns a non-success installer outcome of the current session into the
   * install failure and drops the pending-install marker. An outcome for a
   * versionCode the app already has is stale (the update got installed after
   * all) and returns null. Callers check {@link supersededOutcome} first.
   * `restored`: start() read it from the previous process.
   * An install() that starts while this awaits may supersede the outcome's
   * session: from then on the outcome is held for that attempt instead of
   * touching its marker or its card (still returned for the startup report).
   */
  async function applyInstallOutcome(
    outcome: AndroidInstallOutcome,
    restored: boolean,
  ): Promise<AndroidUpdateFailure | null> {
    const installation = await readAndroidInstallation(deps.updater);
    publish({
      installed: { versionName: installation.versionName, versionCode: installation.versionCode },
    });
    if (outcome.versionCode !== null && installation.versionCode >= outcome.versionCode) return null;
    const failure = outcomeFailure(outcome);
    // install() started during the read: the marker is that attempt's now.
    if (installRunning) {
      holdOutcome(outcome);
      return failure;
    }
    // A session for another build than the one offered now: the marker and the
    // card belong to the offered release, so neither changes. Startup still
    // reports the returned failure.
    const offered = availableAndroidUpdate(snapshot);
    if (offered !== null && !failureMatchesRelease(outcome.versionCode, offered)) return failure;
    await deps.storage.removeItem(PENDING_INSTALL_STORAGE_KEY);
    // The removal ran before any marker of an attempt started meanwhile, and
    // the outcome's session is over either way.
    pendingSessionMarker = null;
    // install() started during the removal: the card is that attempt's now.
    if (installRunning) {
      holdOutcome(outcome);
      return failure;
    }
    showInstallFailure(failure, outcomeOrigin(outcome, restored));
    return failure;
  }

  /**
   * Applies a live outcome. Reading it cleared the native copy, so when
   * applying it fails the outcome is still shown, with that failure appended
   * (a final code keeps leading and is kept across restarts).
   */
  async function applyLiveInstallOutcome(outcome: AndroidInstallOutcome): Promise<void> {
    try {
      await applyInstallOutcome(outcome, false);
    } catch (error) {
      if (installRunning) {
        // install() started meanwhile: it decides whether this session still counts.
        holdOutcome(outcome, androidUpdateFailure(error));
        return;
      }
      showInstallFailure(
        withAlso(outcomeFailure(outcome), androidUpdateFailure(error)),
        outcomeOrigin(outcome, false),
      );
    }
  }

  /** Reads the stored installer outcome while the app runs; a failure to read it is shown too. */
  async function consumeLiveInstallOutcome(): Promise<void> {
    let outcome: AndroidInstallOutcome | null;
    try {
      outcome = await deps.consumeInstallOutcome();
    } catch (error) {
      showInstallFailure(androidUpdateFailure(error), CHANNEL_FAILURE);
      return;
    }
    if (outcome === null) return;
    if (installRunning) {
      holdOutcome(outcome);
      return;
    }
    // Native reports only the session it committed last, so this is an
    // outcome stored just before a newer session was committed and read
    // only now. That newer session owns the card and the marker; this one
    // was abandoned for it, so it is dropped on purpose.
    if (supersededOutcome(outcome)) return;
    await applyLiveInstallOutcome(outcome);
  }

  /**
   * Settles what reached the outcome channel while install() ran: outcomes of
   * the session the attempt superseded are dropped, the others applied. When
   * the attempt itself failed, its failure keeps the headline (and its code)
   * and these are appended to it.
   */
  async function settleHeldOutcomes(): Promise<void> {
    const outcomes = heldOutcomes;
    heldOutcomes = [];
    const channelFailure = heldChannelFailure;
    heldChannelFailure = null;
    for (const { outcome, applyFailure } of outcomes) {
      // Superseded by the session this attempt submitted (see consumeLiveInstallOutcome).
      if (supersededOutcome(outcome)) continue;
      if (applyFailure === null) {
        await applyLiveInstallOutcome(outcome);
      } else {
        showInstallFailure(withAlso(outcomeFailure(outcome), applyFailure), outcomeOrigin(outcome, false));
      }
    }
    if (channelFailure !== null) showInstallFailure(channelFailure, CHANNEL_FAILURE);
  }

  async function runCheck(): Promise<void> {
    const previous = currentAndroidUpdateResult(snapshot);
    const previousCheckedAt = androidUpdateResultCheckedAt(snapshot);
    publish({ check: { kind: 'checking', previous, previousCheckedAt } });
    try {
      const installation = await readAndroidInstallation(deps.updater);
      publish({
        installed: { versionName: installation.versionName, versionCode: installation.versionCode },
      });
      const result = await checkLatestAndroidRelease(installedBuild(installation), deps.fetcher);
      const offered = result.kind === 'available' ? result.release : null;
      // A kept final failure lives exactly as long as its release is offered.
      await dropFinalFailureUnless(offered);
      // A failed or permission-blocked install of a release the check no longer
      // offers is stale: keeping it would show an install card (and the header
      // dot) for an update that is gone or replaced.
      // The same holds for a confirmation wait of a release no longer offered.
      const install = snapshot.install;
      const staleInstall =
        (install.kind === 'failed' ||
          install.kind === 'permission' ||
          install.kind === 'awaiting-confirmation') &&
        !(offered !== null && sameRelease(offered, install.release));
      let nextInstall: AndroidUpdateInstallState | null = staleInstall ? { kind: 'idle' } : null;
      let newFinalFailure: AndroidUpdateFailure | null = null;
      if (offered !== null && (nextInstall ?? install).kind === 'idle') {
        // Installer failures for this build that arrived before any release
        // was known, chained in arrival order; those of other builds are stale.
        const parked = parkedInstallFailures.filter((entry) => entry.versionCode === offered.versionCode);
        parkedInstallFailures = [];
        parked.forEach((entry) => failuresOnCard.add(entry.failure));
        const arrived = parked.reduce<{ failure: AndroidUpdateFailure; restored: boolean } | null>(
          (chained, entry) =>
            chained === null
              ? entry
              : {
                failure: combineFailures(chained.failure, entry.failure),
                restored: chained.restored && entry.restored,
              },
          null,
        );
        // Same release as the kept final failure (anything else dropped it above).
        const kept = finalFailure?.failure ?? null;
        if (arrived !== null) {
          // The kept final failure leads; a retryable arrival never hides it.
          const failure = kept === null ? arrived.failure : combineFailures(kept, arrived.failure);
          const final = androidInstallFailureIsFinal(failure);
          nextInstall = {
            kind: 'failed',
            release: offered,
            failure,
            ...(final && !arrived.restored ? { unacknowledged: true } : {}),
          };
          if (androidInstallFailureIsFinal(arrived.failure)) newFinalFailure = failure;
        } else if (kept !== null) {
          nextInstall = { kind: 'failed', release: offered, failure: kept };
        }
      }
      // A startup note that this check put on the install card is shown there
      // now. A failed startup check is over: the toast reported it, and the
      // card shows this check's result as the current truth.
      const notes = snapshot.startupNotes.filter(
        (note) => !isStartupCheckNote(note) && !failuresOnCard.has(note.failure),
      );
      publish({
        check: { kind: 'done', result, checkedAt: deps.now() },
        ...(nextInstall !== null ? { install: nextInstall } : {}),
        ...(notes.length !== snapshot.startupNotes.length ? { startupNotes: notes } : {}),
      });
      if (offered !== null && newFinalFailure !== null) await keepFinalFailure(offered, newFinalFailure);
    } catch (error) {
      // This check's failure replaces a failed startup check's note: the card
      // shows one check failure, the current one, never the old one under it.
      const notes = snapshot.startupNotes.filter((note) => !isStartupCheckNote(note));
      publish({
        check: {
          kind: 'failed',
          failure: androidUpdateFailure(error),
          checkedAt: deps.now(),
          previous,
          previousCheckedAt,
        },
        ...(notes.length !== snapshot.startupNotes.length ? { startupNotes: notes } : {}),
      });
    }
  }

  function check(reason: AndroidUpdateCheckReason): Promise<void> {
    if (!supported) return Promise.resolve();
    if (reason === 'manual') {
      // Pressing "check again" is the user's answer to what the card showed.
      acknowledgeFinalFailure();
      if (snapshot.orphanedInstallFailure !== null) publish({ orphanedInstallFailure: null });
      if (snapshot.startupNotes.length > 0) publish({ startupNotes: [] });
    }
    if (inFlightCheck !== null) return inFlightCheck;
    if (installBusy()) return Promise.resolve();
    if (reason === 'foreground' && isFresh(FOREGROUND_RECHECK_MS)) return Promise.resolve();
    if (reason === 'profile' && isFresh(PROFILE_RECHECK_MS)) return Promise.resolve();
    const running = runCheck().finally(() => {
      inFlightCheck = null;
    });
    inFlightCheck = running;
    return running;
  }

  async function consumePendingInstall(): Promise<string | null> {
    const raw = await deps.storage.getItem(PENDING_INSTALL_STORAGE_KEY);
    if (raw === null) return null;
    await deps.storage.removeItem(PENDING_INSTALL_STORAGE_KEY);
    const pending = parsePendingInstall(raw);
    const installation = await readAndroidInstallation(deps.updater);
    publish({
      installed: { versionName: installation.versionName, versionCode: installation.versionCode },
    });
    // Lower means the user cancelled or Android refused; the card offers the
    // update again. Reached or passed: name what is actually installed, which
    // can be newer than the marker (e.g. installed by hand meanwhile).
    return installation.versionCode >= pending.versionCode ? installation.versionName : null;
  }

  async function refreshPermissionAfterSettings(): Promise<void> {
    const install = snapshot.install;
    if (install.kind !== 'permission') return;
    try {
      const installation = await readAndroidInstallation(deps.updater);
      if (installation.canRequestPackageInstalls && snapshot.install === install) {
        publish({ install: { kind: 'idle' } });
      }
    } catch (error) {
      if (snapshot.install === install) await failInstall(install.release, androidUpdateFailure(error));
    }
  }
  /**
   * Hands `locale` to the native install receiver. A failure is reported like
   * any other update failure the card does not show otherwise: in the startup
   * report while start() runs, as a note on the card afterwards.
   */
  async function syncAppLocale(locale: AppLocale): Promise<void> {
    try {
      await deps.setAppLocale(locale);
    } catch (error) {
      const note: AndroidUpdateStartupFailure = { phase: 'app-locale', failure: androidUpdateFailure(error) };
      if (startupFailures !== null) {
        startupFailures.push(note);
      } else {
        publish({ startupNotes: [...snapshot.startupNotes, note] });
      }
    }
  }

  /** Reads the outcome Android's installer stored for the previous process at startup. */
  async function startupInstallOutcome(failures: AndroidUpdateStartupFailure[]): Promise<void> {
    let outcome: AndroidInstallOutcome | null;
    try {
      outcome = await deps.consumeInstallOutcome();
    } catch (error) {
      failures.push({ phase: 'install-outcome-unavailable', failure: androidUpdateFailure(error) });
      return;
    }
    if (outcome === null) return;
    if (installRunning) {
      // install() started before start() got here; it settles the outcome.
      holdOutcome(outcome);
      failures.push({ phase: 'install-outcome', failure: outcomeFailure(outcome) });
      return;
    }
    if (supersededOutcome(outcome)) {
      // A session this process submitted meanwhile replaced it: the card and
      // the marker stay with that one, but the user still hears about it.
      failures.push({ phase: 'install-outcome', failure: outcomeFailure(outcome) });
      return;
    }
    try {
      const failure = await applyInstallOutcome(outcome, true);
      if (failure !== null) failures.push({ phase: 'install-outcome', failure });
    } catch (error) {
      failures.push({
        phase: 'install-outcome',
        failure: withAlso(outcomeFailure(outcome), androidUpdateFailure(error)),
      });
    }
  }

  function start(): Promise<AndroidUpdateStartupReport> {
    if (startPromise !== null) return startPromise;
    startPromise = (async () => {
      const failures: AndroidUpdateStartupFailure[] = [];
      if (!supported) return { updatedTo: null, failures };
      // Failures that name no build and find no install card land here until
      // the report is returned (see showInstallFailure).
      startupFailures = failures;
      try {
        return await startUp(failures);
      } catch (error) {
        // Start never got past its own setup: the toast reports it as a check
        // failure and points to the profile, so the card shows it too.
        publish({
          startupNotes: [...snapshot.startupNotes, { phase: 'check', failure: androidUpdateFailure(error) }],
        });
        throw error;
      } finally {
        startupFailures = null;
      }
    })();
    return startPromise;
  }

  /** The startup steps of {@link start}; `failures` is the report being built. */
  async function startUp(failures: AndroidUpdateStartupFailure[]): Promise<AndroidUpdateStartupReport> {
    // First, so the receiver speaks the app's language before anything can
    // reach Android's installer; every later activation follows.
    deps.subscribeLocale((locale) => {
      void syncAppLocale(locale);
    });
    await syncAppLocale(deps.activeLocale());
    try {
      deps.subscribeInstallOutcome(
        () => {
          // The stored copy is the single source; reading it also clears it,
          // so an outcome is applied once even if 'active' reads it too.
          void consumeLiveInstallOutcome();
        },
        (error) => showInstallFailure(androidUpdateFailure(error), CHANNEL_FAILURE),
      );
    } catch (error) {
      failures.push({ phase: 'install-outcome-unavailable', failure: androidUpdateFailure(error) });
    }
    deps.appState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshPermissionAfterSettings();
      void consumeLiveInstallOutcome();
      void check('foreground');
    });
    let updatedTo: string | null = null;
    try {
      updatedTo = await consumePendingInstall();
      if (updatedTo !== null) publish({ updatedTo });
    } catch (error) {
      failures.push({ phase: 'pending-install', failure: androidUpdateFailure(error) });
    }
    try {
      await restoreFinalFailure();
    } catch (error) {
      failures.push({ phase: 'pending-install', failure: androidUpdateFailure(error) });
    }
    await startupInstallOutcome(failures);
    await check('startup');
    if (snapshot.check.kind === 'failed') {
      startupCheckFailures.add(snapshot.check.failure);
      failures.push({ phase: 'check', failure: snapshot.check.failure });
    }
    // The startup toast only names the phase; the card keeps the cause and
    // detail of everything it does not show already (see `startupNotes`).
    const notes = failures.filter((entry) => !failuresOnCard.has(entry.failure));
    if (notes.length > 0) publish({ startupNotes: [...snapshot.startupNotes, ...notes] });
    return { updatedTo, failures };
  }

  async function install(): Promise<void> {
    if (!supported) return;
    if (installRunning) throw new Error('Android update install is already running');
    const release = availableAndroidUpdate(snapshot);
    if (release === null) {
      throw new Error('No installable Android update is known; check for updates first');
    }
    installRunning = true;
    let unsubscribe: (() => void) | null = null;
    let markerWritten = false;
    let submitted = false;
    // A malformed progress event is a bridge bug. It must not end the install
    // while the native download still runs (that made "Retry" a no-op and let
    // a re-check reset the card), so it is reported once the native call
    // settles: added to a native failure, or, when the APK did reach Android's
    // installer, shown as a warning next to the confirmation wait.
    const progressEvents: { failure: AndroidUpdateFailure | null } = { failure: null };
    try {
      publish({ install: { kind: 'preparing', release } });
      const installation = await readAndroidInstallation(deps.updater);
      if (!installation.canRequestPackageInstalls) {
        await deps.updater.openInstallPermissionSettings();
        publish({ install: { kind: 'permission', release } });
        return;
      }
      // Only needed when the app is in the background once the download ends:
      // the installer confirmation then arrives as a notification. A denial is a
      // valid choice; the foreground flow works without it. Asked once per process.
      if (
        !notificationPermissionRequested &&
        typeof deps.platformVersion === 'number' &&
        deps.platformVersion >= 33
      ) {
        notificationPermissionRequested = true;
        await deps.requestNotificationPermission();
      }
      // Written first: a completed self-update kills this process before JS hears back.
      const marker = JSON.stringify({ versionName: release.versionName, versionCode: release.versionCode });
      await deps.storage.setItem(PENDING_INSTALL_STORAGE_KEY, marker);
      markerWritten = true;
      publish({ install: { kind: 'downloading', release, progress: null } });
      unsubscribe = deps.subscribeProgress(
        (progress) => {
          if (snapshot.install.kind === 'downloading' && snapshot.install.release === release) {
            publish({ install: { kind: 'downloading', release, progress } });
          }
        },
        (error) => {
          const failure = androidUpdateFailure(
            new Error(
              `Android update progress event was invalid: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { cause: error },
            ),
          );
          progressEvents.failure =
            progressEvents.failure === null ? failure : withAlso(progressEvents.failure, failure);
        },
      );
      const result = await deps.updater.downloadAndInstall(
        release.apkUrl,
        release.apkDigest,
        release.versionName,
        release.versionCode,
      );
      // Android's installer has the APK now; its own outcome decides the marker.
      // Native abandoned every earlier session for this one.
      submitted = true;
      submittedSession = { sessionId: submittedSessionId(result) };
      pendingSessionMarker = marker;
      assertSubmitted(result, release);
      const failure = progressEvents.failure;
      publish({
        install:
          failure === null
            ? { kind: 'awaiting-confirmation', release }
            : {
              kind: 'awaiting-confirmation',
              release,
              warning: {
                ...failure,
                message: `${failure.message}. The verified APK was still handed to Android's installer`,
              },
            },
      });
    } catch (error) {
      let failure = androidUpdateFailure(error);
      if (progressEvents.failure !== null) failure = withAlso(failure, progressEvents.failure);
      // Nothing reached Android's installer, so no update can complete from
      // this attempt. A session submitted earlier still can: its marker stays.
      if (markerWritten && !submitted) {
        try {
          if (pendingSessionMarker === null) {
            await deps.storage.removeItem(PENDING_INSTALL_STORAGE_KEY);
          } else {
            await deps.storage.setItem(PENDING_INSTALL_STORAGE_KEY, pendingSessionMarker);
          }
        } catch (markerError) {
          failure = withAlso(failure, androidUpdateFailure(markerError));
        }
      }
      await failInstall(release, failure);
    } finally {
      unsubscribe?.();
      installRunning = false;
      await settleHeldOutcomes();
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    check,
    install,
    acknowledgeFinalFailure,
  };
}

export const androidUpdateStore = createAndroidUpdateStore({
  platformOS: Platform.OS,
  platformVersion: Platform.Version,
  updater: androidUpdater,
  fetcher: (input, init) => fetch(input, init),
  now: () => Date.now(),
  storage: AsyncStorage,
  appState: AppState,
  requestNotificationPermission: () =>
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS),
  subscribeProgress: subscribeAndroidUpdateDownloadProgress,
  consumeInstallOutcome: consumeAndroidInstallOutcome,
  subscribeInstallOutcome: subscribeAndroidInstallOutcome,
  setAppLocale: setAndroidUpdaterAppLocale,
  activeLocale: getActiveLocale,
  subscribeLocale: onLocaleActivated,
});

export function useAndroidUpdateSnapshot(): AndroidUpdateSnapshot {
  return useSyncExternalStore(
    androidUpdateStore.subscribe,
    androidUpdateStore.getSnapshot,
    androidUpdateStore.getSnapshot,
  );
}
