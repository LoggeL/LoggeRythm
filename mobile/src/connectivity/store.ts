import NetInfo from '@react-native-community/netinfo';
import {
  connectivityStatus,
  effectiveConnectivityStatus,
  type ConnectivityStatus,
} from './model';

const RECOVERY_NOTICE_MS = 4_000;

export interface ConnectivitySnapshot {
  status: ConnectivityStatus;
  showRecovery: boolean;
}

let snapshot: ConnectivitySnapshot = { status: 'unknown', showRecovery: false };
let lastDefinitive: Exclude<ConnectivityStatus, 'unknown'> | null = null;
let stopNativeSubscription: (() => void) | null = null;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export function getConnectivitySnapshot(): ConnectivitySnapshot {
  return snapshot;
}

function publish(next: ConnectivitySnapshot): void {
  if (next.status === snapshot.status && next.showRecovery === snapshot.showRecovery) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function clearRecoveryTimer(): void {
  if (recoveryTimer !== null) clearTimeout(recoveryTimer);
  recoveryTimer = null;
}

function receiveConnectivityEvidence(
  isConnected: boolean | null,
  isInternetReachable: boolean | null,
): void {
  const raw = connectivityStatus({ isConnected, isInternetReachable });
  const status = effectiveConnectivityStatus(raw, lastDefinitive);
  if (raw !== 'unknown') lastDefinitive = raw;
  if (status === 'unknown') return;

  const recovered = snapshot.status === 'offline' && status === 'online';
  clearRecoveryTimer();
  publish({ status, showRecovery: recovered });
  if (recovered) {
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      publish({ ...snapshot, showRecovery: false });
    }, RECOVERY_NOTICE_MS);
  }
}

function ensureNativeSubscription(): void {
  if (stopNativeSubscription !== null) return;
  stopNativeSubscription = NetInfo.addEventListener((state) => {
    receiveConnectivityEvidence(state.isConnected, state.isInternetReachable);
  });
}

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  ensureNativeSubscription();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopNativeSubscription !== null) {
      stopNativeSubscription();
      stopNativeSubscription = null;
    }
  };
}
