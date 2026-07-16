import type { MediaItem } from '@rntp/player';
import { describe, expect, it } from 'vitest';
import type { Track } from '../api/types';
import {
  mediaItemToTrack,
  mediaItemUsesExplicitDownload,
  trackToMediaItem,
} from './mediaItem';

const track: Track = {
  id: '123',
  title: 'Native boundary',
  artist: 'Bridge Artist',
  artist_id: '456',
  artists: [{ id: '456', name: 'Bridge Artist' }],
  album: 'Bridge Album',
  album_id: '789',
  cover: 'https://images.test/cover.jpg',
  duration_sec: 180,
  preview_url: null,
  rank: 1,
  release_date: '2026-07-15',
};

describe('mediaItemToTrack', () => {
  it('round-trips ordinary JavaScript Track metadata', () => {
    const item = trackToMediaItem(track, 'https://api.test', { Cookie: 'session=test' });

    expect(mediaItemToTrack(item)).toEqual(track);
    expect(mediaItemUsesExplicitDownload(item)).toBe(false);
  });

  it('builds a header-free local source only from an explicit file URI', () => {
    const item = trackToMediaItem(track, 'https://api.test', { Cookie: 'session=test' }, {
      explicitDownloadUri: 'file:///data/user/0/top.logge.loggerythm/no_backup/123.mp3',
    });

    expect(item.url).toEqual({
      uri: 'file:///data/user/0/top.logge.loggerythm/no_backup/123.mp3',
    });
    expect(item.extras?.explicitDownload).toBe(true);
    expect(mediaItemUsesExplicitDownload(item)).toBe(true);
    expect(JSON.stringify(item.url)).not.toContain('Cookie');
  });

  it('rejects a remote URI presented as a verified explicit download', () => {
    expect(() => trackToMediaItem(track, 'https://api.test', {}, {
      explicitDownloadUri: 'https://attacker.test/123.mp3',
    })).toThrow('must use an app-private file URI');
  });

  it('restores the Android RNTP array-like artists representation', () => {
    const item = {
      mediaId: 'queue:1:123',
      url: 'https://api.test/api/tracks/123/stream',
      extras: {
        track: {
          ...track,
          artists: {
            0: { id: '456', name: 'Bridge Artist' },
            __rntp_array_length: 1,
          },
        },
      },
    } as unknown as MediaItem;

    const restored = mediaItemToTrack(item);

    expect(restored?.artists).toEqual([{ id: '456', name: 'Bridge Artist' }]);
    expect(Array.isArray(restored?.artists)).toBe(true);
  });

  it('rejects incomplete native array metadata instead of sending malformed JSON', () => {
    const item = {
      mediaId: 'queue:1:123',
      url: 'https://api.test/api/tracks/123/stream',
      extras: { track: { ...track, artists: { __rntp_array_length: 1 } } },
    } as unknown as MediaItem;

    expect(() => mediaItemToTrack(item)).toThrow('contains invalid Track metadata');
  });
});
