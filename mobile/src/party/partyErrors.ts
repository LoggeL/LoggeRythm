import { ApiError } from '../api/client';
import { strings } from '../localization';

/** One readable cause for a failed party request. */
export function partyErrorDetail(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (error.status === 0) return strings.party.serverUnreachable;
  if (error.status >= 200 && error.status < 300) return error.message;
  try {
    const parsed = JSON.parse(error.body) as { detail?: unknown };
    if (typeof parsed.detail === 'string' && parsed.detail.trim() !== '') return parsed.detail;
  } catch {
    // Not JSON: report the status without a server reason.
  }
  return strings.party.serverNoDetail(error.status);
}
