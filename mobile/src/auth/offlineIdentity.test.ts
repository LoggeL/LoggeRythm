import { describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { GENERATED_OPENAPI_CONTRACT_VERSION } from '../api/generated/contract';
import {
  OFFLINE_IDENTITY_KEY,
  OFFLINE_IDENTITY_MAX_AGE_MS,
  clearOfflineIdentity,
  persistOfflineIdentity,
  readOfflineIdentity,
  type OfflineIdentityStorage,
} from './offlineIdentity';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

const approved: User = {
  id: 7,
  email: 'person@example.test',
  display_name: 'Person',
  is_admin: false,
  is_approved: true,
  avatar_url: null,
};

function memoryStorage(initial: string | null = null): OfflineIdentityStorage & { value: string | null } {
  const storage = {
    value: initial,
    getItemAsync: vi.fn(async () => storage.value),
    setItemAsync: vi.fn(async (_key: string, value: string) => { storage.value = value; }),
    deleteItemAsync: vi.fn(async () => { storage.value = null; }),
  };
  return storage;
}

describe('offline approved identity', () => {
  it('round-trips a recent approved user without persisting a credential', async () => {
    const storage = memoryStorage();
    await persistOfflineIdentity(approved, 'https://music.test', 1_000, storage);
    expect(storage.setItemAsync).toHaveBeenCalledWith(
      OFFLINE_IDENTITY_KEY,
      expect.not.stringContaining('token'),
    );
    expect(JSON.parse(storage.value ?? '{}')).toEqual({
      version: 1,
      origin: 'https://music.test',
      contractVersion: GENERATED_OPENAPI_CONTRACT_VERSION,
      validatedAt: 1_000,
      user: approved,
    });
    await expect(readOfflineIdentity('https://music.test', 2_000, storage)).resolves.toEqual(approved);
  });

  it('deletes a snapshot for a pending/revoked identity', async () => {
    const storage = memoryStorage('{}');
    await persistOfflineIdentity({ ...approved, is_approved: false }, 'https://music.test', 1_000, storage);
    expect(storage.deleteItemAsync).toHaveBeenCalledExactlyOnceWith(OFFLINE_IDENTITY_KEY);
    expect(storage.value).toBeNull();
  });

  it('rejects origin, contract, approval, corruption, and future validation mismatches', async () => {
    const valid = {
      version: 1,
      origin: 'https://music.test',
      contractVersion: GENERATED_OPENAPI_CONTRACT_VERSION,
      validatedAt: 1_000,
      user: approved,
    };
    for (const value of [
      { ...valid, origin: 'https://other.test' },
      { ...valid, contractVersion: 'v999' },
      { ...valid, user: { ...approved, is_approved: false } },
    ]) {
      const storage = memoryStorage(JSON.stringify(value));
      await expect(readOfflineIdentity('https://music.test', 2_000, storage)).rejects.toBeInstanceOf(Error);
      expect(storage.value).toBeNull();
    }
    const future = memoryStorage(JSON.stringify({ ...valid, validatedAt: 3_000 }));
    await expect(readOfflineIdentity('https://music.test', 2_000, future)).resolves.toBeNull();
    expect(future.value).toBeNull();
    const corrupt = memoryStorage('{broken');
    await expect(readOfflineIdentity('https://music.test', 2_000, corrupt)).rejects.toThrow(
      'not valid JSON',
    );
    expect(corrupt.value).toBeNull();
  });

  it('expires the fallback after the bounded offline window', async () => {
    const storage = memoryStorage();
    await persistOfflineIdentity(approved, 'https://music.test', 1_000, storage);
    await expect(
      readOfflineIdentity('https://music.test', 1_000 + OFFLINE_IDENTITY_MAX_AGE_MS + 1, storage),
    ).resolves.toBeNull();
    expect(storage.value).toBeNull();
  });

  it('supports explicit cleanup at every logout/account boundary', async () => {
    const storage = memoryStorage('{}');
    await clearOfflineIdentity(storage);
    expect(storage.deleteItemAsync).toHaveBeenCalledExactlyOnceWith(OFFLINE_IDENTITY_KEY);
  });

  it('orders cleanup after an already-started identity write so it cannot be resurrected', async () => {
    const storage = memoryStorage();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    vi.mocked(storage.setItemAsync).mockImplementationOnce(async (_key: string, value: string) => {
      await writeGate;
      storage.value = value;
    });

    const write = persistOfflineIdentity(approved, 'https://music.test', 1_000, storage);
    await vi.waitFor(() => expect(storage.setItemAsync).toHaveBeenCalledOnce());
    const cleanup = clearOfflineIdentity(storage);
    await Promise.resolve();
    expect(storage.deleteItemAsync).not.toHaveBeenCalled();

    releaseWrite();
    await Promise.all([write, cleanup]);
    expect(storage.value).toBeNull();
    expect(storage.deleteItemAsync).toHaveBeenCalledExactlyOnceWith(OFFLINE_IDENTITY_KEY);
  });
});
