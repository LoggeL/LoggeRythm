import { describe, expect, it, vi } from 'vitest';
import {
  ApiCompatibilityGate,
  ServerCompatibilityCheckError,
  UnsupportedServerError,
  decodeApiCompatibility,
} from './compatibility';
import { GENERATED_OPENAPI_CONTRACT_VERSION } from './generated/contract';

const origin = 'https://music.example';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function compatibility(
  current: string = GENERATED_OPENAPI_CONTRACT_VERSION,
  supported: string[] = [GENERATED_OPENAPI_CONTRACT_VERSION],
) {
  return {
    api_version: '2.4.0',
    current_contract_version: current,
    compatible_contract_versions: supported,
  };
}

describe('decodeApiCompatibility', () => {
  it('strictly decodes the generated compatibility wire model', () => {
    expect(decodeApiCompatibility(compatibility())).toEqual(compatibility());
  });

  it.each([
    [{ ...compatibility(), api_version: 'latest' }, 'semantic version'],
    [{ ...compatibility(), compatible_contract_versions: [] }, 'non-empty'],
    [
      { ...compatibility('v2', ['v1']) },
      'include the current contract',
    ],
    [
      { ...compatibility('v1', ['v1', 'v1']) },
      'must not contain duplicates',
    ],
  ])('rejects malformed server metadata %#', (value, message) => {
    expect(() => decodeApiCompatibility(value)).toThrow(message);
  });
});

describe('ApiCompatibilityGate', () => {
  it('accepts a newer server that explicitly retains the Android contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(compatibility('v2', ['v1', 'v2'])));
    const gate = new ApiCompatibilityGate(fetcher);

    await expect(gate.ensureCompatible(origin)).resolves.toMatchObject({
      current_contract_version: 'v2',
      compatible_contract_versions: ['v1', 'v2'],
    });
    await expect(gate.ensureCompatible(`${origin}/ignored`)).resolves.toMatchObject({
      current_contract_version: 'v2',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(`${origin}/api/version`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    });
  });

  it('fails a v1-only server once before the v2 playlist client can mutate', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(compatibility('v1', ['v1'])));
    const gate = new ApiCompatibilityGate(fetcher);

    const first = gate.ensureCompatible(origin);
    const second = gate.ensureCompatible(origin);
    const results = await Promise.allSettled([first, second]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(UnsupportedServerError);
        expect((result.reason as Error).message).toContain('Android-Version');
        expect((result.reason as Error).message).toContain('v1');
      }
    }
    await expect(gate.ensureCompatible(origin)).rejects.toBeInstanceOf(UnsupportedServerError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server without the endpoint', new Response('', { status: 404 })],
    ['a malformed success response', jsonResponse({ version: 'v1' })],
  ])('caches %s as definitively unsupported', async (_label, response) => {
    const fetcher = vi.fn().mockResolvedValue(response);
    const gate = new ApiCompatibilityGate(fetcher);

    await expect(gate.ensureCompatible(origin)).rejects.toBeInstanceOf(UnsupportedServerError);
    await expect(gate.ensureCompatible(origin)).rejects.toBeInstanceOf(UnsupportedServerError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not cache transient failures, allowing a deterministic retry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(compatibility()));
    const gate = new ApiCompatibilityGate(fetcher);

    await expect(gate.ensureCompatible(origin)).rejects.toBeInstanceOf(
      ServerCompatibilityCheckError,
    );
    await expect(gate.ensureCompatible(origin)).resolves.toMatchObject({
      current_contract_version: GENERATED_OPENAPI_CONTRACT_VERSION,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
