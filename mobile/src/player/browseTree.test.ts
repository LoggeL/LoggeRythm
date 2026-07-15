import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import {
  BrowseTreePublicationCancelledError,
  publishBrowseTree,
  refreshBrowseTree,
} from './browseTree';

const mocks = vi.hoisted(() => ({
  setBrowseTree: vi.fn(),
  authenticatedHeadersFor: vi.fn(),
  getApiBase: vi.fn(),
  getLikes: vi.fn(),
  getPlaylists: vi.fn(),
  getPlaylist: vi.fn(),
}));

vi.mock('@rntp/player', () => ({
  default: { setBrowseTree: mocks.setBrowseTree },
}));
vi.mock('../api/client', () => ({
  authenticatedHeadersFor: mocks.authenticatedHeadersFor,
}));
vi.mock('../config', () => ({ getApiBase: mocks.getApiBase }));
vi.mock('../api/endpoints', () => ({
  getLikes: mocks.getLikes,
  getPlaylists: mocks.getPlaylists,
  getPlaylist: mocks.getPlaylist,
}));

const track: Track = {
  id: '3135556',
  title: 'Example',
  artist: 'Artist',
  artist_id: '42',
  artists: [{ id: '42', name: 'Artist' }],
  album: 'Album',
  album_id: '302127',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

function rejectWhenAborted(signal?: AbortSignal): Promise<never> {
  if (!signal) throw new Error('Test expected an AbortSignal');
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error('request was cancelled'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('request was cancelled')), {
      once: true,
    });
  });
}

describe('Android Auto browse-tree publication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiBase.mockResolvedValue('https://music.example.test');
    mocks.authenticatedHeadersFor.mockResolvedValue({ Cookie: 'sf_session=test' });
    mocks.getLikes.mockResolvedValue([]);
    mocks.getPlaylists.mockResolvedValue([]);
    mocks.getPlaylist.mockRejectedValue(new Error('getPlaylist should not be called'));
  });

  it('rejects a directly cancelled publication with an explicit cancellation type', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(publishBrowseTree(controller.signal)).rejects.toBeInstanceOf(
      BrowseTreePublicationCancelledError,
    );
    expect(mocks.setBrowseTree).not.toHaveBeenCalled();
  });

  it('treats a superseded refresh as expected while the replacement succeeds', async () => {
    mocks.getLikes
      .mockImplementationOnce((signal?: AbortSignal) => rejectWhenAborted(signal))
      .mockResolvedValueOnce([]);
    mocks.getPlaylists
      .mockImplementationOnce((signal?: AbortSignal) => rejectWhenAborted(signal))
      .mockResolvedValueOnce([]);

    const superseded = refreshBrowseTree();
    await vi.waitFor(() => expect(mocks.getLikes).toHaveBeenCalledTimes(1));
    const replacement = refreshBrowseTree();

    await expect(Promise.all([superseded, replacement])).resolves.toEqual([undefined, undefined]);
    expect(mocks.setBrowseTree).toHaveBeenCalledTimes(1);
  });

  it('still rejects real publication failures', async () => {
    mocks.getLikes.mockRejectedValueOnce(new Error('likes endpoint unavailable'));

    await expect(refreshBrowseTree()).rejects.toThrow('likes endpoint unavailable');
    expect(mocks.setBrowseTree).not.toHaveBeenCalled();
  });

  it('encodes stream path segments before publishing native browse items', async () => {
    mocks.getLikes.mockResolvedValueOnce([{ ...track, id: '12/../private?x=1#fragment' }]);

    await publishBrowseTree();

    const categories = mocks.setBrowseTree.mock.calls.at(-1)?.[0];
    expect(categories?.[0]?.items?.[0]?.url).toEqual({
      uri: 'https://music.example.test/api/tracks/12%2F..%2Fprivate%3Fx%3D1%23fragment/stream',
      headers: { Cookie: 'sf_session=test' },
    });
  });
});
