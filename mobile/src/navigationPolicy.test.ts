import { describe, expect, it } from 'vitest';
import {
  buildTransientModalScreenOptions,
  stackTransitionOptions,
  TAB_BACK_BEHAVIOR,
  TRANSIENT_ROOT_ROUTE_NAMES,
  transientModalScreenOptions,
} from './navigationPolicy';

describe('root navigation dismissal policy', () => {
  it('keeps transient routes modal and delegates Android dismissal to system Back', () => {
    expect(TRANSIENT_ROOT_ROUTE_NAMES).toEqual([
      'Profile',
      'NowPlaying',
      'Queue',
      'Party',
      'PlaylistInvite',
    ]);
    expect(transientModalScreenOptions).toEqual({
      headerShown: false,
      presentation: 'modal',
    });
    expect(transientModalScreenOptions).not.toHaveProperty('gestureEnabled');
  });

  it('uses history tab back behavior and reduced-motion-aware stack & modal transitions', () => {
    expect(TAB_BACK_BEHAVIOR).toBe('history');
    expect(stackTransitionOptions(false)).toEqual({ animation: 'slide_from_right' });
    expect(stackTransitionOptions(true)).toEqual({ animation: 'none' });

    const normalModal = buildTransientModalScreenOptions(false);
    expect(normalModal).toEqual({
      headerShown: false,
      presentation: 'modal',
      animation: 'slide_from_bottom',
    });
    expect(normalModal).not.toHaveProperty('gestureEnabled');

    const reducedModal = buildTransientModalScreenOptions(true);
    expect(reducedModal).toEqual({
      headerShown: false,
      presentation: 'modal',
      animation: 'none',
    });
    expect(reducedModal).not.toHaveProperty('gestureEnabled');
  });
});
