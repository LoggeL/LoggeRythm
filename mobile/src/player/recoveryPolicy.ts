export type PlaybackFailureCategory =
  | 'network'
  | 'session'
  | 'authorization'
  | 'source'
  | 'backend'
  | 'renderer'
  | 'unknown';

export type RecoveryExhaustionAction = 'skip' | 'stop';

export interface RecoveryPolicy {
  maxAttempts: number;
  delaysMs: readonly number[];
  exhaustionAction: RecoveryExhaustionAction;
}

const policies: Readonly<Record<PlaybackFailureCategory, RecoveryPolicy>> = {
  network: {
    maxAttempts: 3,
    delaysMs: [0, 250, 750],
    exhaustionAction: 'stop',
  },
  session: {
    maxAttempts: 1,
    delaysMs: [0],
    exhaustionAction: 'stop',
  },
  authorization: {
    maxAttempts: 1,
    delaysMs: [0],
    exhaustionAction: 'skip',
  },
  source: {
    maxAttempts: 1,
    delaysMs: [0],
    exhaustionAction: 'skip',
  },
  backend: {
    maxAttempts: 3,
    delaysMs: [0, 300, 900],
    exhaustionAction: 'skip',
  },
  renderer: {
    maxAttempts: 2,
    delaysMs: [0, 250],
    exhaustionAction: 'skip',
  },
  unknown: {
    maxAttempts: 2,
    delaysMs: [0, 400],
    exhaustionAction: 'stop',
  },
};

const categoryNames: readonly PlaybackFailureCategory[] = [
  'network',
  'session',
  'authorization',
  'source',
  'backend',
  'renderer',
  'unknown',
];

export const MAX_TOTAL_RECOVERY_ATTEMPTS = 6;
export const REAL_PROGRESS_SECONDS = 3;
const MAX_PROGRESS_LEAD_SECONDS = 2;

export interface PlaybackFailureLike {
  code?: unknown;
  message?: unknown;
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value !== null) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(value);
}

function statusFromMessage(message: string): number | null {
  const contextual =
    /(?:http(?: response)?(?: status)?|status(?: code)?|returned)\D{0,16}(401|403|404|416|5\d\d)\b/i.exec(
      message,
    );
  if (contextual !== null) return Number(contextual[1]);
  const bare = /\b(401|403|404|416|5\d\d)\b/.exec(message);
  return bare === null ? null : Number(bare[1]);
}

export function httpStatusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 0) return status;
  }
  return statusFromMessage(messageOf(error));
}

function categoryFromStatus(status: number | null): PlaybackFailureCategory | null {
  if (status === 0) return 'network';
  if (status === 401) return 'session';
  if (status === 403) return 'authorization';
  if (status === 404 || status === 416) return 'source';
  if (status !== null && status >= 500 && status <= 599) return 'backend';
  return null;
}

const networkPattern =
  /\b(network|offline|timed?\s*out|timeout|connection|dns|socket|unreachable|cancelled|aborted)\b/i;
const sessionPattern = /\b(no local session|session (?:expired|missing)|cannot authenticate)\b/i;
const rendererPattern =
  /\b(renderer|decoder|decoding|codec|audio\s*track|unsupported\s*(?:audio|format)|malformed\s*(?:audio|container))\b/i;

/** Prefer the authenticated preload result because it exposes exact HTTP status semantics. */
export function classifyPlaybackFailure(
  nativeError: PlaybackFailureLike,
  preloadError?: unknown,
): PlaybackFailureCategory {
  if (preloadError !== undefined) {
    const statusCategory = categoryFromStatus(httpStatusOf(preloadError));
    if (statusCategory !== null) return statusCategory;
    const preloadMessage = messageOf(preloadError);
    if (sessionPattern.test(preloadMessage)) return 'session';
    if (networkPattern.test(preloadMessage)) return 'network';
    if (rendererPattern.test(preloadMessage)) return 'renderer';
    return 'unknown';
  }

  const message = typeof nativeError.message === 'string' ? nativeError.message : '';
  const statusCategory = categoryFromStatus(statusFromMessage(message));
  if (statusCategory !== null) return statusCategory;
  if (sessionPattern.test(message)) return 'session';
  if (rendererPattern.test(message)) return 'renderer';
  if (networkPattern.test(message)) return 'network';

  switch (nativeError.code) {
    case 'network':
      return 'network';
    case 'renderer':
      return 'renderer';
    case 'source':
      return 'source';
    default:
      return 'unknown';
  }
}

export function recoveryPolicy(category: PlaybackFailureCategory): RecoveryPolicy {
  return policies[category];
}

type AttemptCounts = Record<PlaybackFailureCategory, number>;

function emptyAttemptCounts(): AttemptCounts {
  return {
    network: 0,
    session: 0,
    authorization: 0,
    source: 0,
    backend: 0,
    renderer: 0,
    unknown: 0,
  };
}

export interface RecoveryBudgetState {
  mediaId: string | null;
  attemptsByCategory: AttemptCounts;
  totalAttempts: number;
  checkpointPosition: number;
  checkpointTimestampMs: number;
}

export function createRecoveryBudget(): RecoveryBudgetState {
  return {
    mediaId: null,
    attemptsByCategory: emptyAttemptCounts(),
    totalAttempts: 0,
    checkpointPosition: 0,
    checkpointTimestampMs: 0,
  };
}

function requireMediaId(mediaId: string): string {
  const normalized = mediaId.trim();
  if (normalized.length === 0) throw new Error('Recovery mediaId must not be empty');
  return normalized;
}

function validPosition(position: number): number {
  return Number.isFinite(position) && position >= 0 ? position : 0;
}

function validTimestamp(timestampMs: number): number {
  return Number.isFinite(timestampMs) && timestampMs >= 0 ? timestampMs : 0;
}

/** A different stable mediaId is the only transition that replenishes every retry budget. */
export function transitionRecoveryBudget(
  state: RecoveryBudgetState,
  mediaId: string,
  position: number,
  timestampMs: number,
): RecoveryBudgetState {
  const id = requireMediaId(mediaId);
  if (state.mediaId === id) return state;
  return {
    mediaId: id,
    attemptsByCategory: emptyAttemptCounts(),
    totalAttempts: 0,
    checkpointPosition: validPosition(position),
    checkpointTimestampMs: validTimestamp(timestampMs),
  };
}

export interface ProgressObservation {
  state: RecoveryBudgetState;
  reset: boolean;
}

/**
 * Replenish attempts only after plausible wall-clock playback progress. Large forward jumps are
 * treated as seeks; backward jumps move the baseline without forgiving prior failures.
 */
export function observeRecoveryProgress(
  state: RecoveryBudgetState,
  mediaId: string,
  position: number,
  timestampMs: number,
): ProgressObservation {
  const transitioned = transitionRecoveryBudget(state, mediaId, position, timestampMs);
  if (transitioned !== state) return { state: transitioned, reset: true };

  const nextPosition = validPosition(position);
  const nextTimestamp = validTimestamp(timestampMs);
  const delta = nextPosition - state.checkpointPosition;
  const elapsedSeconds = Math.max(0, nextTimestamp - state.checkpointTimestampMs) / 1_000;

  if (delta < 0 || delta > elapsedSeconds + MAX_PROGRESS_LEAD_SECONDS) {
    return {
      state: {
        ...state,
        checkpointPosition: nextPosition,
        checkpointTimestampMs: nextTimestamp,
      },
      reset: false,
    };
  }
  if (delta < REAL_PROGRESS_SECONDS) return { state, reset: false };

  return {
    state: {
      ...state,
      attemptsByCategory: emptyAttemptCounts(),
      totalAttempts: 0,
      checkpointPosition: nextPosition,
      checkpointTimestampMs: nextTimestamp,
    },
    reset: true,
  };
}

export interface RecoveryAttemptDecision {
  state: RecoveryBudgetState;
  allowed: boolean;
  attempt: number;
  delayMs: number;
}

export function nextRecoveryAttempt(
  state: RecoveryBudgetState,
  category: PlaybackFailureCategory,
): RecoveryAttemptDecision {
  if (state.mediaId === null) throw new Error('Recovery budget has no active media item');
  const current = state.attemptsByCategory[category];
  const policy = recoveryPolicy(category);
  if (current >= policy.maxAttempts || state.totalAttempts >= MAX_TOTAL_RECOVERY_ATTEMPTS) {
    return { state, allowed: false, attempt: current, delayMs: 0 };
  }
  const attempt = current + 1;
  const next: RecoveryBudgetState = {
    ...state,
    attemptsByCategory: { ...state.attemptsByCategory, [category]: attempt },
    totalAttempts: state.totalAttempts + 1,
  };
  return {
    state: next,
    allowed: true,
    attempt,
    delayMs: policy.delaysMs[attempt - 1] ?? policy.delaysMs.at(-1) ?? 0,
  };
}

/** Attribute a failed authenticated probe to its more precise category without minting a retry. */
export function reclassifyRecoveryAttempt(
  state: RecoveryBudgetState,
  from: PlaybackFailureCategory,
  to: PlaybackFailureCategory,
): RecoveryBudgetState {
  if (from === to) return state;
  if (state.attemptsByCategory[from] < 1) {
    throw new Error(`Cannot reclassify a recovery attempt that was not counted as ${from}`);
  }
  return {
    ...state,
    attemptsByCategory: {
      ...state.attemptsByCategory,
      [from]: state.attemptsByCategory[from] - 1,
      [to]: state.attemptsByCategory[to] + 1,
    },
  };
}

export function resetRecoveryAttempts(state: RecoveryBudgetState): RecoveryBudgetState {
  return {
    ...state,
    attemptsByCategory: emptyAttemptCounts(),
    totalAttempts: 0,
  };
}

export function assertRecoveryPolicies(): void {
  for (const category of categoryNames) {
    const policy = policies[category];
    if (policy.maxAttempts < 1 || policy.delaysMs.length !== policy.maxAttempts) {
      throw new Error(`${category} recovery policy must provide one delay per attempt`);
    }
    if (policy.delaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
      throw new Error(`${category} recovery policy contains an invalid delay`);
    }
  }
}

assertRecoveryPolicies();
