export type NowPlayingBody = 'loading' | 'empty' | 'content';

/**
 * The authenticated navigator normally gates this screen on player readiness.
 * Keeping readiness explicit prevents a future deep-link/cold-start path from
 * misreporting an unhydrated native player as an actually empty queue.
 */
export function resolveNowPlayingBody(
  playerReady: boolean,
  hasActiveTrack: boolean,
): NowPlayingBody {
  if (!playerReady) return 'loading';
  return hasActiveTrack ? 'content' : 'empty';
}
