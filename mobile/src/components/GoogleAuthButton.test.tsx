import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { UnsupportedServerError } from '../api/compatibility';
import { strings } from '../localization';
import { byTestId, queryByTestId } from '../test/render';
import { GoogleAuthButton } from './GoogleAuthButton';

const mocks = vi.hoisted(() => ({
  getAuthProviders: vi.fn(),
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
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string, message: string) {
      super(message);
      this.status = status;
      this.body = body;
      this.name = 'ApiError';
    }
  },
}));
vi.mock('../api/endpoints', () => ({
  getAuthProviders: mocks.getAuthProviders,
}));
vi.mock('./ui', () => ({
  ActionButton: 'ActionButton',
  AppText: 'AppText',
}));

function flushMicrotasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('GoogleAuthButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while hidden or mismatched and renders sign-in/register button when ready', () => {
    const setState = vi.fn();
    mocks.useState.mockReturnValueOnce([null, setState]);
    mocks.useRef.mockReturnValueOnce({ current: false });
    expect(
      GoogleAuthButton({
        serverUrl: 'https://loggerythm.logge.top',
        creatingAccount: false,
        onPress: vi.fn(),
      }),
    ).toBeNull();

    mocks.useState.mockReturnValueOnce([
      { server: 'https://other.example.test', kind: 'ready', google: true },
      setState,
    ]);
    mocks.useRef.mockReturnValueOnce({ current: true });
    expect(
      GoogleAuthButton({
        serverUrl: 'https://loggerythm.logge.top',
        creatingAccount: false,
        onPress: vi.fn(),
      }),
    ).toBeNull();

    mocks.useState.mockReturnValueOnce([
      { server: 'https://loggerythm.logge.top', kind: 'ready', google: true },
      setState,
    ]);
    mocks.useRef.mockReturnValueOnce({ current: true });
    const signInTree = GoogleAuthButton({
      serverUrl: 'https://loggerythm.logge.top',
      creatingAccount: false,
      onPress: vi.fn(),
    });
    expect(signInTree).not.toBeNull();
    expect(byTestId(signInTree!, 'google-auth-submit').props.label).toBe(
      strings.auth.continueWithGoogle,
    );

    mocks.useState.mockReturnValueOnce([
      { server: 'https://loggerythm.logge.top', kind: 'ready', google: true },
      setState,
    ]);
    mocks.useRef.mockReturnValueOnce({ current: true });
    const registerTree = GoogleAuthButton({
      serverUrl: 'https://loggerythm.logge.top',
      creatingAccount: true,
      onPress: vi.fn(),
    });
    expect(byTestId(registerTree!, 'google-auth-submit').props.label).toBe(
      strings.auth.registerWithGoogle,
    );
  });

  it('fetches providers on initial valid URL and hides on 404 or google=false', async () => {
    const setState = vi.fn();
    mocks.useState.mockReturnValue([null, setState]);
    mocks.useRef.mockReturnValue({ current: false });
    mocks.getAuthProviders.mockResolvedValueOnce({ google: true });

    GoogleAuthButton({
      serverUrl: 'https://loggerythm.logge.top/',
      creatingAccount: false,
      onPress: vi.fn(),
    });
    const cleanup = (mocks.useEffect.mock.calls[0]?.[0] as () => (() => void) | void)();
    await flushMicrotasks();

    expect(mocks.getAuthProviders).toHaveBeenCalledWith(
      'https://loggerythm.logge.top',
      expect.any(AbortSignal),
    );
    expect(setState).toHaveBeenCalledWith({
      server: 'https://loggerythm.logge.top',
      kind: 'ready',
      google: true,
    });
    if (typeof cleanup === 'function') cleanup();

    setState.mockClear();
    mocks.useEffect.mockClear();
    mocks.useRef.mockReturnValue({ current: false });
    mocks.getAuthProviders.mockRejectedValueOnce(new ApiError(404, '', 'Not found'));

    GoogleAuthButton({
      serverUrl: 'https://older.example.test',
      creatingAccount: false,
      onPress: vi.fn(),
    });
    (mocks.useEffect.mock.calls[0]?.[0] as () => void)();
    await flushMicrotasks();
    expect(setState).toHaveBeenCalledWith({
      server: 'https://older.example.test',
      kind: 'hidden',
    });
  });

  it('surfaces non-404 and compatibility errors clearly', async () => {
    const setState = vi.fn();
    mocks.useState.mockReturnValueOnce([null, setState]);
    mocks.useRef.mockReturnValueOnce({ current: false });
    const compatError = new UnsupportedServerError(['v1']);
    mocks.getAuthProviders.mockRejectedValueOnce(compatError);

    GoogleAuthButton({
      serverUrl: 'https://incompatible.example.test',
      creatingAccount: false,
      onPress: vi.fn(),
    });
    (mocks.useEffect.mock.calls[0]?.[0] as () => void)();
    await flushMicrotasks();
    expect(setState).toHaveBeenCalledWith({
      server: 'https://incompatible.example.test',
      kind: 'error',
      message: compatError.message,
    });

    mocks.useState.mockReturnValueOnce([
      {
        server: 'https://incompatible.example.test',
        kind: 'error',
        message: compatError.message,
      },
      setState,
    ]);
    mocks.useRef.mockReturnValueOnce({ current: true });
    const tree = GoogleAuthButton({
      serverUrl: 'https://incompatible.example.test',
      creatingAccount: false,
      onPress: vi.fn(),
    });
    expect(byTestId(tree!, 'google-auth-provider-error').props.children).toBe(compatError.message);
    expect(queryByTestId(tree!, 'google-auth-submit')).toBeNull();
  });
});
