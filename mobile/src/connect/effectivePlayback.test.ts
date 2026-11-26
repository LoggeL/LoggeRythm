import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectPlaybackState, PartyState } from '../api/types';

const harness = vi.hoisted(() => ({
  remote: null as Partial<ConnectPlaybackState> | null,
  controllingRemote: false,
  party: null as Partial<PartyState> | null,
  sendCommand: vi.fn(async () => undefined),
  controlPrev: vi.fn(async () => undefined),
  prevRestartsTrack: vi.fn((): boolean | null => false),
  prev: vi.fn(),
  reportPlayerError: vi.fn(),
}));

vi.mock('./activeConnect', () => ({
  activeConnectRouter: () => ({
    isControllingRemote: () => harness.controllingRemote,
    remotePlayback: () => harness.remote,
    sendCommand: harness.sendCommand,
  }),
}));
vi.mock('../party/activeParty', () => ({
  activePartyRouter: () => harness.party === null
    ? null
    : {
        getSnapshot: () => ({ party: harness.party, detached: false }),
        controlPrev: harness.controlPrev,
      },
}));
vi.mock('../player/controller', () => ({
  PREVIOUS_RESTARTS_AFTER_SEC: 3,
  prevRestartsTrack: harness.prevRestartsTrack,
  prev: harness.prev,
}));
vi.mock('./effectivePlaybackState', () => ({}));
vi.mock('../player/player', () => ({ RepeatMode: { Off: 0, Track: 1, Queue: 2 } }));
vi.mock('../player/errors', () => ({ reportPlayerError: harness.reportPlayerError }));
vi.mock('../localization', () => ({
  strings: { player: { previousFailed: 'Zurück fehlgeschlagen' }, party: { controlledByHost: () => 'Host' } },
}));

const { effectivePrev, effectivePrevRestartsTrack } = await import('./effectivePlayback');

const NOW = Date.parse('2026-11-26T12:00:00Z');

function remote(overrides: Partial<ConnectPlaybackState>): void {
  harness.controllingRemote = true;
  harness.remote = {
    current_index: 2,
    is_playing: false,
    position_sec: 1,
    duration_sec: 200,
    updated_at: null,
    ...overrides,
  };
}

function guest(overrides: Partial<PartyState>): void {
  harness.party = {
    is_host: false,
    guests_can_control: true,
    current_index: 2,
    is_playing: false,
    position_sec: 1,
    playback_updated_at: null,
    ...overrides,
  };
}

describe('effectivePrevRestartsTrack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    harness.remote = null;
    harness.controllingRemote = false;
    harness.party = null;
    harness.prevRestartsTrack.mockReset();
    harness.prevRestartsTrack.mockReturnValue(false);
  });

  it('asks the local player when nothing else is in control', () => {
    expect(effectivePrevRestartsTrack()).toBe(false);
    harness.prevRestartsTrack.mockReturnValue(true);
    expect(effectivePrevRestartsTrack()).toBe(true);
    harness.prevRestartsTrack.mockReturnValue(null);
    expect(effectivePrevRestartsTrack()).toBe(false);
  });

  it('predicts a controlled remote from its playhead and first-track position', () => {
    remote({ position_sec: 1 });
    expect(effectivePrevRestartsTrack()).toBe(false);
    remote({ position_sec: 10 });
    expect(effectivePrevRestartsTrack()).toBe(true);
    // Playing since 5 s ago from 0 s: past the threshold by now.
    remote({ position_sec: 0, is_playing: true, updated_at: new Date(NOW - 5000).toISOString() });
    expect(effectivePrevRestartsTrack()).toBe(true);
    remote({ position_sec: 0, current_index: 0 });
    expect(effectivePrevRestartsTrack()).toBe(true);
    expect(harness.prevRestartsTrack).not.toHaveBeenCalled();
  });

  it('applies the Jam rule for a guest with control', () => {
    guest({ position_sec: 1 });
    expect(effectivePrevRestartsTrack()).toBe(false);
    guest({ position_sec: 8 });
    expect(effectivePrevRestartsTrack()).toBe(true);
    guest({ position_sec: 0, current_index: 0 });
    expect(effectivePrevRestartsTrack()).toBe(true);
    // Refused outright without control: nothing to predict.
    guest({ position_sec: 8, guests_can_control: false });
    expect(effectivePrevRestartsTrack()).toBe(false);
  });
});

describe('effectivePrev', () => {
  beforeEach(() => {
    harness.remote = null;
    harness.controllingRemote = false;
    harness.party = null;
    harness.sendCommand.mockReset();
    harness.reportPlayerError.mockClear();
  });

  it('reports a remote failure and tells the caller after the command was sent', async () => {
    remote({});
    harness.sendCommand.mockRejectedValueOnce(new Error('offline'));
    const onFailed = vi.fn();
    effectivePrev(onFailed);
    expect(onFailed).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(harness.reportPlayerError).toHaveBeenCalledWith('Zurück fehlgeschlagen', expect.any(Error));
  });

  it('runs without a failure callback, as the Now Playing screen calls it', async () => {
    remote({});
    harness.sendCommand.mockRejectedValueOnce(new Error('offline'));
    effectivePrev();
    await vi.waitFor(() => expect(harness.reportPlayerError).toHaveBeenCalledOnce());
  });
});
