import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/error';
import type {
  AdminUsageOverviewResponse,
  AdminUserUsageDetailResponse,
  AdminUserUsageSummary,
} from '../../api/types';
import { strings } from '../../localization';
import { byTestId, elements, queryByTestId, textContent } from '../../test/render';
import { AdminUsageSectionView } from './AdminUsageSection';
import { AdminUserUsageDetailView } from './AdminUserUsageSheet';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('../../data', () => ({
  musicQueries: {
    adminUsage: vi.fn(),
    adminUserUsage: vi.fn(),
  },
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Artwork: 'Artwork',
  BottomSheet: 'BottomSheet',
  Skeleton: 'Skeleton',
}));

const alice: AdminUserUsageSummary = {
  id: 1,
  email: 'alice@example.test',
  display_name: 'Alice',
  avatar_url: null,
  is_admin: true,
  is_approved: true,
  created_at: '2026-01-10T10:00:00Z',
  last_active_at: '2026-11-24T12:00:00Z',
  plays: 42,
  listening_sec: 7200,
  unique_tracks: 18,
  tracks_requested: 10,
  tracks_materialized: 6,
  materialized_bytes: 30 * 1024 * 1024,
  storage: {
    exclusive_bytes: 20 * 1024 * 1024,
    exclusive_tracks: 4,
    shared_bytes: 10 * 1024 * 1024,
    shared_tracks: 2,
    accessed_bytes: 30 * 1024 * 1024,
    accessed_tracks: 6,
    materialized_bytes: 20 * 1024 * 1024,
    materialized_tracks: 4,
    pinned_bytes: 10 * 1024 * 1024,
    pinned_tracks: 2,
    upload_bytes: 1024,
  },
  library: {
    likes: 12,
    playlists: 3,
    public_playlists: 1,
    playlist_tracks: 25,
    follows: 4,
    party_tracks_added: 5,
    party_hosted: 1,
    import_jobs: 2,
    import_tracks_matched: 40,
  },
  online_devices: 1,
  is_playing_now: true,
  active_device_name: 'Pixel 9',
  active_party_code: null,
};

const bobNullName: AdminUserUsageSummary = {
  ...alice,
  id: 2,
  email: 'bob@example.test',
  display_name: null,
  is_admin: false,
  is_approved: false,
  created_at: null,
  last_active_at: null,
  plays: 0,
  listening_sec: 0,
  unique_tracks: 0,
  tracks_requested: 0,
  tracks_materialized: 0,
  materialized_bytes: 0,
  storage: {
    exclusive_bytes: 0,
    exclusive_tracks: 0,
    shared_bytes: 0,
    shared_tracks: 0,
    accessed_bytes: 0,
    accessed_tracks: 0,
    materialized_bytes: 0,
    materialized_tracks: 0,
    pinned_bytes: 0,
    pinned_tracks: 0,
    upload_bytes: 0,
  },
  online_devices: 0,
  is_playing_now: false,
  active_device_name: null,
};

const overview: AdminUsageOverviewResponse = {
  range: 'all',
  generated_at: '2026-11-24T12:05:00Z',
  request_tracking_since: '2026-11-01T00:00:00Z',
  overview: {
    total_users: 2,
    approved_users: 1,
    pending_users: 1,
    active_users: 1,
    total_plays: 42,
    total_listening_sec: 7200,
    unique_tracks_played: 18,
    tracks_requested: 10,
    tracks_materialized: 6,
    materialized_bytes: 30 * 1024 * 1024,
    online_connect_devices: 1,
    online_connect_users: 1,
    active_parties: 1,
    storage: {
      cached_tracks: 6,
      total_audio_bytes: 30 * 1024 * 1024,
      exclusive_audio_bytes: 20 * 1024 * 1024,
      exclusive_audio_tracks: 4,
      shared_audio_bytes: 10 * 1024 * 1024,
      shared_audio_tracks: 2,
      unattributed_audio_bytes: 0,
      unattributed_audio_tracks: 0,
      directly_attributed_tracks: 4,
      directly_attributed_bytes: 20 * 1024 * 1024,
      upload_bytes: 1024,
      disk_total: 100 * 1024 * 1024,
      disk_used: 40 * 1024 * 1024,
      disk_free: 60 * 1024 * 1024,
      retention_days: 30,
    },
  },
  users: [alice, bobNullName],
};

const detailPayload: AdminUserUsageDetailResponse = {
  range: '30d',
  generated_at: '2026-11-24T12:05:00Z',
  request_tracking_since: '2026-11-01T00:00:00Z',
  user: bobNullName,
  storage_breakdown: {
    ...bobNullName.storage,
    total_cache_bytes: 30 * 1024 * 1024,
  },
  requests_by_source: [
    { source: 'stream', requests: 3, materialized: 1, materialized_bytes: 4096 },
  ],
  active_devices: [
    {
      device_id: 'dev-1',
      name: 'Pixel 9',
      device_type: 'mobile',
      is_active: true,
      party_code: 'JAM99',
      connected_at: '2026-11-24T11:00:00Z',
      last_seen_at: '2026-11-24T12:00:00Z',
    },
  ],
  top_tracks: [{ key: '101', label: 'Track One', sublabel: 'Artist A', cover: '', count: 5 }],
  top_artists: [{ key: '', label: 'Unknown Artist ID', sublabel: '', cover: '', count: 5 }],
  recent_plays: [
    {
      id: '101',
      title: 'Track One',
      artist: 'Artist A',
      album: 'Album A',
      cover: '',
      duration_sec: 210,
      played_at: '2026-11-24T11:55:00Z',
    },
  ],
  recent_requests: [
    {
      deezer_id: '101',
      title: 'Track One',
      artist: 'Artist A',
      cover: '',
      source: 'stream',
      materialized: true,
      size_bytes: 4096,
      requested_at: '2026-11-24T11:54:00Z',
      is_currently_stored: true,
    },
  ],
};

describe('AdminUsageSectionView & AdminUserUsageDetailView', () => {
  it('renders loading skeleton before initial response', () => {
    const tree = AdminUsageSectionView({
      apiBase: 'https://music.example.test',
      range: 'all',
      sortKey: 'plays',
      data: undefined,
      pending: true,
      fetching: true,
      fetchStatus: 'fetching',
      stale: false,
      error: null,
      onRangeChange: vi.fn(),
      onSortChange: vi.fn(),
      onRefresh: vi.fn(),
      onSelectUser: vi.fn(),
    });
    expect(byTestId(tree, 'profile-admin-usage-loading')).toBeDefined();
    expect(elements(tree).some((el) => el.type === 'Skeleton')).toBe(true);
    expect(queryByTestId(tree, 'profile-admin-usage-content')).toBeNull();
  });

  it('fails loudly on 403 / API errors with retry button', () => {
    const onRefresh = vi.fn();
    const tree = AdminUsageSectionView({
      apiBase: 'https://music.example.test',
      range: '7d',
      sortKey: 'plays',
      data: undefined,
      pending: false,
      fetching: false,
      fetchStatus: 'idle',
      stale: false,
      error: new ApiError(403, '{}', 'Forbidden'),
      onRangeChange: vi.fn(),
      onSortChange: vi.fn(),
      onRefresh,
      onSelectUser: vi.fn(),
    });
    const err = byTestId(tree, 'profile-admin-usage-error');
    expect(err.props.accessibilityRole).toBe('alert');
    expect(textContent(err).join(' ')).toContain(strings.admin.forbidden);
    (byTestId(tree, 'profile-admin-usage-retry').props.onPress as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('renders KPIs, timeframe/sort controls, live Connect badge, null display_name fallback, and selects users', () => {
    const onRangeChange = vi.fn();
    const onSortChange = vi.fn();
    const onSelectUser = vi.fn();
    const tree = AdminUsageSectionView({
      apiBase: 'https://music.example.test',
      range: 'all',
      sortKey: 'plays',
      data: overview,
      pending: false,
      fetching: false,
      fetchStatus: 'idle',
      stale: false,
      error: null,
      onRangeChange,
      onSortChange,
      onRefresh: vi.fn(),
      onSelectUser,
    });

    expect(byTestId(tree, 'profile-admin-kpi-users')).toBeDefined();
    expect(byTestId(tree, 'profile-admin-kpi-plays')).toBeDefined();
    expect(byTestId(tree, 'profile-admin-kpi-requests')).toBeDefined();
    expect(byTestId(tree, 'profile-admin-kpi-cache')).toBeDefined();
    expect(byTestId(tree, 'profile-admin-usage-user-live-1')).toBeDefined();
    expect(queryByTestId(tree, 'profile-admin-usage-user-live-2')).toBeNull();
    expect(textContent(byTestId(tree, 'profile-admin-usage-user-2'))).toContain('bob@example.test');

    (byTestId(tree, 'profile-admin-usage-range-7d').props.onPress as () => void)();
    expect(onRangeChange).toHaveBeenCalledWith('7d');

    (byTestId(tree, 'profile-admin-usage-sort-exclusive_bytes').props.onPress as () => void)();
    expect(onSortChange).toHaveBeenCalledWith('exclusive_bytes');

    (byTestId(tree, 'profile-admin-usage-user-1').props.onPress as () => void)();
    expect(onSelectUser).toHaveBeenCalledWith(alice);
  });

  it('renders drill-down detail, omits member-since when created_at is null, and handles empty artist key', () => {
    const tree = AdminUserUsageDetailView({
      summary: bobNullName,
      range: '30d',
      data: detailPayload,
      pending: false,
      fetching: false,
      fetchStatus: 'idle',
      stale: false,
      error: null,
      onRefresh: vi.fn(),
    });

    expect(byTestId(tree, 'profile-admin-detail-content')).toBeDefined();
    expect(queryByTestId(tree, 'profile-admin-detail-member-since')).toBeNull();
    expect(byTestId(tree, 'profile-admin-detail-top-tracks-0')).toBeDefined();
    expect(byTestId(tree, 'profile-admin-detail-top-artists-0')).toBeDefined();
    expect(textContent(byTestId(tree, 'profile-admin-detail-devices')).join(' ')).toContain(
      'Pixel 9',
    );
  });

  it('renders drill-down error loudly with retry', () => {
    const onRefresh = vi.fn();
    const tree = AdminUserUsageDetailView({
      summary: alice,
      range: 'all',
      data: undefined,
      pending: false,
      fetching: false,
      fetchStatus: 'idle',
      stale: false,
      error: new Error('Usage detail crashed'),
      onRefresh,
    });
    expect(textContent(byTestId(tree, 'profile-admin-detail-error')).join(' ')).toContain(
      'Usage detail crashed',
    );
    (byTestId(tree, 'profile-admin-detail-retry').props.onPress as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
