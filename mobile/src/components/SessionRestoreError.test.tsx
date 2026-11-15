import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId } from '../test/render';
import SessionRestoreError from './SessionRestoreError';

const mocks = vi.hoisted(() => ({ useState: vi.fn() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../localization', () => ({
  activeLocale: 'en',
  createRuntimeCatalog: <T extends object>(catalogs: { en: T }) => catalogs.en,
  strings: {
    auth: {
      restoreFailedTitle: 'Could not restore session',
      forgetSession: 'Forget session',
      retryRestoreFailed: 'Could not retry session restore',
      forgetSessionFailed: 'Could not safely forget session',
    },
    common: { retry: 'Retry', working: 'Working' },
  },
}));
vi.mock('./BrandLockup', () => ({ default: 'BrandLockup' }));

function renderReady({
  onRetry = vi.fn(async () => undefined),
  onForget = vi.fn(async () => undefined),
  busy = false,
  actionError = null,
}: {
  onRetry?: () => Promise<void>;
  onForget?: () => Promise<void>;
  busy?: boolean;
  actionError?: { kind: 'generic'; message: string } | null;
} = {}) {
  const setBusy = vi.fn();
  const setActionError = vi.fn();
  mocks.useState
    .mockReturnValueOnce([busy, setBusy])
    .mockReturnValueOnce([actionError, setActionError]);
  return {
    tree: SessionRestoreError({
      error: { kind: 'generic', message: 'Could not safely restore the session' },
      onRetry,
      onForget,
    }),
    setBusy,
    setActionError,
    onRetry,
    onForget,
  };
}

describe('SessionRestoreError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Retry invokes only the retry lifecycle action', async () => {
    const rendered = renderReady();
    (byTestId(rendered.tree, 'session-retry').props.onPress as () => void)();

    await vi.waitFor(() => expect(rendered.onRetry).toHaveBeenCalledOnce());
    expect(rendered.onForget).not.toHaveBeenCalled();
    expect(rendered.setBusy.mock.calls).toEqual([[true], [false]]);
    expect(rendered.setActionError).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('Forget invokes only the credential-forgetting lifecycle action', async () => {
    const rendered = renderReady();
    (byTestId(rendered.tree, 'session-forget').props.onPress as () => void)();

    await vi.waitFor(() => expect(rendered.onForget).toHaveBeenCalledOnce());
    expect(rendered.onRetry).not.toHaveBeenCalled();
    expect(rendered.setBusy.mock.calls).toEqual([[true], [false]]);
    expect(rendered.setActionError).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('replaces private retry diagnostics with action-specific copy', async () => {
    const privateDetail = 'GET https://prod.example.test/me exposed token=private';
    const rendered = renderReady({
      onRetry: vi.fn(async () => { throw new Error(privateDetail); }),
    });
    (byTestId(rendered.tree, 'session-retry').props.onPress as () => void)();

    await vi.waitFor(() => {
      expect(rendered.setActionError).toHaveBeenLastCalledWith({
        kind: 'generic',
        message: 'Could not retry session restore',
      });
    });
    expect(JSON.stringify(rendered.setActionError.mock.calls)).not.toContain(privateDetail);
  });

  it('replaces private cleanup diagnostics with safe forget-session copy', async () => {
    const privateDetail = 'SecureStore lr.session.v1 failed for private keystore alias';
    const rendered = renderReady({
      onForget: vi.fn(async () => { throw new Error(privateDetail); }),
    });
    (byTestId(rendered.tree, 'session-forget').props.onPress as () => void)();

    await vi.waitFor(() => {
      expect(rendered.setActionError).toHaveBeenLastCalledWith({
        kind: 'generic',
        message: 'Could not safely forget session',
      });
    });
    expect(JSON.stringify(rendered.setActionError.mock.calls)).not.toContain(privateDetail);
  });

  it('locks both actions and reports the retry as busy while one is running', () => {
    const rendered = renderReady({ busy: true });
    const retry = byTestId(rendered.tree, 'session-retry');

    expect(retry.props.accessibilityLabel).toBe('Retry');
    expect(retry.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(byTestId(rendered.tree, 'session-forget').props.disabled).toBe(true);
  });

  it('announces the latest action failure instead of the stale restore error', () => {
    const rendered = renderReady({
      actionError: { kind: 'generic', message: 'Could not retry session restore' },
    });
    const message = byTestId(rendered.tree, 'session-restore-message');

    expect(message.props.accessibilityRole).toBe('alert');
    expect(message.props.accessibilityLiveRegion).toBe('assertive');
    expect(message.props.children).toBe('Could not retry session restore');
    expect(byTestId(rendered.tree, 'session-restore-error').props.accessibilityViewIsModal).toBe(true);
  });
});
