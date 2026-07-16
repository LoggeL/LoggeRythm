import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  nativeListener: null as null | ((state: {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
  }) => void),
  stop: vi.fn(),
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: mocks.addEventListener },
}));

describe('connectivity external store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.nativeListener = null;
    mocks.stop.mockReset();
    mocks.addEventListener.mockReset();
    mocks.addEventListener.mockImplementation((listener) => {
      mocks.nativeListener = listener;
      return mocks.stop;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores cold nullable evidence, latches offline through re-probe, then expires recovery', async () => {
    const store = await import('./store');
    const notify = vi.fn();
    const unsubscribe = store.subscribeConnectivity(notify);
    const emit = (isConnected: boolean | null, isInternetReachable: boolean | null) => {
      mocks.nativeListener?.({ isConnected, isInternetReachable });
    };

    emit(null, null);
    expect(store.getConnectivitySnapshot()).toEqual({ status: 'unknown', showRecovery: false });
    expect(notify).not.toHaveBeenCalled();

    emit(false, null);
    expect(store.getConnectivitySnapshot()).toEqual({ status: 'offline', showRecovery: false });

    emit(true, null);
    expect(store.getConnectivitySnapshot()).toEqual({ status: 'offline', showRecovery: false });

    emit(true, true);
    expect(store.getConnectivitySnapshot()).toEqual({ status: 'online', showRecovery: true });
    vi.advanceTimersByTime(3_999);
    expect(store.getConnectivitySnapshot().showRecovery).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.getConnectivitySnapshot()).toEqual({ status: 'online', showRecovery: false });

    unsubscribe();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('shares one native subscription across React subscribers', async () => {
    const store = await import('./store');
    const first = store.subscribeConnectivity(vi.fn());
    const second = store.subscribeConnectivity(vi.fn());
    expect(mocks.addEventListener).toHaveBeenCalledOnce();

    first();
    expect(mocks.stop).not.toHaveBeenCalled();
    second();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});
