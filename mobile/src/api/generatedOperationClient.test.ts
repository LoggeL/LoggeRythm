import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { TrackWire } from './generated/contract';
import {
  GeneratedOperationRequestError,
  requestGeneratedOperation,
} from './generatedOperationClient';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./client', () => ({ apiRequest: mocks.apiRequest }));

describe('generated operation runtime client', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue([]);
  });

  it('binds an operation to its generated method, path, auth, and success status', async () => {
    const signal = new AbortController().signal;
    const decode = (value: unknown): TrackWire[] => value as TrackWire[];
    const result = requestGeneratedOperation('search_api_search_get', {
      request: { query: { q: 'AC/DC & Friends', type: 'album' } },
      decode,
      signal,
      timeoutMs: 900,
    });

    expectTypeOf(result).toEqualTypeOf<Promise<TrackWire[]>>();
    await result;
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/search?q=AC%2FDC%20%26%20Friends&type=album',
      {
        method: 'GET',
        decode,
        noAuth: true,
        signal,
        successStatuses: [200],
        timeoutMs: 900,
      },
    );
  });

  it('encodes generated path parameters and keeps required auth enabled', async () => {
    const decode = (value: unknown): undefined => value as undefined;
    await requestGeneratedOperation('remove_track_api_playlists__playlist_id__tracks__deezer_id__delete', {
      request: { path: { playlist_id: 7, deezer_id: '12/../admin?x=1' } },
      decode,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/playlists/7/tracks/12%2F..%2Fadmin%3Fx%3D1',
      {
        method: 'DELETE',
        decode,
        noAuth: false,
        signal: undefined,
        successStatuses: [204],
        timeoutMs: undefined,
      },
    );
  });

  it('omits explicit null query values instead of serializing a sentinel', async () => {
    const decode = (value: unknown) => value as never;
    await requestGeneratedOperation('lyrics_api_lyrics_get', {
      request: { query: { artist: 'AC/DC', title: 'One & Two', deezer_id: null } },
      decode,
    });

    expect(mocks.apiRequest.mock.calls[0]?.[0]).toBe(
      '/api/lyrics?artist=AC%2FDC&title=One%20%26%20Two',
    );
  });

  it('fails loudly for missing path values and explicit session-cookie injection', () => {
    expect(() =>
      requestGeneratedOperation('track_metadata_api_tracks__deezer_id__get', {
        request: { path: {} } as never,
        decode: (value) => value as never,
      }),
    ).toThrow('request.path.deezer_id is required');
    expect(() =>
      requestGeneratedOperation('public_playlists_api_playlists_public_get', {
        request: { cookie: { sf_session: 'foreign-session' } },
        decode: (value) => value as never,
      }),
    ).toThrow('request.cookie is forbidden');
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('rejects multipart bodies instead of silently JSON-encoding them', () => {
    expect(() =>
      requestGeneratedOperation('set_avatar_api_me_avatar_put', {
        request: { body: { file: new Blob(['avatar']) } },
        decode: (value) => value as never,
      }),
    ).toThrow(GeneratedOperationRequestError);
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
