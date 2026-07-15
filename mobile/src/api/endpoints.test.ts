import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from './types';
import {
  getAlbum,
  getPlaylist,
  getRadio,
  getTrack,
  likeTrack,
  likesContains,
  register,
  unlikeTrack,
} from './endpoints';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./client', () => ({ apiRequest: mocks.apiRequest }));

describe('API endpoint URL construction', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue(undefined);
  });

  it.each([
    ['track metadata', () => getTrack('12/../admin?x=1#fragment'), '/api/tracks/12%2F..%2Fadmin%3Fx%3D1%23fragment'],
    ['album metadata', () => getAlbum('12/../admin?x=1#fragment'), '/api/albums/12%2F..%2Fadmin%3Fx%3D1%23fragment'],
    ['radio', () => getRadio('12/../admin?x=1#fragment'), '/api/radio/12%2F..%2Fadmin%3Fx%3D1%23fragment'],
    ['unlike', () => unlikeTrack('12/../admin?x=1#fragment'), '/api/me/likes/12%2F..%2Fadmin%3Fx%3D1%23fragment'],
  ])('encodes the dynamic path segment for %s', (_label, request, expectedPath) => {
    request();
    expect(mocks.apiRequest).toHaveBeenCalledWith(expectedPath, expect.any(Object));
  });

  it('encodes the track id used by the like endpoint', () => {
    const track = { id: '12/../admin?x=1#fragment' } as Track;
    likeTrack(track);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/me/likes/12%2F..%2Fadmin%3Fx%3D1%23fragment',
      { method: 'PUT', body: track },
    );
  });

  it('encodes playlist ids through the same path-segment boundary', () => {
    getPlaylist(42);
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/playlists/42', expect.any(Object));
  });

  it('encodes the complete comma-separated likes query value', () => {
    likesContains(['12', '34']);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/me/likes/contains?ids=12%2C34',
      expect.any(Object),
    );
  });
});

describe('registration endpoint', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it('posts the exact backend body and captures the new session like login', async () => {
    const request = {
      email: 'person@example.test',
      password: 'correct horse battery staple',
      display_name: 'Person',
      invite: 'invite-code',
    };
    const user = {
      id: 7,
      email: request.email,
      display_name: request.display_name,
      is_admin: false,
      is_approved: true,
      avatar_url: null,
    };
    mocks.apiRequest.mockResolvedValueOnce(user);

    await expect(register(request)).resolves.toBe(user);
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/auth/register', {
      method: 'POST',
      body: request,
      captureSession: true,
      noAuth: true,
      decode: expect.any(Function),
    });
  });

  it('includes explicit nulls for optional backend fields', () => {
    const request = {
      email: 'person@example.test',
      password: 'password',
      display_name: null,
      invite: null,
    };

    register(request);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ body: request }),
    );
  });
});
