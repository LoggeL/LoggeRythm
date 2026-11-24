import { useSyncExternalStore } from 'react';
import type {
  ConnectCommandAction,
  ConnectCommandPayloadMap,
  ConnectDevice,
  ConnectPlaybackState,
} from '../api/types';
import { IDLE_CONNECT_SNAPSHOT, type ConnectSessionSnapshot } from './connectModel';

/**
 * Dependency-free router so controller, trackActions, player chrome, and
 * player setup can consult Connect without circular or native-module imports.
 */
export interface ActiveConnectRouter {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConnectSessionSnapshot;
  isControllingRemote(): boolean;
  activeDevice(): ConnectDevice | null;
  remotePlayback(): ConnectPlaybackState | null;
  transferPlayback(targetDeviceId: string, play?: boolean): Promise<void>;
  sendCommand<A extends ConnectCommandAction>(
    action: A,
    payload: ConnectCommandPayloadMap[A],
    targetDeviceId?: string,
  ): Promise<void>;
  reset(): void;
}

let router: ActiveConnectRouter | null = null;
let unsubscribeRouter: (() => void) | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of [...listeners]) listener();
}

export function installActiveConnectRouter(next: ActiveConnectRouter): void {
  if (router !== null && router !== next) {
    throw new Error('A different Connect session is already installed');
  }
  router = next;
  unsubscribeRouter?.();
  unsubscribeRouter = next.subscribe(notifyListeners);
  notifyListeners();
}

export function activeConnectRouter(): ActiveConnectRouter | null {
  return router;
}

export function getActiveConnectSnapshot(): ConnectSessionSnapshot {
  return router?.getSnapshot() ?? IDLE_CONNECT_SNAPSHOT;
}

export function subscribeActiveConnectSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveConnectSnapshot(): ConnectSessionSnapshot {
  return useSyncExternalStore(
    subscribeActiveConnectSnapshot,
    getActiveConnectSnapshot,
    getActiveConnectSnapshot,
  );
}

export function transferActiveConnectPlayback(
  targetDeviceId: string,
  play?: boolean,
): Promise<void> {
  if (router === null) {
    return Promise.reject(new Error('Connect session is not initialized'));
  }
  return router.transferPlayback(targetDeviceId, play);
}
