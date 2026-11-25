import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseHttpError } from '../../api/sseStream';
import type { openPlaylistEventsStream } from '../../data/playlistEventsStream';
import { PlaylistLiveSyncBanner } from './PlaylistLiveSyncBanner';

const harness = vi.hoisted(() => ({
  connectivity: 'online' as 'online' | 'offline',
  openStream: vi.fn(),
  invalidateQueries: vi.fn(async () => undefined),
  announceForAccessibility: vi.fn(),
  effects: [] as (() => (() => void) | undefined)[],
  stateValues: [] as unknown[],
  stateSetters: [] as ReturnType<typeof vi.fn>[],
  stateSlot: 0,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (fn: () => (() => void) | undefined) => {
      harness.effects.push(fn);
    },
    useRef: <T,>(initial: T) => ({ current: initial }),
    useState: <T,>(initial: T) => {
      const slot = harness.stateSlot++;
      if (slot >= harness.stateValues.length) {
        harness.stateValues[slot] = initial;
        harness.stateSetters[slot] = vi.fn((next: T) => {
          harness.stateValues[slot] = next;
        });
      }
      return [harness.stateValues[slot] as T, harness.stateSetters[slot]];
    },
    useSyncExternalStore: () => ({ status: harness.connectivity }),
  };
});
vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: harness.announceForAccessibility },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: harness.invalidateQueries }),
}));
vi.mock('../../api/client', () => ({
  authenticatedHeadersFor: vi.fn(),
}));
vi.mock('../../config', () => ({
  getApiBase: vi.fn(async () => 'https://music.test'),
}));
vi.mock('../../connectivity/store', () => ({
  getConnectivitySnapshot: () => ({ status: harness.connectivity }),
  subscribeConnectivity: () => () => undefined,
}));
vi.mock('../../data/playlistEventsStream', () => ({
  openPlaylistEventsStream: harness.openStream,
}));
vi.mock('../ui', () => ({
  ActionButton: 'ActionButton',
  AppText: 'AppText',
}));

type StreamHandlers = Parameters<typeof openPlaylistEventsStream>[1];

describe('PlaylistLiveSyncBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    harness.connectivity = 'online';
    harness.effects.length = 0;
    harness.stateValues.length = 0;
    harness.stateSetters.length = 0;
    harness.stateSlot = 0;
    harness.openStream.mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not open an SSE stream for non-collaborative personal playlists', () => {
    const tree = PlaylistLiveSyncBanner({
      playlistId: 10,
      scope: 'https://music.test::user:1',
      currentRevision: 2,
      focused: true,
      isCollaborative: false,
      onExit: vi.fn(),
    });
    for (const effect of harness.effects) effect();

    expect(tree).toBeNull();
    expect(harness.openStream).not.toHaveBeenCalled();
  });

  it('transitions to revoked without retrying on terminal HTTP 403', async () => {
    let handlers: StreamHandlers | null = null;
    harness.openStream.mockImplementationOnce(async (_id: number, h: StreamHandlers) => {
      handlers = h;
      return vi.fn();
    });

    PlaylistLiveSyncBanner({
      playlistId: 10,
      scope: 'https://music.test::user:1',
      currentRevision: 2,
      focused: true,
      isCollaborative: true,
      onExit: vi.fn(),
    });
    for (const effect of harness.effects) effect();
    await Promise.resolve();

    expect(handlers).not.toBeNull();
    handlers!.onClosed(new SseHttpError(403, 'Playlist events stream rejected with HTTP 403'));

    // Terminal state slot 0 becomes 'revoked'; no reconnect timer scheduled.
    expect(harness.stateValues[0]).toBe('revoked');
    vi.advanceTimersByTime(20_000);
    expect(harness.openStream).toHaveBeenCalledTimes(1);
  });

  it('transitions to deleted without retrying on terminal HTTP 404', async () => {
    let handlers: StreamHandlers | null = null;
    harness.openStream.mockImplementationOnce(async (_id: number, h: StreamHandlers) => {
      handlers = h;
      return vi.fn();
    });

    PlaylistLiveSyncBanner({
      playlistId: 10,
      scope: 'https://music.test::user:1',
      currentRevision: 2,
      focused: true,
      isCollaborative: true,
      onExit: vi.fn(),
    });
    for (const effect of harness.effects) effect();
    await Promise.resolve();

    handlers!.onClosed(new SseHttpError(404, 'Playlist events stream rejected with HTTP 404'));

    expect(harness.stateValues[0]).toBe('deleted');
    vi.advanceTimersByTime(20_000);
    expect(harness.openStream).toHaveBeenCalledTimes(1);
  });

  it('stops reconnecting and surfaces error loudly on terminal HTTP 401', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let handlers: StreamHandlers | null = null;
    harness.openStream.mockImplementationOnce(async (_id: number, h: StreamHandlers) => {
      handlers = h;
      return vi.fn();
    });

    PlaylistLiveSyncBanner({
      playlistId: 10,
      scope: 'https://music.test::user:1',
      currentRevision: 2,
      focused: true,
      isCollaborative: true,
      onExit: vi.fn(),
    });
    for (const effect of harness.effects) effect();
    await Promise.resolve();

    handlers!.onClosed(new SseHttpError(401, 'Playlist events stream rejected with HTTP 401'));

    expect(harness.stateValues[0]).toBeNull();
    expect(String(harness.stateValues[1])).toContain('HTTP 401');
    vi.advanceTimersByTime(20_000);
    expect(harness.openStream).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('retries after 5s on transient network closures', async () => {
    let handlers: StreamHandlers | null = null;
    harness.openStream.mockImplementation(async (_id: number, h: StreamHandlers) => {
      handlers = h;
      return vi.fn();
    });

    PlaylistLiveSyncBanner({
      playlistId: 10,
      scope: 'https://music.test::user:1',
      currentRevision: 2,
      focused: true,
      isCollaborative: true,
      onExit: vi.fn(),
    });
    for (const effect of harness.effects) effect();
    await Promise.resolve();

    handlers!.onClosed(new Error('network error'));
    expect(String(harness.stateValues[1])).toContain('network error');

    vi.advanceTimersByTime(5_000);
    expect(harness.openStream).toHaveBeenCalledTimes(2);
  });
});
