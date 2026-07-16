import { describe, expect, it } from 'vitest';
import { TRANSIENT_ROOT_ROUTE_NAMES, transientModalScreenOptions } from './navigationPolicy';

describe('root navigation dismissal policy', () => {
  it('keeps transient routes modal and delegates Android dismissal to system Back', () => {
    expect(TRANSIENT_ROOT_ROUTE_NAMES).toEqual(['Profile', 'NowPlaying', 'Queue']);
    expect(transientModalScreenOptions).toEqual({
      headerShown: false,
      presentation: 'modal',
    });
    expect(transientModalScreenOptions).not.toHaveProperty('gestureEnabled');
  });
});
