import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import {
  ServerCompatibilityCheckError,
  UnsupportedServerError,
} from '../api/compatibility';
import { colors } from '../theme';
import { flatStyle, queryByTestId as byTestID, textContent } from '../test/render';
import ConnectivityBanner, {
  ConnectivityBannerView,
  isTransientOfflineError,
} from './ConnectivityBanner';

const mocks = vi.hoisted(() => ({
  offlineMode: false,
  refreshUser: vi.fn(async () => ({ id: 1 })),
  connectivity: { status: 'unknown' as 'unknown' | 'online' | 'offline', showRecovery: false },
  reducedMotion: false,
  effects: [] as (() => void)[],
  setStates: [] as ReturnType<typeof vi.fn>[],
  setValue: vi.fn(),
  timing: vi.fn((_value: unknown, _config: unknown) => ({
    start: vi.fn((cb?: (result: { finished: boolean }) => void) => cb?.({ finished: true })),
    stop: vi.fn(),
  })),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)) => {
      const setter = vi.fn();
      mocks.setStates.push(setter);
      return [typeof initial === 'function' ? (initial as () => T)() : initial, setter];
    },
    useRef: <T,>(initial: T) => ({ current: initial }),
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useMemo: <T,>(factory: () => T) => factory(),
    useEffect: (effect: () => void) => {
      mocks.effects.push(effect);
    },
    useSyncExternalStore: <T,>(_sub: unknown, getSnapshot: () => T) => getSnapshot(),
  };
});
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      setValue = mocks.setValue;
      interpolate(config: unknown) {
        return { interpolate: config };
      }
    },
    View: 'Animated.View',
    timing: mocks.timing,
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../connectivity/store', () => ({
  getConnectivitySnapshot: () => mocks.connectivity,
  subscribeConnectivity: () => () => undefined,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ offlineMode: mocks.offlineMode, refreshUser: mocks.refreshUser }),
}));
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));
vi.mock('../localization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../localization')>()),
  strings: {
    common: {
      retrying: 'Retrying…',
    },
    shell: {
      offlineTitle: 'Offline',
      offlineBody: 'Only downloads are available.',
      backOnlineTitle: 'Back online',
      backOnlineBody: 'Online content is available again.',
      revalidationFailedTitle: 'Could not verify session',
      revalidationFailedBody: 'Your online session could not be verified. Please try again.',
      revalidationRetry: 'Check again',
    },
  },
}));

beforeEach(() => {
  mocks.offlineMode = false;
  mocks.refreshUser = vi.fn(async () => ({ id: 1 }));
  mocks.connectivity = { status: 'unknown', showRecovery: false };
  mocks.reducedMotion = false;
  mocks.effects.length = 0;
  mocks.setStates.length = 0;
  vi.clearAllMocks();
});

describe('ConnectivityBannerView', () => {
  it('announces the persistent offline state assertively without private diagnostics', () => {
    const rendered = ConnectivityBannerView({ kind: 'offline', topInset: 24 });
    expect(byTestID(rendered, 'connectivity-offline')?.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
      accessibilityLabel: 'Offline. Only downloads are available.',
    });
    expect(JSON.stringify(rendered)).not.toContain('https://');
    expect(textContent(rendered)).toEqual(
      expect.arrayContaining(['Offline', 'Only downloads are available.']),
    );
  });

  it('uses the status tokens and keeps clear of the status bar', () => {
    const offline = byTestID(ConnectivityBannerView({ kind: 'offline', topInset: 24 }), 'connectivity-offline');
    const restored = byTestID(ConnectivityBannerView({ kind: 'restored' }), 'connectivity-restored');

    expect(flatStyle(offline?.props.style)).toMatchObject({
      backgroundColor: colors.warningSubtle,
      paddingTop: 24,
    });
    expect(flatStyle(restored?.props.style)).toMatchObject({
      backgroundColor: colors.successSubtle,
      paddingTop: 8,
    });
  });

  it('announces restored connectivity politely as a transient status', () => {
    const rendered = ConnectivityBannerView({ kind: 'restored' });
    expect(byTestID(rendered, 'connectivity-restored')?.props).toMatchObject({
      accessibilityRole: 'text',
      accessibilityLiveRegion: 'polite',
      accessibilityLabel: 'Back online. Online content is available again.',
    });
  });

  it('renders a distinct loud error alert with a Retry action when session revalidation fails', () => {
    const onRetry = vi.fn();
    const rendered = ConnectivityBannerView({
      kind: 'error',
      topInset: 24,
      message: 'Server version is unsupported.',
      onRetry,
    });
    const alert = byTestID(rendered, 'connectivity-revalidation-error');
    expect(alert?.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(flatStyle(alert?.props.style).backgroundColor).toBe(colors.dangerSubtle);
    const retry = byTestID(rendered, 'connectivity-revalidation-retry');
    expect(retry?.props.accessibilityRole).toBe('button');
    (retry?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('isTransientOfflineError', () => {
  it('treats transport/5xx/compatibility-check errors as transient offline and surfaces real errors loudly', () => {
    expect(isTransientOfflineError(new ApiError(0, '', 'Network failed'))).toBe(true);
    expect(isTransientOfflineError(new ApiError(503, '', 'Unavailable'))).toBe(true);
    expect(isTransientOfflineError(new ServerCompatibilityCheckError('Server unreachable'))).toBe(true);

    expect(isTransientOfflineError(new UnsupportedServerError(['v1']))).toBe(false);
    expect(isTransientOfflineError(new ApiError(403, '', 'Forbidden'))).toBe(false);
    expect(isTransientOfflineError(new Error('Account drift'))).toBe(false);
  });
});

describe('ConnectivityBanner overlay & loud revalidation failures', () => {
  it('positions as a floating animated overlay so layout never jumps', () => {
    mocks.connectivity = { status: 'offline', showRecovery: false };
    const rendered = ConnectivityBanner();
    expect(rendered?.type).toBe('Animated.View');
    expect(flatStyle(rendered?.props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    });
    mocks.effects[1]();
    expect(mocks.timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1, useNativeDriver: true }),
    );
  });

  it('reports non-offline refreshUser() failures loudly instead of swallowing them', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new UnsupportedServerError(['v1']);
    mocks.offlineMode = true;
    mocks.connectivity = { status: 'online', showRecovery: false };
    mocks.refreshUser = vi.fn(async () => {
      throw failure;
    });

    ConnectivityBanner();
    mocks.effects[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      '[LoggeRythm] offline-mode session revalidation failed:',
      failure,
    );
    // First useState setter is setRevalidationError
    expect(mocks.setStates[0]).toHaveBeenCalledWith({
      kind: 'compatibility',
      message: failure.message,
    });
    errorSpy.mockRestore();
  });
});
