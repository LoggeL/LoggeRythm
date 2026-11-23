import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueueDrag } from './useQueueDrag';

const harness = vi.hoisted(() => ({
  hapticTrigger: vi.fn(() => true),
  refs: new Map<number, { current: unknown }>(),
  refCursor: 0,
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useEffect: (effect: () => void) => {
    effect();
  },
  useMemo: (factory: () => unknown) => factory(),
  useRef: <T,>(initial: T) => {
    const slot = harness.refCursor++;
    if (!harness.refs.has(slot)) {
      harness.refs.set(slot, { current: initial });
    }
    return harness.refs.get(slot);
  },
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
}));

vi.mock('react-native', () => ({
  Animated: {
    Value: class MockAnimatedValue {
      setValue = vi.fn();
    },
  },
}));

vi.mock('../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: harness.hapticTrigger }),
}));

describe('useQueueDrag haptics', () => {
  beforeEach(() => {
    harness.refs.clear();
    harness.refCursor = 0;
    harness.hapticTrigger.mockClear();
  });

  it('triggers drag haptic on lift, commit haptic on drop, and tap haptic on handle tap', () => {
    const onTap = vi.fn();
    const onDrop = vi.fn();
    const rows = [
      { stableId: 'a', origin: 'context' as const },
      { stableId: 'b', origin: 'context' as const },
      { stableId: 'c', origin: 'context' as const },
    ];
    const controller = useQueueDrag({
      rows,
      activeIndex: 0,
      disabled: false,
      onTap,
      onDrop,
    });

    const frame = {
      measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(0, 100, 360, 400),
    };
    const rowB = {
      measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(0, 160, 360, 64),
    };
    const rowC = {
      measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(0, 224, 360, 64),
    };
    controller.attachFrame(frame as never);
    controller.attachRow('b')(rowB as never);
    controller.attachRow('c')(rowC as never);

    // Quick tap without dragging triggers 'tap' haptic + onTap
    const handlersB = controller.handlersFor('b');
    handlersB.onResponderGrant({ nativeEvent: { pageY: 180 } } as never);
    handlersB.onResponderRelease();
    expect(harness.hapticTrigger).toHaveBeenCalledWith('tap');
    expect(onTap).toHaveBeenCalledWith('b');

    // Drag lift past threshold triggers 'drag' haptic, drop at new position triggers 'commit'
    harness.hapticTrigger.mockClear();
    handlersB.onResponderGrant({ nativeEvent: { pageY: 180 } } as never);
    handlersB.onResponderMove({ nativeEvent: { pageY: 200 } } as never);
    expect(harness.hapticTrigger).toHaveBeenCalledWith('drag');

    handlersB.onResponderMove({ nativeEvent: { pageY: 260 } } as never);
    handlersB.onResponderRelease();
    expect(harness.hapticTrigger).toHaveBeenCalledWith('commit');
    expect(onDrop).toHaveBeenCalledWith(1, 2);
  });
});
