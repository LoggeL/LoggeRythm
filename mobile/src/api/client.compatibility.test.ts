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

describe('API compatibility request boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getApiBase.mockResolvedValue('https://music.example');
    mocks.ensureApiCompatibility.mockResolvedValue({
      api_version: '1.0.0',
      current_contract_version: 'v1',
      compatible_contract_versions: ['v1'],
    });
    mocks.secureStore.getItemAsync.mockResolvedValue(null);
    mocks.asyncStorage.getItem.mockResolvedValue(null);
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('rejects before reading, migrating, or invalidating session state', async () => {
    mocks.ensureApiCompatibility.mockRejectedValue(
      new Error('Dieser Server wird von dieser Android-Version nicht unterstützt.'),
    );
    const { apiRequest, onSessionInvalidated } = await import('./client');
    const invalidated = vi.fn();
    onSessionInvalidated(invalidated);

    await expect(apiRequest('/api/auth/me')).rejects.toThrow('Android-Version');

    expect(mocks.ensureApiCompatibility).toHaveBeenCalledWith('https://music.example');
    expect(mocks.secureStore.getItemAsync).not.toHaveBeenCalled();
    expect(mocks.secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mocks.secureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mocks.asyncStorage.getItem).not.toHaveBeenCalled();
    expect(mocks.asyncStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('runs the preflight before loading session state and sending the request', async () => {
    const order: string[] = [];
    mocks.ensureApiCompatibility.mockImplementation(async () => {
      order.push('compatibility');
      return {
        api_version: '1.0.0',
        current_contract_version: 'v1',
        compatible_contract_versions: ['v1'],
      };
    });
    mocks.secureStore.getItemAsync.mockImplementation(async () => {
      order.push('session');
      return null;
    });
    mocks.fetch.mockImplementation(async () => {
      order.push('request');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { apiRequest } = await import('./client');

    await expect(apiRequest('/api/ping')).resolves.toEqual({ ok: true });
    expect(order).toEqual(['compatibility', 'session', 'request']);
  });

  it('rejects an undocumented 2xx status before decoding the generated response', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    const { apiRequest } = await import('./client');
    const decode = vi.fn((value: unknown) => value);

    await expect(
      apiRequest('/api/generated-operation', {
        successStatuses: [200],
        decode,
      }),
    ).rejects.toMatchObject({
      status: 201,
      message: expect.stringContaining(
        'returned undocumented success status 201; expected 200',
      ),
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it('also gates native stream sources and authenticated media headers', async () => {
    mocks.ensureApiCompatibility.mockRejectedValue(
      new Error('Dieser Server wird von dieser Android-Version nicht unterstützt.'),
    );
    const { authenticatedHeadersFor, streamSource } = await import('./client');

    await expect(streamSource('12')).rejects.toThrow('Android-Version');
    await expect(authenticatedHeadersFor('https://music.example')).rejects.toThrow(
      'Android-Version',
    );

    expect(mocks.ensureApiCompatibility).toHaveBeenNthCalledWith(1, 'https://music.example');
    expect(mocks.ensureApiCompatibility).toHaveBeenNthCalledWith(2, 'https://music.example');
    expect(mocks.secureStore.getItemAsync).not.toHaveBeenCalled();
    expect(mocks.asyncStorage.getItem).not.toHaveBeenCalled();
  });
});
