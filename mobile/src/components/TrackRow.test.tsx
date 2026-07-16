import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import TrackRow from './TrackRow';

vi.mock('./track/StandardTrackRow', () => ({ default: 'StandardTrackRow' }));

const track: Track = {
  id: '7',
  title: 'Signal',
  artist: 'Artist',
  artist_id: '9',
  artists: [{ id: '9', name: 'Artist' }],
  album: 'Album',
  album_id: '11',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

describe('TrackRow compatibility wrapper', () => {
  it('delegates one exact occurrence and keeps Similar metadata policy compact', () => {
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const occurrence = {
      queueContext: { type: 'radio' as const, id: 'similar:seed' },
      originalContextOrder: 2,
    };
    const rendered = TrackRow({
      track,
      testID: 'similar-track-seed-7-2',
      occurrence,
      onPress,
      onLongPress,
      onOpenAlbum,
      onOpenArtist,
    });

    expect(rendered.type).toBe('StandardTrackRow');
    expect(rendered.props).toMatchObject({
      track,
      testID: 'similar-track-seed-7-2',
      occurrence,
      popularity: 'none',
      showAlbumLabel: false,
      showDuration: false,
      onPlay: onPress,
      onActions: onLongPress,
      onOpenAlbum,
      onOpenArtist,
    });
  });
});
