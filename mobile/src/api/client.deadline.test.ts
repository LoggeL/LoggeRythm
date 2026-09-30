import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  asyncStorage: {
    getItem: vi.fn(),
    removeItem: vi.fn(),
  },
  secureStore: {
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
  },
  getApiBase: vi.fn(),
  ensureApiCompatibility: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: mocks.asyncStorage,
}));
vi.mock('expo-secure-store', () => mocks.secureStore);
vi.mock('../config', async (importOriginal) => ({
  ...await importOriginal<typeof import('../config')>(),
  getApiBase: mocks.getApiBase,
}));
vi.mock('./compatibility', () => ({
  ensureApiCompatibility: mocks.ensureApiCompatibility,
  resetApiCompatibilityCheck: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function responseWithBody(status: number, body: Promise<string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    headers: new Headers(),
    text: vi.fn(() => body),
  } as unknown as Response;
}

describe('API request deadline through the response body', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getApiBase.mockResolvedValue('https://music.example.test');
    mocks.ensureApiCompatibility.mockResolvedValue(undefined);
    mocks.secureStore.getItemAsync.mockResolvedValue(null);
    mocks.asyncStorage.getItem.mockResolvedValue(null);
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('times out when the response headers arrive but the body never resolves', async () => {
    const body = deferred<string>();
    const response = responseWithBody(200, body.promise);
    mocks.fetch.mockResolvedValue(response);
    const { apiRequest } = await import('./client');

    const request = apiRequest('/api/slow-body', { timeoutMs: 30 });
    const rejection = expect(request).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'GET https://music.example.test/api/slow-body timed out after 30 ms',
    });
    await vi.waitFor(() => expect(response.text).toHaveBeenCalledOnce());
    const signal = mocks.fetch.mock.calls[0]?.[1]?.signal as AbortSignal;

    await rejection;
    expect(signal.aborted).toBe(true);

    body.resolve('{"late":true}');
  });

  it('cancels body reading after headers without waiting for the body promise', async () => {
    const body = deferred<string>();
    const response = responseWithBody(200, body.promise);
    mocks.fetch.mockResolvedValue(response);
    const caller = new AbortController();
    const { apiRequest } = await import('./client');

    const request = apiRequest('/api/cancellable', {
      signal: caller.signal,
      timeoutMs: 10_000,
    });
    await vi.waitFor(() => expect(response.text).toHaveBeenCalledOnce());
    const signal = mocks.fetch.mock.calls[0]?.[1]?.signal as AbortSignal;
    caller.abort();

    await expect(request).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'GET https://music.example.test/api/cancellable was cancelled',
    });
    expect(signal.aborted).toBe(true);

    body.resolve('{"late":true}');
  });

  it('removes the caller listener and timer after a complete response', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    const { apiRequest } = await import('./client');

    await expect(apiRequest('/api/ready', {
      signal: caller.signal,
      timeoutMs: 100,
    })).resolves.toEqual({ ok: true });

    const signal = mocks.fetch.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    caller.abort();
    await vi.advanceTimersByTimeAsync(200);
    expect(signal.aborted).toBe(false);
  });

  it('keeps malformed JSON as a status-specific response error', async () => {
    mocks.fetch.mockResolvedValue(responseWithBody(200, Promise.resolve('{bad json')));
    const { apiRequest } = await import('./client');

    await expect(apiRequest('/api/malformed')).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
      body: '{bad json',
      message: expect.stringContaining('returned invalid JSON'),
    });
  });
});
