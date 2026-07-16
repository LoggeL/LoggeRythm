import { useSyncExternalStore } from 'react';

export type PlayerNoticeKind = 'bookkeeping';

export type PlayerNotice = Readonly<{
  id: number;
  kind: PlayerNoticeKind;
  dedupeKey: string;
  title: string;
  message: string;
}>;

export const PLAYER_NOTICE_TTL_MS = 8_000;

let currentNotice: PlayerNotice | null = null;
let nextNoticeId = 1;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function cancelExpiry(): void {
  if (expiryTimer === null) return;
  clearTimeout(expiryTimer);
  expiryTimer = null;
}

function expireNotice(id: number): void {
  if (currentNotice?.id !== id) return;
  currentNotice = null;
  expiryTimer = null;
  emit();
}

/**
 * Publish a short-lived, user-safe status that cannot alter player state.
 * Repeated failures with the same key are ignored until the bounded notice
 * expires, so a noisy bookkeeping endpoint cannot keep a banner alive forever.
 */
export function reportPlayerNotice(
  kind: PlayerNoticeKind,
  dedupeKey: string,
  title: string,
  message: string,
): void {
  if (currentNotice?.kind === kind && currentNotice.dedupeKey === dedupeKey) return;

  cancelExpiry();
  const notice: PlayerNotice = {
    id: nextNoticeId,
    kind,
    dedupeKey,
    title,
    message,
  };
  nextNoticeId += 1;
  currentNotice = notice;
  // Do not log backend/native diagnostics here. The supplied copy is localized
  // and intentionally generic; playback errors retain their separate channel.
  console.warn(`[LoggeRythm] non-fatal ${kind} status`);
  expiryTimer = setTimeout(() => expireNotice(notice.id), PLAYER_NOTICE_TTL_MS);
  emit();
}

export function clearPlayerNotice(expectedId?: number): void {
  if (currentNotice === null) return;
  if (expectedId !== undefined && currentNotice.id !== expectedId) return;
  cancelExpiry();
  currentNotice = null;
  emit();
}

export function getPlayerNotice(): PlayerNotice | null {
  return currentNotice;
}

export function subscribePlayerNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlayerNotice(): PlayerNotice | null {
  return useSyncExternalStore(
    subscribePlayerNotice,
    getPlayerNotice,
    getPlayerNotice,
  );
}
