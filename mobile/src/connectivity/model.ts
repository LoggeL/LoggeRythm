export type ConnectivityStatus = 'unknown' | 'online' | 'offline';

export interface ConnectivityEvidence {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

/**
 * NetInfo intentionally starts with nullable evidence. Treating that state as
 * offline creates a false warning on every cold launch, while treating an
 * explicit false as online lets mutations escape into a known-dead network.
 */
export function connectivityStatus({
  isConnected,
  isInternetReachable,
}: ConnectivityEvidence): ConnectivityStatus {
  if (isConnected === false || isInternetReachable === false) return 'offline';
  if (isConnected === true && isInternetReachable === true) return 'online';
  return 'unknown';
}

/** Keep the last definitive state while Android is re-probing reachability. */
export function effectiveConnectivityStatus(
  current: ConnectivityStatus,
  lastDefinitive: Exclude<ConnectivityStatus, 'unknown'> | null,
): ConnectivityStatus {
  return current === 'unknown' ? lastDefinitive ?? 'unknown' : current;
}
