export const TRANSIENT_ROOT_ROUTE_NAMES = [
  'Profile',
  'Insights',
  'NowPlaying',
  'Queue',
  'PartyStart',
  'Party',
] as const;

/**
 * Tab back navigation walks recently visited tabs before leaving the app,
 * matching Android and TV rail expectations deterministically.
 */
export const TAB_BACK_BEHAVIOR = 'history' as const;

/**
 * Transient destinations always dismiss back to the durable tab topology.
 * Android dismissal is owned by system Back; native-stack `gestureEnabled`
 * is iOS-only and must not be represented as Android swipe support.
 */
export const transientModalScreenOptions = {
  headerShown: false,
  presentation: 'modal',
} as const;

/**
 * Reduced-motion-aware native-stack push transition. Never sets iOS-only
 * `gestureEnabled`.
 */
export function stackTransitionOptions(reducedMotion: boolean): {
  readonly animation: 'none' | 'slide_from_right';
} {
  return {
    animation: reducedMotion ? 'none' : 'slide_from_right',
  };
}

/**
 * Reduced-motion-aware transient modal screen options. Preserves the exact
 * Android Back dismissal policy (`headerShown: false`, `presentation: 'modal'`,
 * no `gestureEnabled`) while suppressing slide animations under reduced motion.
 */
export function buildTransientModalScreenOptions(reducedMotion: boolean): {
  readonly headerShown: false;
  readonly presentation: 'modal';
  readonly animation: 'none' | 'slide_from_bottom';
} {
  return {
    ...transientModalScreenOptions,
    animation: reducedMotion ? 'none' : 'slide_from_bottom',
  };
}
