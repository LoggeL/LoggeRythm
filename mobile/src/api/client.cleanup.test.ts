import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  asyncStorage: {
    getItem: vi.fn(),
    removeItem: vi.fn(),
  },
  secureStore: {
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: mocks.asyncStorage,
}));
vi.mock('expo-secure-store', () => mocks.secureStore);
vi.mock('../config', () => ({ getApiBase: vi.fn() }));
vi.mock('./compatibility', () => ({ ensureApiCompatibility: vi.fn() }));

describe('local session cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.secureStore.deleteItemAsync.mockResolvedValue(undefined);
    mocks.asyncStorage.removeItem.mockResolvedValue(undefined);
  });

  it('deletes both the encrypted session and the legacy plaintext slot', async () => {
    const { clearSession } = await import('./client');

    await expect(clearSession()).resolves.toBeUndefined();

    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledExactlyOnceWith('lr.session.v1');
    expect(mocks.asyncStorage.removeItem).toHaveBeenCalledExactlyOnceWith('lr.session');
  });

  it('attempts both credential stores and reports every deletion failure', async () => {
    mocks.secureStore.deleteItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    mocks.asyncStorage.removeItem.mockRejectedValueOnce(new Error('storage unavailable'));
    const { clearSession } = await import('./client');

    await expect(clearSession()).rejects.toThrow(
      'SecureStore: keystore unavailable; legacy AsyncStorage: storage unavailable',
    );

    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledOnce();
    expect(mocks.asyncStorage.removeItem).toHaveBeenCalledOnce();
  });

  it('retries failed 401-era disk cleanup while the client remains signed out', async () => {
    mocks.secureStore.deleteItemAsync
      .mockRejectedValueOnce(new Error('keystore temporarily unavailable'))
      .mockResolvedValueOnce(undefined);
    const { clearSession, retryInvalidatedSessionCleanup } = await import('./client');

    await expect(clearSession()).rejects.toThrow('keystore temporarily unavailable');
    await expect(retryInvalidatedSessionCleanup()).resolves.toBeUndefined();

    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(mocks.asyncStorage.removeItem).toHaveBeenCalledTimes(2);
  });

  it('does not erase an authenticated session during a stale cleanup retry', async () => {
    mocks.secureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      token: 'new-session',
      origin: 'https://music.example',
      secure: true,
    }));
    mocks.asyncStorage.getItem.mockResolvedValueOnce(null);
    const { hasSession, retryInvalidatedSessionCleanup } = await import('./client');

    await expect(hasSession()).resolves.toBe(true);
    await expect(retryInvalidatedSessionCleanup()).resolves.toBeUndefined();

    expect(mocks.secureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mocks.asyncStorage.removeItem).not.toHaveBeenCalled();
  });
});
