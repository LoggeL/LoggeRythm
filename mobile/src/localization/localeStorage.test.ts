import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateLocale,
  getActiveLocale,
  strings,
} from './index';
import {
  APP_LOCALE_STORAGE_KEY,
  LOCALE_HYDRATION_TIMEOUT_MS,
  persistLocale,
  readBootstrapLocale,
  readPersistedLocale,
  type LocaleStorage,
} from './localeStorage';

function storageWith(value: string | null): LocaleStorage & {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
} {
  return {
    getItem: vi.fn(async () => value),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  vi.useRealTimers();
  activateLocale('de');
});

describe('device locale persistence', () => {
  it('uses German when no preference exists or storage cannot be read', async () => {
    expect(await readPersistedLocale(storageWith(null))).toBe('de');
    const unavailable = storageWith('en');
    unavailable.getItem.mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await readPersistedLocale(unavailable)).toBe('de');
  });

  it.each(['de', 'en'] as const)('accepts the exact supported value %s', async (locale) => {
    const storage = storageWith(locale);
    expect(await readPersistedLocale(storage)).toBe(locale);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(['EN', 'de-DE', '', ' en ', '{"locale":"en"}'])(
    'rejects and removes malformed value %j',
    async (value) => {
      const storage = storageWith(value);
      expect(await readPersistedLocale(storage)).toBe('de');
      expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith(APP_LOCALE_STORAGE_KEY);
    },
  );

  it('falls back even when cleanup of an invalid value fails', async () => {
    const storage = storageWith('fr');
    storage.removeItem.mockRejectedValueOnce(new Error('read only'));
    await expect(readPersistedLocale(storage)).resolves.toBe('de');
  });

  it('validates before writing and propagates persistence failures', async () => {
    const storage = storageWith(null);
    await expect(persistLocale(storage, 'fr')).rejects.toThrow('Unsupported app locale');
    expect(storage.setItem).not.toHaveBeenCalled();

    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(persistLocale(storage, 'en')).rejects.toThrow('disk full');
  });

  it('hydrates persisted English before a restarted localized shell is released', async () => {
    let release!: (value: string | null) => void;
    const storage = storageWith(null);
    storage.getItem.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve;
    }));
    activateLocale('de');

    const hydration = readBootstrapLocale(storage);
    expect(getActiveLocale()).toBe('de');

    release('en');
    activateLocale(await hydration);

    expect(getActiveLocale()).toBe('en');
    expect(strings.navigation.profile).toBe('Profile');
  });

  it('falls back to German within the bounded startup window when storage never settles', async () => {
    vi.useFakeTimers();
    const storage = storageWith(null);
    storage.getItem.mockImplementationOnce(() => new Promise(() => undefined));
    let settled = false;

    const hydration = readBootstrapLocale(storage).then((locale) => {
      settled = true;
      return locale;
    });
    await vi.advanceTimersByTimeAsync(LOCALE_HYDRATION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(hydration).resolves.toBe('de');
    expect(settled).toBe(true);
  });
});

describe('runtime catalog', () => {
  it('resolves the stable strings facade against the active locale', () => {
    activateLocale('de');
    expect(strings.navigation.profile).toBe('Profil');
    activateLocale('en');
    expect(getActiveLocale()).toBe('en');
    expect(strings.navigation.profile).toBe('Profile');
  });

  it('rejects unsupported runtime activation without changing locale', () => {
    activateLocale('en');
    expect(() => activateLocale('fr')).toThrow('Unsupported app locale');
    expect(getActiveLocale()).toBe('en');
  });
});
