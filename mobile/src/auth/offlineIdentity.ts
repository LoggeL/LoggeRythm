import * as SecureStore from 'expo-secure-store';
import { decodeUser } from '../api/decoders';
import type { User } from '../api/types';
import { GENERATED_OPENAPI_CONTRACT_VERSION } from '../api/generated/contract';

export const OFFLINE_IDENTITY_KEY = 'lr.offline-identity.v1';
export const OFFLINE_IDENTITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export interface OfflineIdentityStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

interface StoredOfflineIdentity {
  version: 1;
  origin: string;
  contractVersion: string;
  validatedAt: number;
  user: User;
}

const secureStorage: OfflineIdentityStorage = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

let identityOperationTail: Promise<void> = Promise.resolve();

/**
 * SecureStore calls are serialized so a cleanup requested after an in-flight
 * validated-identity write always deletes that write last. Callers still see
 * their own error, while a failed operation cannot poison a later cleanup.
 */
function serializeIdentityOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = identityOperationTail.then(operation, operation);
  identityOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function exactOrigin(value: string): string {
  const normalized = value.trim();
  const origin = new URL(normalized).origin;
  if (normalized !== origin && normalized !== `${origin}/`) {
    throw new Error('Offline identity origin must not contain a path, query, or fragment');
  }
  return origin;
}

function decodeStoredOfflineIdentity(raw: string, expectedOrigin: string): StoredOfflineIdentity {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Offline identity snapshot is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Offline identity snapshot must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) throw new Error('Offline identity snapshot version is unsupported');
  if (record.origin !== expectedOrigin) {
    throw new Error('Offline identity snapshot belongs to another server origin');
  }
  if (record.contractVersion !== GENERATED_OPENAPI_CONTRACT_VERSION) {
    throw new Error('Offline identity snapshot uses another API contract');
  }
  if (
    typeof record.validatedAt !== 'number'
    || !Number.isSafeInteger(record.validatedAt)
    || record.validatedAt <= 0
  ) {
    throw new Error('Offline identity snapshot has an invalid validation time');
  }
  const user = decodeUser(record.user);
  if (!user.is_approved) throw new Error('Offline identity snapshot is not approved');
  return {
    version: 1,
    origin: expectedOrigin,
    contractVersion: GENERATED_OPENAPI_CONTRACT_VERSION,
    validatedAt: record.validatedAt,
    user,
  };
}

/** Store only a server-validated approved identity; never a token or cookie. */
export function persistOfflineIdentity(
  user: User,
  apiBase: string,
  now = Date.now(),
  storage: OfflineIdentityStorage = secureStorage,
): Promise<void> {
  return serializeIdentityOperation(async () => {
    if (!user.is_approved) {
      await storage.deleteItemAsync(OFFLINE_IDENTITY_KEY);
      return;
    }
    if (!Number.isSafeInteger(now) || now <= 0) {
      throw new Error('Offline identity validation time is invalid');
    }
    const value: StoredOfflineIdentity = {
      version: 1,
      origin: exactOrigin(apiBase),
      contractVersion: GENERATED_OPENAPI_CONTRACT_VERSION,
      validatedAt: now,
      user: decodeUser(user),
    };
    await storage.setItemAsync(OFFLINE_IDENTITY_KEY, JSON.stringify(value));
  });
}

/**
 * Restore only a recent, approved identity bound to this exact origin and generated contract.
 * Invalid/expired snapshots are deleted before returning null so Retry cannot revive them.
 */
export function readOfflineIdentity(
  apiBase: string,
  now = Date.now(),
  storage: OfflineIdentityStorage = secureStorage,
): Promise<User | null> {
  return serializeIdentityOperation(async () => {
    const raw = await storage.getItemAsync(OFFLINE_IDENTITY_KEY);
    if (raw === null) return null;
    let snapshot: StoredOfflineIdentity;
    try {
      snapshot = decodeStoredOfflineIdentity(raw, exactOrigin(apiBase));
    } catch (error) {
      await storage.deleteItemAsync(OFFLINE_IDENTITY_KEY);
      throw error;
    }
    if (now < snapshot.validatedAt || now - snapshot.validatedAt > OFFLINE_IDENTITY_MAX_AGE_MS) {
      await storage.deleteItemAsync(OFFLINE_IDENTITY_KEY);
      return null;
    }
    return snapshot.user;
  });
}

export function clearOfflineIdentity(
  storage: OfflineIdentityStorage = secureStorage,
): Promise<void> {
  return serializeIdentityOperation(() => storage.deleteItemAsync(OFFLINE_IDENTITY_KEY));
}
