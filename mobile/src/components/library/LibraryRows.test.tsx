import { describe, expect, it, vi } from 'vitest';
import type { ArtistSummary, PlaylistSummary } from '../../api/types';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { metrics } from '../../theme';
import {
  LibraryFollowingRow,
  LibraryLikedCollectionCard,
  LibraryPlaylistRow,
} from './LibraryRows';

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
}));

const playlist: PlaylistSummary = {
  id: 7,
  name: 'Night Drive with an extraordinarily long playlist name',
  description: '  Late hours  ',
  cover_url: '/covers/7.jpg',
  is_public: false,
  track_count: 12,
  owner_id: 1,
  owner_name: null,
  owner_avatar_url: null,
  is_collaborative: false,
  is_owner: true,
  is_collaborator: false,
  can_edit_tracks: true,
  collaborator_count: 0,
};

describe('LibraryPlaylistRow', () => {
  it('opens the playlist route and resolves the cover against the API origin', () => {
    const onOpenPlaylist = vi.fn();
    const row = LibraryPlaylistRow({ playlist, apiBase: 'https://music.test', onOpenPlaylist });
    const button = byTestId(row, 'library-playlist-7');

    expect(button.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: libraryStrings.library.openPlaylist(playlist.name, 12),
    });
    expect(flatStyle(button.props.style).minHeight)
      .toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
    expect(byType(row, 'Image')[0].props.source).toEqual({ uri: 'https://music.test/covers/7.jpg' });
    (button.props.onPress as () => void)();
    expect(onOpenPlaylist).toHaveBeenCalledExactlyOnceWith({
      kind: 'playlist',
      playlistId: 7,
      name: playlist.name,
    });
  });

  it('truncates the title and leads the subtitle with the track count', () => {
    const row = LibraryPlaylistRow({ playlist, apiBase: 'https://music.test', onOpenPlaylist: vi.fn() });
    const [title, subtitle] = byType(row, 'Text');

    expect(title.props.numberOfLines).toBe(1);
    expect(subtitle.props.numberOfLines).toBe(1);
    expect(textContent(row)).toEqual([
      playlist.name,
      `${libraryStrings.common.tracks(12)} · Late hours`,
    ]);

    const plain = LibraryPlaylistRow({
      playlist: { ...playlist, description: null, cover_url: null },
      apiBase: 'https://music.test',
      onOpenPlaylist: vi.fn(),
    });
    expect(textContent(plain)[1]).toBe(libraryStrings.common.tracks(12));
    expect(byType(plain, 'Image')).toHaveLength(0);
    expect(queryByTestId(plain, 'library-playlist-7-collab')).toBeNull();
  });

  it('shows the collaborative pill and shared-by metadata for shared playlists', () => {
    const shared: PlaylistSummary = {
      ...playlist,
      id: 9,
      name: 'WG-Küche',
      description: 'Evening',
      owner_id: 2,
      owner_name: 'Jule',
      is_owner: false,
      is_collaborator: true,
      is_collaborative: true,
      can_edit_tracks: true,
      collaborator_count: 2,
    };
    const row = LibraryPlaylistRow({
      playlist: shared,
      apiBase: 'https://music.test',
      onOpenPlaylist: vi.fn(),
    });

    expect(byTestId(row, 'library-playlist-9-collab')).toBeDefined();
    expect(byTestId(row, 'library-playlist-9').props.accessibilityLabel).toBe(
      libraryStrings.library.openSharedPlaylist('WG-Küche', 'Jule', 12),
    );
    expect(textContent(row)).toEqual([
      'WG-Küche',
      `${libraryStrings.library.sharedBy('Jule')} · ${libraryStrings.common.tracks(12)} · Evening`,
      libraryStrings.library.collaborative,
    ]);
  });
});

describe('LibraryLikedCollectionCard', () => {
  it('keeps the liked-collection entry contract', () => {
    const onOpenPlaylist = vi.fn();
    const card = LibraryLikedCollectionCard({ count: 3, onOpenPlaylist });
    const button = byTestId(card, 'library-open-liked');

    expect(button.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: libraryStrings.library.openLiked(3),
    });
    expect(textContent(card)).toEqual([
      libraryStrings.library.likedTracks,
      libraryStrings.common.tracks(3),
    ]);
    (button.props.onPress as () => void)();
    expect(onOpenPlaylist).toHaveBeenCalledExactlyOnceWith({
      kind: 'liked',
      name: libraryStrings.library.likedTracks,
    });
  });
});

describe('LibraryFollowingRow', () => {
  it('opens the artist route from a round avatar row', () => {
    const artist: ArtistSummary = { id: 'artist-1', name: 'Artist', picture: '' };
    const onOpenArtist = vi.fn();
    const row = LibraryFollowingRow({ artist, onOpenArtist });
    const button = byTestId(row, 'library-following-artist-1');

    expect(button.props.accessibilityLabel).toBe(libraryStrings.library.openArtist('Artist'));
    // An empty picture renders the placeholder only, never a broken image request.
    expect(byType(row, 'Image')).toHaveLength(0);
    (button.props.onPress as () => void)();
    expect(onOpenArtist).toHaveBeenCalledOnce();
    expect(onOpenArtist.mock.calls[0][0]).toMatchObject({ artistId: 'artist-1' });
  });
});
