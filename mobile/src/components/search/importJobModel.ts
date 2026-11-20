import { ApiError } from '../../api/client';
import type { ImportJobStatus } from '../../api/types';
import { strings } from '../../localization';

export function importJobTitle(job: Pick<ImportJobStatus, 'name' | 'url'>): string {
  return job.name || job.url;
}

/** One-line state of an import for the list and the progress panel. */
export function importJobSummary(job: ImportJobStatus): string {
  switch (job.status) {
    case 'queued':
      return strings.search.importJobQueued;
    case 'running':
      return job.total === 0
        ? strings.search.importJobReading
        : strings.search.importJobProgress(job.processed, job.total, job.matched);
    case 'done':
      return strings.search.importJobDone(job.matched, job.total);
    case 'failed':
      return strings.search.importJobFailed(job.error ?? strings.search.importJobNoServerError);
  }
}

/** Whole percent of matched-against-Deezer tracks; 0 while Spotify is still read. */
export function importJobProgressPercent(job: Pick<ImportJobStatus, 'processed' | 'total'>): number {
  if (job.total === 0) return 0;
  return Math.min(100, Math.round((job.processed / job.total) * 100));
}

/**
 * The reason an import request failed, for the user. The server's own
 * `detail` (e.g. "Es laufen bereits 3 Importe…", a bad link) is shown as is;
 * transport failures get a fixed message so request URLs never reach the UI.
 */
export function importJobErrorDetail(error: unknown): string {
  if (!(error instanceof ApiError)) {
    // Not a transport/HTTP failure (e.g. a response that broke the decoder):
    // show its own message instead of hiding the cause.
    return error instanceof Error ? error.message : String(error);
  }
  if (error.status === 0) return strings.search.importServerUnreachable;
  // A success status that still failed means the response broke the contract.
  if (error.status >= 200 && error.status < 300) return error.message;
  if (error.body.length === 0) return strings.search.importServerNoDetail;
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.body);
  } catch {
    return strings.search.importServerNoDetail;
  }
  const detail = typeof parsed === 'object' && parsed !== null
    ? (parsed as { detail?: unknown }).detail
    : undefined;
  return typeof detail === 'string' && detail.trim().length > 0
    ? detail
    : strings.search.importServerNoDetail;
}
