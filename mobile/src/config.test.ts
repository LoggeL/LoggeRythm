import { describe, expect, it } from 'vitest';
import { DEFAULT_API_BASE, getApiBase, normalizeApiBase, PRODUCTION_API_BASE } from './config';

describe('mobile server configuration', () => {
  it('bakes the canonical production origin by default', async () => {
    expect(PRODUCTION_API_BASE).toBe('https://loggerythm.logge.top');
    expect(DEFAULT_API_BASE).toBe(PRODUCTION_API_BASE);
    await expect(getApiBase()).resolves.toBe(PRODUCTION_API_BASE);
  });

  it('normalizes safe HTTP origins and rejects credentials', () => {
    expect(normalizeApiBase('https://loggerythm.logge.top///')).toBe(
      'https://loggerythm.logge.top',
    );
    expect(() => normalizeApiBase('https://user:pass@example.com')).toThrow(
      'embedded credentials',
    );
  });
});
