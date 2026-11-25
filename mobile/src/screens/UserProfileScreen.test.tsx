import { describe, expect, it, vi } from 'vitest';
import type { PublicProfile } from '../api/types';
import { byTestId } from '../test/render';
import { UserProfileView } from './UserProfileScreen';

vi.mock('react-native', () => ({
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../components/catalog/CatalogCards', () => ({
  CatalogArtistCard: 'CatalogArtistCard',
  HorizontalCatalogRail: 'HorizontalCatalogRail',
}));
vi.mock('../components/library/LibraryRows', () => ({
  LibraryPlaylistRow: 'LibraryPlaylistRow',
}));
vi.mock('../components/ui', () => ({
  AppText: 'AppText',
  Artwork: 'Artwork',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  SectionHeader: 'SectionHeader',
  TrackRowSkeleton: 'TrackRowSkeleton',
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../config', () => ({ getCurrentApiBase: () => 'https://music.example.test' }));
vi.mock('../data', () => ({ musicQueries: { publicProfile: vi.fn() } }));
vi.mock('../hooks/useBottomInset', () => ({ useBottomInset: () => 96 }));
vi.mock('../tv', () => ({ TvFocusScope: 'TvFocusScope', useTvEnvironment: () => ({ isTv: false }) }));

const profile: PublicProfile = {
  id: 42,
  display_name: 'Jule',
  avatar_url: '/api/users/42/avatar',
  playlists: [
    {
      id: 11,
      name: 'Indie Summer',
      description: 'Warm tracks',
      cover_url: null,
      is_public: true,
      track_count: 14,
      owner_id: 42,
      owner_name: 'Jule',
      owner_avatar_url: null,
      is_collaborative: false,
      is_owner: false,
      is_collaborator: false,
      can_edit_tracks: false,
      collaborator_count: 0,
    },
  ],
  top_artists: [{ id: '27', name: 'Daft Punk', picture: '' }],
};

describe('UserProfileView', () => {
  it('renders public profile hero, top artists rail, and public playlists', () => {
    const onOpenPlaylist = vi.fn();
    const onOpenArtist = vi.fn();
    const tree = UserProfileView({
      profile,
      apiBase: 'https://music.example.test',
      isPending: false,
      isError: false,
      refreshing: false,
      bottomInset: 96,
      onRefresh: vi.fn(),
      onOpenPlaylist,
      onOpenArtist,
    });

    expect(byTestId(tree, 'user-profile-name').props.children).toBe('Jule');
    expect(byTestId(tree, 'user-profile-top-artists')).toBeDefined();
    expect(byTestId(tree, 'user-profile-playlists')).toBeDefined();
  });

  it('renders empty playlists notice and retryable error state', () => {
    const onRefresh = vi.fn();
    const errTree = UserProfileView({
      profile: undefined,
      apiBase: 'https://music.example.test',
      isPending: false,
      isError: true,
      refreshing: false,
      bottomInset: 96,
      onRefresh,
      onOpenPlaylist: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    expect(byTestId(errTree, 'user-profile-error-state')).toBeDefined();
    (byTestId(errTree, 'user-profile-error-state').props.onRetry as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();

    const emptyTree = UserProfileView({
      profile: { ...profile, playlists: [], top_artists: [] },
      apiBase: 'https://music.example.test',
      isPending: false,
      isError: false,
      refreshing: false,
      bottomInset: 96,
      onRefresh: vi.fn(),
      onOpenPlaylist: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    expect(byTestId(emptyTree, 'user-profile-no-playlists')).toBeDefined();
  });
});
