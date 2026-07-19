import type { AppLocale } from '../localization';

export interface AndroidUpdateDownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface AndroidUpdateProgressPresentation {
  downloaded: string;
  total: string | null;
  percent: number | null;
  visibleText: string;
  accessibilityText: string;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const MAX_SAFE_BYTES = 300 * 1024 * 1024;

function finiteNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

export function decodeAndroidUpdateDownloadProgress(
  value: unknown,
): AndroidUpdateDownloadProgress {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Android update download progress must be an object');
  }
  const record = value as Record<string, unknown>;
  const downloadedBytes = finiteNonNegativeInteger(
    record.downloadedBytes,
    'Android update downloaded bytes',
  );
  const totalBytes = record.totalBytes === null || record.totalBytes === undefined
    ? null
    : finiteNonNegativeInteger(record.totalBytes, 'Android update total bytes');
  if (downloadedBytes > MAX_SAFE_BYTES || (totalBytes !== null && totalBytes > MAX_SAFE_BYTES)) {
    throw new Error('Android update download progress exceeds the APK safety limit');
  }
  if (totalBytes !== null && downloadedBytes > totalBytes) {
    throw new Error('Android update downloaded bytes exceeds its total');
  }
  return { downloadedBytes, totalBytes };
}

export function normalizeAndroidUpdateDownloadProgress(
  progress: AndroidUpdateDownloadProgress | null,
): AndroidUpdateDownloadProgress {
  if (progress === null) return { downloadedBytes: 0, totalBytes: null };
  const downloadedBytes = Math.max(0, Math.floor(progress.downloadedBytes));
  const rawTotal = progress.totalBytes;
  const totalBytes = rawTotal === null ? null : Math.max(0, Math.floor(rawTotal));
  return {
    downloadedBytes: totalBytes === null ? downloadedBytes : Math.min(downloadedBytes, totalBytes),
    totalBytes,
  };
}

export function formatAndroidUpdateBytes(bytes: number, locale: AppLocale): string {
  const safeBytes = Math.max(0, Math.floor(bytes));
  let value = safeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const maximumFractionDigits = unitIndex === 0 || value >= 100 ? 0 : 1;
  const formatted = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US', {
    maximumFractionDigits,
  }).format(value);
  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}

export function presentAndroidUpdateDownloadProgress(
  progress: AndroidUpdateDownloadProgress | null,
  locale: AppLocale,
): AndroidUpdateProgressPresentation {
  const normalized = normalizeAndroidUpdateDownloadProgress(progress);
  const downloaded = formatAndroidUpdateBytes(normalized.downloadedBytes, locale);
  if (normalized.totalBytes === null || normalized.totalBytes === 0) {
    return {
      downloaded,
      total: null,
      percent: null,
      visibleText: locale === 'de'
        ? `${downloaded} geladen`
        : `${downloaded} downloaded`,
      accessibilityText: locale === 'de'
        ? `Update-Download läuft, ${downloaded} geladen`
        : `Update download in progress, ${downloaded} downloaded`,
    };
  }
  const total = formatAndroidUpdateBytes(normalized.totalBytes, locale);
  const percent = Math.min(
    100,
    Math.max(0, Math.round((normalized.downloadedBytes / normalized.totalBytes) * 100)),
  );
  return {
    downloaded,
    total,
    percent,
    visibleText: locale === 'de'
      ? `${percent} % · ${downloaded} von ${total}`
      : `${percent}% · ${downloaded} of ${total}`,
    accessibilityText: locale === 'de'
      ? `Update-Download ${percent} Prozent, ${downloaded} von ${total}`
      : `Update download ${percent} percent, ${downloaded} of ${total}`,
  };
}
