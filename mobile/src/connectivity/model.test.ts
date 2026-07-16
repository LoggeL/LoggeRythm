import { describe, expect, it } from 'vitest';
import { connectivityStatus, effectiveConnectivityStatus } from './model';

describe('connectivity model', () => {
  it('does not claim the cold-launch nullable state is offline', () => {
    expect(connectivityStatus({ isConnected: null, isInternetReachable: null })).toBe('unknown');
    expect(connectivityStatus({ isConnected: true, isInternetReachable: null })).toBe('unknown');
  });

  it('fails closed on either explicit transport or internet-reachability failure', () => {
    expect(connectivityStatus({ isConnected: false, isInternetReachable: null })).toBe('offline');
    expect(connectivityStatus({ isConnected: true, isInternetReachable: false })).toBe('offline');
  });

  it('requires positive transport and internet evidence before announcing recovery', () => {
    expect(connectivityStatus({ isConnected: true, isInternetReachable: true })).toBe('online');
  });

  it('latches a definitive state while Android performs an intermediate re-probe', () => {
    expect(effectiveConnectivityStatus('unknown', 'offline')).toBe('offline');
    expect(effectiveConnectivityStatus('unknown', 'online')).toBe('online');
    expect(effectiveConnectivityStatus('online', 'offline')).toBe('online');
  });
});
