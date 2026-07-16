import { describe, expect, it } from 'vitest';
import {
  MAX_TOTAL_RECOVERY_ATTEMPTS,
  classifyPlaybackFailure,
  createRecoveryBudget,
  nextRecoveryAttempt,
  observeRecoveryProgress,
  reclassifyRecoveryAttempt,
  recoveryPolicy,
  transitionRecoveryBudget,
} from './recoveryPolicy';

describe('playback recovery classification', () => {
  it.each([
    [{ status: 0, message: 'timed out' }, 'network'],
    [{ status: 401, message: 'expired' }, 'session'],
    [{ status: 403, message: 'forbidden' }, 'authorization'],
    [{ status: 404, message: 'missing' }, 'source'],
    [{ status: 416, message: 'range' }, 'source'],
    [{ status: 502, message: 'materialization failed' }, 'backend'],
  ] as const)('uses authenticated preload status %j as %s', (preloadError, expected) => {
    expect(classifyPlaybackFailure({ code: 'unknown', message: '' }, preloadError)).toBe(expected);
  });

  it('distinguishes native network, HTTP, codec, source, and unknown failures', () => {
    expect(classifyPlaybackFailure({ code: 'network', message: 'socket closed' })).toBe('network');
    expect(classifyPlaybackFailure({ code: 'source', message: 'HTTP status 403' })).toBe(
      'authorization',
    );
    expect(classifyPlaybackFailure({ code: 'source', message: 'HTTP 416' })).toBe('source');
    expect(classifyPlaybackFailure({ code: 'source', message: 'unsupported audio codec' })).toBe(
      'renderer',
    );
    expect(classifyPlaybackFailure({ code: 'source', message: 'bad source' })).toBe('source');
    expect(classifyPlaybackFailure({ code: 'unknown', message: 'mystery' })).toBe('unknown');
  });

  it('keeps global connectivity failures in place while item-specific failures may skip', () => {
    expect(recoveryPolicy('network').exhaustionAction).toBe('stop');
    expect(recoveryPolicy('session').exhaustionAction).toBe('stop');
    expect(recoveryPolicy('unknown').exhaustionAction).toBe('stop');
    expect(recoveryPolicy('authorization').exhaustionAction).toBe('skip');
    expect(recoveryPolicy('source').exhaustionAction).toBe('skip');
    expect(recoveryPolicy('renderer').exhaustionAction).toBe('skip');
  });
});

describe('playback recovery budget', () => {
  it('applies bounded category-specific attempts and backoff', () => {
    let state = transitionRecoveryBudget(createRecoveryBudget(), 'queue:1', 0, 0);
    const observed: [number, number][] = [];
    for (;;) {
      const decision = nextRecoveryAttempt(state, 'network');
      state = decision.state;
      if (!decision.allowed) break;
      observed.push([decision.attempt, decision.delayMs]);
    }

    expect(observed).toEqual([
      [1, 0],
      [2, 250],
      [3, 750],
    ]);
    expect(state.totalAttempts).toBe(3);
  });

  it('reclassifies one probe without increasing the total budget', () => {
    let state = transitionRecoveryBudget(createRecoveryBudget(), 'queue:1', 0, 0);
    state = nextRecoveryAttempt(state, 'source').state;
    state = reclassifyRecoveryAttempt(state, 'source', 'backend');

    expect(state.attemptsByCategory.source).toBe(0);
    expect(state.attemptsByCategory.backend).toBe(1);
    expect(state.totalAttempts).toBe(1);
  });

  it('resets only for a different item or plausible real progress', () => {
    let state = transitionRecoveryBudget(createRecoveryBudget(), 'queue:1', 0, 0);
    state = nextRecoveryAttempt(state, 'renderer').state;

    const stalled = observeRecoveryProgress(state, 'queue:1', 1, 5_000);
    expect(stalled.reset).toBe(false);
    expect(stalled.state.totalAttempts).toBe(1);

    const seek = observeRecoveryProgress(stalled.state, 'queue:1', 40, 6_000);
    expect(seek.reset).toBe(false);
    expect(seek.state.totalAttempts).toBe(1);

    const progressed = observeRecoveryProgress(seek.state, 'queue:1', 44, 10_000);
    expect(progressed.reset).toBe(true);
    expect(progressed.state.totalAttempts).toBe(0);

    const retried = nextRecoveryAttempt(progressed.state, 'renderer').state;
    const transitioned = transitionRecoveryBudget(retried, 'queue:2', 0, 11_000);
    expect(transitioned.totalAttempts).toBe(0);
  });

  it('never exceeds the global per-item cap when error categories alternate', () => {
    let state = transitionRecoveryBudget(createRecoveryBudget(), 'queue:1', 0, 0);
    const categories = ['network', 'backend', 'unknown'] as const;
    let allowed = 0;
    for (let index = 0; index < 20; index += 1) {
      const decision = nextRecoveryAttempt(state, categories[index % categories.length]);
      state = decision.state;
      if (decision.allowed) allowed += 1;
    }
    expect(allowed).toBe(MAX_TOTAL_RECOVERY_ATTEMPTS);
  });
});
