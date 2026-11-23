import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import { UserFacingPlayerError } from '../player/errors';
import type { MediaPlayFromSearchRequest } from './mediaPlayFromSearchIntent';
import { attachMediaPlayFromSearchIntake } from './voicePlaybackRuntime';

const mocks = vi.hoisted(() => ({
  onRequest: null as ((request: MediaPlayFromSearchRequest) => void) | null,
  onError: null as ((error: unknown) => void) | null,
  stopIntake: vi.fn(),
  execute: vi.fn(),
  reportPlayerError: vi.fn(),
  reportPlayerNotice: vi.fn(),
  announce: vi.fn(),
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
}));
vi.mock('../data/repositories', () => ({ musicRepository: {} }));
vi.mock('../player/controller', () => ({
  playTracks: vi.fn(),
  playTrackWithRadio: vi.fn(),
  TrackRadioError: class TrackRadioError extends Error {},
}));
vi.mock('../player/player', () => ({
  default: {
    getActiveMediaItem: vi.fn(() => null),
    getQueue: vi.fn(() => []),
    isPlaying: vi.fn(() => false),
    play: vi.fn(),
  },
}));
vi.mock('../player/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../player/errors')>();
  return {
    ...actual,
    reportPlayerError: mocks.reportPlayerError,
  };
});
vi.mock('../player/notices', () => ({
  reportPlayerNotice: mocks.reportPlayerNotice,
}));
vi.mock('./mediaPlayFromSearchIntent', () => ({
  startMediaPlayFromSearchIntake: vi.fn((onRequest, onError) => {
    mocks.onRequest = onRequest;
    mocks.onError = onError;
    return mocks.stopIntake;
  }),
}));
vi.mock('./mediaPlayFromSearch', () => ({
  executeMediaPlayFromSearch: mocks.execute,
}));

function makeRequest(query: string): MediaPlayFromSearchRequest {
  return {
    query,
    mediaFocus: null,
    focusKind: 'unstructured',
    artist: null,
    album: null,
    title: null,
    playlist: null,
    genre: null,
  };
}

describe('attachMediaPlayFromSearchIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onRequest = null;
    mocks.onError = null;
  });

  it('does not start native intake when accountScope is null (unauthenticated)', () => {
    const stop = attachMediaPlayFromSearchIntake(null, vi.fn());
    stop();
    expect(mocks.onRequest).toBeNull();
    expect(mocks.stopIntake).not.toHaveBeenCalled();
  });

  it('serializes back-to-back voice requests so concurrent intents never race playback', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    mocks.execute
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            order.push('start-1');
            releaseFirst = () => {
              order.push('end-1');
              resolve({ kind: 'resumed' });
            };
          }),
      )
      .mockImplementationOnce(async () => {
        order.push('start-2');
        return { kind: 'resumed' };
      });

    const stop = attachMediaPlayFromSearchIntake('user:1', vi.fn());
    mocks.onRequest!(makeRequest('first'));
    mocks.onRequest!(makeRequest('second'));

    await Promise.resolve();
    expect(order).toEqual(['start-1']);

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['start-1', 'end-1', 'start-2']);

    stop();
    expect(mocks.stopIntake).toHaveBeenCalledTimes(1);
  });

  it('reports execution errors and malformed intent bridge errors loudly', async () => {
    const failure = new UserFacingPlayerError(strings.voice.noMatchesFor('missing'));
    mocks.execute.mockRejectedValueOnce(failure);

    attachMediaPlayFromSearchIntake('user:1', vi.fn());
    mocks.onRequest!(makeRequest('missing'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.voice.playFromSearchFailed,
      failure,
    );
    expect(mocks.announce).toHaveBeenCalledWith(
      `${strings.voice.playFromSearchFailed}: ${strings.voice.noMatchesFor('missing')}`,
    );

    mocks.onError!(new Error('corrupt json'));
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.voice.playFromSearchFailed,
      new UserFacingPlayerError(strings.voice.invalidIntentPayload),
    );
  });
});
