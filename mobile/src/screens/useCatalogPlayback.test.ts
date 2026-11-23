import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import { catalogStrings } from './catalogStrings';
import { useCatalogPlayback } from './useCatalogPlayback';

const mocks = vi.hoisted(() => ({
  playTracks: vi.fn(),
  playTrackRow: vi.fn(),
  toggleShuffle: vi.fn(),
  setRuntimeError: vi.fn(),
  useState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});
vi.mock('../player/controller', () => ({
  playTracks: mocks.playTracks,
  playTrackRow: mocks.playTrackRow,
  toggleShuffle: mocks.toggleShuffle,
}));

const track = { id: '7', title: 'Signal' } as Track;
const context = { type: 'album' as const, id: '9', label: 'Parity' };

describe('useCatalogPlayback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useState.mockReturnValue([null, mocks.setRuntimeError]);
    mocks.playTracks.mockResolvedValue(undefined);
    mocks.playTrackRow.mockResolvedValue('started-context');
    mocks.toggleShuffle.mockResolvedValue(true);
  });

  it('owns exactly one state cell so pinned hook orders stay stable', () => {
    useCatalogPlayback();
    expect(mocks.useState).toHaveBeenCalledOnce();
    expect(mocks.useState).toHaveBeenCalledWith(null);
  });

  it('starts the exact tracks at the exact index in the given context', () => {
    const tracks = [track, track];
    useCatalogPlayback().play(tracks, 1, context);

    expect(mocks.setRuntimeError).toHaveBeenCalledWith(null);
    expect(mocks.playTracks).toHaveBeenCalledWith(tracks, 1, { context });
  });

  it('reports an invalid selection instead of calling the player', () => {
    useCatalogPlayback().play([], 0, context);

    expect(mocks.playTracks).not.toHaveBeenCalled();
    expect(mocks.setRuntimeError).toHaveBeenCalledWith(catalogStrings.common.playbackFailed);
  });

  it('surfaces a rejected start as one sanitized message', async () => {
    mocks.playTracks.mockRejectedValue(new Error('native queue detail'));
    useCatalogPlayback().play([track], 0, context);
    await vi.waitFor(() => expect(mocks.setRuntimeError).toHaveBeenCalledTimes(2));

    expect(mocks.setRuntimeError).toHaveBeenLastCalledWith(catalogStrings.common.playbackFailed);
    expect(mocks.setRuntimeError).not.toHaveBeenCalledWith(
      expect.stringContaining('native queue detail'),
    );
  });

  it('delegates row taps to playTrackRow so tapping the active track toggles play/pause', () => {
    const tracks = [track, track];
    useCatalogPlayback().playRow(tracks, 1, context);

    expect(mocks.setRuntimeError).toHaveBeenCalledWith(null);
    expect(mocks.playTrackRow).toHaveBeenCalledWith(tracks, 1, { context });
    expect(mocks.playTracks).not.toHaveBeenCalled();
  });

  it('starts context playback and enables shuffle for shuffle actions', async () => {
    const tracks = [track, { ...track, id: '8' } as Track];
    useCatalogPlayback().shuffle(tracks, context);

    await vi.waitFor(() => expect(mocks.toggleShuffle).toHaveBeenCalledOnce());
    expect(mocks.playTracks).toHaveBeenCalledWith(tracks, expect.any(Number), { context });
  });
});
