import { describe, expect, it } from 'vitest';
import { strings } from '../localization';
import { catalogStrings } from './catalogStrings';
import { catalogFailureMessage } from './catalogFeedback';

describe('catalog action feedback', () => {
  it('maps failures to localized action copy without exposing private diagnostics', () => {
    const privateDetail = 'HTTP 500 from db.internal.example: session=private';

    expect(catalogFailureMessage('playback', new Error(privateDetail)))
      .toBe(catalogStrings.common.playbackFailed);
    expect(catalogFailureMessage('home-playback', new Error(privateDetail)))
      .toBe(strings.home.playFailed);
    expect(catalogFailureMessage('artist-follow', new Error(privateDetail)))
      .toBe(catalogStrings.artist.followFailed);
    expect(catalogFailureMessage('radar-seen-state', new Error(privateDetail)))
      .toBe(strings.home.radarSeenStateFailed);

    for (const kind of ['playback', 'home-playback', 'artist-follow', 'radar-seen-state'] as const) {
      expect(catalogFailureMessage(kind, new Error(privateDetail))).not.toContain(privateDetail);
    }
  });
});
