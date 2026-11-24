import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { catalogStrings } from '../../screens/catalogStrings';
import { layout } from '../../theme';
import { Artwork } from '../ui';
import {
  CatalogAlbumCard,
  CatalogArtistCard,
  CatalogHeroArtwork,
  CatalogPlaylistCard,
  CatalogTrackCard,
  CatalogTrackRow,
} from './CatalogCards';

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
  },
  Text: 'Text',
  View: 'View',
}));

// PressableScale owns animation state (a hook), so it cannot be called outside a render.
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
}));
vi.mock('../track/StandardTrackRow', () => ({ default: 'StandardTrackRow' }));
vi.mock('../track/TrackShelfCard', () => ({ default: 'TrackShelfCard' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

const track: Track = {
  id: '12',
  title: 'Midnight Signal',
  artist: 'LoggeRythm',
  artist_id: '7',
  artists: [{ id: '7', name: 'LoggeRythm' }],
  album: 'Parity',
  album_id: '9',
  cover: '',
  duration_sec: 185,
  preview_url: null,
  rank: 750_000,
  release_date: '',
};

describe('CatalogTrackRow', () => {
  const occurrence = {
    queueContext: { type: 'artist' as const, id: '7' },
    originalContextOrder: 0,
  };

  it('delegates identity, duration, state, and exact occurrence to the shared row', () => {
    const metadata = '12.345 Wiedergaben · 6.789 Hörer:innen (Last.fm)';
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const row = CatalogTrackRow({
      track,
      index: 0,
      testID: 'artist-track-12-0',
      occurrence,
      metadata,
      popularity: 'artist-popular',
      plays: { plays: 12_345, listeners: 6_789 },
      onPress: vi.fn(),
      onLongPress: vi.fn(),
      onOpenAlbum,
      onOpenArtist,
    });

    const shared = elements(row).find((element) => element.type === 'StandardTrackRow');
    expect(shared?.props).toMatchObject({
      track,
      testID: 'artist-track-12-0',
      occurrence,
      position: 1,
      popularity: 'artist-popular',
      plays: { plays: 12_345, listeners: 6_789 },
      onOpenAlbum,
      onOpenArtist,
      // The fact is rendered by the shared row as `${testID}-metadata`
      // (covered in trackCompositions.test), inside its highlight.
      caption: metadata,
    });
  });

  it('does not manufacture a metadata line when no count is available', () => {
    const row = CatalogTrackRow({
      track,
      index: 0,
      testID: 'artist-track-12-0',
      occurrence,
      onPress: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    const shared = elements(row).find((element) => element.type === 'StandardTrackRow');
    expect(shared?.props.caption).toBeUndefined();
    expect(shared?.props.captionAccessibilityLabel).toBeUndefined();
  });

  it('hands the spoken form of an abbreviated fact to the shared row', () => {
    const row = CatalogTrackRow({
      track,
      index: 0,
      testID: 'release-radar-track-12-0',
      occurrence,
      metadata: 'Neu · heute · Artist 3× gehört',
      metadataAccessibilityLabel: 'Neu, heute, Im Radar, weil du Artist 3-mal gehört hast',
      onPress: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    const shared = elements(row).find((element) => element.type === 'StandardTrackRow');
    expect(shared?.props).toMatchObject({
      caption: 'Neu · heute · Artist 3× gehört',
      captionAccessibilityLabel: 'Neu, heute, Im Radar, weil du Artist 3-mal gehört hast',
    });
  });

  it('lets a page that is the album itself drop the redundant album label', () => {
    const base = {
      track,
      index: 0,
      testID: 'album-track-12-0',
      occurrence,
      onPress: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    };
    const shared = (row: React.ReactNode) =>
      elements(row).find((element) => element.type === 'StandardTrackRow');

    expect(shared(CatalogTrackRow({ ...base, showAlbumLabel: false }))?.props.showAlbumLabel)
      .toBe(false);
    // Unset keeps the shared row's own default instead of forcing a value.
    expect(shared(CatalogTrackRow(base))?.props.showAlbumLabel).toBeUndefined();
  });
});

describe('catalog cards', () => {
  it('opens an album from one labelled, springy artwork tile', () => {
    const onPress = vi.fn();
    const card = CatalogAlbumCard({
      album: { id: '9', title: 'Parity', artist: 'LoggeRythm', cover: '', release_date: '' },
      testID: 'artist-album-9',
      onPress,
    });

    expect(card.type).toBe('PressableScale');
    expect(card.props).toMatchObject({
      testID: 'artist-album-9',
      accessibilityRole: 'button',
      accessibilityLabel: catalogStrings.common.openAlbum('Parity', 'LoggeRythm'),
    });
    (card.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
    expect(elements(card).some((element) => element.type === Artwork)).toBe(true);
  });

  it('renders artists round and labels the card with the artist name', () => {
    const card = CatalogArtistCard({
      artist: { id: '7', name: 'LoggeRythm', picture: '' },
      testID: 'artist-related-7',
      onPress: vi.fn(),
    });

    expect(card.props.accessibilityLabel).toBe(catalogStrings.common.openArtist('LoggeRythm'));
    const artwork = elements(card).find((element) => element.type === Artwork);
    expect(artwork?.props).toMatchObject({ shape: 'round', size: layout.artwork.card });
  });

  it('keeps the hero cover on the artwork scale, round for artists', () => {
    expect(CatalogHeroArtwork({ uri: 'https://example.test/a.jpg' }).props).toMatchObject({
      size: layout.artwork.hero,
      shape: 'square',
    });
    expect(CatalogHeroArtwork({ uri: '', round: true, compact: true }).props).toMatchObject({
      size: layout.artwork.lg,
      shape: 'round',
    });
  });
});

describe('CatalogTrackCard', () => {
  it('delegates cards to the shared non-overlapping shelf composition', () => {
    const occurrence = {
      queueContext: { type: 'chart' as const, id: 'discover' },
      originalContextOrder: 3,
    };
    const onPlay = vi.fn();
    const onActions = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const card = CatalogTrackCard({
      track,
      testID: 'discover-chart-12-3',
      occurrence,
      rank: 4,
      onPress: onPlay,
      onLongPress: onActions,
      onOpenAlbum,
      onOpenArtist,
    });

    expect(card.type).toBe('TrackShelfCard');
    expect(card.props).toMatchObject({
      track,
      testID: 'discover-chart-12-3',
      occurrence,
      rank: 4,
      onPlay,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });
  });
});

describe('CatalogPlaylistCard', () => {
  const playlist = {
    id: 7,
    name: 'Roadtrip',
    description: null,
    cover_url: null,
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
  const texts = (card: React.ReactElement) =>
    elements(card)
      .map((element) => element.props.children)
      .filter((children): children is string => typeof children === 'string');

  it('names the owner of a community playlist', () => {
    const card = CatalogPlaylistCard({
      playlist: {
        ...playlist,
        is_public: true,
        is_owner: false,
        can_edit_tracks: false,
        owner_id: 2,
        owner_name: 'Sam',
      },
      coverUrl: null,
      testID: 'discover-playlist-7',
      onPress: vi.fn(),
    });

    expect(texts(card)).toEqual([
      'Roadtrip',
      catalogStrings.discover.byOwner('Sam'),
      catalogStrings.common.tracks(12),
    ]);
    expect(card.props.accessibilityLabel).toBe(
      catalogStrings.discover.openPlaylist('Roadtrip', 'Sam', 12),
    );
  });

  it('marks the signed-in user’s own playlist instead of leaving the owner line out', () => {
    const onPress = vi.fn();
    const card = CatalogPlaylistCard({
      playlist,
      own: true,
      coverUrl: null,
      testID: 'discover-playlist-7',
      onPress,
    });

    expect(texts(card)).toEqual([
      'Roadtrip',
      catalogStrings.discover.ownPlaylist,
      catalogStrings.common.tracks(12),
    ]);
    expect(card.props.accessibilityLabel).toBe(
      catalogStrings.discover.openOwnPlaylist('Roadtrip', 12),
    );
    expect(card.props.onPress).toBe(onPress);
  });

  it('shows the collaborative badge and shared-by owner label for collaborative playlists', () => {
    const card = CatalogPlaylistCard({
      playlist: {
        ...playlist,
        is_owner: false,
        is_collaborator: true,
        is_collaborative: true,
        can_edit_tracks: true,
        owner_id: 2,
        owner_name: 'Sam',
        collaborator_count: 2,
      },
      own: false,
      coverUrl: null,
      testID: 'discover-playlist-7',
      onPress: vi.fn(),
    });

    expect(texts(card)).toEqual([
      'Roadtrip',
      catalogStrings.discover.sharedBy('Sam'),
      catalogStrings.common.tracks(12),
      catalogStrings.discover.collaborativeBadge,
    ]);
  });
});
