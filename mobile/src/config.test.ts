import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE,
  activateApiBase,
  getCurrentApiBase,
  getApiBase,
  normalizeApiBase,
  normalizeSignInApiBase,
  PRODUCTION_API_BASE,
  resetApiBase,
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

  it('accepts a canonical custom HTTPS origin and drives the runtime base', async () => {
    expect(normalizeSignInApiBase(' HTTPS://Music.Example.Test:8443/ ')).toBe(
      'https://music.example.test:8443',
    );
    expect(activateApiBase('https://music.example.test:8443')).toBe(
      'https://music.example.test:8443',
    );
    expect(getCurrentApiBase()).toBe('https://music.example.test:8443');
    await expect(getApiBase()).resolves.toBe('https://music.example.test:8443');
    expect(resetApiBase()).toBe(PRODUCTION_API_BASE);
  });

  it.each([
    'http://music.example.test',
    'http://10.0.2.2:8000',
    'https:music.example.test',
    'https:///music.example.test',
    'https://music.example.test/path',
    'https://music.example.test?query=1',
    'https://music.example.test/#fragment',
    'https://user:pass@music.example.test',
    'https://music.example.test:0',
    'https://music.example.test\\@evil.test',
    `https://${'a'.repeat(513)}.test`,
  ])('rejects an unsafe sign-in destination: %s', (value) => {
    expect(() => normalizeSignInApiBase(value)).toThrow(
      'canonical HTTPS origin required',
    );
  });
});
