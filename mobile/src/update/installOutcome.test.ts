import { NativeModules } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeAndroidInstallOutcome,
  parseInstallOutcome,
  setAndroidUpdaterAppLocale,
  subscribeAndroidInstallOutcome,
} from './githubReleaseUpdater';
import { androidUpdateFailure } from './updateErrors';

const nativeListeners = new Map<string, (value: unknown) => void>();
const nativeSubscriptionRemove = vi.fn();

vi.mock('react-native', () => ({
  NativeModules: {},
  NativeEventEmitter: class {
    addListener(eventName: string, listener: (value: unknown) => void) {
      nativeListeners.set(eventName, listener);
      return { remove: nativeSubscriptionRemove };
    }
  },
  Platform: { OS: 'android' },
}));

const ABORTED = {
  code: 'updater-install-aborted',
  message: 'Install aborted (status 3)',
  sessionId: 1234,
  versionName: '1.0.17',
  versionCode: 10085,
};

describe('parseInstallOutcome', () => {
  it('accepts the native shape, with or without the session release', () => {
    expect(parseInstallOutcome(ABORTED)).toEqual(ABORTED);
    expect(parseInstallOutcome({ ...ABORTED, versionName: null, versionCode: null })).toEqual({
      ...ABORTED,
      versionName: null,
      versionCode: null,
    });
  });

  it.each([
    ['null', null, 'expected an object, got null'],
    ['an array', [], 'expected an object, got object'],
    ['a foreign code', { ...ABORTED, code: 'aborted' }, 'code "aborted" is not an updater code'],
    ['no message', { ...ABORTED, message: ' ' }, 'updater-install-aborted has no message'],
    ['an empty versionName', { ...ABORTED, versionName: '' }, 'has versionName ""'],
    ['a missing versionName', { ...ABORTED, versionName: undefined }, 'has versionName undefined'],
    ['a fractional versionCode', { ...ABORTED, versionCode: 1.5 }, 'has versionCode 1.5'],
    ['a zero versionCode', { ...ABORTED, versionCode: 0 }, 'has versionCode 0'],
    ['no sessionId', { ...ABORTED, sessionId: undefined }, 'has sessionId undefined'],
    ['a null sessionId', { ...ABORTED, sessionId: null }, 'has sessionId null'],
    ['a fractional sessionId', { ...ABORTED, sessionId: 2.5 }, 'has sessionId 2.5'],
    ['a zero sessionId', { ...ABORTED, sessionId: 0 }, 'has sessionId 0'],
  ])('rejects %s loudly with updater-install-outcome-invalid', (_name, value, message) => {
    let thrown: unknown;
    try {
      parseInstallOutcome(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(androidUpdateFailure(thrown)).toMatchObject({ code: 'updater-install-outcome-invalid' });
    expect((thrown as Error).message).toContain(message);
  });
});

describe('install outcome bridge', () => {
  beforeEach(() => {
    (NativeModules as Record<string, unknown>).LoggeRythmUpdater = {
      getInstallationInfo: vi.fn(),
      openInstallPermissionSettings: vi.fn(),
      downloadAndInstall: vi.fn(),
      consumeInstallOutcome: vi.fn(async () => ABORTED),
      setAppLocale: vi.fn(async () => null),
    };
    nativeListeners.clear();
    nativeSubscriptionRemove.mockClear();
  });

  it('consumes and validates the stored outcome', async () => {
    await expect(consumeAndroidInstallOutcome()).resolves.toEqual(ABORTED);
    const module = NativeModules.LoggeRythmUpdater as { consumeInstallOutcome: ReturnType<typeof vi.fn> };
    module.consumeInstallOutcome.mockResolvedValueOnce(null);
    await expect(consumeAndroidInstallOutcome()).resolves.toBeNull();
    module.consumeInstallOutcome.mockResolvedValueOnce({ code: 'updater-install-aborted' });
    await expect(consumeAndroidInstallOutcome()).rejects.toThrow('updater-install-aborted has no message');
  });

  it('fails loudly when the native module predates consumeInstallOutcome', async () => {
    delete (NativeModules.LoggeRythmUpdater as Record<string, unknown>).consumeInstallOutcome;
    await expect(consumeAndroidInstallOutcome()).rejects.toThrow(
      'LoggeRythm updater native module has no consumeInstallOutcome',
    );
  });

  it('hands the app language to the native updater and passes its rejection on', async () => {
    const module = NativeModules.LoggeRythmUpdater as { setAppLocale: ReturnType<typeof vi.fn> };
    await expect(setAndroidUpdaterAppLocale('en')).resolves.toBeUndefined();
    expect(module.setAppLocale).toHaveBeenCalledExactlyOnceWith('en');
    module.setAppLocale.mockRejectedValueOnce(
      Object.assign(new Error('Android could not persist the app language de'), { code: 'updater-locale-unsaved' }),
    );
    await expect(setAndroidUpdaterAppLocale('de')).rejects.toMatchObject({ code: 'updater-locale-unsaved' });
  });

  it('fails loudly when the native module predates setAppLocale', async () => {
    delete (NativeModules.LoggeRythmUpdater as Record<string, unknown>).setAppLocale;
    await expect(setAndroidUpdaterAppLocale('de')).rejects.toThrow(
      'LoggeRythm updater native module has no setAppLocale',
    );
  });

  it('forwards valid outcome events and reports malformed ones', () => {
    const listener = vi.fn();
    const invalid = vi.fn();
    const unsubscribe = subscribeAndroidInstallOutcome(listener, invalid);
    const emit = nativeListeners.get('LoggeRythmUpdaterInstallOutcome');
    if (emit === undefined) throw new Error('No install outcome listener is registered');
    emit(ABORTED);
    emit({ ...ABORTED, code: 42 });
    unsubscribe();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(ABORTED);
    expect(invalid).toHaveBeenCalledOnce();
    expect(androidUpdateFailure(invalid.mock.calls[0][0])).toMatchObject({
      code: 'updater-install-outcome-invalid',
    });
    expect(nativeSubscriptionRemove).toHaveBeenCalledOnce();
  });

  it('does not disguise a throwing listener as an invalid event', () => {
    const invalid = vi.fn();
    subscribeAndroidInstallOutcome(() => {
      throw new Error('listener bug');
    }, invalid);
    const emit = nativeListeners.get('LoggeRythmUpdaterInstallOutcome');
    expect(() => emit?.(ABORTED)).toThrow('listener bug');
    expect(invalid).not.toHaveBeenCalled();
  });
});
