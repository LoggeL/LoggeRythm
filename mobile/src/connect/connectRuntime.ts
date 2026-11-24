import { decodeTrack } from '../api/decoders';
import type { ConnectCommandAction, ConnectRepeatMode, Track } from '../api/types';
import { getConnectivitySnapshot, subscribeConnectivity } from '../connectivity/store';
import { strings } from '../localization';
import { activePartyRouter } from '../party/activeParty';
import { subscribePartyCodeChanges } from '../party/partyRuntime';
import {
  addToQueue,
  clearLocalQueue,
  getQueueSnapshot,
  isContextShuffleEnabled,
  moveQueueItem,
  next,
  playNext,
  playTracks,
  prev,
  removeQueueItem,
  seekTo,
  setRepeatMode,
  skipToQueueItem,
  syncConnectQueue,
  togglePlay,
  toggleShuffle,
} from '../player/controller';
import Player from '../player/player';
import { queueStableIdOf } from '../player/queueContract';
import { installActiveConnectRouter } from './activeConnect';
import { connectRepeatToPlayer, type ConnectSessionSnapshot } from './connectModel';
import { ConnectSession, useConnectSessionSnapshot } from './connectSession';
import { openConnectSocket } from './connectSocket';
import {
  loadConnectDeviceIdentity,
  saveConnectDeviceName,
  saveConnectEnabled,
} from './deviceIdentity';

let instance: ConnectSession | null = null;
let unsubscribePartyCode: (() => void) | null = null;

function requireFiniteNonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Command payload "${field}" must be a non-negative finite number`);
  }
  return value;
}

function requireSafeNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Command payload "${field}" must be a non-negative integer`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Command payload "${field}" must be a boolean`);
  }
  return value;
}

function requireRepeatMode(value: unknown): ConnectRepeatMode {
  if (value !== 'off' && value !== 'all' && value !== 'one') {
    throw new Error(`Command payload "repeat" must be one of: off, all, one`);
  }
  return value;
}

/**
 * Strictly validate and execute an incoming Connect remote command against
 * this mobile device's native player. Invalid payloads throw loudly so the
 * server relays `command_ack(ok=false)` back to the controller.
 */
export async function executeConnectRemoteCommand(
  action: ConnectCommandAction,
  payload: Record<string, unknown>,
): Promise<void> {
  switch (action) {
    case 'play':
      Player.play();
      return;
    case 'pause':
      Player.pause();
      return;
    case 'toggle':
      togglePlay();
      return;
    case 'next':
      next();
      return;
    case 'prev':
      prev();
      return;
    case 'clear_queue':
      await clearLocalQueue();
      return;
    case 'seek': {
      const positionSec = requireFiniteNonNegative(payload.position_sec, 'position_sec');
      seekTo(positionSec);
      return;
    }
    case 'set_volume':
    case 'set_mute':
      throw new Error(strings.connect.volumeUnsupported);
    case 'set_shuffle': {
      const desired = requireBoolean(payload.shuffle, 'shuffle');
      if (isContextShuffleEnabled() !== desired) {
        const expectedIds = getQueueSnapshot().items.map(queueStableIdOf);
        await toggleShuffle(expectedIds);
      }
      return;
    }
    case 'set_repeat': {
      const repeat = requireRepeatMode(payload.repeat);
      setRepeatMode(connectRepeatToPlayer(repeat));
      return;
    }
    case 'play_tracks': {
      if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) {
        throw new Error('Command payload "tracks" must be a non-empty Track array');
      }
      const tracks: Track[] = payload.tracks.map((item, idx) =>
        decodeTrack(item, `play_tracks.tracks[${idx}]`),
      );
      const startIndex = requireSafeNonNegativeInt(payload.start_index, 'start_index');
      if (startIndex >= tracks.length) {
        throw new Error(`start_index ${startIndex} is outside a ${tracks.length}-track list`);
      }
      const label =
        typeof payload.queue_context === 'string' && payload.queue_context.trim().length > 0
          ? payload.queue_context.trim()
          : strings.connect.title;
      await playTracks(tracks, startIndex, {
        context: { type: 'collection', id: 'connect', label },
        localOnly: true,
      });
      return;
    }
    case 'queue_add': {
      const track = decodeTrack(payload.track, 'queue_add.track');
      await addToQueue(track);
      return;
    }
    case 'queue_play_next': {
      const track = decodeTrack(payload.track, 'queue_play_next.track');
      await playNext(track);
      return;
    }
    case 'queue_remove': {
      const index = requireSafeNonNegativeInt(payload.index, 'index');
      const expectedIds = getQueueSnapshot().items.map(queueStableIdOf);
      await removeQueueItem(index, expectedIds);
      return;
    }
    case 'queue_reorder': {
      const fromIndex = requireSafeNonNegativeInt(payload.from_index, 'from_index');
      const toIndex = requireSafeNonNegativeInt(payload.to_index, 'to_index');
      const expectedIds = getQueueSnapshot().items.map(queueStableIdOf);
      await moveQueueItem(fromIndex, toIndex, expectedIds);
      return;
    }
    case 'select_index': {
      const index = requireSafeNonNegativeInt(payload.index, 'index');
      const expectedIds = getQueueSnapshot().items.map(queueStableIdOf);
      await skipToQueueItem(index, expectedIds);
      return;
    }
  }
}

export function connectSession(): ConnectSession {
  if (instance === null) {
    const session = new ConnectSession({
      loadIdentity: () => loadConnectDeviceIdentity(),
      saveDeviceName: (name) => saveConnectDeviceName(name),
      saveEnabled: (enabled) => saveConnectEnabled(enabled),
      openSocket: (handlers) => openConnectSocket(handlers),
      player: {
        subscribe: (listener) => Player.subscribe(listener),
        getSnapshot: () => Player.getSnapshot(),
        isContextShuffleEnabled,
        pause: () => Player.pause(),
        applyActivatedPlayback: syncConnectQueue,
        executeRemoteCommand: executeConnectRemoteCommand,
      },
      isOnline: () => getConnectivitySnapshot().status !== 'offline',
      subscribeConnectivity,
      getActivePartyState: () => {
        const party = activePartyRouter();
        return {
          code: party?.activePartyCode() ?? null,
          isHost: party?.isHost() ?? false,
          controlOnly: party?.isControlOnly() ?? false,
        };
      },
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    });
    instance = session;
    installActiveConnectRouter({
      subscribe: (listener) => session.subscribe(listener),
      getSnapshot: () => session.getSnapshot(),
      isControllingRemote: () => session.getSnapshot().isControllingRemote,
      activeDevice: () => session.getSnapshot().activeDevice,
      remotePlayback: () => session.getSnapshot().state?.playback ?? null,
      transferPlayback: (targetDeviceId, play) =>
        session.transferPlayback(targetDeviceId, play),
      sendCommand: (action, payload, targetDeviceId) =>
        session.sendCommand(action, payload, targetDeviceId),
      reset: () => session.reset(),
    });
    unsubscribePartyCode = subscribePartyCodeChanges((code) => {
      session.setPartyCode(code);
    });
  }
  return instance;
}

export function useConnectSession(): ConnectSessionSnapshot {
  return useConnectSessionSnapshot(connectSession());
}

/** Test-only cleanup to release runtime listeners if needed. */
export function disposeConnectRuntimePartySubscription(): void {
  unsubscribePartyCode?.();
  unsubscribePartyCode = null;
}
