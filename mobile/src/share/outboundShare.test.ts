import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricsLine, Track } from '../api/types';
import {
  buildAlbumShareUrl,
  buildArtistShareUrl,
  buildPlaylistShareUrl,
  buildTrackShareUrl,
  formatLyricQuoteExcerpt,
  shareAlbum,
  shareArtist,
  shareLyricQuote,
  sharePlaylist,
  shareTrack,
} from './outboundShare';

const mocks = vi.hoisted(() => ({
  share: vi.fn(),
  apiBase: 'https://music.example.test',
}));

vi.mock('react-native', () => ({
  Share: { share: mocks.share },
}));
vi.mock('../config', () => ({
  getCurrentApiBase: () => mocks.apiBase,
}));

const track: Track = {
  id: '3135556',
  title: 'Harder, Better, Faster, Stronger',
  artist: 'Daft Punk',
  artist_id: '27',
  artists: [{ id: '27', name: 'Daft Punk' }],
  album: 'Discovery',
  album_id: '302127',
  cover: '',
  duration_sec: 224,
  preview_url: null,
  rank: 1,
  release_date: '2001-03-07',
};

describe('outboundShare', () => {
  beforeEach(() => {
    mocks.apiBase = 'https://music.example.test/';
    mocks.share.mockReset().mockResolvedValue({ action: 'sharedAction' });
  });

  it('builds canonical server URLs for tracks, albums, artists, and playlists', () => {
    expect(buildTrackShareUrl(track)).toBe('https://music.example.test/album/302127');
    expect(buildTrackShareUrl({ ...track, album_id: '' })).toBe(
      'https://music.example.test/search?q=Harder%2C%20Better%2C%20Faster%2C%20Stronger%20Daft%20Punk',
    );
    expect(buildAlbumShareUrl('302127')).toBe('https://music.example.test/album/302127');
    expect(buildArtistShareUrl('27')).toBe('https://music.example.test/artist/27');
    expect(buildPlaylistShareUrl(42)).toBe('https://music.example.test/playlist/42');
  });

  it('fails loudly on empty IDs or invalid playlist IDs', () => {
    expect(() => buildAlbumShareUrl('  ')).toThrow('album id is empty');
    expect(() => buildArtistShareUrl('')).toThrow('artist id is empty');
    expect(() => buildPlaylistShareUrl(0)).toThrow('invalid playlist id');
  });

  it('invokes Share.share with localized messages and canonical URLs', async () => {
    await shareTrack(track);
    expect(mocks.share).toHaveBeenLastCalledWith(expect.objectContaining({
      title: track.title,
      url: 'https://music.example.test/album/302127',
      message: expect.stringContaining('https://music.example.test/album/302127'),
    }));

    await shareAlbum('302127', 'Discovery', 'Daft Punk');
    expect(mocks.share).toHaveBeenLastCalledWith(expect.objectContaining({
      url: 'https://music.example.test/album/302127',
    }));

    await shareArtist('27', 'Daft Punk');
    expect(mocks.share).toHaveBeenLastCalledWith(expect.objectContaining({
      url: 'https://music.example.test/artist/27',
    }));

    await sharePlaylist(42, 'Night Drive');
    expect(mocks.share).toHaveBeenLastCalledWith(expect.objectContaining({
      url: 'https://music.example.test/playlist/42',
    }));
  });

  it('formats a lyric quote card with the tapped line and following context line', async () => {
    const lines: LyricsLine[] = [
      { t: 10, text: 'Work it harder' },
      { t: 14, text: 'Make it better' },
      { t: 18, text: '' },
    ];
    expect(formatLyricQuoteExcerpt(lines, 0)).toBe('Work it harder\nMake it better');
    expect(formatLyricQuoteExcerpt(lines, 1)).toBe('Make it better');
    expect(() => formatLyricQuoteExcerpt(lines, 2)).toThrow('instrumental');

    await shareLyricQuote(track, lines, 0);
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Work it harder\nMake it better'),
      url: 'https://music.example.test/album/302127',
    }));
  });
});
