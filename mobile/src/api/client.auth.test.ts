import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  resetApiCompatibilityCheck: vi.fn(),
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
  resetApiCompatibilityCheck: mocks.resetApiCompatibilityCheck,
}));

const storedSession = JSON.stringify({
  version: 1,
  token: 'stored-session-token',
  origin: 'https://music.example.test',
  secure: true,
});

function ok(body: unknown = { ok: true }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('authenticated client lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getApiBase.mockResolvedValue('https://music.example.test');
    mocks.ensureApiCompatibility.mockResolvedValue({
      api_version: '1.0.0',
      current_contract_version: 'v1',
      compatible_contract_versions: ['v1'],
    });
    mocks.secureStore.getItemAsync.mockResolvedValue(storedSession);
    mocks.secureStore.deleteItemAsync.mockResolvedValue(undefined);
    mocks.asyncStorage.getItem.mockResolvedValue(null);
    mocks.asyncStorage.removeItem.mockResolvedValue(undefined);
    mocks.fetch.mockImplementation(async () => ok());
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('reloads and sends the stored session after a process restart', async () => {
    const firstClient = await import('./client');
    await expect(firstClient.apiRequest('/api/auth/me')).resolves.toEqual({ ok: true });

    vi.resetModules();
    const restartedClient = await import('./client');
    await expect(restartedClient.apiRequest('/api/auth/me')).resolves.toEqual({ ok: true });

    expect(mocks.secureStore.getItemAsync).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (const request of mocks.fetch.mock.calls) {
      expect(request[1]?.headers).toMatchObject({ Cookie: 'sf_session=stored-session-token' });
    }
    expect(mocks.secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('preflights and persists an explicit custom HTTPS login origin', async () => {
    mocks.secureStore.getItemAsync.mockResolvedValueOnce(null);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'sf_session=custom-session; HttpOnly; Secure; Path=/; SameSite=lax',
      },
    }));
    const client = await import('./client');

    await expect(client.apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'person@example.test', password: 'password123' },
      captureSession: true,
      noAuth: true,
      apiBase: 'https://MUSIC.example.test:8443/',
    })).resolves.toEqual({ id: 7 });

    expect(mocks.resetApiCompatibilityCheck)
      .toHaveBeenCalledExactlyOnceWith('https://music.example.test:8443');
    expect(mocks.ensureApiCompatibility)
      .toHaveBeenCalledWith('https://music.example.test:8443');
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://music.example.test:8443/api/auth/login',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
      }),
    );
    expect(mocks.secureStore.setItemAsync).toHaveBeenCalledWith(
      'lr.session.v1',
      JSON.stringify({
        version: 1,
        token: 'custom-session',
        origin: 'https://music.example.test:8443',
        secure: true,
      }),
    );
  });

  it('rejects unsafe custom origins before compatibility or credentials', async () => {
    mocks.secureStore.getItemAsync.mockResolvedValueOnce(null);
    const client = await import('./client');

    await expect(client.apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'person@example.test', password: 'password123' },
      captureSession: true,
      noAuth: true,
      apiBase: 'http://music.example.test',
    })).rejects.toThrow('canonical HTTPS origin required');

    expect(mocks.ensureApiCompatibility).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('does not send credentials when the selected server fails preflight', async () => {
    mocks.secureStore.getItemAsync.mockResolvedValueOnce(null);
    mocks.ensureApiCompatibility.mockRejectedValueOnce(new Error('unsupported server'));
    const client = await import('./client');

    await expect(client.apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'person@example.test', password: 'password123' },
      captureSession: true,
      noAuth: true,
      apiBase: 'https://unsupported.example.test',
    })).rejects.toThrow('unsupported server');

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('sends a replay-safe mutation key without weakening the authenticated cookie', async () => {
    const client = await import('./client');
    const eventId = '123e4567-e89b-42d3-a456-426614174000';

    await expect(client.apiRequest('/api/me/plays', {
      method: 'POST',
      body: { id: '42' },
      idempotencyKey: eventId,
    })).resolves.toEqual({ ok: true });

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://music.example.test/api/me/plays',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': eventId,
          Cookie: 'sf_session=stored-session-token',
        },
      }),
    );
  });

  it('invalidates the stored session and notifies AuthProvider on 401', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ detail: 'Not authenticated' }),
      { status: 401 },
    ));
    const client = await import('./client');
    const invalidated = vi.fn();
    client.onSessionInvalidated(invalidated);

    const request = client.apiRequest('/api/auth/me');
    const error = await request.catch((cause: unknown) => cause);

    expect(error).toMatchObject({ status: 401 });
    expect(invalidated).toHaveBeenCalledOnce();
    expect(client.authoritativeSessionInvalidationFor(error))
      .toBe(invalidated.mock.calls[0][0]);
    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledExactlyOnceWith('lr.session.v1');
    expect(mocks.asyncStorage.removeItem).toHaveBeenCalledExactlyOnceWith('lr.session');
    await expect(client.hasSession()).resolves.toBe(false);
  });

  it('preserves authoritative 401 when initial credential deletion fails', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ detail: 'Not authenticated' }),
      { status: 401 },
    ));
    mocks.secureStore.deleteItemAsync.mockRejectedValueOnce(
      new Error('private keystore diagnostic'),
    );
    const client = await import('./client');
    const invalidated = vi.fn();
    client.onSessionInvalidated(invalidated);

    await expect(client.apiRequest('/api/auth/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });

    expect(invalidated).toHaveBeenCalledOnce();
    await expect(client.hasSession()).resolves.toBe(false);
  });

  it('holds a replacement session commit behind its exact invalidation cleanup', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ detail: 'Not authenticated' }),
        { status: 401 },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 8 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'sf_session=replacement; HttpOnly; Secure; Path=/; SameSite=lax',
        },
      }));
    const client = await import('./client');
    const invalidationError = await client.apiRequest('/api/auth/me')
      .catch((cause: unknown) => cause);
    const authority =
      client.authoritativeSessionInvalidationFor(invalidationError);
    expect(authority).not.toBeNull();
    if (authority === null) throw new Error('Expected invalidation authority');

    const cleanup = deferred<void>();
    const cleanupAttempt = client.runWithSessionInvalidationAuthority(
      authority,
      () => cleanup.promise,
    );
    const replacement = client.apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'new@example.test', password: 'password123' },
      captureSession: true,
      noAuth: true,
    });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.secureStore.setItemAsync).not.toHaveBeenCalled();

    cleanup.resolve();
    await cleanupAttempt;
    await expect(replacement).resolves.toEqual({ id: 8 });
    expect(mocks.secureStore.setItemAsync).toHaveBeenCalledOnce();
  });

  it('keeps a valid stored session after 403 and reuses it on the next request', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ detail: 'Approval required' }),
        { status: 403 },
      ))
      .mockResolvedValueOnce(ok());
    const client = await import('./client');
    const invalidated = vi.fn();
    client.onSessionInvalidated(invalidated);

    await expect(client.apiRequest('/api/protected')).rejects.toMatchObject({ status: 403 });
    await expect(client.hasSession()).resolves.toBe(true);
    await expect(client.apiRequest('/api/auth/me')).resolves.toEqual({ ok: true });

    expect(invalidated).not.toHaveBeenCalled();
    expect(mocks.secureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mocks.asyncStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Cookie: 'sf_session=stored-session-token',
    });
  });

  it('cannot install a late login credential after logout cleared the session boundary', async () => {
    mocks.secureStore.getItemAsync.mockResolvedValueOnce(null);
    let resolveLogin!: (response: Response) => void;
    const loginResponse = new Promise<Response>((resolve) => { resolveLogin = resolve; });
    mocks.fetch.mockImplementationOnce(() => loginResponse);
    const client = await import('./client');

    const login = client.apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'person@example.test', password: 'password123' },
      captureSession: true,
      noAuth: true,
    });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    await client.clearSession();
    resolveLogin(new Response(JSON.stringify({ id: 7 }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'sf_session=late-session; HttpOnly; Secure; Path=/; SameSite=lax',
      },
    }));

    await expect(login).rejects.toThrow(
      'Authentication response was invalidated by a newer session transition',
    );
    expect(mocks.secureStore.setItemAsync).not.toHaveBeenCalled();
    await expect(client.hasSession()).resolves.toBe(false);
  });

  it('does not authorize a stale 401 to invalidate a newer login revision', async () => {
    const oldResponse = deferred<Response>();
    mocks.fetch
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 8 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'sf_session=new-session; HttpOnly; Secure; Path=/; SameSite=lax',
        },
      }));
    const client = await import('./client');
    const invalidated = vi.fn();
    client.onSessionInvalidated(invalidated);

    const oldRequest = client.apiRequest('/api/me/plays', {
      method: 'POST',
      body: { id: '42' },
    });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    await expect(client.apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'new@example.test', password: 'password123' },
      captureSession: true,
      noAuth: true,
    })).resolves.toEqual({ id: 8 });

    oldResponse.resolve(new Response(
      JSON.stringify({ detail: 'Old session expired' }),
      { status: 401 },
    ));
    const staleError = await oldRequest.catch((cause: unknown) => cause);

    expect(staleError).toMatchObject({ name: 'ApiError', status: 401 });
    expect(client.authoritativeSessionInvalidationFor(staleError)).toBeNull();
    expect(invalidated).not.toHaveBeenCalled();
    await expect(client.hasSession()).resolves.toBe(true);
    await expect(
      client.authenticatedHeadersFor('https://music.example.test/api/me'),
    ).resolves.toEqual({ Cookie: 'sf_session=new-session' });
  });

  it('rejects authority A before fetch after session B has committed', async () => {
    const client = await import('./client');
    const authorityA = await client.captureAuthenticatedRequestAuthority();
    await client.clearSession();
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 8 }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'sf_session=session-b; HttpOnly; Secure; Path=/; SameSite=lax',
      },
    }));
    await client.apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'new@example.test', password: 'password123' },
      captureSession: true,
      noAuth: true,
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();

    await expect(client.apiRequest('/api/me/plays', {
      method: 'POST',
      body: { id: '42' },
      authenticatedRequestAuthority: authorityA,
    })).rejects.toBeInstanceOf(client.AuthenticatedRequestAuthorityError);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
