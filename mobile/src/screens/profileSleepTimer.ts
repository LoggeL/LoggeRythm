import TrackPlayer from '@rntp/player';
import { currentTrackRemainingSeconds } from './profileModel';

export type ProfileSleepTimerState = ReturnType<typeof TrackPlayer.getSleepTimer>;

export interface SleepTimerGateway {
  read: () => ProfileSleepTimerState;
  activeIndex: () => number | null;
  progress: () => { position: number; duration: number };
  afterTime: (seconds: number, options?: { fadeOutSeconds?: number }) => void;
  afterMediaItem: (index: number) => void;
  cancel: () => void;
}

export type SleepTimerOperationErrorCode = 'no_active_track' | 'no_remaining_time';

export class SleepTimerOperationError extends Error {
  constructor(readonly code: SleepTimerOperationErrorCode) {
    super(code);
    this.name = 'SleepTimerOperationError';
  }
}

export const nativeSleepTimerGateway: SleepTimerGateway = {
  read: TrackPlayer.getSleepTimer,
  activeIndex: TrackPlayer.getActiveMediaItemIndex,
  progress: TrackPlayer.getProgress,
  afterTime: TrackPlayer.sleepAfterTime,
  afterMediaItem: TrackPlayer.sleepAfterMediaItemAtIndex,
  cancel: TrackPlayer.cancelSleepTimer,
};

export function setPresetSleepTimer(
  minutes: number,
  gateway: SleepTimerGateway = nativeSleepTimerGateway,
): ProfileSleepTimerState {
  const seconds = Math.round(minutes * 60);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError('Sleep timer must be positive');
  const fadeOutSeconds = Math.min(5, seconds);
  gateway.afterTime(seconds, { fadeOutSeconds });
  // Native commands cross an asynchronous MediaSession boundary, while
  // getSleepTimer() reads the service's persisted snapshot synchronously. An
  // immediate read can therefore return the previous timer for one poll. Give
  // the UI the exact command state now; its one-second native read reconciles
  // the authoritative countdown afterwards.
  return { type: 'time', remainingSeconds: seconds, fadeOutSeconds };
}

export function setEndOfTrackSleepTimer(
  gateway: SleepTimerGateway = nativeSleepTimerGateway,
): ProfileSleepTimerState {
  const index = gateway.activeIndex();
  if (index === null || index < 0) throw new SleepTimerOperationError('no_active_track');
  gateway.afterMediaItem(index);
  return { type: 'mediaItem', index };
}

export function setCurrentTrackRemainingSleepTimer(
  gateway: SleepTimerGateway = nativeSleepTimerGateway,
): ProfileSleepTimerState {
  if (gateway.activeIndex() === null) throw new SleepTimerOperationError('no_active_track');
  const progress = gateway.progress();
  const seconds = currentTrackRemainingSeconds(progress.position, progress.duration);
  if (seconds === null) throw new SleepTimerOperationError('no_remaining_time');
  const fadeOutSeconds = Math.min(5, seconds);
  gateway.afterTime(seconds, { fadeOutSeconds });
  return { type: 'time', remainingSeconds: seconds, fadeOutSeconds };
}

export function clearSleepTimer(
  gateway: SleepTimerGateway = nativeSleepTimerGateway,
): ProfileSleepTimerState {
  gateway.cancel();
  return null;
}
