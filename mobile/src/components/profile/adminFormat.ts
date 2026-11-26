import { ApiError } from '../../api/error';
import type {
  AdminOverviewStorage,
  AdminUsageRange,
  AdminUserStorage,
  AdminUserUsageSummary,
} from '../../api/types';
import { getActiveLocale, strings } from '../../localization';
import type { StringCatalog } from '../../localization/catalog';

export type AdminHubTab = 'usage' | 'users' | 'storage' | 'status';

export const ADMIN_HUB_TABS: readonly AdminHubTab[] = ['usage', 'users', 'storage', 'status'];

export const ADMIN_USAGE_RANGES: readonly AdminUsageRange[] = ['7d', '30d', 'all'];

export type AdminUsageSortKey =
  | 'plays'
  | 'exclusive_bytes'
  | 'tracks_requested'
  | 'last_active_at';

export const ADMIN_USAGE_SORT_KEYS: readonly AdminUsageSortKey[] = [
  'plays',
  'exclusive_bytes',
  'tracks_requested',
  'last_active_at',
];

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatAdminBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`Admin byte count must be a non-negative safe integer, got ${String(bytes)}`);
  }
  if (bytes === 0) return '0 B';
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  if (index >= BYTE_UNITS.length) {
    throw new Error(`Admin byte count exceeds TB formatting range: ${bytes}`);
  }
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${BYTE_UNITS[index]}`;
}

export function formatAdminDuration(
  seconds: number,
  copy: StringCatalog['admin']['time'] = strings.admin.time,
): string {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error(`Admin duration must be a non-negative safe integer, got ${String(seconds)}`);
  }
  if (seconds === 0) return copy.durationZero;
  if (seconds < 60) return copy.durationLessMinute;
  const totalMinutes = Math.floor(seconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours === 0) return copy.durationMinutes(minutes);
  if (totalHours < 48) {
    return minutes > 0 ? copy.durationHoursMinutes(totalHours, minutes) : copy.durationHours(totalHours);
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? copy.durationDaysHours(days, hours) : copy.durationDays(days);
}

function parseRequiredIso(iso: string, label: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`${label} must be a valid ISO-8601 timestamp, got "${iso}"`);
  }
  return ms;
}

export function formatAdminShortDate(iso: string, locale = getActiveLocale()): string {
  const ms = parseRequiredIso(iso, 'Admin date');
  const tag = locale === 'de' ? 'de-DE' : 'en-US';
  return new Intl.DateTimeFormat(tag, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ms));
}

export function formatAdminRelativeTimestamp(
  iso: string | null,
  nowMs: number = Date.now(),
  copy: StringCatalog['admin']['time'] = strings.admin.time,
  locale = getActiveLocale(),
): string {
  if (iso === null) return copy.never;
  const thenMs = parseRequiredIso(iso, 'Admin relative timestamp');
  const diffSec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (diffSec < 60) return copy.justNow;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return copy.minutesAgo(diffMin);
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return copy.hoursAgo(diffHours);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return copy.yesterday;
  if (diffDays < 7) return copy.daysAgo(diffDays);
  if (diffDays < 30) return copy.weeksAgo(Math.floor(diffDays / 7));
  return formatAdminShortDate(iso, locale);
}

export function adminUserLabel(user: { display_name: string | null; email: string }): string {
  const trimmed = user.display_name?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : user.email;
}

export function adminInviteShareUrl(apiBase: string, code: string): string {
  const trimmedBase = apiBase.trim().replace(/\/+$/u, '');
  if (trimmedBase.length === 0) {
    throw new Error('Admin invite URL requires a non-empty server origin');
  }
  const trimmedCode = code.trim();
  if (trimmedCode.length === 0) {
    throw new Error('Admin invite URL requires a non-empty invite code');
  }
  return `${trimmedBase}/register?invite=${encodeURIComponent(trimmedCode)}`;
}

function sharePct(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.min(100, (part / total) * 100);
}

export function computeAdminOverviewStorageShares(storage: AdminOverviewStorage): {
  exclusivePct: number;
  sharedPct: number;
  unattributedPct: number;
  diskUsedPct: number;
} {
  return {
    exclusivePct: sharePct(storage.exclusive_audio_bytes, storage.total_audio_bytes),
    sharedPct: sharePct(storage.shared_audio_bytes, storage.total_audio_bytes),
    unattributedPct: sharePct(storage.unattributed_audio_bytes, storage.total_audio_bytes),
    diskUsedPct: sharePct(storage.disk_used, storage.disk_total),
  };
}

export function computeAdminUserStorageShares(
  storage: AdminUserStorage,
  totalCacheBytes: number,
): {
  exclusivePct: number;
  sharedPct: number;
  accessedPct: number;
} {
  return {
    exclusivePct: sharePct(storage.exclusive_bytes, totalCacheBytes),
    sharedPct: sharePct(storage.shared_bytes, totalCacheBytes),
    accessedPct: sharePct(storage.accessed_bytes, totalCacheBytes),
  };
}

function sortMetric(user: AdminUserUsageSummary, key: AdminUsageSortKey): number {
  switch (key) {
    case 'plays':
      return user.plays;
    case 'exclusive_bytes':
      return user.storage.exclusive_bytes;
    case 'tracks_requested':
      return user.tracks_requested;
    case 'last_active_at':
      return user.last_active_at === null ? -1 : parseRequiredIso(user.last_active_at, 'last_active_at');
  }
}

export function sortAdminUsageUsers(
  users: readonly AdminUserUsageSummary[],
  sortKey: AdminUsageSortKey,
): AdminUserUsageSummary[] {
  return [...users].sort((left, right) => {
    if (sortKey === 'last_active_at') {
      if (left.last_active_at === null && right.last_active_at !== null) return 1;
      if (left.last_active_at !== null && right.last_active_at === null) return -1;
    }
    const diff = sortMetric(right, sortKey) - sortMetric(left, sortKey);
    if (diff !== 0) return diff;
    return adminUserLabel(left).localeCompare(adminUserLabel(right));
  });
}

/**
 * Extract explicit, user-readable admin error context without ever swallowing
 * 403s, contract errors, or backend error details.
 */
export function formatAdminErrorDetail(
  error: unknown,
  copy: Pick<StringCatalog['admin'], 'forbidden'> = strings.admin,
): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return copy.forbidden;
    const message = error.message.trim();
    return message.length > 0 ? message : `HTTP ${error.status}`;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) return message;
  }
  const text = String(error ?? '').trim();
  if (text.length === 0) {
    throw new Error('Admin error handler received an empty error value');
  }
  return text;
}
