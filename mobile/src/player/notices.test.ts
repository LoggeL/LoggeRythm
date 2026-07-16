import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYER_NOTICE_TTL_MS,
  clearPlayerNotice,
  getPlayerNotice,
  reportPlayerNotice,
  subscribePlayerNotice,
} from './notices';

describe('non-fatal player notices', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPlayerNotice();
  });

  afterEach(() => {
    clearPlayerNotice();
    vi.useRealTimers();
  });

  it('deduplicates one failure key without extending its bounded lifetime', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlayerNotice(listener);

    reportPlayerNotice('bookkeeping', 'transition:one', 'Safe title', 'Safe message');
    const first = getPlayerNotice();
    reportPlayerNotice('bookkeeping', 'transition:one', 'Changed title', 'Changed message');

    expect(getPlayerNotice()).toEqual(first);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PLAYER_NOTICE_TTL_MS);
    expect(getPlayerNotice()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('replaces a different notice and an old timer cannot clear the replacement', () => {
    reportPlayerNotice('bookkeeping', 'transition:one', 'First', 'First message');
    const firstId = getPlayerNotice()?.id;
    vi.advanceTimersByTime(PLAYER_NOTICE_TTL_MS - 1);

    reportPlayerNotice('bookkeeping', 'transition:two', 'Second', 'Second message');
    const second = getPlayerNotice();
    expect(second?.id).not.toBe(firstId);
    vi.advanceTimersByTime(1);
    expect(getPlayerNotice()).toEqual(second);
    vi.advanceTimersByTime(PLAYER_NOTICE_TTL_MS - 1);
    expect(getPlayerNotice()).toBeNull();
  });

  it('guards explicit dismissal against clearing a newer notice', () => {
    reportPlayerNotice('bookkeeping', 'transition:one', 'First', 'First message');
    const firstId = getPlayerNotice()!.id;
    reportPlayerNotice('bookkeeping', 'transition:two', 'Second', 'Second message');

    clearPlayerNotice(firstId);
    expect(getPlayerNotice()?.title).toBe('Second');
    clearPlayerNotice(getPlayerNotice()!.id);
    expect(getPlayerNotice()).toBeNull();
  });
});
