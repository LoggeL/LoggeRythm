import { describe, expect, it, vi } from 'vitest';
import {
  SleepTimerOperationError,
  clearSleepTimer,
  setCurrentTrackRemainingSleepTimer,
  setEndOfTrackSleepTimer,
  setPresetSleepTimer,
  type SleepTimerGateway,
} from './profileSleepTimer';
import { SLEEP_PRESETS_MINUTES } from './profileModel';

vi.mock('@rntp/player', () => ({
  default: {
    cancelSleepTimer: vi.fn(),
    getActiveMediaItemIndex: vi.fn(() => null),
    getProgress: vi.fn(() => ({ position: 0, duration: 0 })),
    getSleepTimer: vi.fn(() => null),
    sleepAfterMediaItemAtIndex: vi.fn(),
    sleepAfterTime: vi.fn(),
  },
}));

function gateway(overrides: Partial<SleepTimerGateway> = {}): SleepTimerGateway {
  return {
    read: vi.fn(() => null),
    activeIndex: vi.fn(() => 2),
    progress: vi.fn(() => ({ position: 10.25, duration: 20 })),
    afterTime: vi.fn(),
    afterMediaItem: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe('native profile sleep timer orchestration', () => {
  it('exposes exactly the production 15/30/45/60 minute presets', () => {
    expect(SLEEP_PRESETS_MINUTES).toEqual([15, 30, 45, 60]);
  });

  it.each(SLEEP_PRESETS_MINUTES)('sets the %i-minute preset as a native wall-clock timer', (minutes) => {
    const target = gateway();
    const result = setPresetSleepTimer(minutes, target);
    const seconds = minutes * 60;
    expect(target.afterTime).toHaveBeenCalledWith(seconds, { fadeOutSeconds: 5 });
    expect(result).toEqual({ type: 'time', remainingSeconds: seconds, fadeOutSeconds: 5 });
    expect(target.read).not.toHaveBeenCalled();
  });

  it('targets the actual active queue item for end-of-track', () => {
    const target = gateway();
    const result = setEndOfTrackSleepTimer(target);
    expect(target.afterMediaItem).toHaveBeenCalledWith(2);
    expect(result).toEqual({ type: 'mediaItem', index: 2 });
    expect(target.read).not.toHaveBeenCalled();
  });

  it('does not let the native fallback silently target queue item zero', () => {
    const target = gateway({ activeIndex: () => null });
    expect(() => setEndOfTrackSleepTimer(target)).toThrowError(
      expect.objectContaining({ code: 'no_active_track' }),
    );
    expect(target.afterMediaItem).not.toHaveBeenCalled();
  });

  it('uses the current track remainder as the countdown', () => {
    const target = gateway();
    const result = setCurrentTrackRemainingSleepTimer(target);
    expect(target.afterTime).toHaveBeenCalledWith(10, { fadeOutSeconds: 5 });
    expect(result).toEqual({ type: 'time', remainingSeconds: 10, fadeOutSeconds: 5 });
  });

  it('reports unavailable duration separately from an absent track', () => {
    const target = gateway({ progress: () => ({ position: 0, duration: 0 }) });
    expect(() => setCurrentTrackRemainingSleepTimer(target)).toThrowError(
      expect.objectContaining({ code: 'no_remaining_time' }),
    );
    expect(() => setCurrentTrackRemainingSleepTimer(
      gateway({ activeIndex: () => null }),
    )).toThrow(SleepTimerOperationError);
  });

  it('cancels through the native timer boundary', () => {
    const target = gateway();
    expect(clearSleepTimer(target)).toBeNull();
    expect(target.cancel).toHaveBeenCalledOnce();
    expect(target.read).not.toHaveBeenCalled();
  });
});
