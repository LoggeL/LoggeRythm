import { strings } from '../localization';
import { activePartyRouter } from '../party/activeParty';
import {
  clearUpcomingQueue,
  cycleRepeat,
  moveQueueItem,
  next,
  prev,
  removeQueueItem,
  seekTo,
  skipToQueueItem,
  togglePlay,
  toggleShuffle,
} from '../player/controller';
import { reportPlayerError } from '../player/errors';
import { RepeatMode } from '../player/player';
import { activeConnectRouter } from './activeConnect';
import { repeatModeToConnect } from './connectModel';

export {
  useEffectivePlayback,
  useEffectiveProgress,
  useHasEffectiveActiveTrack,
  type EffectivePlaybackState,
} from './effectivePlaybackState';

function reportConnectCommandFailure(title: string, error: unknown): void {
  reportPlayerError(title, error);
}

/** Dispatch play/pause to remote Connect, shared-control Jam, or local Media3. */
export function effectiveTogglePlay(): void {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    void connect.sendCommand('toggle', {}).catch((error) => {
      reportConnectCommandFailure(strings.player.playPauseFailed, error);
    });
    return;
  }
  const party = activePartyRouter();
  const partySnap = party?.getSnapshot() ?? null;
  if (party !== null && partySnap !== null && partySnap.party !== null && !partySnap.party.is_host && !partySnap.detached) {
    if (partySnap.party.guests_can_control) {
      void party.controlTogglePlay().catch((error) => {
        reportConnectCommandFailure(strings.player.playPauseFailed, error);
      });
    } else {
      reportPlayerError(
        strings.player.playPauseFailed,
        new Error(strings.party.controlledByHost(partySnap.party.host_name)),
      );
    }
    return;
  }
  togglePlay();
}

export function effectiveNext(): void {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    void connect.sendCommand('next', {}).catch((error) => {
      reportConnectCommandFailure(strings.player.nextFailed, error);
    });
    return;
  }
  const party = activePartyRouter();
  const partySnap = party?.getSnapshot() ?? null;
  if (party !== null && partySnap !== null && partySnap.party !== null && !partySnap.party.is_host && !partySnap.detached) {
    if (partySnap.party.guests_can_control) {
      void party.controlNext().catch((error) => {
        reportConnectCommandFailure(strings.player.nextFailed, error);
      });
    } else {
      reportPlayerError(
        strings.player.nextFailed,
        new Error(strings.party.controlledByHost(partySnap.party.host_name)),
      );
    }
    return;
  }
  next();
}

export function effectivePrev(): void {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    void connect.sendCommand('prev', {}).catch((error) => {
      reportConnectCommandFailure(strings.player.previousFailed, error);
    });
    return;
  }
  const party = activePartyRouter();
  const partySnap = party?.getSnapshot() ?? null;
  if (party !== null && partySnap !== null && partySnap.party !== null && !partySnap.party.is_host && !partySnap.detached) {
    if (partySnap.party.guests_can_control) {
      void party.controlPrev().catch((error) => {
        reportConnectCommandFailure(strings.player.previousFailed, error);
      });
    } else {
      reportPlayerError(
        strings.player.previousFailed,
        new Error(strings.party.controlledByHost(partySnap.party.host_name)),
      );
    }
    return;
  }
  prev();
}

export function effectiveSeekTo(seconds: number): void {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    void connect.sendCommand('seek', { position_sec: Math.max(0, seconds) }).catch((error) => {
      reportConnectCommandFailure(strings.player.seekFailed, error);
    });
    return;
  }
  const party = activePartyRouter();
  const partySnap = party?.getSnapshot() ?? null;
  if (party !== null && partySnap !== null && partySnap.party !== null && !partySnap.party.is_host && !partySnap.detached) {
    if (partySnap.party.guests_can_control) {
      void party.controlSeek(Math.max(0, seconds)).catch((error) => {
        reportConnectCommandFailure(strings.player.seekFailed, error);
      });
    } else {
      reportPlayerError(
        strings.player.seekFailed,
        new Error(strings.party.controlledByHost(partySnap.party.host_name)),
      );
    }
    return;
  }
  seekTo(seconds);
}

export function effectiveCycleRepeat(currentMode: RepeatMode): RepeatMode {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    const nextMode =
      currentMode === RepeatMode.Off
        ? RepeatMode.All
        : currentMode === RepeatMode.All
          ? RepeatMode.One
          : RepeatMode.Off;
    void connect
      .sendCommand('set_repeat', { repeat: repeatModeToConnect(nextMode) })
      .catch((error) => {
        reportConnectCommandFailure(strings.player.repeatFailed, error);
      });
    return nextMode;
  }
  return cycleRepeat();
}

export async function effectiveToggleShuffle(
  expectedStableIds?: readonly string[],
): Promise<boolean> {
  const connect = activeConnectRouter();
  const remotePlayback = connect?.remotePlayback() ?? null;
  if (connect !== null && connect.isControllingRemote() && remotePlayback !== null) {
    const desired = !remotePlayback.shuffle;
    await connect.sendCommand('set_shuffle', { shuffle: desired });
    return desired;
  }
  return toggleShuffle(expectedStableIds);
}

export async function effectiveSkipToIndex(
  index: number,
  expectedStableIds: readonly string[],
): Promise<void> {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    await connect.sendCommand('select_index', { index });
    return;
  }
  await skipToQueueItem(index, expectedStableIds);
}

export async function effectiveRemoveQueueItem(
  index: number,
  expectedStableIds: readonly string[],
): Promise<void> {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    await connect.sendCommand('queue_remove', { index });
    return;
  }
  await removeQueueItem(index, expectedStableIds);
}

export async function effectiveMoveQueueItem(
  fromIndex: number,
  toIndex: number,
  expectedStableIds: readonly string[],
): Promise<void> {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    await connect.sendCommand('queue_reorder', { from_index: fromIndex, to_index: toIndex });
    return;
  }
  await moveQueueItem(fromIndex, toIndex, expectedStableIds);
}

export async function effectiveClearUpcoming(
  expectedStableIds: readonly string[],
): Promise<void> {
  const connect = activeConnectRouter();
  if (connect !== null && connect.isControllingRemote()) {
    await connect.sendCommand('clear_queue', {});
    return;
  }
  await clearUpcomingQueue(expectedStableIds);
}
