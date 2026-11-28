import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/error';
import type { AdminOverviewStorage, AdminUserUsageSummary } from '../../api/types';
import { de, en } from '../../localization/catalog';
import {
  adminInviteShareUrl,
  adminUserLabel,
  computeAdminOverviewStorageShares,
  computeAdminUserStorageShares,
  formatAdminBytes,
  formatAdminDuration,
  formatAdminErrorDetail,
  formatAdminRelativeTimestamp,
  sortAdminUsageUsers,
} from './adminFormat';

function makeUser(overrides: Partial<AdminUserUsageSummary>): AdminUserUsageSummary {
  return {
    id: 1,
    email: 'user@example.test',
    display_name: 'Alice',
    avatar_url: null,
    is_admin: false,
    is_approved: true,
    created_at: '2026-01-10T12:00:00Z',
    last_active_at: '2026-11-24T12:00:00Z',
    plays: 10,
    listening_sec: 1800,
    unique_tracks: 5,
    tracks_requested: 4,
    tracks_materialized: 2,
    materialized_bytes: 2048,
    storage: {
      exclusive_bytes: 1024,
      exclusive_tracks: 1,
      shared_bytes: 2048,
      shared_tracks: 2,
      accessed_bytes: 3072,
      accessed_tracks: 3,
      materialized_bytes: 1024,
      materialized_tracks: 1,
      pinned_bytes: 1024,
      pinned_tracks: 1,
      upload_bytes: 0,
    },
    library: {
      likes: 1,
      playlists: 1,
      public_playlists: 0,
      playlist_tracks: 3,
      follows: 1,
      party_tracks_added: 0,
      party_hosted: 0,
      import_jobs: 0,
      import_tracks_matched: 0,
    },
    online_devices: 0,
    is_playing_now: false,
    active_device_name: null,
    active_party_code: null,
    ...overrides,
  };
}

describe('adminFormat', () => {
  it('formats byte sizes strictly and fails loud on negative or non-integer inputs', () => {
    expect(formatAdminBytes(0)).toBe('0 B');
    expect(formatAdminBytes(512)).toBe('512 B');
    expect(formatAdminBytes(1536)).toBe('1.5 KB');
    expect(formatAdminBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(() => formatAdminBytes(-1)).toThrow(/non-negative safe integer/);
    expect(() => formatAdminBytes(1.5)).toThrow(/non-negative safe integer/);
  });

  it('formats listening durations in DE and EN and rejects invalid values', () => {
    expect(formatAdminDuration(0, en.admin.time)).toBe('0m');
    expect(formatAdminDuration(45, en.admin.time)).toBe('< 1m');
    expect(formatAdminDuration(300, en.admin.time)).toBe('5m');
    expect(formatAdminDuration(3900, de.admin.time)).toBe('1 Std. 5 Min.');
    expect(formatAdminDuration(7200, en.admin.time)).toBe('2h');
    expect(formatAdminDuration(50 * 3600, en.admin.time)).toBe('2d 2h');
    expect(() => formatAdminDuration(-5, en.admin.time)).toThrow(/non-negative safe integer/);
  });

  it('formats relative timestamps and rejects malformed ISO strings', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(formatAdminRelativeTimestamp(null, now, en.admin.time, 'en')).toBe('Never');
    expect(formatAdminRelativeTimestamp('2026-11-24T11:59:40Z', now, en.admin.time, 'en')).toBe(
      'just now',
    );
    expect(formatAdminRelativeTimestamp('2026-11-24T11:45:00Z', now, en.admin.time, 'en')).toBe(
      '15m ago',
    );
    expect(formatAdminRelativeTimestamp('2026-11-23T11:00:00Z', now, de.admin.time, 'de')).toBe(
      'gestern',
    );
    expect(() => formatAdminRelativeTimestamp('not-a-date', now, en.admin.time, 'en')).toThrow(
      /valid ISO-8601/,
    );
  });

  it('falls back to email for null or blank display_name and builds strict invite URLs', () => {
    expect(adminUserLabel({ display_name: null, email: 'a@example.test' })).toBe('a@example.test');
    expect(adminUserLabel({ display_name: '   ', email: 'b@example.test' })).toBe('b@example.test');
    expect(adminUserLabel({ display_name: '  Alice  ', email: 'a@example.test' })).toBe('Alice');

    expect(adminInviteShareUrl('https://music.example.test/', 'CODE 123')).toBe(
      'https://music.example.test/register?invite=CODE%20123',
    );
    expect(() => adminInviteShareUrl('   ', 'ABC')).toThrow(/server origin/);
    expect(() => adminInviteShareUrl('https://music.example.test', '  ')).toThrow(/invite code/);
  });

  it('computes overview and per-user storage percentages accurately', () => {
    const overviewStorage: AdminOverviewStorage = {
      cached_tracks: 4,
      total_audio_bytes: 1000,
      exclusive_audio_bytes: 250,
      exclusive_audio_tracks: 1,
      shared_audio_bytes: 500,
      shared_audio_tracks: 2,
      unattributed_audio_bytes: 250,
      unattributed_audio_tracks: 1,
      directly_attributed_tracks: 2,
      directly_attributed_bytes: 500,
      upload_bytes: 0,
      disk_total: 1000,
      disk_used: 400,
      disk_free: 600,
      retention_days: 30,
    };
    expect(computeAdminOverviewStorageShares(overviewStorage)).toEqual({
      exclusivePct: 25,
      sharedPct: 50,
      unattributedPct: 25,
      diskUsedPct: 40,
    });

    const user = makeUser({});
    expect(computeAdminUserStorageShares(user.storage, 4096)).toEqual({
      exclusivePct: 25,
      sharedPct: 50,
      accessedPct: 75,
    });
  });

  it('sorts users by plays, storage, requests, and activity (keeping null activity last)', () => {
    const alpha = makeUser({
      id: 1,
      display_name: 'Alpha',
      plays: 5,
      tracks_requested: 20,
      last_active_at: null,
      storage: {
        ...makeUser({}).storage,
        exclusive_bytes: 4000,
        shared_bytes: 0,
        accessed_bytes: 4000,
      },
    });
    const beta = makeUser({
      id: 2,
      display_name: 'Beta',
      plays: 30,
      tracks_requested: 2,
      last_active_at: '2026-11-24T11:00:00Z',
    });
    const gamma = makeUser({
      id: 3,
      display_name: null,
      email: 'gamma@example.test',
      plays: 15,
      tracks_requested: 8,
      last_active_at: '2026-11-24T12:00:00Z',
    });

    expect(sortAdminUsageUsers([alpha, beta, gamma], 'plays').map((u) => u.id)).toEqual([2, 3, 1]);
    expect(sortAdminUsageUsers([alpha, beta, gamma], 'exclusive_bytes').map((u) => u.id)).toEqual([
      1, 2, 3,
    ]);
    expect(sortAdminUsageUsers([alpha, beta, gamma], 'tracks_requested').map((u) => u.id)).toEqual([
      1, 3, 2,
    ]);
    expect(sortAdminUsageUsers([alpha, beta, gamma], 'last_active_at').map((u) => u.id)).toEqual([
      3, 2, 1,
    ]);
  });

  it('formats admin error details explicitly and fails loud on empty values', () => {
    expect(formatAdminErrorDetail(new ApiError(403, '{}', 'Forbidden'), en.admin)).toBe(
      en.admin.forbidden,
    );
    expect(formatAdminErrorDetail(new ApiError(500, '{}', 'Disk failed'), en.admin)).toBe(
      'Disk failed',
    );
    expect(formatAdminErrorDetail(new ApiError(502, '{}', ''), en.admin)).toBe('HTTP 502');
    expect(formatAdminErrorDetail(new Error('Invalid contract'), en.admin)).toBe('Invalid contract');
    expect(() => formatAdminErrorDetail(null, en.admin)).toThrow(/empty error value/);
  });
});
