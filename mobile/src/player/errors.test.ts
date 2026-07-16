import { describe, expect, it } from 'vitest';
import { playerFailureMessage, UserFacingPlayerError } from './errors';

describe('player error presentation', () => {
  it('hides native and transport diagnostics behind action-specific copy', () => {
    const privateDetail = 'MediaCodec failed; cookie=private; host=db.internal.example';

    expect(playerFailureMessage('Playback failed', new Error(privateDetail)))
      .toBe('Playback failed');
    expect(playerFailureMessage('Playback failed', privateDetail))
      .toBe('Playback failed');
  });

  it('renders only explicitly marked, already-localized recovery detail', () => {
    expect(playerFailureMessage(
      'Playback stopped',
      new UserFacingPlayerError('The track remained unavailable after three attempts.'),
    )).toBe('Playback stopped: The track remained unavailable after three attempts.');
  });
});
