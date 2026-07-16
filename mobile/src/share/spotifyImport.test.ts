import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SHARED_TEXT_LENGTH,
  SpotifyImportInputError,
  dismissSpotifyImportRequest,
  getSpotifyImportRequest,
  getSpotifyImportRequestForScope,
  normalizeSpotifyImportInput,
  receiveSpotifySharedText,
  subscribeSpotifyImportRequests,
} from './spotifyImport';

afterEach(() => dismissSpotifyImportRequest());

describe('Spotify import input', () => {
  it.each(['track', 'album', 'playlist'] as const)(
    'accepts a pasted %s URL and strips tracking parameters',
    (kind) => {
      expect(
        normalizeSpotifyImportInput(
          `https://open.spotify.com/${kind}/AbC123xyz?si=tracking`,
        ),
      ).toBe(`https://open.spotify.com/${kind}/AbC123xyz`);
    },
  );

  it('extracts locale-prefixed links from Android share prose and accepts Spotify URIs', () => {
    expect(
      normalizeSpotifyImportInput(
        'Listen to this\nhttps://open.spotify.com/intl-de/track/ABC123?si=abc).',
      ),
    ).toBe('https://open.spotify.com/track/ABC123');
    expect(normalizeSpotifyImportInput('spotify:playlist:ABC123')).toBe(
      'https://open.spotify.com/playlist/ABC123',
    );
  });

  it.each([
    'http://open.spotify.com/track/ABC123',
    'https://open.spotify.com.evil.test/track/ABC123',
    'https://evil.test/?next=https://open.spotify.com.evil.test/track/ABC123',
    'https://open.spotify.com/show/ABC123',
    'https://open.spotify.com/intl-evil/track/ABC123',
    'https://open.spotify.com/track/ABC123/extra',
    'not a Spotify link',
  ])('rejects untrusted input %s', (input) => {
    expect(() => normalizeSpotifyImportInput(input)).toThrow(SpotifyImportInputError);
  });

  it('rejects oversized and ambiguous share payloads', () => {
    expect(() => normalizeSpotifyImportInput('x'.repeat(MAX_SHARED_TEXT_LENGTH + 1))).toThrow(
      expect.objectContaining({ code: 'too-long' }),
    );
    expect(() =>
      normalizeSpotifyImportInput(
        'https://open.spotify.com/track/ABC123 https://open.spotify.com/album/DEF456',
      ),
    ).toThrow(expect.objectContaining({ code: 'ambiguous' }));
  });
});

describe('shared Spotify import request store', () => {
  it('publishes valid and invalid requests and rejects stale dismissals', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSpotifyImportRequests(listener);
    const first = receiveSpotifySharedText(
      'https://open.spotify.com/track/ABC123',
      'origin::user:7',
    );
    expect(first).toMatchObject({
      accountScope: 'origin::user:7',
      link: 'https://open.spotify.com/track/ABC123',
      errorCode: null,
    });
    expect(getSpotifyImportRequestForScope('origin::user:7')).toEqual(first);
    expect(getSpotifyImportRequestForScope('origin::user:8')).toBeNull();
    const second = receiveSpotifySharedText(
      'https://example.test/track/ABC123',
      'origin::user:8',
    );
    expect(second).toMatchObject({
      accountScope: 'origin::user:8',
      link: null,
      errorCode: 'invalid',
    });
    dismissSpotifyImportRequest(first.id);
    expect(getSpotifyImportRequest()).toEqual(second);
    dismissSpotifyImportRequest(second.id);
    expect(getSpotifyImportRequest()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
