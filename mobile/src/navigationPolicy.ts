export const TRANSIENT_ROOT_ROUTE_NAMES = ['Profile', 'NowPlaying', 'Queue'] as const;

/**
 * Transient destinations always dismiss back to the durable tab topology.
 * Android dismissal is owned by system Back; native-stack `gestureEnabled`
 * is iOS-only and must not be represented as Android swipe support.
 */
export const transientModalScreenOptions = {
  headerShown: false,
  presentation: 'modal',
} as const;
