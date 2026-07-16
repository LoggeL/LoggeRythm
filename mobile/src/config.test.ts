import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE,
  getApiBase,
  normalizeApiBase,
  PRODUCTION_API_BASE,
  selectApiBase,
} from './config';

describe('mobile server configuration', () => {
  it('bakes the canonical production origin by default', async () => {
    expect(PRODUCTION_API_BASE).toBe('https://loggerythm.logge.top');
    expect(DEFAULT_API_BASE).toBe(PRODUCTION_API_BASE);
    await expect(getApiBase()).resolves.toBe(PRODUCTION_API_BASE);
  });

  it('treats a blank build-time override as unset', () => {
    expect(selectApiBase(undefined)).toBe(PRODUCTION_API_BASE);
    expect(selectApiBase('   ')).toBe(PRODUCTION_API_BASE);
    expect(selectApiBase('http://10.0.2.2:8000')).toBe('http://10.0.2.2:8000');
  });

  it('refuses a non-production origin for a production bundle', () => {
    expect(selectApiBase(PRODUCTION_API_BASE, true)).toBe(PRODUCTION_API_BASE);
    expect(() => selectApiBase('https://staging.example.test', true)).toThrow(
      'Production builds must use the canonical LoggeRythm API origin',
    );
  });

  it('normalizes root trailing slashes to the canonical origin', () => {
    expect(normalizeApiBase(' https://LOGGERYTHM.logge.top/ ')).toBe(
      'https://loggerythm.logge.top',
    );
    expect(normalizeApiBase('http://10.0.2.2:8000/')).toBe('http://10.0.2.2:8000');
  });

  it('rejects credentials, non-root paths, queries, and fragments', () => {
    expect(() => normalizeApiBase('https://user:pass@example.com')).toThrow(
      'embedded credentials',
    );
    expect(() => normalizeApiBase('https://example.com/api')).toThrow(
      'path must be the origin root',
    );
    expect(() => normalizeApiBase('https://example.com/api/')).toThrow(
      'path must be the origin root',
    );
    expect(() => normalizeApiBase('https://example.com///')).toThrow(
      'path must be the origin root',
    );
    expect(() => normalizeApiBase('https://example.com/?server=other')).toThrow(
      'query strings and fragments are not allowed',
    );
    expect(() => normalizeApiBase('https://example.com/#debug')).toThrow(
      'query strings and fragments are not allowed',
    );
  });
});
