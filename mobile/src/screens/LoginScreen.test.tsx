import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import LoginScreen from './LoginScreen';

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  linkingAddEventListener: vi.fn(),
  linkingGetInitialURL: vi.fn(),
  useAuth: vi.fn(),
  useEffect: vi.fn(),
  useRef: vi.fn(),
  useState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useEffect: mocks.useEffect,
    useRef: mocks.useRef,
    useState: mocks.useState,
  };
});
vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Linking: {
    addEventListener: mocks.linkingAddEventListener,
    getInitialURL: mocks.linkingGetInitialURL,
  },
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
  serverUrl?: string;
  displayName?: string;
  email?: string;
  password?: string;
  serverSwitchNotice?: string | null;
}

function render({
  mode = 'sign-in',
  busy = false,
  serverUrl = 'https://loggerythm.logge.top',
  displayName,
  email = 'person@example.test',
  password = 'password123',
  serverSwitchNotice = null,
}: RenderOptions = {}) {
  const setters = Array.from({ length: 10 }, () => vi.fn());
  const values = mode === 'sign-in'
    ? [mode, serverUrl, '', email, password, '', '', busy, null, serverSwitchNotice]
    : [
      mode,
      serverUrl,
      displayName ?? 'Person',
      email,
      password,
      password,
      'invite',
      busy,
      null,
      serverSwitchNotice,
    ];
  values.forEach((value, index) => mocks.useState.mockReturnValueOnce([value, setters[index]]));
  const serverUrlRef = { current: serverUrl };
  const authRequestInFlightRef = { current: false };
  mocks.useRef
    .mockReturnValueOnce(serverUrlRef)
    .mockReturnValueOnce(authRequestInFlightRef);
  return {
    tree: LoginScreen(),
    authRequestInFlightRef,
    serverUrlRef,
    setDisplayName: setters[2],
    setEmail: setters[3],
    setPassword: setters[4],
    setConfirmPassword: setters[5],
    setInvite: setters[6],
    setServerUrl: setters[1],
    setBusy: setters[7],
    setError: setters[8],
    setServerSwitchNotice: setters[9],
  };
}

describe('LoginScreen action feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkingGetInitialURL.mockResolvedValue(null);
    mocks.linkingAddEventListener.mockReturnValue({ remove: vi.fn() });
  });

  it('announces a successful sign-in and exposes its lifecycle state', async () => {
    const login = vi.fn(async () => undefined);
    mocks.useAuth.mockReturnValue({ login, register: vi.fn() });
    const rendered = render();

    await (byTestId(rendered.tree, 'login-submit').props.onPress as () => Promise<void>)();
    expect(login).toHaveBeenCalledExactlyOnceWith(
      'person@example.test',
      'password123',
      'https://loggerythm.logge.top',
    );
    expect(rendered.setBusy.mock.calls).toEqual([[true], [false]]);
    expect(rendered.setError).toHaveBeenCalledExactlyOnceWith(null);
    expect(mocks.announce).toHaveBeenCalledExactlyOnceWith(strings.auth.signedIn);
  });

  it('announces account creation through the distinct registration action', async () => {
    const register = vi.fn(async () => undefined);
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register });
    const rendered = render({ mode: 'create-account' });

    await (byTestId(rendered.tree, 'register-submit').props.onPress as () => Promise<void>)();
    expect(register).toHaveBeenCalledWith(
      expect.any(Object),
      'https://loggerythm.logge.top',
    );
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
    expect(rendered.authRequestInFlightRef.current).toBe(false);
  });

  it('rejects a syntactically invalid sign-in email locally before auth starts', async () => {
    const login = vi.fn(async () => undefined);
    mocks.useAuth.mockReturnValue({ login, register: vi.fn() });
    const rendered = render({ email: 'not-an-email' });

    await (byTestId(rendered.tree, 'login-submit').props.onPress as () => Promise<void>)();

    expect(login).not.toHaveBeenCalled();
    expect(rendered.setBusy).not.toHaveBeenCalled();
    expect(rendered.setError.mock.calls).toEqual([[null], [strings.auth.emailInvalid]]);
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it('rejects an unsafe custom server before auth starts', async () => {
    const login = vi.fn(async () => undefined);
    mocks.useAuth.mockReturnValue({ login, register: vi.fn() });
    const rendered = render({ serverUrl: 'http://music.example.test' });

    await (byTestId(rendered.tree, 'login-submit').props.onPress as () => Promise<void>)();

    expect(login).not.toHaveBeenCalled();
    expect(rendered.setBusy).not.toHaveBeenCalled();
    expect(rendered.setError.mock.calls).toEqual([[null], [strings.auth.serverInvalid]]);
  });

  it('clears credentials before a production registration link replaces a custom server', () => {
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register: vi.fn() });
    const rendered = render({
      mode: 'create-account',
      serverUrl: 'https://custom.example.test',
    });
    const effect = mocks.useEffect.mock.calls[0]?.[0] as (() => (() => void) | void);
    const cleanup = effect();
    const listener = mocks.linkingAddEventListener.mock.calls[0]?.[1] as
      ((event: { url: string }) => void);

    listener({
      url: 'https://loggerythm.logge.top/register?invite=production-invite',
    });

    expect(rendered.setDisplayName).toHaveBeenCalledExactlyOnceWith('');
    expect(rendered.setEmail).toHaveBeenCalledExactlyOnceWith('');
    expect(rendered.setPassword).toHaveBeenCalledExactlyOnceWith('');
    expect(rendered.setConfirmPassword).toHaveBeenCalledExactlyOnceWith('');
    expect(rendered.setInvite.mock.calls).toEqual([[''], ['production-invite']]);
    expect(rendered.setServerUrl)
      .toHaveBeenCalledExactlyOnceWith('https://loggerythm.logge.top');
    expect(rendered.serverUrlRef.current).toBe('https://loggerythm.logge.top');
    expect(rendered.setServerSwitchNotice)
      .toHaveBeenCalledExactlyOnceWith(strings.auth.productionLinkServerChanged);
    expect(mocks.announce)
      .toHaveBeenCalledExactlyOnceWith(strings.auth.productionLinkServerChanged);

    if (typeof cleanup === 'function') cleanup();
  });

  it('does not carry a manually entered invite when a production link has no invite', () => {
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register: vi.fn() });
    const rendered = render({
      mode: 'create-account',
      serverUrl: 'https://custom.example.test',
    });
    const effect = mocks.useEffect.mock.calls[0]?.[0] as (() => (() => void) | void);
    const cleanup = effect();
    const listener = mocks.linkingAddEventListener.mock.calls[0]?.[1] as
      ((event: { url: string }) => void);

    listener({ url: 'https://loggerythm.logge.top/register' });

    expect(rendered.setInvite).toHaveBeenCalledExactlyOnceWith('');
    if (typeof cleanup === 'function') cleanup();
  });

  it('keeps form credentials and the custom server for an originless app-scheme invite', () => {
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register: vi.fn() });
    const rendered = render({
      mode: 'create-account',
      serverUrl: 'https://custom.example.test',
    });
    const effect = mocks.useEffect.mock.calls[0]?.[0] as (() => (() => void) | void);
    const cleanup = effect();
    const listener = mocks.linkingAddEventListener.mock.calls[0]?.[1] as
      ((event: { url: string }) => void);

    listener({ url: 'loggerythm://register?invite=custom-invite' });

    expect(rendered.setServerUrl).not.toHaveBeenCalled();
    expect(rendered.setDisplayName).not.toHaveBeenCalled();
    expect(rendered.setEmail).not.toHaveBeenCalled();
    expect(rendered.setPassword).not.toHaveBeenCalled();
    expect(rendered.setConfirmPassword).not.toHaveBeenCalled();
    expect(rendered.setInvite).toHaveBeenCalledExactlyOnceWith('custom-invite');
    expect(rendered.setServerSwitchNotice).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  it('does not visually rebind an in-flight custom-server login to a production link', async () => {
    let resolveLogin!: () => void;
    const login = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    mocks.useAuth.mockReturnValue({ login, register: vi.fn() });
    const rendered = render({ serverUrl: 'https://custom.example.test' });
    const effect = mocks.useEffect.mock.calls[0]?.[0] as (() => (() => void) | void);
    const cleanup = effect();
    const listener = mocks.linkingAddEventListener.mock.calls[0]?.[1] as
      ((event: { url: string }) => void);

    const submission = (
      byTestId(rendered.tree, 'login-submit').props.onPress as () => Promise<void>
    )();
    expect(login).toHaveBeenCalledExactlyOnceWith(
      'person@example.test',
      'password123',
      'https://custom.example.test',
    );
    expect(rendered.authRequestInFlightRef.current).toBe(true);

    listener({
      url: 'https://loggerythm.logge.top/register?invite=must-not-rebind',
    });

    expect(rendered.serverUrlRef.current).toBe('https://custom.example.test');
    expect(rendered.setServerUrl)
      .toHaveBeenCalledExactlyOnceWith('https://custom.example.test');
    expect(rendered.setServerUrl)
      .not.toHaveBeenCalledWith('https://loggerythm.logge.top');
    expect(rendered.setDisplayName).not.toHaveBeenCalled();
    expect(rendered.setEmail).not.toHaveBeenCalled();
    expect(rendered.setPassword).not.toHaveBeenCalled();
    expect(rendered.setConfirmPassword).not.toHaveBeenCalled();
    expect(rendered.setInvite).not.toHaveBeenCalled();
    expect(rendered.setServerSwitchNotice).not.toHaveBeenCalled();

    resolveLogin();
    await submission;
    expect(rendered.authRequestInFlightRef.current).toBe(true);
    if (typeof cleanup === 'function') cleanup();
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
    expect(byTestId(tree, 'login-server').props.editable).toBe(false);
    expect(byTestId(tree, 'login-email').props.editable).toBe(false);
    expect(byTestId(tree, 'login-password').props.editable).toBe(false);
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
    expect(byTestId(card, 'login-server').props).toMatchObject({
      accessibilityLabel: strings.auth.server,
      keyboardType: 'url',
      autoCapitalize: 'none',
      autoCorrect: false,
    });
    expect(byTestId(card, 'login-server-hint').props.children)
      .toBe(strings.auth.serverCredentialNotice);
    expect(byTestId(card, submitID)).toBeDefined();
    expect(byTestId(card, 'auth-mode-toggle')).toBeDefined();
  });

  it('renders the localized server-switch notice visibly', () => {
    mocks.useAuth.mockReturnValue({ login: vi.fn(), register: vi.fn() });
    const tree = render({
      serverSwitchNotice: strings.auth.productionLinkServerChanged,
    }).tree;

    expect(byTestId(tree, 'login-server-switch-notice').props.children)
      .toBe(strings.auth.productionLinkServerChanged);
  });
});
