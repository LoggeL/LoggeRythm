import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import type { OfflinePlaylistBrowseSummary } from '../offline/browse';
import { LibraryDownloadsList, LibraryLikedTrackRow } from './LibraryScreen';
import { libraryStrings } from './libraryStrings';

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('../components/track/StandardTrackRow', () => ({
  default: 'StandardTrackRow',
}));
vi.mock('../components/library/LibraryRecentRow', () => ({
  LibraryRecentRow: 'LibraryRecentRow',
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../components/trackActions', () => ({ showTrackActions: vi.fn() }));
vi.mock('../data', () => ({
  musicCacheScope: vi.fn(),
  musicMutations: { createPlaylist: vi.fn() },
  musicQueries: {},
  queryKeys: { playlists: { owned: vi.fn(), public: vi.fn() } },
  refreshLibraryAutoBrowse: vi.fn(),
}));
vi.mock('../player/browseTree', () => ({ refreshBrowseTree: vi.fn() }));
vi.mock('../player/controller', () => ({ playTracks: vi.fn() }));
vi.mock('../player/notices', () => ({ reportPlayerNotice: vi.fn() }));
vi.mock('../offline/hooks', () => ({ useOfflineDownloads: vi.fn() }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function propsOf(node: React.ReactNode): ElementProps {
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    throw new Error('Expected a React element');
  }
  return (node as React.ReactElement<ElementProps>).props;
}

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestID(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`Missing ${testID}`);
  return found;
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textContent((node as React.ReactElement<ElementProps>).props.children);
}

const track: Track = {
  id: '42',
  title: 'Liked duplicate',
  artist: 'Primary',
  artist_id: '7',
  artists: [
    { id: '7', name: 'Primary' },
    { id: '8', name: 'Guest' },
  ],
  album: 'Parity',
  album_id: '9',
  cover: 'cover.jpg',
  duration_sec: 185,
  preview_url: null,
  rank: 0,
  release_date: '',
};

describe('LibraryLikedTrackRow', () => {
  it('delegates the full track and exact liked-account occurrence to the shared row', () => {
    const onPlay = vi.fn();
    const onActions = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const row = LibraryLikedTrackRow({
      track,
      index: 3,
      accountId: 17,
      onPlay,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });

    expect(propsOf(row)).toMatchObject({
      track,
      testID: 'library-liked-track-42-3',
      occurrence: {
        queueContext: { type: 'liked', id: '17' },
        originalContextOrder: 3,
      },
      position: 4,
      onPlay,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });
    expect(propsOf(row).showDuration).toBeUndefined();
    expect(propsOf(row).showAlbumLabel).toBeUndefined();
  });
});

const offlinePlaylists: OfflinePlaylistBrowseSummary[] = [
  {
    id: 12,
    name: 'Complete local',
    description: null,
    cover_url: null,
    is_public: false,
    is_owner: true,
    owner_name: 'Owner',
    track_count: 2,
    offline: {
      status: 'complete',
      downloadedOccurrences: 2,
      failedOccurrences: 0,
      pendingOccurrences: 0,
      totalOccurrences: 2,
      sizeBytes: 4_000,
      failures: [],
      failedTrackIds: [],
      pendingTrackIds: [],
      completedAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:00:00.000Z',
    },
  },
  {
    id: 13,
    name: 'Partial local',
    description: null,
    cover_url: '/covers/13.jpg',
    is_public: false,
    is_owner: true,
    owner_name: 'Owner',
    track_count: 3,
    offline: {
      status: 'partial',
      downloadedOccurrences: 2,
      failedOccurrences: 1,
      pendingOccurrences: 0,
      totalOccurrences: 3,
      sizeBytes: 4_000,
      failures: [{
        trackId: '41',
        code: 'network-timeout',
        retryable: true,
        failedAt: '2026-07-16T12:00:00.000Z',
      }],
      failedTrackIds: ['41'],
      pendingTrackIds: [],
      completedAt: null,
      updatedAt: '2026-07-16T13:00:00.000Z',
    },
  },
];

describe('LibraryDownloadsList', () => {
  it('lists complete and partial snapshots and navigates through playlist routes', () => {
    const onOpenPlaylist = vi.fn();
    const tree = LibraryDownloadsList({
      availability: 'ready',
      playlists: offlinePlaylists,
      apiBase: 'https://music.test',
      onOpenPlaylist,
    });

    const complete = byTestID(tree, 'library-download-12');
    const partial = byTestID(tree, 'library-download-13');
    expect(complete.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: libraryStrings.library.openDownload('Complete local', 2, 2),
    });
    expect(textContent(byTestID(tree, 'library-download-12-status')))
      .toBe(libraryStrings.library.downloadedPlaylist(2, 2));
    expect(textContent(byTestID(tree, 'library-download-13-status')))
      .toBe(libraryStrings.library.partialDownload(2, 3, 1));

    (partial.props.onPress as () => void)();
    expect(onOpenPlaylist).toHaveBeenCalledWith({
      kind: 'playlist',
      playlistId: 13,
      name: 'Partial local',
    });
  });

  it('distinguishes hydration, empty, and unavailable storage accessibly', () => {
    const props = {
      playlists: [],
      apiBase: 'https://music.test',
      onOpenPlaylist: vi.fn(),
    };
    const loading = LibraryDownloadsList({ ...props, availability: 'loading' });
    const empty = LibraryDownloadsList({ ...props, availability: 'ready' });
    const unavailable = LibraryDownloadsList({ ...props, availability: 'unavailable' });

    expect(byTestID(loading, 'library-downloads-loading').props.accessibilityRole)
      .toBe('progressbar');
    expect(textContent(byTestID(empty, 'library-downloads-empty')))
      .toContain(libraryStrings.library.noDownloads);
    expect(byTestID(unavailable, 'library-downloads-unavailable').props)
      .toMatchObject({ accessibilityRole: 'alert', accessibilityLiveRegion: 'polite' });
  });
});
