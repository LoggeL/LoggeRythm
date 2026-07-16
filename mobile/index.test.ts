import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHeadlessTask: vi.fn(),
  registerRootComponent: vi.fn(),
  registerBackgroundEventHandler: vi.fn(),
  drainDurablePlaybackEvents: vi.fn(async () => ({ claimed: 0, completed: 0, retried: 0 })),
  handleBackgroundPlaybackEvent: vi.fn(async () => undefined),
}));

vi.mock('react-native', () => ({
  AppRegistry: { registerHeadlessTask: mocks.registerHeadlessTask },
}));
vi.mock('expo', () => ({ registerRootComponent: mocks.registerRootComponent }));
vi.mock('./App', () => ({ default: function TestApp() {} }));
vi.mock('./src/player/player', () => ({
  default: { registerBackgroundEventHandler: mocks.registerBackgroundEventHandler },
}));
vi.mock('./src/player/controller', () => ({
  drainDurablePlaybackEvents: mocks.drainDurablePlaybackEvents,
  handleBackgroundPlaybackEvent: mocks.handleBackgroundPlaybackEvent,
}));

describe('mobile entry point', () => {
  it('registers the exact durable playback headless task before the app', async () => {
    await import('./index');

    expect(mocks.registerHeadlessTask).toHaveBeenCalledOnce();
    expect(mocks.registerHeadlessTask.mock.calls[0]?.[0]).toBe('LoggeRythmPlaybackEventDrain');
    const provider = mocks.registerHeadlessTask.mock.calls[0]?.[1] as () => () => Promise<void>;
    await provider()();
    expect(mocks.drainDurablePlaybackEvents).toHaveBeenCalledOnce();
    expect(mocks.registerBackgroundEventHandler).toHaveBeenCalledOnce();
    expect(mocks.registerRootComponent).toHaveBeenCalledOnce();
    expect(mocks.registerHeadlessTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerRootComponent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
