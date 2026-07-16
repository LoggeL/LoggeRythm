import { AccessibilityInfo } from 'react-native';
import type { Track } from '../api/types';
import { strings } from '../localization';
import { addToQueue, playNext, startRadio } from '../player/controller';
import { trackActionFailureMessage } from './trackActionFeedback';

export type TrackQueueAction = 'play-next' | 'add-to-queue' | 'start-radio';
export const TRACK_ACTION_ORDER = [
  'play-next',
  'add-to-queue',
  'start-radio',
  'add-to-playlist',
  'open-album',
  'open-artist',
  'remove',
] as const;
export type TrackActionId = (typeof TRACK_ACTION_ORDER)[number];

export interface AuthorizedTrackRemoval {
  /** Exact account-scoped query namespace that granted the remove capability. */
  accountScope: string;
  onRemove: () => Promise<void> | void;
}

export interface TrackActionOptions {
  /** Omitted everywhere except a caller that has verified edit ownership. */
  authorizedRemove?: AuthorizedTrackRemoval;
}

export interface TrackActionRequest {
  requestId: number;
  track: Track;
  onError: (message: string) => void;
  authorizedRemove?: AuthorizedTrackRemoval;
}

export type TrackRemovalResult =
  | { status: 'removed' }
  | { status: 'failed'; message: string }
  | { status: 'stale' };

let requestSequence = 0;
let activeRequest: TrackActionRequest | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

export function subscribeTrackActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTrackActionRequest(): TrackActionRequest | null {
  return activeRequest;
}

/** Exact TalkBack/focus order; Remove exists only for the granting account. */
export function trackActionIdsForRequest(
  request: TrackActionRequest | null,
  currentAccountScope: string | null,
): TrackActionId[] {
  const canRemove =
    request?.authorizedRemove !== undefined &&
    request.authorizedRemove.accountScope === currentAccountScope;
  return canRemove ? [...TRACK_ACTION_ORDER] : TRACK_ACTION_ORDER.slice(0, -1);
}

export function showTrackActions(
  track: Track,
  onError: (message: string) => void,
  options: TrackActionOptions = {},
): void {
  const authorizedRemove = options.authorizedRemove;
  if (
    authorizedRemove !== undefined &&
    (authorizedRemove.accountScope.trim().length === 0 ||
      typeof authorizedRemove.onRemove !== 'function')
  ) {
    throw new Error('Authorized track removal requires an account scope and callback');
  }
  activeRequest = {
    requestId: ++requestSequence,
    track,
    onError,
    ...(authorizedRemove === undefined ? {} : { authorizedRemove }),
  };
  publish();
}

export function dismissTrackActions(requestId?: number): void {
  if (requestId !== undefined && activeRequest?.requestId !== requestId) return;
  if (activeRequest === null) return;
  activeRequest = null;
  publish();
}

function actionContract(action: TrackQueueAction, track: Track) {
  switch (action) {
    case 'play-next':
      return {
        succeeded: strings.trackActions.playNextSucceeded(track.title),
        run: () => playNext(track),
      };
    case 'add-to-queue':
      return {
        succeeded: strings.trackActions.addToQueueSucceeded(track.title),
        run: () => addToQueue(track),
      };
    case 'start-radio':
      return {
        succeeded: strings.trackActions.startRadioSucceeded(track.title),
        run: () => startRadio(track),
      };
  }
}

/** Execute against the request that opened the sheet; stale sheets cannot close a newer one. */
export async function runTrackQueueAction(
  request: TrackActionRequest,
  action: TrackQueueAction,
): Promise<boolean> {
  const contract = actionContract(action, request.track);
  try {
    await contract.run();
    AccessibilityInfo.announceForAccessibility(contract.succeeded);
    dismissTrackActions(request.requestId);
    return true;
  } catch (error) {
    try {
      request.onError(trackActionFailureMessage(action, error));
    } catch {
      // A presentation callback must never hide the action sheet's recoverable state.
    }
    return false;
  }
}

function requestIsActive(request: TrackActionRequest): boolean {
  return activeRequest?.requestId === request.requestId;
}

/**
 * Run contextual removal only for the still-active request and exact account
 * scope that granted it. Auth transitions and replacement sheets cannot replay
 * an old owner callback.
 */
export async function runAuthorizedTrackRemoval(
  request: TrackActionRequest,
  currentAccountScope: string | null,
): Promise<TrackRemovalResult> {
  const removal = request.authorizedRemove;
  if (
    removal === undefined ||
    currentAccountScope === null ||
    removal.accountScope !== currentAccountScope ||
    !requestIsActive(request)
  ) {
    return { status: 'stale' };
  }

  try {
    await removal.onRemove();
  } catch (error) {
    if (!requestIsActive(request)) return { status: 'stale' };
    const message = trackActionFailureMessage('remove', error);
    try {
      request.onError(message);
    } catch {
      // The sheet still receives the returned error even if its caller unmounted.
    }
    return { status: 'failed', message };
  }

  if (!requestIsActive(request)) return { status: 'stale' };
  AccessibilityInfo.announceForAccessibility(
    strings.trackActions.removeSucceeded(request.track.title),
  );
  dismissTrackActions(request.requestId);
  return { status: 'removed' };
}
