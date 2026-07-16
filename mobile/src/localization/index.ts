import { de, en, type StringCatalog } from './catalog';

export type AppLocale = 'de' | 'en';

export const catalogs: Readonly<Record<AppLocale, StringCatalog>> = { de, en };

export const DEFAULT_APP_LOCALE: AppLocale = 'de';

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'de' || value === 'en';
}

/**
 * The selected locale is process-wide because background player callbacks and
 * other non-React code also need the current copy. React views subscribe via
 * LocaleProvider; this binding alone is deliberately not a render mechanism.
 */
export let activeLocale: AppLocale = DEFAULT_APP_LOCALE;

export function getActiveLocale(): AppLocale {
  return activeLocale;
}

export function activateLocale(value: unknown): AppLocale {
  if (!isAppLocale(value)) throw new Error('Unsupported app locale');
  activeLocale = value;
  return activeLocale;
}

export function createRuntimeCatalog<T extends object>(
  localeCatalogs: Readonly<Record<AppLocale, T>>,
): T {
  return new Proxy({} as T, {
    get(_target, property) {
      return Reflect.get(localeCatalogs[activeLocale], property);
    },
  });
}

/**
 * Keep the established `strings.section.key` API while resolving its top-level
 * section at access time. This lets imperative/background code follow a locale
 * change without capturing a stale catalog at module initialization.
 */
export const strings: StringCatalog = createRuntimeCatalog(catalogs);
