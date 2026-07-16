import { describe, expect, it } from 'vitest';
import {
  ServerCompatibilityCheckError,
  UnsupportedServerError,
} from '../api/compatibility';
import { presentError } from './presentationError';

describe('auth and shell error presentation', () => {
  it('replaces transport response bodies, request URLs, and native diagnostics', () => {
    const transport = Object.assign(
      new Error('POST https://prod.example.test/api/login returned private database detail'),
      {
        status: 500,
        body: '{"token":"private-token","email":"private@example.test"}',
      },
    );
    const native = new Error('SecureStore key lr.session.v1 failed: keystore alias private-alias');
    const fallback = 'The action could not be completed. Please retry.';

    expect(presentError(transport, fallback)).toEqual({ kind: 'generic', message: fallback });
    expect(presentError(native, fallback)).toEqual({ kind: 'generic', message: fallback });
    expect(JSON.stringify([presentError(transport, fallback), presentError(native, fallback)]))
      .not.toMatch(/private-token|private@example|prod\.example|lr\.session|keystore|private-alias/u);
  });

  it('preserves deliberately authored server compatibility recovery copy', () => {
    const unsupported = new UnsupportedServerError(['v999']);
    const retryable = new ServerCompatibilityCheckError('Compatibility check can be retried.');

    expect(presentError(unsupported, 'fallback')).toEqual({
      kind: 'compatibility',
      message: unsupported.message,
    });
    expect(presentError(retryable, 'fallback')).toEqual({
      kind: 'compatibility',
      message: retryable.message,
    });
  });
});
