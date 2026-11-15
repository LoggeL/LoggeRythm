import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import { byTestId } from '../test/render';
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
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../components/BrandLockup', () => ({ default: 'BrandLockup' }));

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

  it('locks both actions while one is running and reports which one is busy', () => {
    mocks.useAuth.mockReturnValue({
      user: { email: 'pending@example.test' },
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
    const checking = render({ busy: 'refresh' }).tree;

    expect(byTestId(checking, 'approval-recheck').props.accessibilityState)
      .toEqual({ disabled: true, busy: true });
    expect(byTestId(checking, 'approval-logout').props.accessibilityState)
      .toEqual({ disabled: true, busy: false });
    expect(byTestId(checking, 'approval-logout').props.disabled).toBe(true);
  });

  it('renders the full server origin and a still-pending status', () => {
    mocks.useAuth.mockReturnValue({
      user: { email: 'pending@example.test' },
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
    const tree = render({ status: strings.auth.approvalStillPending }).tree;

    expect(byTestId(tree, 'approval-server-origin').props.numberOfLines).toBeUndefined();
    expect(byTestId(tree, 'approval-status').props.children)
      .toBe(strings.auth.approvalStillPending);
    expect(byTestId(tree, 'approval-status').props.accessibilityLiveRegion).toBe('polite');
  });
});
