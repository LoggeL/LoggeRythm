import { describe, expect, it } from 'vitest';
import { libraryStrings } from './libraryStrings';
import { playlistFailureMessage, playlistNameValidation } from './playlistFeedback';

describe('playlist action feedback', () => {
  it('never exposes backend or native error details', () => {
    const privateDetail = 'HTTP 500: database host db.internal.example failed';

    expect(playlistFailureMessage('playback', new Error(privateDetail)))
      .toBe(libraryStrings.common.playbackFailed);
    expect(playlistFailureMessage('mutation', new Error(privateDetail)))
      .toBe(libraryStrings.playlist.mutationFailed);
    expect(playlistFailureMessage('track-action', privateDetail))
      .toBe(libraryStrings.playlist.actionFailed);
    expect(playlistFailureMessage('create', privateDetail))
      .toBe(libraryStrings.library.createFailed);

    for (const kind of ['playback', 'mutation', 'track-action', 'create'] as const) {
      expect(playlistFailureMessage(kind, new Error(privateDetail))).not.toContain(privateDetail);
    }
  });

  it('keeps locally derived edit validation specific', () => {
    expect(playlistNameValidation('   ')).toBe(libraryStrings.playlist.nameRequired);
    expect(playlistNameValidation(' Road trip ')).toBeNull();
  });
});
