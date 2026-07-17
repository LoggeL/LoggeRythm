import {
  DEFAULT_APP_LOCALE,
  isAppLocale,
  type AppLocale,
} from './index';

export const APP_LOCALE_STORAGE_KEY = 'lr.app-locale.v1';
export const LOCALE_HYDRATION_TIMEOUT_MS = 2_000;

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

/**
 * Bound the only read that blocks locale-dependent application children.
 * AsyncStorage normally settles immediately, but a wedged native bridge must
 * not turn the locale gate into an indefinite blank startup.
 */
export function readBootstrapLocale(
  storage: LocaleStorage,
  timeoutMs = LOCALE_HYDRATION_TIMEOUT_MS,
): Promise<AppLocale> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return Promise.reject(new TypeError('Locale hydration timeout is invalid'));
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (locale: AppLocale): void => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      resolve(locale);
    };

    timeout = setTimeout(() => finish(DEFAULT_APP_LOCALE), timeoutMs);
    void readPersistedLocale(storage).then(
      finish,
      () => finish(DEFAULT_APP_LOCALE),
    );
  });
}

export async function persistLocale(
  storage: LocaleStorage,
  value: unknown,
): Promise<AppLocale> {
  if (!isAppLocale(value)) throw new Error('Unsupported app locale');
  await storage.setItem(APP_LOCALE_STORAGE_KEY, value);
  return value;
}
