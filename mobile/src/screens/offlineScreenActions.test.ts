import { describe, expect, it, vi } from 'vitest';
import { runOfflinePlaylistScreenAction } from './offlineScreenActions';

describe('offline playlist screen action', () => {
  it('refreshes native browse exactly once after the transaction commits', async () => {
    let commit: (() => void) | undefined;
    const action = vi.fn(() => new Promise<void>((resolve) => { commit = resolve; }));
    const refresh = vi.fn(async () => undefined);

    const pending = runOfflinePlaylistScreenAction(action, refresh);
    expect(action).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();

    commit?.();
    await pending;
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not refresh native browse when the storage transaction fails', async () => {
    const error = new Error('storage failed');
    const refresh = vi.fn(async () => undefined);

    await expect(runOfflinePlaylistScreenAction(
      vi.fn(async () => { throw error; }),
      refresh,
    )).rejects.toBe(error);
    expect(refresh).not.toHaveBeenCalled();
  });
});
