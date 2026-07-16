import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  activateLocale,
  DEFAULT_APP_LOCALE,
  isAppLocale,
  type AppLocale,
} from './index';
import {
  persistLocale,
  readPersistedLocale,
  type LocaleStorage,
} from './localeStorage';

export interface LocaleContextValue {
  locale: AppLocale;
  ready: boolean;
  selectLocale(value: AppLocale): Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface LocaleProviderProps {
  children: ReactNode;
  storage?: LocaleStorage;
}

export function LocaleProvider({
  children,
  storage = AsyncStorage,
}: LocaleProviderProps) {
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_APP_LOCALE);
  const [ready, setReady] = useState(false);
  const localeRef = useRef<AppLocale>(DEFAULT_APP_LOCALE);
  const userSelectionStarted = useRef(false);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    void readPersistedLocale(storage).then((persisted) => {
      if (!mounted || userSelectionStarted.current) return;
      localeRef.current = activateLocale(persisted);
      setLocale(persisted);
    }).finally(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [storage]);

  const selectLocale = useCallback((value: AppLocale): Promise<void> => {
    if (!isAppLocale(value)) return Promise.reject(new Error('Unsupported app locale'));
    userSelectionStarted.current = true;

    const operation = writeQueue.current.then(async () => {
      if (localeRef.current === value) return;
      await persistLocale(storage, value);
      localeRef.current = activateLocale(value);
      setLocale(value);
    });
    // Keep the queue usable after a failed write while returning the original
    // rejection to the caller so the UI can report that nothing changed.
    writeQueue.current = operation.catch(() => undefined);
    return operation;
  }, [storage]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    ready,
    selectLocale,
  }), [locale, ready, selectLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}

/** Subscribe a render boundary without coupling it to locale-management UI. */
export function useLocaleRevision(): AppLocale {
  return useLocale().locale;
}
