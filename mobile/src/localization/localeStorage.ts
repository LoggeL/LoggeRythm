import {
  DEFAULT_APP_LOCALE,
  isAppLocale,
  type AppLocale,
} from './index';

export const APP_LOCALE_STORAGE_KEY = 'lr.app-locale.v1';

export interface LocaleStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Locale preference is device-level, not account-scoped. Missing, corrupt, or
 * unreadable storage always falls back to German; malformed values are removed
 * best-effort so they cannot become a recurring bootstrap hazard.
 */
export async function readPersistedLocale(
  storage: LocaleStorage,
): Promise<AppLocale> {
  let value: string | null;
  try {
    value = await storage.getItem(APP_LOCALE_STORAGE_KEY);
  } catch {
    return DEFAULT_APP_LOCALE;
  }

  if (value === null) return DEFAULT_APP_LOCALE;
  if (isAppLocale(value)) return value;

  try {
    await storage.removeItem(APP_LOCALE_STORAGE_KEY);
  } catch {
    // The invalid value is still ignored. A cleanup failure must not block app
    // startup or make untrusted storage content an active locale.
  }
  return DEFAULT_APP_LOCALE;
}

export async function persistLocale(
  storage: LocaleStorage,
  value: unknown,
): Promise<AppLocale> {
  if (!isAppLocale(value)) throw new Error('Unsupported app locale');
  await storage.setItem(APP_LOCALE_STORAGE_KEY, value);
  return value;
}
