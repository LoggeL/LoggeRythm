import { describe, expect, it } from 'vitest';
import { AccountCleanupBarrier, AuthCommitBarrier } from './cleanupBarrier';

describe('AccountCleanupBarrier', () => {
  it('keeps failed cleanup mandatory until an explicit successful completion', () => {
    const barrier = new AccountCleanupBarrier();
    expect(barrier.needsCleanup).toBe(false);

    barrier.require('https://prod.example|account:7');
    expect(barrier.needsCleanup).toBe(true);
    expect(barrier.accountScope).toBe('https://prod.example|account:7');

    barrier.complete();
    expect(barrier.needsCleanup).toBe(false);
    expect(barrier.accountScope).toBeNull();
  });

  it('does not lose a known departing scope during a later generic retry', () => {
    const barrier = new AccountCleanupBarrier();
    barrier.require('https://prod.example|account:7');
    barrier.require(null);

    expect(barrier.needsCleanup).toBe(true);
    expect(barrier.accountScope).toBe('https://prod.example|account:7');
  });
});

describe('AuthCommitBarrier', () => {
  it('rejects every identity result captured before account cleanup', () => {
    const barrier = new AuthCommitBarrier();
    const stale = barrier.capture();

    barrier.invalidate();

    expect(() => barrier.assertCurrent(stale)).toThrow(
      'Authentication result was invalidated by account cleanup',
    );
    expect(() => barrier.assertCurrent(barrier.capture())).not.toThrow();
  });
});
