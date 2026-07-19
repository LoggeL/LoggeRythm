import { describe, expect, it } from 'vitest';
import {
  decodeAndroidUpdateDownloadProgress,
  formatAndroidUpdateBytes,
  normalizeAndroidUpdateDownloadProgress,
  presentAndroidUpdateDownloadProgress,
} from './downloadProgress';

describe('Android update download progress', () => {
  it('decodes native determinate and indeterminate progress strictly', () => {
    expect(decodeAndroidUpdateDownloadProgress({ downloadedBytes: 1024, totalBytes: 4096 }))
      .toEqual({ downloadedBytes: 1024, totalBytes: 4096 });
    expect(decodeAndroidUpdateDownloadProgress({ downloadedBytes: 1024, totalBytes: null }))
      .toEqual({ downloadedBytes: 1024, totalBytes: null });
    expect(() => decodeAndroidUpdateDownloadProgress({ downloadedBytes: 5, totalBytes: 4 }))
      .toThrow('exceeds its total');
    expect(() => decodeAndroidUpdateDownloadProgress({ downloadedBytes: 1.5, totalBytes: null }))
      .toThrow('downloaded bytes');
  });

  it('normalizes progress before UI and accessibility rendering', () => {
    expect(normalizeAndroidUpdateDownloadProgress({ downloadedBytes: 99.9, totalBytes: 10.1 }))
      .toEqual({ downloadedBytes: 10, totalBytes: 10 });
    expect(normalizeAndroidUpdateDownloadProgress({ downloadedBytes: 1536.8, totalBytes: null }))
      .toEqual({ downloadedBytes: 1536, totalBytes: null });
  });

  it('formats localized determinate progress with percentage and byte totals', () => {
    const english = presentAndroidUpdateDownloadProgress({
      downloadedBytes: 5 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
    }, 'en');
    expect(english).toMatchObject({
      downloaded: '5 MB',
      total: '10 MB',
      percent: 50,
      visibleText: '50% · 5 MB of 10 MB',
      accessibilityText: 'Update download 50 percent, 5 MB of 10 MB',
    });

    const german = presentAndroidUpdateDownloadProgress({
      downloadedBytes: 1.5 * 1024 * 1024,
      totalBytes: 3 * 1024 * 1024,
    }, 'de');
    expect(german).toMatchObject({
      downloaded: '1,5 MB',
      total: '3 MB',
      percent: 50,
      visibleText: '50 % · 1,5 MB von 3 MB',
      accessibilityText: 'Update-Download 50 Prozent, 1,5 MB von 3 MB',
    });
  });

  it('uses indeterminate copy when Content-Length is unknown', () => {
    expect(presentAndroidUpdateDownloadProgress({ downloadedBytes: 1536, totalBytes: null }, 'en'))
      .toMatchObject({
        total: null,
        percent: null,
        visibleText: '1.5 KB downloaded',
      });
    expect(presentAndroidUpdateDownloadProgress({ downloadedBytes: 1536, totalBytes: null }, 'de'))
      .toMatchObject({
        total: null,
        percent: null,
        visibleText: '1,5 KB geladen',
      });
  });

  it('keeps byte formatting locale-aware without inventing totals', () => {
    expect(formatAndroidUpdateBytes(999, 'en')).toBe('999 B');
    expect(formatAndroidUpdateBytes(1234, 'en')).toBe('1.2 KB');
    expect(formatAndroidUpdateBytes(1234, 'de')).toBe('1,2 KB');
  });
});
