import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateLocale,
  getActiveLocale,
  strings,
} from './index';
import {
  APP_LOCALE_STORAGE_KEY,
  persistLocale,
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
