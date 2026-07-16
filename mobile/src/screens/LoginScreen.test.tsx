import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import LoginScreen from './LoginScreen';

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  useAuth: vi.fn(),
  useEffect: vi.fn(),
  useState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useEffect: mocks.useEffect,
    useState: mocks.useState,
  };
});
vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Linking: { addEventListener: vi.fn(), getInitialURL: vi.fn() },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 11, right: 13, bottom: 17, left: 19 }),
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

interface RenderOptions {
  mode?: 'sign-in' | 'create-account';
  busy?: boolean;
  displayName?: string;
}

function render({ mode = 'sign-in', busy = false, displayName }: RenderOptions = {}) {
  const setters = Array.from({ length: 8 }, () => vi.fn());
  const values = mode === 'sign-in'
    ? [mode, '', 'person@example.test', 'password123', '', '', busy, null]
    : [
      mode,
      displayName ?? 'Person',
      'person@example.test',
      'password123',
      'password123',
      'invite',
      busy,
      null,
    ];
  values.forEach((value, index) => mocks.useState.mockReturnValueOnce([value, setters[index]]));
  return { tree: LoginScreen(), setBusy: setters[6], setError: setters[7] };
}

describe('LoginScreen action feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('announces a successful sign-in and exposes its lifecycle state', async () => {
    const login = vi.fn(async () => undefined);
    mocks.useAuth.mockReturnValue({ login, register: vi.fn() });
    const rendered = render();

    await (byTestId(rendered.tree, 'login-submit').props.onPress as () => Promise<void>)();
    expect(login).toHaveBeenCalledExactlyOnceWith('person@example.test', 'password123');
    expect(rendered.setBusy.mock.calls).toEqual([[true], [false]]);
    expect(rendered.setError).toHaveBeenCalledExactlyOnceWith(null);
    expect(mocks.announce).toHaveBeenCalledExactlyOnceWith(strings.auth.signedIn);
  });

  it('announces account creation through the distinct registration action', async () => {
    const register = vi.fn(async () => undefined);
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register });
    const rendered = render({ mode: 'create-account' });

    await (byTestId(rendered.tree, 'register-submit').props.onPress as () => Promise<void>)();
    expect(register).toHaveBeenCalledOnce();
    expect(mocks.announce).toHaveBeenCalledExactlyOnceWith(strings.auth.accountCreated);
  });

  it('hides transport details behind sign-in-specific recovery copy', async () => {
    const privateDetail =
      'POST https://prod.example.test/login leaked private@example.test and database host db.internal';
    const login = vi.fn(async () => { throw new Error(privateDetail); });
    mocks.useAuth.mockReturnValue({ login, register: vi.fn() });
    const rendered = render();

    await (byTestId(rendered.tree, 'login-submit').props.onPress as () => Promise<void>)();

    expect(rendered.setError.mock.calls).toEqual([[null], [strings.auth.signInFailed]]);
    expect(JSON.stringify(rendered.setError.mock.calls)).not.toContain(privateDetail);
  });

  it('still presents a specific local registration validation message', async () => {
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register: vi.fn() });
    const rendered = render({ mode: 'create-account', displayName: '   ' });

    await (byTestId(rendered.tree, 'register-submit').props.onPress as () => Promise<void>)();

    expect(rendered.setError.mock.calls).toEqual([
      [null],
      [strings.auth.displayNameRequired],
    ]);
  });

  it('renders a labeled polite progress state and busy submit control', () => {
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register: vi.fn() });
    const tree = render({ busy: true }).tree;
    const progress = byTestId(tree, 'auth-submit-progress');
    const submit = byTestId(tree, 'login-submit');

    expect(progress.props.accessibilityRole).toBe('progressbar');
    expect(progress.props.accessibilityLabel).toBe(strings.auth.signingIn);
    expect(progress.props.accessibilityLiveRegion).toBe('polite');
    expect(submit.props.accessibilityLabel).toBe(strings.auth.signingIn);
    expect(submit.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it.each([
    ['sign-in', 'login-submit'],
    ['create-account', 'register-submit'],
  ] as const)('keeps the complete %s form in a safe-area-aware scroll surface', (mode, submitID) => {
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register: vi.fn() });
    const tree = render({ mode }).tree;
    const scroll = byTestId(tree, 'auth-scroll');
    const card = byTestId(tree, 'auth-card');

    expect(scroll.props.contentContainerStyle).toEqual([
      expect.objectContaining({
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
      }),
      {
        paddingTop: 35,
        paddingRight: 37,
        paddingBottom: 41,
        paddingLeft: 43,
      },
    ]);
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('never');
    expect(scroll.props.scrollIndicatorInsets).toEqual({
      top: 11,
      right: 13,
      bottom: 17,
      left: 19,
    });
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(card.props.style).toEqual(expect.objectContaining({ width: '100%', maxWidth: 520 }));
    expect(byTestId(card, submitID)).toBeDefined();
    expect(byTestId(card, 'auth-mode-toggle')).toBeDefined();
  });
});
