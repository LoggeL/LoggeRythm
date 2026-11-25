import { describe, expect, it, vi } from 'vitest';
import { byTestId } from '../../test/render';
import { classifyVisualizerError, VisualizerBars } from './VisualizerStage';

vi.mock('react-native', () => ({
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' },
    RESULTS: { GRANTED: 'granted' },
    check: vi.fn(),
    request: vi.fn(),
  },
  Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
vi.mock('../../player/nativeAudioCraft', () => ({
  isNativeMethodAvailable: () => true,
  setVisualizerEnabled: vi.fn(),
  subscribeVisualizerFrames: vi.fn(() => vi.fn()),
}));

describe('VisualizerStage', () => {
  it('classifies native visualizer permission and session errors loudly', () => {
    const permErr = Object.assign(new Error('RECORD_AUDIO denied'), {
      code: 'visualizer-permission-denied',
    });
    expect(classifyVisualizerError(permErr).kind).toBe('permission-denied');

    const sessionErr = Object.assign(new Error('Audio session 0'), {
      code: 'visualizer-session-unavailable',
    });
    expect(classifyVisualizerError(sessionErr).kind).toBe('session-unavailable');

    expect(classifyVisualizerError(new Error('Unexpected crash')).kind).toBe('generic');
  });

  it('renders 28 spectrum bars from visualizer frame magnitudes', () => {
    const bands = Array.from({ length: 28 }, (_, i) => (i + 1) / 28);
    const tree = VisualizerBars({ bands, bass: 0.75, maxBarHeight: 120 });
    expect(byTestId(tree, 'visualizer-bars')).toBeDefined();
  });
});
