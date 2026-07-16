import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionRestoreError from './SessionRestoreError';

const mocks = vi.hoisted(() => ({ useState: vi.fn() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});
vi.mock('react-native', () => ({
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
vi.mock('../theme', () => ({
  colors: {
    accent: '#f00',
    background: '#000',
    danger: '#f00',
    onAccent: '#fff',
    textPrimary: '#fff',
    textSecondary: '#aaa',
  },
  metrics: { minimumTouchTarget: 48 },
}));
vi.mock('./BrandLockup', () => ({ default: 'BrandLockup' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`No element has testID ${testID}`);
  return found;
}

function renderReady({
  onRetry = vi.fn(async () => undefined),
  onForget = vi.fn(async () => undefined),
}: {
  onRetry?: () => Promise<void>;
  onForget?: () => Promise<void>;
} = {}) {
  const setBusy = vi.fn();
  const setActionError = vi.fn();
  mocks.useState
    .mockReturnValueOnce([false, setBusy])
    .mockReturnValueOnce([null, setActionError]);
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
});
