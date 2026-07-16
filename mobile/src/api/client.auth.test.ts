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
  fetch: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: mocks.asyncStorage,
}));
vi.mock('expo-secure-store', () => mocks.secureStore);
vi.mock('../config', () => ({ getApiBase: mocks.getApiBase }));
vi.mock('./compatibility', () => ({ ensureApiCompatibility: mocks.ensureApiCompatibility }));

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

  it('invalidates the stored session and notifies AuthProvider on 401', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ detail: 'Not authenticated' }),
      { status: 401 },
    ));
    const client = await import('./client');
    const invalidated = vi.fn();
    client.onSessionInvalidated(invalidated);

    await expect(client.apiRequest('/api/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(invalidated).toHaveBeenCalledOnce();
    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledExactlyOnceWith('lr.session.v1');
    expect(mocks.asyncStorage.removeItem).toHaveBeenCalledExactlyOnceWith('lr.session');
    await expect(client.hasSession()).resolves.toBe(false);
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
});
