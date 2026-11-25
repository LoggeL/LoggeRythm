import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import {
  findLikedTrack,
  getLikedTrackIndex,
  isSameRecording,
  isTrackLiked,
  normalizeIsrc,
  trackLikeIdentityKey,
} from './trackIdentity';
import { createTrackLikeMutationOptions, withTrackLiked } from './trackLikes';
import { queryKeys } from './queryKeys';
import type { MusicRepository } from './repositories';
import {
  collectSearchLibraryTracks,
  withoutLibraryTracks,
} from '../screens/searchLibraryModel';

vi.mock('./repositories', () => ({ musicRepository: {} }));

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: 'The Emptiness Machine',
    artist: 'Linkin Park',
    artist_id: '92',
    artists: [{ id: '92', name: 'Linkin Park' }],
    album: 'From Zero',
    album_id: '1002',
    cover: '',
    duration_sec: 190,
    preview_url: null,
    rank: 787002,
    release_date: '',
    isrc: 'USWB12403464',
    ...overrides,
  };
}

describe('trackIdentity and cross-release likes', () => {
  it('normalizes ISRCs and matches Single / EP / Album while keeping distinct recordings separate', () => {
    const album = makeTrack('3068802261', { album: 'From Zero', isrc: 'USWB12403464' });
    const single = makeTrack('2978105041', { album: 'The Emptiness Machine', isrc: 'us-wb1-24-03464' });
    const live = makeTrack('4175528112', { title: 'The Emptiness Machine (Live)', isrc: 'USWB12601056' });

    expect(normalizeIsrc('us-wb1-24-03464')).toBe('USWB12403464');
    expect(isSameRecording(album, single)).toBe(true);
    expect(isSameRecording(album, live)).toBe(false);

    const likes = [album];
    const index = getLikedTrackIndex(likes);
    expect(getLikedTrackIndex(likes)).toBe(index);
    expect(isTrackLiked(index, single)).toBe(true);
    expect(findLikedTrack(index, single)).toBe(album);
    expect(isTrackLiked(index, live)).toBe(false);
    expect(trackLikeIdentityKey(single)).toBe('isrc:USWB12403464');
    expect(trackLikeIdentityKey(album)).toBe('isrc:USWB12403464');
  });

  it('unlikes the stored album row when toggled from the single release and rolls back on failure', async () => {
    const album = makeTrack('3068802261', { album: 'From Zero' });
    const single = makeTrack('2978105041', { album: 'The Emptiness Machine' });

    expect(withTrackLiked([album], single, false)).toEqual([]);
    expect(withTrackLiked([album], single, true)).toEqual([single]);

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const key = queryKeys.library.likes('account-1');
    client.setQueryData<Track[]>(key, [album]);

    const unlikeTrack = vi.fn(async () => undefined);
    const mutation = client.getMutationCache().build(
      client,
      createTrackLikeMutationOptions({
        queryClient: client,
        scope: 'account-1',
        track: single,
        refreshAutoBrowse: vi.fn(async () => undefined),
        repository: {
          likeTrack: vi.fn(async () => undefined),
          unlikeTrack,
        } as Pick<MusicRepository, 'likeTrack' | 'unlikeTrack'>,
      }),
    );

    await mutation.execute(false);
    expect(unlikeTrack).toHaveBeenCalledExactlyOnceWith('3068802261');
    expect(client.getQueryData(key)).toEqual([]);
  });

  it('deduplicates search library tracks and hides remote cross-release duplicates by ISRC', () => {
    const album = makeTrack('3068802261', { album: 'From Zero' });
    const single = makeTrack('2978105041', { album: 'The Emptiness Machine' });
    const live = makeTrack('4175528112', { title: 'The Emptiness Machine (Live)', isrc: 'USWB12601056' });

    const collected = collectSearchLibraryTracks({
      likes: [album],
      playlists: [{ is_owner: true, tracks: [single, live] }],
      downloads: [],
    });
    expect(collected.map((t) => t.id)).toEqual(['3068802261', '4175528112']);

    const remote = withoutLibraryTracks([single, live], new Set([album.id]), [album]);
    expect(remote.map((t) => t.id)).toEqual(['4175528112']);
  });
});
