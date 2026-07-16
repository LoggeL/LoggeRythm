import { describe, expect, it } from 'vitest';
import { strings } from '../../localization';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from './trackPresentationCopy';

describe('track presentation copy', () => {
  it('uses the shared localized metadata vocabulary', () => {
    expect(trackIdentityCopy.duration('3:05')).toBe(strings.search.trackDuration('3:05'));
    expect(trackIdentityCopy.popularity(75)).toBe(strings.search.trackPopularity(75));
    expect(trackStateIndicatorCopy.serverCached).toBe(
      strings.trackPresentation.serverCached,
    );
    expect(trackStateIndicatorCopy.downloaded).toBe(
      strings.trackPresentation.downloaded,
    );
    expect(trackStateIndicatorCopy.rollingDeviceCache(61.9)).toBe(
      strings.trackPresentation.rollingDeviceCache('1:01'),
    );
  });

  it('rejects impossible rolling-cache evidence before copy is produced', () => {
    expect(() => trackStateIndicatorCopy.rollingDeviceCache(0)).toThrow(
      'positive finite seconds',
    );
  });
});
