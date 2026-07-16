import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import PendingApprovalScreen from './PendingApprovalScreen';

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  useAuth: vi.fn(),
  useState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});
vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../components/BrandLockup', () => ({ default: 'BrandLockup' }));

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

function render({ busy = null, status = null }: { busy?: 'refresh' | 'logout' | null; status?: string | null } = {}) {
  const setBusy = vi.fn();
  const setError = vi.fn();
  const setStatus = vi.fn();
  mocks.useState
    .mockReturnValueOnce([busy, setBusy])
    .mockReturnValueOnce([null, setError])
    .mockReturnValueOnce([status, setStatus]);
  return { tree: PendingApprovalScreen(), setBusy, setError, setStatus };
}

describe('PendingApprovalScreen transition feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('announces and renders a successful still-pending recheck', async () => {
    const refreshUser = vi.fn(async () => ({ is_approved: false }));
    mocks.useAuth.mockReturnValue({
      user: { email: 'pending@example.test' },
      refreshUser,
      logout: vi.fn(),
    });
    const rendered = render();

    await (byTestId(rendered.tree, 'approval-recheck').props.onPress as () => Promise<void>)();
    await vi.waitFor(() => expect(refreshUser).toHaveBeenCalledOnce());
    expect(rendered.setBusy.mock.calls).toEqual([['refresh'], [null]]);
    expect(rendered.setStatus.mock.calls).toEqual([[null], [strings.auth.approvalStillPending]]);
    expect(mocks.announce).toHaveBeenCalledExactlyOnceWith(strings.auth.approvalStillPending);
  });

  it('announces approval without writing stale pending-screen state', async () => {
    const refreshUser = vi.fn(async () => ({ is_approved: true }));
    mocks.useAuth.mockReturnValue({
      user: { email: 'approved@example.test' },
      refreshUser,
      logout: vi.fn(),
    });
    const rendered = render();

    await (byTestId(rendered.tree, 'approval-recheck').props.onPress as () => Promise<void>)();
    await vi.waitFor(() => expect(refreshUser).toHaveBeenCalledOnce());
    expect(rendered.setStatus).toHaveBeenCalledExactlyOnceWith(null);
    expect(mocks.announce).toHaveBeenCalledExactlyOnceWith(strings.auth.approvalGranted);
  });

  it('hides private refresh diagnostics behind approval-specific copy', async () => {
    const privateDetail = 'GET /me exposed private@example.test from db.internal';
    const refreshUser = vi.fn(async () => { throw new Error(privateDetail); });
    mocks.useAuth.mockReturnValue({
      user: { email: 'pending@example.test' },
      refreshUser,
      logout: vi.fn(),
    });
    const rendered = render();

    (byTestId(rendered.tree, 'approval-recheck').props.onPress as () => void)();
    await vi.waitFor(() => {
      expect(rendered.setError).toHaveBeenLastCalledWith(strings.auth.approvalCheckFailed);
    });
    expect(JSON.stringify(rendered.setError.mock.calls)).not.toContain(privateDetail);
  });

  it('hides native cleanup diagnostics behind sign-out-specific copy', async () => {
    const privateDetail = 'SecureStore lr.session.v1 failed for private keystore alias';
    const logout = vi.fn(async () => { throw new Error(privateDetail); });
    mocks.useAuth.mockReturnValue({
      user: { email: 'pending@example.test' },
      refreshUser: vi.fn(),
      logout,
    });
    const rendered = render();

    (byTestId(rendered.tree, 'approval-logout').props.onPress as () => void)();
    await vi.waitFor(() => {
      expect(rendered.setError).toHaveBeenLastCalledWith(strings.auth.logoutFailedMessage);
    });
    expect(JSON.stringify(rendered.setError.mock.calls)).not.toContain(privateDetail);
  });

  it('exposes checking and signing-out work as labeled live progress', () => {
    mocks.useAuth.mockReturnValue({
      user: { email: 'pending@example.test' },
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
    const checking = render({ busy: 'refresh' }).tree;
    const progress = byTestId(checking, 'approval-progress');
    expect(progress.props.accessibilityRole).toBe('progressbar');
    expect(progress.props.accessibilityLabel).toBe(strings.auth.checkingApproval);
    expect(progress.props.accessibilityLiveRegion).toBe('polite');
    expect(byTestId(checking, 'approval-recheck').props.accessibilityLabel)
      .toBe(strings.auth.checkingApproval);

    mocks.useState.mockReset();
    const signingOut = render({ busy: 'logout' }).tree;
    expect(byTestId(signingOut, 'approval-progress').props.accessibilityLabel)
      .toBe(strings.auth.signingOut);
    expect(byTestId(signingOut, 'approval-logout').props.accessibilityLabel)
      .toBe(strings.auth.signingOut);
  });
});
