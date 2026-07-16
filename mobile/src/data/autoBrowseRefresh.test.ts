import { describe, expect, it, vi } from 'vitest';
import { refreshLibraryAutoBrowse } from './autoBrowseRefresh';

describe('Library Android Auto refresh', () => {
  it('waits for a successful native publication', async () => {
    const refresh = vi.fn(async () => undefined);

    await expect(refreshLibraryAutoBrowse(refresh)).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not turn publication or presentation failure into mutation failure', async () => {
    const failure = new Error('Auto unavailable');
    const onError = vi.fn(() => { throw new Error('notice unavailable'); });

    await expect(
      refreshLibraryAutoBrowse(vi.fn(async () => { throw failure; }), onError),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});
