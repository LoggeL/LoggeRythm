import { AccessibilityInfo } from 'react-native';
import type { Track } from '../api/types';
import { strings } from '../localization';
import { addToQueue, playNext, startRadio } from '../player/controller';
import { reportPlayerError } from '../player/errors';
import { activeConnectRouter } from '../connect/activeConnect';
import { activePartyRouter } from '../party/activeParty';
import { trackActionFailureMessage } from './trackActionFeedback';

export type TrackQueueAction = 'play-next' | 'add-to-queue' | 'start-radio';
export const TRACK_ACTION_ORDER = [
  'play-next',
  'add-to-queue',
  'start-radio',
  'add-to-playlist',
  'download',
  'open-album',
  'open-artist',
  'share',
] as const;
export type TrackActionId =
  | (typeof TRACK_ACTION_ORDER)[number]
  | 'remove-download'
  | 'remove';

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
  individuallyDownloaded = false,
): TrackActionId[] {
  const canRemove =
    request?.authorizedRemove !== undefined &&
    request.authorizedRemove.accountScope === currentAccountScope;
  const downloadAction: TrackActionId = individuallyDownloaded ? 'remove-download' : 'download';
  const actions: TrackActionId[] = TRACK_ACTION_ORDER.map((action) =>
    action === 'download' ? downloadAction : action);
  return canRemove ? [...actions, 'remove'] : actions;
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
  // While the player follows a party its queue is the party's: queue actions
  // add the song for everyone instead of editing a queue the party overwrites.
  const party = activePartyRouter();
  if ((action === 'play-next' || action === 'add-to-queue') && party?.isFollowingParty() === true) {
    return {
      succeeded:
        action === 'play-next'
          ? strings.party.playNextAdded(track.title)
          : strings.party.addedToParty(track.title),
      run: () => party.addTrack(track, action === 'play-next' ? 'next' : 'end'),
    };
  }
  const connect = activeConnectRouter();
  if ((action === 'play-next' || action === 'add-to-queue') && connect?.isControllingRemote() === true) {
    return {
      succeeded:
        action === 'play-next'
          ? strings.trackActions.playNextSucceeded(track.title)
          : strings.trackActions.addToQueueSucceeded(track.title),
      run: () =>
        action === 'play-next'
          ? connect.sendCommand('queue_play_next', { track })
          : connect.sendCommand('queue_add', { track }),
    };
  }
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

/** Quick swipe-to-queue helper: routes through active Jam / Connect / local queue and reports failures loudly. */
export async function quickAddTrackToQueue(track: Track): Promise<boolean> {
  const contract = actionContract('add-to-queue', track);
  try {
    await contract.run();
    AccessibilityInfo.announceForAccessibility(contract.succeeded);
    return true;
  } catch (error) {
    reportPlayerError(trackActionFailureMessage('add-to-queue', error), error);
    return false;
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
